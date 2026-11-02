import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { backup } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configFromEnv } from "../server/config.js";
import { connect, migrate } from "../server/db.js";
import { passwordHash } from "../server/security.js";
import { lockDatabase } from "../server/lock.js";
async function password() {
  if (!stdin.isTTY)
    throw new Error("Ejecuta este comando en una terminal interactiva.");
  async function hidden(label) {
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    return new Promise((resolve, reject) => {
      let value = "";
      const onData = (b) => {
        for (const ch of b.toString()) {
          if (ch === "\u0003") {
            done();
            reject(new Error("Cancelado"));
            return;
          }
          if (ch === "\r" || ch === "\n") {
            done();
            resolve(value);
            return;
          }
          if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
          else if (ch >= " ") value += ch;
        }
      };
      function done() {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
      }
      stdin.on("data", onData);
    });
  }
  const a = await hidden(
    "Nueva contraseña administrativa (mínimo 14 caracteres): ",
  );
  if (a.length < 14 || a.length > 256)
    throw new Error("Usa de 14 a 256 caracteres.");
  if (a !== (await hidden("Repite la contraseña: ")))
    throw new Error("Las contraseñas no coinciden.");
  return a;
}
const command = process.argv[2];
let db, unlock;
try {
  if (command === "setup") {
    const envPath = process.env.ENV_FILE || ".env";
    if (!existsSync(envPath)) copyFileSync(".env.example", envPath);
    let content = readFileSync(envPath, "utf8");
    if (!/^CODE_PEPPER=[a-f0-9]{64}$/m.test(content)) {
      const p = randomBytes(32).toString("hex");
      content = content.replace(/^CODE_PEPPER=.*$/m, `CODE_PEPPER=${p}`);
      writeFileSync(envPath, content, { mode: 0o600 });
      process.env.CODE_PEPPER = p;
    } else
      process.env.CODE_PEPPER = content.match(
        /^CODE_PEPPER=([a-f0-9]{64})$/m,
      )[1];
    chmodSync(envPath, 0o600);
    // Reload newly created configuration without replacing explicitly supplied environment variables.
    const { default: dotenv } = await import("dotenv");
    dotenv.config({ path: envPath, quiet: true });
  }
  const c = configFromEnv();
  mkdirSync(dirname(c.dbPath), { recursive: true, mode: 0o700 });
  if (command !== "backup") unlock = lockDatabase(c.dbPath);
  if (command === "restore") {
    const source = process.argv[3];
    if (!source || process.argv[4] !== "--confirm")
      throw new Error(
        "Uso: npm run restore -- RUTA_RESPALDO --confirm (servidor detenido).",
      );
    const tmp = `${c.dbPath}.restore-${randomBytes(12).toString("hex")}`;
    if (resolve(source) === c.dbPath)
      throw new Error("Elige un respaldo distinto de la base activa.");
    copyFileSync(source, tmp);
    const check = connect(tmp);
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("Respaldo corrupto.");
      if (check.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Referencias inválidas.");
      if (
        check.prepare("SELECT version FROM schema_migrations").get()
          ?.version !== 1
      )
        throw new Error("Versión de respaldo incompatible.");
      if (check.prepare("SELECT COUNT(*) AS n FROM offerings").get().n !== 6)
        throw new Error("Deben existir seis mesas.");
      if (
        check.prepare("SELECT COUNT(*) AS n FROM ballots").get().n !==
        check
          .prepare("SELECT COALESCE(SUM(voted),0) AS n FROM participants")
          .get().n
      )
        throw new Error("Conteos inconsistentes.");
      check.exec(
        "DELETE FROM admin_sessions; DELETE FROM voter_sessions; PRAGMA wal_checkpoint(TRUNCATE);",
      );
    } finally {
      check.close();
    }
    if (existsSync(c.dbPath)) {
      db = connect(c.dbPath);
      await backup(db, `${c.dbPath}.before-restore-${Date.now()}.sqlite`);
      db.close();
      db = null;
    }
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(c.dbPath + suffix)) unlinkSync(c.dbPath + suffix);
    renameSync(tmp, c.dbPath);
    console.log(
      "Restauración verificada. Sesiones invalidadas. Conserva el mismo CODE_PEPPER del respaldo.",
    );
  } else {
    if (command === "backup" && !existsSync(c.dbPath))
      throw new Error("La base a respaldar no existe. Revisa DB_PATH.");
    db = connect(c.dbPath);
    if (command === "backup") {
      if (
        db.prepare("SELECT version FROM schema_migrations").get()?.version !== 1
      )
        throw new Error("La base no corresponde a OfrendaVote versión 1.");
      const target = resolve(
        process.argv[3] || `backups/ofrendavote-${Date.now()}.sqlite`,
      );
      if (existsSync(target) || target === c.dbPath)
        throw new Error("El respaldo debe ser un archivo nuevo.");
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      await backup(db, target);
      chmodSync(target, 0o600);
      console.log(`Respaldo consistente: ${target}`);
    } else {
      migrate(db);
      if (command === "setup" || command === "admin-reset") {
        if (command === "setup" && db.prepare("SELECT id FROM admin").get())
          console.log(
            "Configuración existente. Usa npm run admin:reset para cambiar la contraseña.",
          );
        else {
          const hash = passwordHash(await password());
          db.prepare(
            "INSERT INTO admin VALUES(1,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash",
          ).run(hash);
          db.exec("DELETE FROM admin_sessions;");
          console.log("Administrador configurado.");
        }
      } else if (command === "migrate") console.log("Migraciones al día.");
      else throw new Error("Comando desconocido.");
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db?.close();
  unlock?.();
}
