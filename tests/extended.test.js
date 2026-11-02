import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import supertest from "supertest";
import sharp from "sharp";
import { parse } from "csv-parse/sync";
import { connect, migrate } from "../server/db.js";
import { createApp } from "../server/app.js";
import { passwordHash, digest, codeHash } from "../server/security.js";
import { castVote } from "../server/voting.js";
import { optimizePhoto, saveGallery } from "../server/photos.js";
import { parseParticipantsCSV } from "../server/participants.js";
const password = "Prueba-Ampliacion-Segura",
  pepper = "d".repeat(64),
  hash = passwordHash(password);
const photo = readFileSync(new URL("./fixtures/photo.png", import.meta.url));
const counts = [8, 6, 8, 6, 5, 1];
const generatedCSV = () => {
  const rows = ["id_participante,nombre,mesa,tipo"];
  let id = 0;
  for (let table = 1; table <= 6; table++)
    for (let i = 0; i < counts[table - 1]; i++)
      rows.push(
        `OF-${String(++id).padStart(3, "0")},Persona de prueba ${id},${table},integrante`,
      );
  for (let i = 0; i < 6; i++)
    rows.push(
      `OF-${String(++id).padStart(3, "0")},Persona de prueba ${id},,solo_votante`,
    );
  return "\uFEFF" + rows.join("\r\n");
};
const realCSV = process.env.REAL_PARTICIPANTS_CSV
  ? readFileSync(process.env.REAL_PARTICIPANTS_CSV, "utf8")
  : generatedCSV();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "ov-ext-")),
    path = join(dir, "test.sqlite"),
    db = connect(path);
  migrate(db);
  db.prepare("INSERT INTO admin VALUES(1,?)").run(hash);
  const app = createApp(db, { pepper, testLimits: true });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const agent = supertest.agent(app);
  return { db, dir, path, app, api: supertest(app), agent };
}
function post(api, path, body, token) {
  const r = api
    .post(path)
    .set("Host", "localhost")
    .set("Origin", "http://localhost");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
async function loginAdmin(f) {
  const r = await post(f.agent, "/api/admin/login", { password });
  assert.equal(r.status, 200);
  f.csrf = r.body.csrf;
  return f;
}
function adminPost(f, path, body) {
  return post(f.agent, `/api/admin${path}`, body).set("X-CSRF-Token", f.csrf);
}
async function importCSV(f, content = realCSV) {
  const preview = await adminPost(f, "/participants/import/preview", {
    csv: content,
  });
  assert.equal(preview.status, 200, preview.body.error);
  const commit = await adminPost(f, "/participants/import", {
    csv: content,
    previewHash: preview.body.previewHash,
  });
  assert.equal(commit.status, 201, commit.body.error);
  return { preview: preview.body, commit: commit.body };
}
async function codesAndOpen(f) {
  const r = await adminPost(f, "/codes/export", { password });
  assert.equal(r.status, 200, r.body.error);
  const codes = parse(r.text, { columns: true, bom: true });
  assert.equal(
    (await adminPost(f, "/election", { action: "open", password })).status,
    200,
  );
  return codes;
}
function putGallery(
  f,
  {
    table = 1,
    name = "Ofrenda de prueba",
    version = 0,
    manifest = [],
    files = [],
  } = {},
) {
  let req = f.agent
    .put(`/api/admin/offerings/${table}/gallery`)
    .set("Host", "localhost")
    .set("Origin", "http://localhost")
    .set("X-CSRF-Token", f.csrf)
    .field("name", name)
    .field("version", String(version))
    .field("manifest", JSON.stringify(manifest));
  for (const file of files)
    req = req.attach("photos", Buffer.isBuffer(file) ? file : file.buffer, {
      filename: file.name || "foto.png",
      contentType: file.mime || "image/png",
    });
  return req;
}
const uploadsManifest = (n) =>
  Array.from({ length: n }, (_, i) => ({ upload: i, primary: i === 0 }));

test("CSV de 40 personas: previsualiza distribución, confirma y reimporta idempotentemente sin cambiar códigos", async (t) => {
  const f = await loginAdmin(fixture(t));
  const first = await adminPost(f, "/participants/import/preview", {
    csv: realCSV,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.summary.total, 40);
  assert.equal(first.body.rows.length, 40);
  assert.deepEqual(
    first.body.distribution.tables.map((r) => r.total),
    counts,
  );
  assert.equal(first.body.distribution.solo, 6);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM participants").get().n, 0);
  const request = { csv: realCSV, previewHash: first.body.previewHash };
  assert.equal(
    (await adminPost(f, "/participants/import", request)).body.count,
    40,
  );
  const delivery = await adminPost(f, "/codes/export", { password });
  assert.equal(delivery.status, 200);
  const codes = parse(delivery.text, { columns: true, bom: true });
  assert.equal(codes.length, 40);
  assert.equal(new Set(codes.map((r) => r.codigo)).size, 40);
  assert.ok(codes.every((r) => /^[A-HJ-NP-Z2-9]{16}$/.test(r.codigo)));
  assert.equal(codes.filter((r) => r.mesa === "").length, 6);
  const before = f.db.prepare("SELECT * FROM participants ORDER BY id").all();
  const second = await adminPost(f, "/participants/import", request);
  assert.equal(second.status, 201);
  assert.equal(second.body.count, 0);
  assert.equal(second.body.skipped, 40);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM participants ORDER BY id").all(),
    before,
  );
  const dash = (await f.agent.get("/api/admin/dashboard")).body;
  assert.equal(dash.participation.total, 40);
  assert.equal(dash.participation.solo.total, 6);
  assert.deepEqual(
    dash.participation.tables.map((r) => r.total),
    counts,
  );
});
test("CSV valida tipos, mesa vacía, duplicados y nombres; conflictos no sobrescriben ni importan parcialmente", async (t) => {
  const f = await loginAdmin(fixture(t));
  for (const row of [
    "A,Ana,,integrante",
    "A,Ana,1,solo_votante",
    "A,Ana,,otro",
    "A,Ana,7,integrante",
    "A,Ana,0,integrante",
    "A A,Ana,1,integrante",
    "A,A,1,integrante",
    "A,Ana,1,integrante\nA,Ana,1,integrante",
  ]) {
    const r = await adminPost(f, "/participants/import/preview", {
      csv: "id_participante,nombre,mesa,tipo\n" + row,
    });
    assert.ok(r.status >= 400, r.text);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM participants").get().n,
      0,
    );
  }
  await importCSV(f);
  const conflict =
    realCSV.replace(
      /OF-001,[^,]+,1,integrante/,
      "OF-001,Nombre diferente,1,integrante",
    ) + "\nNUEVO,Persona nueva,,solo_votante";
  const preview = await adminPost(f, "/participants/import/preview", {
    csv: conflict,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.conflicts, 1);
  assert.equal(
    (
      await adminPost(f, "/participants/import", {
        csv: conflict,
        previewHash: preview.body.previewHash,
      })
    ).status,
    409,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM participants").get().n, 40);
  assert.equal(
    (await adminPost(f, "/participants/import", { csv: realCSV })).status,
    409,
  );
});
test("cada uno de los seis solo_votante puede elegir cualquiera de las seis mesas; voto único e integrantes bloqueados", async (t) => {
  for (let choice = 1; choice <= 6; choice++) {
    const f = await loginAdmin(fixture(t));
    await importCSV(f);
    const codes = await codesAndOpen(f);
    for (const row of codes.filter((r) => r.mesa === "")) {
      const login = await post(f.api, "/api/voter/login", { code: row.codigo });
      assert.equal(login.status, 200);
      assert.equal(login.body.participant.tableId, null);
      assert.equal(login.body.participant.type, "solo_votante");
      const token = login.body.token;
      assert.equal(
        (await post(f.api, "/api/voter/vote", { tableId: choice }, token))
          .status,
        200,
      );
      assert.equal(
        (
          await post(
            f.api,
            "/api/voter/vote",
            { tableId: choice === 6 ? 1 : choice + 1 },
            token,
          )
        ).status,
        401,
      );
      assert.equal(
        (await post(f.api, "/api/voter/login", { code: row.codigo })).status,
        401,
      );
    }
    for (let own = 1; own <= 6; own++) {
      const row = codes.find((r) => Number(r.mesa) === own);
      const login = await post(f.api, "/api/voter/login", { code: row.codigo });
      assert.equal(
        (
          await post(
            f.api,
            "/api/voter/vote",
            { tableId: own },
            login.body.token,
          )
        ).status,
        403,
      );
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 6);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM participants WHERE voted=1").get().n,
      6,
    );
    const before = f.db
      .prepare("SELECT id,voted,code_hash FROM participants ORDER BY id")
      .all();
    assert.equal(
      (await adminPost(f, "/participants/import", { csv: realCSV })).status,
      409,
    );
    assert.deepEqual(
      f.db
        .prepare("SELECT id,voted,code_hash FROM participants ORDER BY id")
        .all(),
      before,
    );
    const dash = (await f.agent.get("/api/admin/dashboard")).body;
    assert.equal(dash.participation.voted, 6);
    assert.equal(dash.participation.solo.voted, 6);
    assert.deepEqual(
      f.db
        .prepare("PRAGMA table_info(ballots)")
        .all()
        .map((p) => p.name),
      ["id", "table_id"],
    );
  }
});
test("concurrencia real de solo_votante: ocho conexiones, una sola papeleta", async (t) => {
  const f = await loginAdmin(fixture(t));
  await importCSV(f);
  const codes = await codesAndOpen(f),
    code = codes.find((c) => c.mesa === "").codigo;
  const login = await post(f.api, "/api/voter/login", { code });
  const workers = Array.from(
    { length: 8 },
    (_, i) =>
      new Worker(new URL("./concurrent-worker.js", import.meta.url), {
        workerData: {
          path: f.path,
          hash: digest(login.body.token),
          tableId: (i % 6) + 1,
        },
      }),
  );
  t.after(() => Promise.all(workers.map((w) => w.terminate())));
  await Promise.all(workers.map((w) => once(w, "message")));
  const responses = workers.map((w) => once(w, "message"));
  workers.forEach((w) => w.postMessage("go"));
  const results = await Promise.all(responses);
  assert.equal(results.filter(([r]) => r.ok).length, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
});
test("SQLite impone correspondencia entre tipo y mesa, incluso fuera de React", (t) => {
  const f = fixture(t);
  for (const [type, table] of [
    ["solo_votante", 1],
    ["integrante", null],
    ["otro", null],
    ["integrante", 7],
  ])
    assert.throws(() =>
      f.db
        .prepare(
          "INSERT INTO participants(id,name,type,table_id) VALUES(?,?,?,?)",
        )
        .run(`X${type}${table}`, "Prueba", type, table),
    );
});
test("galería: cinco imágenes, principal, orden, reemplazo y borrado atómicos", async (t) => {
  const f = await loginAdmin(fixture(t));
  let r = await putGallery(f, {
    manifest: uploadsManifest(5),
    files: [photo, photo, photo, photo, photo],
  });
  assert.equal(r.status, 200, r.body.error);
  let o = (await f.api.get("/api/public")).body.offerings[0];
  assert.equal(o.photos.length, 5);
  assert.ok(o.photos[0].isPrimary);
  const original = o.photos.map((p) => p.id);
  const bytes = await f.api.get(o.photos[0].url);
  assert.match(bytes.headers["content-type"], /image\/webp/);
  const meta = await sharp(bytes.body).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  const thumb = await f.api.get(o.photos[0].thumbnailUrl);
  assert.ok((await sharp(thumb.body).metadata()).width <= 640);
  const manifest = [...original]
    .reverse()
    .map((id, i) => ({ id, primary: i === 2 }));
  r = await putGallery(f, { version: o.galleryVersion, manifest });
  assert.equal(r.status, 200);
  o = (await f.api.get("/api/public")).body.offerings[0];
  assert.deepEqual(
    o.photos.map((p) => p.id),
    [...original].reverse(),
  );
  assert.equal(o.primaryPhoto.id, original[2]);
  const removed = o.photos[0].id,
    replace = o.photos[1].id;
  r = await putGallery(f, {
    version: o.galleryVersion,
    manifest: [
      { upload: 0, primary: true },
      ...o.photos.slice(2).map((p) => ({ id: p.id, primary: false })),
    ],
    files: [photo],
  });
  assert.equal(r.status, 200);
  o = (await f.api.get("/api/public")).body.offerings[0];
  assert.equal(o.photos.length, 4);
  assert.ok(!o.photos.some((p) => [removed, replace].includes(p.id)));
  assert.equal(
    (await f.api.get(`/api/offerings/1/photos/${removed}`)).status,
    404,
  );
  assert.equal(
    (await f.api.get(`/api/offerings/2/photos/${o.photos[0].id}`)).status,
    404,
  );
});
test("galería valida contenido real, fotos dañadas, tipo, tamaño, referencias y versión sin cambios parciales", async (t) => {
  const f = await loginAdmin(fixture(t));
  const corruptPNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMesAAAAASUVORK5CYII=",
    "base64",
  );
  for (const bad of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from("no imagen"),
    corruptPNG,
    Buffer.from([255, 216, 255, 0]),
  ]) {
    const r = await putGallery(f, {
      manifest: uploadsManifest(1),
      files: [bad],
    });
    assert.equal(r.status, 400, r.text);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM offering_photos").get().n,
      0,
    );
  }
  assert.equal(
    (
      await putGallery(f, {
        manifest: uploadsManifest(1),
        files: [Buffer.alloc(5 * 1024 * 1024 + 1)],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await putGallery(f, {
        manifest: uploadsManifest(6),
        files: [photo, photo, photo, photo, photo, photo],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await putGallery(f, {
        manifest: [{ upload: 0, primary: false }],
        files: [photo],
      })
    ).status,
    400,
  );
  assert.equal((await putGallery(f, { manifest: [null] })).status, 400);
  assert.equal(
    (await putGallery(f, { manifest: [{ id: "otro", primary: true }] })).status,
    400,
  );
  assert.equal(
    (await putGallery(f, { manifest: uploadsManifest(1), files: [photo] }))
      .status,
    200,
  );
  const before = f.db.prepare("SELECT * FROM offering_photos").all();
  assert.equal((await putGallery(f, { version: 0, manifest: [] })).status, 409);
  assert.deepEqual(f.db.prepare("SELECT * FROM offering_photos").all(), before);
});
test("JPG, PNG y WebP se decodifican y optimizan a una resolución adecuada", async () => {
  const jpg = await sharp(photo).jpeg().toBuffer(),
    webp = await sharp(photo).webp().toBuffer();
  for (const buffer of [photo, jpg, webp]) {
    const result = await optimizePhoto({ buffer });
    assert.equal(result.mime, "image/webp");
    assert.ok(result.width <= 1920);
  }
  const large = await sharp({
    create: { width: 2100, height: 1600, channels: 3, background: "#ae782d" },
  })
    .jpeg()
    .toBuffer();
  const optimized = await optimizePhoto({ buffer: large });
  assert.equal(optimized.width, 1920);
  assert.ok(optimized.data.length < large.length);
});
test("abrir bloquea todas las operaciones de galería y también los triggers de SQLite", async (t) => {
  const f = await loginAdmin(fixture(t));
  assert.equal(
    (
      await putGallery(f, {
        manifest: uploadsManifest(2),
        files: [photo, photo],
      })
    ).status,
    200,
  );
  await importCSV(f);
  await codesAndOpen(f);
  const before = f.db.prepare("SELECT * FROM offering_photos").all();
  assert.equal((await putGallery(f, { version: 1, manifest: [] })).status, 409);
  assert.throws(() =>
    f.db.prepare("DELETE FROM offering_photos WHERE offering_id=1").run(),
  );
  assert.throws(() =>
    f.db.prepare("UPDATE offering_photos SET is_primary=0").run(),
  );
  assert.deepEqual(f.db.prepare("SELECT * FROM offering_photos").all(), before);
});
test("fotos incluidas en respaldo, restauración y reinicio de Express con SQLite persistente", async (t) => {
  const f = await loginAdmin(fixture(t));
  assert.equal(
    (
      await putGallery(f, {
        manifest: uploadsManifest(2),
        files: [photo, photo],
      })
    ).status,
    200,
  );
  const o = (await f.api.get("/api/public")).body.offerings[0],
    before = f.db
      .prepare("SELECT * FROM offering_photos ORDER BY position")
      .all();
  const second = connect(f.path),
    restarted = createApp(second, { pepper, testLimits: true });
  assert.equal((await supertest(restarted).get(o.photos[0].url)).status, 200);
  second.close();
  const target = join(f.dir, "snapshot.sqlite"),
    restored = join(f.dir, "restore.sqlite"),
    env = { ...process.env, DB_PATH: f.path, CODE_PEPPER: pepper };
  const backup = spawnSync(
    process.execPath,
    ["scripts/manage.js", "backup", target],
    { env, encoding: "utf8" },
  );
  assert.equal(backup.status, 0, backup.stderr);
  const restore = spawnSync(
    process.execPath,
    ["scripts/manage.js", "restore", target, "--confirm"],
    { env: { ...env, DB_PATH: restored }, encoding: "utf8" },
  );
  assert.equal(restore.status, 0, restore.stderr);
  const check = connect(restored);
  assert.deepEqual(
    check.prepare("SELECT * FROM offering_photos ORDER BY position").all(),
    before,
  );
  check.close();
});

test("migración de v1 con votos, códigos, sesiones y foto: preserva datos y genera respaldo previo", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ov-migration-")),
    path = join(dir, "old.sqlite"),
    db = connect(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(
    readFileSync(
      new URL("../server/migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  db.prepare("INSERT INTO admin VALUES(1,?)").run(hash);
  db.prepare("UPDATE offerings SET photo=?,mime=? WHERE id=1").run(
    photo,
    "image/png",
  );
  for (const id of ["A", "B"])
    db.prepare(
      "INSERT INTO participants(id,name,email,table_id,code_hash,issued) VALUES(?,?,?,?,?,1)",
    ).run(id, "Persona " + id, "a@example.local", 1, codeHash(id, pepper));
  db.exec("UPDATE election SET status='open'");
  for (const id of ["A", "B"])
    db.prepare("INSERT INTO voter_sessions VALUES(?,?,?,?)").run(
      id,
      id,
      Date.now() + 90000,
      Date.now() + 600000,
    );
  castVote(db, "B", 2);
  const participants = db
      .prepare("SELECT * FROM participants ORDER BY id")
      .all(),
    ballots = db.prepare("SELECT * FROM ballots").all(),
    sessions = db.prepare("SELECT * FROM voter_sessions").all();
  migrate(db);
  assert.equal(
    db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v,
    2,
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT id,name,email,table_id,code_hash,issued,voted FROM participants ORDER BY id",
      )
      .all(),
    participants,
  );
  assert.deepEqual(db.prepare("SELECT * FROM ballots").all(), ballots);
  assert.deepEqual(db.prepare("SELECT * FROM voter_sessions").all(), sessions);
  assert.ok(
    Buffer.from(
      db.prepare("SELECT data FROM offering_photos").get().data,
    ).equals(photo),
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  const backups = readdirSync(dir).filter((p) =>
    p.includes("before-migration"),
  );
  assert.equal(backups.length, 1);
  const backup = connect(join(dir, backups[0]));
  assert.equal(
    backup.prepare("SELECT MAX(version) v FROM schema_migrations").get().v,
    1,
  );
  assert.equal(backup.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  backup.close();
  const restoredPath = join(dir, "restored-v1.sqlite");
  const restored = spawnSync(
    process.execPath,
    ["scripts/manage.js", "restore", join(dir, backups[0]), "--confirm"],
    {
      env: { ...process.env, DB_PATH: restoredPath, CODE_PEPPER: pepper },
      encoding: "utf8",
    },
  );
  assert.equal(restored.status, 0, restored.stderr);
  const restoredDb = connect(restoredPath);
  assert.equal(
    restoredDb.prepare("SELECT MAX(version) n FROM schema_migrations").get().n,
    2,
  );
  assert.equal(restoredDb.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  assert.equal(
    restoredDb.prepare("SELECT COUNT(*) n FROM voter_sessions").get().n,
    0,
  );
  assert.ok(
    Buffer.from(
      restoredDb.prepare("SELECT data FROM offering_photos").get().data,
    ).equals(photo),
  );
  restoredDb.close();
  migrate(db);
  assert.equal(
    readdirSync(dir).filter((p) => p.startsWith("old.sqlite.before-migration"))
      .length,
    1,
  );
});
test("migración fallida revierte toda la estructura y conserva la base v1", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ov-bad-migration-")),
    path = join(dir, "old.sqlite"),
    db = connect(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(
    readFileSync(
      new URL("../server/migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare("INSERT INTO participants(id,name,table_id) VALUES(?,?,?)").run(
    "A",
    "Persona",
    7,
  );
  db.exec("PRAGMA foreign_keys=ON");
  assert.throws(() => migrate(db));
  assert.equal(
    db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v,
    1,
  );
  assert.equal(
    db.prepare("SELECT table_id FROM participants").get().table_id,
    7,
  );
  assert.ok(
    !db
      .prepare("PRAGMA table_info(participants)")
      .all()
      .some((p) => p.name === "type"),
  );
});
