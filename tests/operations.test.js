import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { connect, migrate } from "../server/db.js";
import { passwordHash, codeHash, digest } from "../server/security.js";
import { castVote } from "../server/voting.js";
import { lockDatabase } from "../server/lock.js";
test("respaldo en línea y restauración verificada, preservación de votos, bloqueo y sesiones revocadas", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ov-ops-")),
    path = join(dir, "production.sqlite"),
    target = join(dir, "backup.sqlite"),
    pepper = "f".repeat(64);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = connect(path);
  migrate(db);
  db.prepare("INSERT INTO admin VALUES(1,?)").run(
    passwordHash("Operacion-Segura-Prueba"),
  );
  db.prepare(
    "INSERT INTO participants(id,name,table_id,code_hash,issued) VALUES(?,?,?,?,1)",
  ).run("A", "Ana", 1, codeHash("ABCDEFGHJKLMNPQA", pepper));
  db.exec("UPDATE election SET status='open'");
  const hash = digest("t".repeat(64));
  db.prepare("INSERT INTO voter_sessions VALUES(?,?,?,?)").run(
    hash,
    "A",
    Date.now() + 90000,
    Date.now() + 600000,
  );
  castVote(db, hash, 2);
  db.prepare("INSERT INTO admin_sessions VALUES(?,?,?)").run(
    "hash",
    "csrf",
    Date.now() + 600000,
  );
  const env = { ...process.env, DB_PATH: path, CODE_PEPPER: pepper };
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/manage.js", ...args], {
      env,
      encoding: "utf8",
    });
  const unlock = lockDatabase(path);
  const b = run("backup", target);
  assert.equal(b.status, 0, b.stderr);
  assert.ok(existsSync(target));
  assert.equal(run("backup", target).status, 1);
  assert.equal(run("restore", target, "--confirm").status, 1);
  db.close();
  unlock();
  assert.equal(run("restore", target).status, 1);
  const restored = run("restore", target, "--confirm");
  assert.equal(restored.status, 0, restored.stderr);
  db = connect(path);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  assert.equal(db.prepare("SELECT voted FROM participants").get().voted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM voter_sessions").get().n, 0);
  db.close();
  const bad = join(dir, "bad.sqlite");
  writeFileSync(bad, "no es sqlite");
  assert.equal(run("restore", bad, "--confirm").status, 1);
  db = connect(path);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  db.close();
});

test("reinicio real del servidor conserva voto, estado y prohibición de reutilizar código", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { createServer } = await import("node:net");
  const dir = mkdtempSync(join(tmpdir(), "ov-restart-")),
    path = join(dir, "test.sqlite"),
    pepper = "c".repeat(64),
    code = "ABCDEFGHJKLMNPQA";
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = connect(path);
  migrate(db);
  db.prepare("INSERT INTO admin VALUES(1,?)").run(
    passwordHash("Prueba-Reinicio-Segura"),
  );
  db.prepare(
    "INSERT INTO participants(id,name,table_id,code_hash,issued) VALUES(?,?,?,?,1)",
  ).run("A", "Ana", 1, codeHash(code, pepper));
  db.exec("UPDATE election SET status='open'");
  db.close();
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        DB_PATH: path,
        CODE_PEPPER: pepper,
        HOST: "127.0.0.1",
        PORT: String(port),
        COOKIE_SECURE: "false",
        TLS_KEY: "",
        TLS_CERT: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("El servidor no inició")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Inicio falló: ${code}`));
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  t.after(stop);
  async function post(path, body, token) {
    return fetch(origin + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  await start();
  const login = await post("/api/voter/login", { code });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal(
    (await post("/api/voter/vote", { tableId: 2 }, token)).status,
    200,
  );
  await stop();
  await start();
  assert.equal((await post("/api/voter/login", { code })).status, 401);
  assert.equal(
    (await post("/api/voter/vote", { tableId: 3 }, token)).status,
    401,
  );
  assert.equal(
    (await (await fetch(origin + "/api/public")).json()).status,
    "open",
  );
  await stop();
  const check = connect(path);
  assert.equal(check.prepare("SELECT COUNT(*) n FROM ballots").get().n, 1);
  check.close();
});
