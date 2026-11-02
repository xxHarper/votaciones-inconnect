import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export function connect(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 10000 });
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;",
  );
  return db;
}
export const SCHEMA_VERSION = 2;
export function migrate(db) {
  const hasSchema = !!db
    .prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
    .get();
  let version = hasSchema
    ? db.prepare("SELECT MAX(version) AS n FROM schema_migrations").get().n
    : 0;
  if (version > SCHEMA_VERSION)
    throw new Error(
      "La base requiere una versión más reciente de OfrendaVote.",
    );
  if (version === SCHEMA_VERSION) return;
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("No se puede migrar una base con errores de integridad.");
  // Copia consistente antes de tocar una base existente; incluye WAL y fotos.
  if (hasSchema && db.prepare("PRAGMA database_list").get().file) {
    const destination = `${db.prepare("PRAGMA database_list").get().file}.before-migration-v${version}-${Date.now()}.sqlite`;
    db.prepare("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
  }
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    for (let next = version + 1; next <= SCHEMA_VERSION; next++) {
      const filename =
        next === 1
          ? "001_initial.sql"
          : "002_participant_types_and_galleries.sql";
      db.exec(
        readFileSync(
          fileURLToPath(new URL(`./migrations/${filename}`, import.meta.url)),
          "utf8",
        ),
      );
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("La migración produciría referencias inválidas.");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}
export function atomic(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const state = (db) =>
  db.prepare("SELECT status FROM election WHERE id=1").get().status;
export function audit(db, action, subject = null) {
  db.prepare("INSERT INTO audit(action,subject) VALUES(?,?)").run(
    action,
    subject,
  );
}
export function participation(db) {
  const rows = db
    .prepare(
      "SELECT o.id, o.name, COUNT(p.id) AS total, COALESCE(SUM(p.voted),0) AS voted, COALESCE(SUM(CASE WHEN p.code_hash IS NOT NULL OR p.voted=1 THEN 1 ELSE 0 END),0) AS enabled FROM offerings o LEFT JOIN participants p ON p.table_id=o.id GROUP BY o.id ORDER BY o.id",
    )
    .all();
  const solo = db
    .prepare(
      "SELECT COUNT(*) AS total,COALESCE(SUM(voted),0) AS voted,COALESCE(SUM(CASE WHEN code_hash IS NOT NULL OR voted=1 THEN 1 ELSE 0 END),0) AS enabled FROM participants WHERE type='solo_votante'",
    )
    .get();
  return {
    tables: rows,
    solo,
    total: rows.reduce((s, r) => s + r.total, 0) + solo.total,
    voted: rows.reduce((s, r) => s + r.voted, 0) + solo.voted,
  };
}
