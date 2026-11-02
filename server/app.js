import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { resolve } from "node:path";
import { castVote } from "./voting.js";
import { atomic, audit, state, participation } from "./db.js";
import {
  assert,
  exact,
  token,
  digest,
  codeHash,
  generateCode,
  passwordOK,
  csv,
} from "./security.js";

export function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      hsts: config.secure ? undefined : false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected = `${config.secure ? "https" : "http"}://${req.get("host")}`;
      const allowed = [expected, ...(config.origins || [])];
      if (
        !origin ||
        !allowed.includes(origin) ||
        req.get("sec-fetch-site") === "cross-site"
      )
        return res
          .status(403)
          .json({ error: "Origen de solicitud no permitido." });
    }
    next();
  });
  const now = () => Date.now();
  const idle = (config.voterIdleSeconds || 90) * 1000;
  const max = (config.voterMaxSeconds || 600) * 1000;
  const adminIdle = (config.adminIdleSeconds || 1800) * 1000;
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: !!config.secure,
    path: "/api/admin",
    maxAge: adminIdle,
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 },
  });
  const limit = (n, ms = 15 * 60 * 1000) =>
    rateLimit({
      windowMs: ms,
      limit: n,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_q, s) =>
        s.status(429).json({
          error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.",
        }),
    });
  const codeLimit = limit(config.testLimits ? 10000 : 30);
  const loginLimit = limit(config.testLimits ? 10000 : 8);
  const getAdmin = (req) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ov_admin="))
      ?.slice(9);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return;
    return db
      .prepare("SELECT * FROM admin_sessions WHERE token_hash=? AND expires>?")
      .get(digest(raw), now());
  };
  const admin = (req, res, next) => {
    const s = getAdmin(req);
    if (!s)
      return res
        .status(401)
        .json({ error: "Inicia sesión como administrador." });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("x-csrf-token") !== s.csrf
    )
      return res
        .status(403)
        .json({ error: "Sesión de seguridad inválida. Recarga el panel." });
    db.prepare("UPDATE admin_sessions SET expires=? WHERE token_hash=?").run(
      now() + adminIdle,
      s.token_hash,
    );
    req.adminSession = s;
    next();
  };
  const voter = (req, res, next) => {
    const raw = req.get("authorization")?.replace(/^Bearer /, "");
    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
      return res.status(401).json({ error: "Ingresa nuevamente tu código." });
    const s = db
      .prepare(
        "SELECT * FROM voter_sessions WHERE token_hash=? AND expires>? AND deadline>?",
      )
      .get(digest(raw), now(), now());
    if (!s)
      return res
        .status(401)
        .json({ error: "Tu sesión terminó. Ingresa nuevamente tu código." });
    req.voter = s;
    next();
  };
  const draft = () =>
    assert(
      state(db) === "draft",
      409,
      "Esta operación está bloqueada porque el concurso ya inició.",
    );
  const reauth = (body) =>
    assert(
      passwordOK(
        body.password,
        db.prepare("SELECT password_hash FROM admin WHERE id=1").get()
          ?.password_hash,
      ),
      403,
      "Contraseña administrativa incorrecta.",
    );
  const offeringList = () =>
    db
      .prepare(
        "SELECT id,name,photo IS NOT NULL AS hasPhoto FROM offerings ORDER BY id",
      )
      .all();
  const results = () => {
    assert(
      state(db) === "closed",
      409,
      "Los resultados solo están disponibles después del cierre.",
    );
    const p = participation(db);
    const rows = db
      .prepare(
        "SELECT o.id,o.name,COUNT(b.id) AS votes FROM offerings o LEFT JOIN ballots b ON b.table_id=o.id GROUP BY o.id ORDER BY votes DESC,o.id",
      )
      .all();
    return {
      participation: p,
      ranking: rows.map((r) => ({
        ...r,
        percent: p.voted ? +((100 * r.votes) / p.voted).toFixed(2) : 0,
        rank: 1 + rows.filter((x) => x.votes > r.votes).length,
        tied: rows.filter((x) => x.votes === r.votes).length > 1,
      })),
    };
  };
  app.get("/api/public", (_q, res) =>
    res.json({
      status: state(db),
      offerings: offeringList(),
      idleSeconds: idle / 1000,
    }),
  );
  app.get("/api/offerings/:id/photo", (req, res) => {
    const r = db
      .prepare("SELECT photo,mime FROM offerings WHERE id=?")
      .get(req.params.id);
    if (!r?.photo) return res.sendStatus(404);
    res
      .type(r.mime)
      .set("Cache-Control", "no-store")
      .send(Buffer.from(r.photo));
  });
  app.post("/api/voter/login", codeLimit, (req, res) => {
    exact(req.body, ["code"]);
    assert(state(db) === "open", 409, "La votación no está abierta.");
    assert(
      typeof req.body.code === "string" &&
        /^[A-HJ-NP-Z2-9]{16}$/i.test(req.body.code),
      401,
      "Código inválido o no disponible.",
    );
    const result = atomic(db, () => {
      const p = db
        .prepare(
          "SELECT id,name,table_id,voted FROM participants WHERE code_hash=?",
        )
        .get(codeHash(req.body.code, config.pepper));
      assert(p && !p.voted, 401, "Código inválido o no disponible.");
      db.prepare(
        "DELETE FROM voter_sessions WHERE participant_id=? OR expires<? OR deadline<?",
      ).run(p.id, now(), now());
      const t = token();
      db.prepare("INSERT INTO voter_sessions VALUES(?,?,?,?)").run(
        digest(t),
        p.id,
        now() + idle,
        now() + max,
      );
      return {
        token: t,
        participant: { name: p.name, tableId: p.table_id },
        idleSeconds: idle / 1000,
      };
    });
    res.json(result);
  });
  app.post("/api/voter/activity", voter, (req, res) => {
    exact(req.body, []);
    db.prepare(
      "UPDATE voter_sessions SET expires=MIN(?,deadline) WHERE token_hash=?",
    ).run(now() + idle, req.voter.token_hash);
    res.json({ ok: true });
  });
  app.post("/api/voter/logout", voter, (req, res) => {
    db.prepare("DELETE FROM voter_sessions WHERE token_hash=?").run(
      req.voter.token_hash,
    );
    res.json({ ok: true });
  });
  app.post("/api/voter/vote", voter, (req, res) => {
    exact(req.body, ["tableId"]);
    assert(
      Number.isInteger(req.body.tableId) &&
        req.body.tableId >= 1 &&
        req.body.tableId <= 6,
      400,
      "Elige una mesa válida del 1 al 6.",
    );
    res.json(castVote(db, req.voter.token_hash, req.body.tableId));
  });
  app.post("/api/admin/login", loginLimit, (req, res) => {
    exact(req.body, ["password"]);
    reauth(req.body);
    const t = token(),
      csrf = token();
    db.prepare("DELETE FROM admin_sessions WHERE expires<?").run(now());
    db.prepare("INSERT INTO admin_sessions VALUES(?,?,?)").run(
      digest(t),
      csrf,
      now() + adminIdle,
    );
    audit(db, "admin_login");
    res.cookie("ov_admin", t, cookieOptions).json({ csrf });
  });
  app.use("/api/admin", admin);
  app.get("/api/admin/session", (req, res) =>
    res.json({ csrf: req.adminSession.csrf }),
  );
  app.post("/api/admin/logout", (req, res) => {
    db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(
      req.adminSession.token_hash,
    );
    res.clearCookie("ov_admin", cookieOptions).json({ ok: true });
  });
  app.get("/api/admin/dashboard", (_q, res) =>
    res.json({
      status: state(db),
      participation: participation(db),
      offerings: offeringList(),
      participants: db
        .prepare(
          "SELECT id,name,email,table_id AS tableId,voted,issued,code_hash IS NOT NULL AS enabled FROM participants ORDER BY table_id,name",
        )
        .all(),
    }),
  );
  function validateParticipant(r) {
    exact(r, ["id", "name", "email", "tableId"]);
    assert(
      typeof r.id === "string" && /^[\p{L}\p{N}_-]{1,64}$/u.test(r.id),
      400,
      "Identificador inválido (1–64 letras, números, guion o guion bajo).",
    );
    assert(
      typeof r.name === "string" &&
        r.name.trim().length >= 2 &&
        r.name.length <= 120 &&
        !/[\x00-\x1f]/.test(r.name),
      400,
      "Nombre inválido (2–120 caracteres).",
    );
    const email = r.email === undefined ? "" : r.email;
    assert(
      typeof email === "string" &&
        email.length <= 254 &&
        (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
      400,
      "Correo inválido.",
    );
    assert(
      Number.isInteger(r.tableId) && r.tableId >= 1 && r.tableId <= 6,
      400,
      "Mesa inválida: debe estar entre 1 y 6.",
    );
    return { ...r, name: r.name.trim(), email };
  }
  function addParticipants(rows) {
    assert(
      rows.length > 0 && rows.length <= 10000,
      400,
      "Importa entre 1 y 10000 participantes.",
    );
    const valid = rows.map(validateParticipant);
    const ids = new Set(
      db
        .prepare("SELECT id FROM participants")
        .all()
        .map((p) => p.id.toLowerCase()),
    );
    for (const r of valid) {
      assert(
        !ids.has(r.id.toLowerCase()) &&
          !db
            .prepare("SELECT id FROM participants WHERE lower(id)=lower(?)")
            .get(r.id),
        409,
        `Identificador duplicado: ${r.id}`,
      );
      ids.add(r.id.toLowerCase());
    }
    for (const r of valid)
      db.prepare(
        "INSERT INTO participants(id,name,email,table_id) VALUES(?,?,?,?)",
      ).run(r.id, r.name, r.email, r.tableId);
    return valid.length;
  }
  app.post("/api/admin/participants", (req, res) => {
    const count = atomic(db, () => {
      draft();
      const n = addParticipants([req.body]);
      audit(db, "participant_added", req.body.id);
      return n;
    });
    res.status(201).json({ count });
  });
  app.put("/api/admin/participants/:id", (req, res) => {
    exact(req.body, ["name", "email", "tableId"]);
    atomic(db, () => {
      draft();
      const existing = db
        .prepare("SELECT * FROM participants WHERE id=?")
        .get(req.params.id);
      assert(existing, 404, "Participante no encontrado.");
      const p = validateParticipant({ id: existing.id, ...req.body });
      const changed = existing.table_id !== p.tableId;
      db.prepare(
        "UPDATE participants SET name=?,email=?,table_id=?,code_hash=CASE WHEN ? THEN NULL ELSE code_hash END,issued=CASE WHEN ? THEN 0 ELSE issued END WHERE id=?",
      ).run(p.name, p.email, p.tableId, changed ? 1 : 0, changed ? 1 : 0, p.id);
      db.prepare("DELETE FROM voter_sessions WHERE participant_id=?").run(p.id);
      audit(db, "participant_updated", p.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/participants/import", (req, res) => {
    exact(req.body, ["csv"]);
    assert(typeof req.body.csv === "string", 400, "CSV requerido.");
    let records;
    try {
      records = parse(req.body.csv, {
        columns: (headers) => {
          assert(
            headers.length >= 3 &&
              headers.length <= 4 &&
              new Set(headers).size === headers.length &&
              headers.every((k) =>
                ["identificador", "nombre", "correo", "mesa"].includes(k),
              ) &&
              ["identificador", "nombre", "mesa"].every((k) =>
                headers.includes(k),
              ),
            400,
            "Encabezados CSV inválidos.",
          );
          return headers;
        },
        bom: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 10000,
      });
    } catch {
      assert(false, 400, "CSV mal formado.");
    }
    const rows = records.map((r) => {
      assert(
        Object.keys(r).length >= 3 &&
          Object.keys(r).every((k) =>
            ["identificador", "nombre", "correo", "mesa"].includes(k),
          ) &&
          ["identificador", "nombre", "mesa"].every((k) => k in r),
        400,
        "Encabezados esperados: identificador,nombre,correo,mesa.",
      );
      return {
        id: r.identificador,
        name: r.nombre,
        email: r.correo || "",
        tableId: /^[1-6]$/.test(r.mesa) ? Number(r.mesa) : 0,
      };
    });
    const count = atomic(db, () => {
      draft();
      const n = addParticipants(rows);
      audit(db, "participants_imported", String(n));
      return n;
    });
    res.status(201).json({ count });
  });
  function sendCodes(res, rows) {
    res
      .type("text/csv")
      .attachment("codigos-entrega-unica.csv")
      .send(csv([["identificador", "nombre", "mesa", "codigo"], ...rows]));
  }
  app.post("/api/admin/codes/export", (req, res) => {
    exact(req.body, ["password"]);
    reauth(req.body);
    const rows = atomic(db, () => {
      draft();
      const pending = db
        .prepare(
          "SELECT * FROM participants WHERE issued=0 AND voted=0 ORDER BY id",
        )
        .all();
      assert(pending.length, 409, "No hay códigos nuevos para exportar.");
      const rows = pending.map((p) => {
        const c = generateCode();
        db.prepare(
          "UPDATE participants SET code_hash=?,issued=1 WHERE id=?",
        ).run(codeHash(c, config.pepper), p.id);
        return [p.id, p.name, p.table_id, c];
      });
      audit(db, "codes_issued", String(rows.length));
      return rows;
    });
    sendCodes(res, rows);
  });
  app.post("/api/admin/codes/regenerate", (req, res) => {
    exact(req.body, ["id", "confirmation", "password"]);
    reauth(req.body);
    assert(
      typeof req.body.id === "string" && req.body.id === req.body.confirmation,
      400,
      "Confirma el identificador exacto.",
    );
    const rows = atomic(db, () => {
      assert(state(db) !== "closed", 409, "El concurso terminó.");
      const p = db
        .prepare("SELECT * FROM participants WHERE id=?")
        .get(req.body.id);
      assert(
        p && !p.voted,
        409,
        "Solo se regenera para participantes que no han votado.",
      );
      const c = generateCode();
      db.prepare("UPDATE participants SET code_hash=?,issued=1 WHERE id=?").run(
        codeHash(c, config.pepper),
        p.id,
      );
      db.prepare("DELETE FROM voter_sessions WHERE participant_id=?").run(p.id);
      audit(db, "code_regenerated", p.id);
      return [[p.id, p.name, p.table_id, c]];
    });
    sendCodes(res, rows);
  });
  app.put("/api/admin/offerings/:id", upload.single("photo"), (req, res) => {
    exact(req.body, ["name"]);
    const id = Number(req.params.id);
    assert(Number.isInteger(id) && id >= 1 && id <= 6, 400, "Mesa inválida.");
    assert(
      typeof req.body.name === "string" &&
        req.body.name.trim().length >= 2 &&
        req.body.name.length <= 100,
      400,
      "Nombre inválido.",
    );
    let mime = null;
    if (req.file) {
      const b = req.file.buffer;
      mime = b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : b[0] === 255 && b[1] === 216 && b[2] === 255
          ? "image/jpeg"
          : b.toString("ascii", 0, 4) === "RIFF" &&
              b.toString("ascii", 8, 12) === "WEBP"
            ? "image/webp"
            : null;
      assert(mime, 400, "Solo fotos PNG, JPG o WebP (máximo 5 MB).");
    }
    atomic(db, () => {
      draft();
      if (mime)
        db.prepare("UPDATE offerings SET name=?,photo=?,mime=? WHERE id=?").run(
          req.body.name.trim(),
          req.file.buffer,
          mime,
          id,
        );
      else
        db.prepare("UPDATE offerings SET name=? WHERE id=?").run(
          req.body.name.trim(),
          id,
        );
      audit(db, "offering_updated", String(id));
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/election", (req, res) => {
    exact(req.body, ["action", "password"]);
    reauth(req.body);
    assert(
      ["open", "close"].includes(req.body.action),
      400,
      "Acción inválida.",
    );
    atomic(db, () => {
      if (req.body.action === "open") {
        draft();
        const p = participation(db);
        assert(
          p.total > 0 &&
            !db
              .prepare(
                "SELECT id FROM participants WHERE issued=0 OR code_hash IS NULL LIMIT 1",
              )
              .get(),
          409,
          "Da de alta participantes y entrega todos los códigos antes de abrir.",
        );
        db.prepare("UPDATE election SET status='open' WHERE id=1").run();
      } else {
        assert(state(db) === "open", 409, "La votación no está abierta.");
        db.prepare("UPDATE election SET status='closed' WHERE id=1").run();
        db.prepare("DELETE FROM voter_sessions").run();
      }
      audit(db, `election_${req.body.action}`);
    });
    res.json({ status: state(db) });
  });
  app.get("/api/admin/results", (_q, res) => res.json(results()));
  app.get("/api/admin/results.csv", (_q, res) => {
    const r = results();
    res
      .type("text/csv")
      .attachment("resultados-ofrendavote.csv")
      .send(
        csv([
          ["lugar", "mesa", "ofrenda", "votos", "porcentaje", "empate"],
          ...r.ranking.map((x) => [
            x.rank,
            x.id,
            x.name,
            x.votes,
            x.percent,
            x.tied ? "sí" : "no",
          ]),
          [],
          ["participantes", r.participation.total],
          ["votaron", r.participation.voted],
          [
            "participacion_porcentaje",
            r.participation.total
              ? +(
                  (100 * r.participation.voted) /
                  r.participation.total
                ).toFixed(2)
              : 0,
          ],
        ]),
      );
  });
  app.get("/api/admin/audit", (_q, res) =>
    res.json(
      db
        .prepare(
          "SELECT action,subject,occurred_at FROM audit ORDER BY id DESC LIMIT 200",
        )
        .all(),
    ),
  );
  app.use("/api", (_q, res) =>
    res.status(404).json({ error: "Ruta no disponible." }),
  );
  app.use(
    express.static(resolve("dist"), {
      etag: false,
      setHeaders: (res) => res.set("Cache-Control", "no-store"),
    }),
  );
  app.get(["/", "/admin"], (_q, res) =>
    res.set("Cache-Control", "no-store").sendFile(resolve("dist/index.html")),
  );
  app.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({ error: "La foto supera 5 MB." });
    if (err instanceof multer.MulterError)
      return res.status(400).json({ error: "Archivo no válido." });
    const status =
      err.status || (err.type === "entity.parse.failed" ? 400 : 500);
    res.status(status).json({
      error:
        status < 500
          ? err.message
          : "No se pudo completar la operación. Inténtalo nuevamente.",
    });
  });
  return app;
}
