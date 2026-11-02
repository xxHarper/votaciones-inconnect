import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import {
  validateParticipant,
  idKey,
  parseParticipantsCSV,
  planImport,
  insertParticipant,
} from "./participants.js";
import {
  offeringList,
  photoList,
  optimizePhoto,
  saveGallery,
} from "./photos.js";
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
      offerings: offeringList(db),
      idleSeconds: idle / 1000,
    }),
  );
  app.get("/api/offerings/:id/photos/:photoId", (req, res) => {
    const p = db
      .prepare(
        "SELECT data,thumbnail,mime FROM offering_photos WHERE id=? AND offering_id=?",
      )
      .get(req.params.photoId, req.params.id);
    if (!p) return res.sendStatus(404);
    res
      .type(p.mime)
      .send(Buffer.from(req.query.size === "thumb" ? p.thumbnail : p.data));
  });
  app.get("/api/offerings/:id/photo", (req, res) => {
    const p = db
      .prepare(
        "SELECT data,mime FROM offering_photos WHERE offering_id=? AND is_primary=1",
      )
      .get(req.params.id);
    if (!p) return res.sendStatus(404);
    res.type(p.mime).send(Buffer.from(p.data));
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
          "SELECT id,name,table_id,type,voted FROM participants WHERE code_hash=?",
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
        participant: { name: p.name, tableId: p.table_id, type: p.type },
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
      offerings: offeringList(db),
      participants: db
        .prepare(
          "SELECT id,name,email,table_id AS tableId,type,voted,issued,code_hash IS NOT NULL AS enabled FROM participants ORDER BY table_id,name",
        )
        .all(),
    }),
  );
  function addParticipants(rows) {
    const valid = rows.map(validateParticipant),
      ids = new Set(
        db
          .prepare("SELECT id FROM participants")
          .all()
          .map((p) => idKey(p.id)),
      );
    for (const p of valid) {
      assert(!ids.has(idKey(p.id)), 409, `Identificador duplicado: ${p.id}`);
      ids.add(idKey(p.id));
    }
    valid.forEach((p) => insertParticipant(db, p));
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
    exact(req.body, ["name", "email", "tableId", "type"]);
    atomic(db, () => {
      draft();
      const existing = db
        .prepare("SELECT * FROM participants WHERE id=?")
        .get(req.params.id);
      assert(existing, 404, "Participante no encontrado.");
      const p = validateParticipant({ id: existing.id, ...req.body });
      const changed =
        existing.table_id !== p.tableId || existing.type !== p.type;
      db.prepare(
        "UPDATE participants SET name=?,email=?,table_id=?,type=?,code_hash=CASE WHEN ? THEN NULL ELSE code_hash END,issued=CASE WHEN ? THEN 0 ELSE issued END WHERE id=?",
      ).run(
        p.name,
        p.email,
        p.tableId,
        p.type,
        changed ? 1 : 0,
        changed ? 1 : 0,
        p.id,
      );
      db.prepare("DELETE FROM voter_sessions WHERE participant_id=?").run(p.id);
      audit(db, "participant_updated", p.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/participants/import/preview", (req, res) => {
    exact(req.body, ["csv"]);
    draft();
    res.json(planImport(db, parseParticipantsCSV(req.body.csv)));
  });
  app.post("/api/admin/participants/import", (req, res) => {
    exact(req.body, ["csv", "previewHash"]);
    const parsed = parseParticipantsCSV(req.body.csv);
    const result = atomic(db, () => {
      draft();
      const plan = planImport(db, parsed);
      if (parsed.format === "typed" || req.body.previewHash !== undefined)
        assert(
          req.body.previewHash === plan.previewHash,
          409,
          "La previsualización falta o cambió. Vuelve a revisar el archivo antes de confirmar.",
        );
      assert(
        plan.summary.conflicts === 0,
        409,
        "Hay identificadores existentes con datos distintos. No se reemplazó ningún registro.",
      );
      plan.rows
        .filter((r) => r.status === "new")
        .forEach((p) => insertParticipant(db, p));
      if (plan.summary.new)
        audit(db, "participants_imported", String(plan.summary.new));
      return {
        count: plan.summary.new,
        skipped: plan.summary.existing,
        total: plan.summary.total,
      };
    });
    res.status(201).json(result);
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
  const galleryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 4 },
  });
  app.put(
    "/api/admin/offerings/:id/gallery",
    (req, res, next) => {
      draft();
      next();
    },
    galleryUpload.array("photos", 5),
    async (req, res) => {
      exact(req.body, ["name", "version", "manifest"]);
      let manifest;
      try {
        manifest = JSON.parse(req.body.manifest);
      } catch {
        assert(false, 400, "Galería inválida.");
      }
      const uploads = [];
      for (const file of req.files || [])
        uploads.push(await optimizePhoto(file));
      res.json(
        saveGallery(db, {
          id: Number(req.params.id),
          name: req.body.name,
          version: /^\d+$/.test(req.body.version)
            ? Number(req.body.version)
            : -1,
          manifest,
          uploads,
        }),
      );
    },
  );
  // Compatibilidad con el editor anterior de una fotografía: sustituye la principal.
  app.put(
    "/api/admin/offerings/:id",
    (req, res, next) => {
      draft();
      next();
    },
    upload.single("photo"),
    async (req, res) => {
      exact(req.body, ["name"]);
      const id = Number(req.params.id),
        o = db.prepare("SELECT * FROM offerings WHERE id=?").get(id);
      assert(o, 400, "Mesa inválida.");
      const photos = photoList(db, id),
        uploads = req.file ? [await optimizePhoto(req.file)] : [];
      let manifest = photos.map((p) => ({ id: p.id, primary: !!p.isPrimary }));
      if (req.file) {
        const index = manifest.findIndex((p) => p.primary);
        if (index < 0) manifest.push({ upload: 0, primary: true });
        else manifest[index] = { upload: 0, primary: true };
      }
      res.json(
        saveGallery(db, {
          id,
          name: req.body.name,
          version: o.gallery_version,
          manifest,
          uploads,
        }),
      );
    },
  );
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
