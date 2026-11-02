import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import supertest from "supertest";
import { parse } from "csv-parse/sync";
import { createApp } from "../server/app.js";
import { connect, migrate } from "../server/db.js";
import { codeHash, digest, passwordHash } from "../server/security.js";
const pepper = "a".repeat(64),
  password = "Prueba-Admin-2026-Segura",
  code = "ABCD2345EFGH6789";
function fixture(t, { open = true, limits = false, idle = 90 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ov-test-")),
    path = join(dir, "test.sqlite");
  let db = connect(path);
  migrate(db);
  db.prepare("INSERT INTO admin VALUES(1,?)").run(passwordHash(password));
  db.prepare(
    "INSERT INTO participants(id,name,table_id,code_hash,issued) VALUES(?,?,?,?,1)",
  ).run("EMP1", "Ana López", 1, codeHash(code, pepper));
  if (open) db.exec("UPDATE election SET status='open'");
  const app = createApp(db, {
    pepper,
    testLimits: !limits,
    voterIdleSeconds: idle,
  });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, path, app, api: supertest(app) };
}
function post(api, path, body, token) {
  const req = api
    .post(path)
    .set("Host", "localhost")
    .set("Origin", "http://localhost");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body);
}
async function voter(f) {
  const r = await post(f.api, "/api/voter/login", { code });
  assert.equal(r.status, 200);
  return r.body.token;
}
async function admin(f) {
  const agent = supertest.agent(f.app);
  const r = await post(agent, "/api/admin/login", { password });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf };
}
function adminPost(a, path, body) {
  return post(a.agent, `/api/admin${path}`, body).set("X-CSRF-Token", a.csrf);
}
test("voto único: anónimo, definitivo y persistente; repetir código o token falla", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  const r = await post(f.api, "/api/voter/vote", { tableId: 2 }, token);
  assert.equal(r.status, 200);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 3 }, token)).status,
    401,
  );
  assert.equal((await post(f.api, "/api/voter/login", { code })).status, 401);
  assert.equal(
    f.db.prepare("SELECT voted,code_hash FROM participants").get().voted,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT code_hash FROM participants").get().code_hash,
    null,
  );
  assert.deepEqual(
    f.db
      .prepare("PRAGMA table_info(ballots)")
      .all()
      .map((x) => x.name),
    ["id", "table_id"],
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit").get().n, 0);
  const second = connect(f.path);
  assert.equal(second.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  second.close();
});
test("prohíbe voto propio y mantiene el código habilitado", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 1 }, token)).status,
    403,
  );
  assert.equal(f.db.prepare("SELECT voted FROM participants").get().voted, 0);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 6 }, token)).status,
    200,
  );
});
test("rechaza código inválido, inyección SQL y código ya utilizado sin filtrar identidad", async (t) => {
  const f = fixture(t);
  for (const code of ["AAAAAAAAAAAAAAAA", "' OR 1=1 --", "", null]) {
    const r = await post(f.api, "/api/voter/login", { code });
    assert.equal(r.status, 401);
    assert.ok(!JSON.stringify(r.body).includes("Ana"));
  }
});
test("concurrencia HTTP: una única papeleta ante 25 solicitudes simultáneas", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  const server = f.app.listen(0);
  server.setMaxListeners(100);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const http = supertest(server);
  const responses = await Promise.all(
    Array.from({ length: 25 }, () =>
      post(http, "/api/voter/vote", { tableId: 2 }, token),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
});
test("concurrencia SQLite real: conexiones en hilos independientes compiten por el mismo voto", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  const workers = Array.from(
    { length: 8 },
    (_, i) =>
      new Worker(new URL("./concurrent-worker.js", import.meta.url), {
        workerData: { path: f.path, hash: digest(token), tableId: 2 + (i % 5) },
      }),
  );
  t.after(() => Promise.all(workers.map((w) => w.terminate())));
  await Promise.all(workers.map((w) => once(w, "message")));
  const responses = workers.map((w) => once(w, "message"));
  workers.forEach((w) => w.postMessage("go"));
  const replies = await Promise.all(responses);
  assert.equal(replies.filter(([r]) => r.ok).length, 1);
  assert.equal(
    f.db.prepare("SELECT SUM(voted) n FROM participants").get().n,
    1,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
});
test("rollback atómico: fallo de papeleta no consume al participante", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  f.db.exec(
    "CREATE TRIGGER test_failure BEFORE INSERT ON ballots BEGIN SELECT RAISE(ABORT,'fallo simulado'); END;",
  );
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, token)).status,
    500,
  );
  assert.equal(f.db.prepare("SELECT voted FROM participants").get().voted, 0);
  assert.notEqual(
    f.db.prepare("SELECT code_hash FROM participants").get().code_hash,
    null,
  );
  f.db.exec("DROP TRIGGER test_failure");
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, token)).status,
    200,
  );
});
test("votación cerrada: no admite autenticación ni votos con sesión previa", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  f.db.exec("UPDATE election SET status='closed'");
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, token)).status,
    409,
  );
  assert.equal((await post(f.api, "/api/voter/login", { code })).status, 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 0);
});
test("manipulación de solicitudes: rechaza campos extra, impide identidad y mesa arbitrarias", async (t) => {
  const f = fixture(t),
    token = await voter(f);
  for (const body of [
    { tableId: 0 },
    { tableId: 7 },
    { tableId: "2" },
    { tableId: 2.5 },
    { tableId: 2, participantId: "OTRA" },
    { tableId: 2, ownTable: 6 },
    { tableId: 2, code },
    { mesa: 2 },
    [2],
    null,
  ])
    assert.equal(
      (await post(f.api, "/api/voter/vote", body, token)).status,
      400,
    );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 0);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, "b".repeat(64)))
      .status,
    401,
  );
});
test("privacidad: API pública sin datos privados, admin protegido y resultados ocultos durante apertura", async (t) => {
  const f = fixture(t),
    a = await admin(f);
  const pub = await f.api.get("/api/public");
  assert.deepEqual(Object.keys(pub.body).sort(), [
    "idleSeconds",
    "offerings",
    "status",
  ]);
  assert.equal((await f.api.get("/api/admin/dashboard")).status, 401);
  assert.equal((await a.agent.get("/api/admin/results")).status, 409);
  assert.equal((await a.agent.get("/api/admin/results.csv")).status, 409);
  const dashboard = (await a.agent.get("/api/admin/dashboard")).body;
  assert.ok(!JSON.stringify(dashboard).includes("code_hash"));
  assert.ok(!JSON.stringify(dashboard).includes("password_hash"));
  assert.ok(!JSON.stringify(dashboard).includes("ballots"));
  assert.ok(!JSON.stringify(dashboard).includes("votes"));
  assert.equal(pub.headers["cache-control"], "no-store, max-age=0");
});
test("sesiones de kiosco: sin cookie, sesión nueva revoca anterior, logout y caducidad", async (t) => {
  const f = fixture(t);
  const r = await post(f.api, "/api/voter/login", { code });
  assert.equal(r.headers["set-cookie"], undefined);
  const token2 = await voter(f);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, r.body.token)).status,
    401,
  );
  assert.equal(
    (await post(f.api, "/api/voter/logout", {}, token2)).status,
    200,
  );
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, token2)).status,
    401,
  );
  const token3 = await voter(f);
  f.db.prepare("UPDATE voter_sessions SET expires=?").run(Date.now() - 100);
  assert.equal(
    (await post(f.api, "/api/voter/activity", {}, token3)).status,
    401,
  );
});
test("admin: cookie HttpOnly/SameSite, origen obligatorio y CSRF", async (t) => {
  const f = fixture(t),
    a = await admin(f);
  const r = await post(f.api, "/api/admin/login", { password });
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
  assert.match(r.headers["set-cookie"][0], /SameSite=Strict/);
  assert.equal((await post(a.agent, "/api/admin/logout", {})).status, 403);
  assert.equal(
    (await f.api.post("/api/admin/login").send({ password })).status,
    403,
  );
  assert.equal(
    (
      await f.api
        .post("/api/admin/login")
        .set("Origin", "https://evil.test")
        .send({ password })
    ).status,
    403,
  );
  assert.equal((await adminPost(a, "/logout", {})).status, 200);
  assert.equal((await a.agent.get("/api/admin/dashboard")).status, 401);
});
test("importación CSV: valida lote completo, duplicados, correo, mesa y campos", async (t) => {
  const f = fixture(t, { open: false }),
    a = await admin(f);
  for (const csv of [
    "identificador,nombre,correo,mesa\nA,Ana,,2\nB,Beto,,7",
    "identificador,nombre,correo,mesa\nA,Ana,,2\na,Ana,,3",
    "identificador,nombre,correo,mesa\nEMP1,Ana,,2",
    "identificador,nombre,correo,mesa\nX,Ana,xxx,2",
    "id,nombre,mesa\nX,Ana,2",
  ]) {
    assert.ok(
      (await adminPost(a, "/participants/import", { csv })).status >= 400,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM participants").get().n,
      1,
    );
  }
  const r = await adminPost(a, "/participants/import", {
    csv: '\uFEFFidentificador,nombre,correo,mesa\r\nEMP2,"Pérez, Luis",,6',
  });
  assert.equal(r.status, 201);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM participants").get().n, 2);
});
test("códigos: exportación única, hash en DB, regeneración invalida anterior y sesión", async (t) => {
  const f = fixture(t, { open: false }),
    a = await admin(f);
  await adminPost(a, "/participants", {
    id: "EMP2",
    name: "Luis Pérez",
    email: "",
    tableId: 2,
  });
  const r = await adminPost(a, "/codes/export", { password });
  assert.equal(r.status, 200);
  const rows = parse(r.text, { columns: true, bom: true });
  assert.equal(rows.length, 1);
  assert.match(rows[0].codigo, /^[A-HJ-NP-Z2-9]{16}$/);
  assert.notEqual(
    f.db.prepare("SELECT code_hash FROM participants WHERE id='EMP2'").get()
      .code_hash,
    rows[0].codigo,
  );
  assert.equal((await adminPost(a, "/codes/export", { password })).status, 409);
  f.db.exec("UPDATE election SET status='open'");
  const token = await voter(f);
  const regen = await adminPost(a, "/codes/regenerate", {
    id: "EMP1",
    confirmation: "EMP1",
    password,
  });
  assert.equal(regen.status, 200);
  assert.equal((await post(f.api, "/api/voter/login", { code })).status, 401);
  assert.equal(
    (await post(f.api, "/api/voter/vote", { tableId: 2 }, token)).status,
    401,
  );
  const fresh = parse(regen.text, { columns: true, bom: true })[0].codigo;
  const session = await post(f.api, "/api/voter/login", { code: fresh });
  await post(f.api, "/api/voter/vote", { tableId: 2 }, session.body.token);
  assert.equal(
    (
      await adminPost(a, "/codes/regenerate", {
        id: "EMP1",
        confirmation: "EMP1",
        password,
      })
    ).status,
    409,
  );
});
test("apertura bloquea altas/fotos, cierre irreversible y resultados con empates", async (t) => {
  const f = fixture(t, { open: false }),
    a = await admin(f);
  assert.equal(
    (await adminPost(a, "/election", { action: "open", password })).status,
    200,
  );
  assert.equal(
    (
      await adminPost(a, "/participants", {
        id: "EMP2",
        name: "Luis Pérez",
        tableId: 2,
      })
    ).status,
    409,
  );
  assert.throws(() => f.db.prepare("UPDATE participants SET table_id=2").run());
  assert.throws(() => f.db.prepare("UPDATE offerings SET name='otra'").run());
  assert.throws(() => f.db.prepare("DELETE FROM offerings WHERE id=1").run());
  assert.equal(
    (await adminPost(a, "/election", { action: "close", password })).status,
    200,
  );
  assert.equal(
    (await adminPost(a, "/election", { action: "open", password })).status,
    409,
  );
  const r = await a.agent.get("/api/admin/results");
  assert.equal(r.status, 200);
  assert.equal(r.body.ranking.length, 6);
  assert.ok(
    r.body.ranking.every(
      (x) => x.votes === 0 && x.rank === 1 && x.tied && x.percent === 0,
    ),
  );
  assert.equal((await a.agent.get("/api/admin/results.csv")).status, 200);
});
test("foto local PNG persistente y rechazo de SVG", async (t) => {
  const f = fixture(t, { open: false }),
    a = await admin(f);
  const upload = (buf, name) =>
    a.agent
      .put("/api/admin/offerings/1")
      .set("Host", "localhost")
      .set("Origin", "http://localhost")
      .set("X-CSRF-Token", a.csrf)
      .field("name", "Ofrenda de Ana")
      .attach("photo", buf, name);
  assert.equal((await upload(Buffer.from("<svg/>"), "bad.svg")).status, 400);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMesAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal((await upload(png, "foto.png")).status, 200);
  const r = await f.api.get("/api/offerings/1/photo");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /image\/png/);
  assert.equal(
    f.db.prepare("SELECT name FROM offerings WHERE id=1").get().name,
    "Ofrenda de Ana",
  );
});
test("rate limiting códigos y administrador", async (t) => {
  const f = fixture(t, { limits: true });
  for (let i = 0; i < 30; i++)
    await post(f.api, "/api/voter/login", { code: "AAAAAAAAAAAAAAAA" });
  assert.equal((await post(f.api, "/api/voter/login", { code })).status, 429);
  for (let i = 0; i < 8; i++)
    await post(f.api, "/api/admin/login", { password: "incorrecta" });
  assert.equal(
    (await post(f.api, "/api/admin/login", { password })).status,
    429,
  );
});

test("editar durante preparación invalida código al cambiar mesa; después de abrir está bloqueado", async (t) => {
  const f = fixture(t, { open: false }),
    a = await admin(f);
  const update = (body) =>
    a.agent
      .put("/api/admin/participants/EMP1")
      .set("Host", "localhost")
      .set("Origin", "http://localhost")
      .set("X-CSRF-Token", a.csrf)
      .send(body);
  assert.equal(
    (
      await update({
        name: "Ana actualizada",
        email: "ana@inconnect.local",
        tableId: 3,
      })
    ).status,
    200,
  );
  const p = f.db.prepare("SELECT * FROM participants").get();
  assert.equal(p.table_id, 3);
  assert.equal(p.code_hash, null);
  assert.equal(p.issued, 0);
  assert.equal(
    (await adminPost(a, "/election", { action: "open", password })).status,
    409,
  );
  await adminPost(a, "/codes/export", { password });
  assert.equal(
    (await adminPost(a, "/election", { action: "open", password })).status,
    200,
  );
  assert.equal(
    (await update({ name: "Ana actualizada", email: "", tableId: 1 })).status,
    409,
  );
  assert.equal(
    f.db.prepare("SELECT table_id FROM participants").get().table_id,
    3,
  );
});
