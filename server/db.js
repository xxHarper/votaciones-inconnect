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
export function migrate(db) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
      .get()
  ) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        readFileSync(
          fileURLToPath(
            new URL("./migrations/001_initial.sql", import.meta.url),
          ),
          "utf8",
        ),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
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
  return {
    tables: rows,
    total: rows.reduce((s, r) => s + r.total, 0),
    voted: rows.reduce((s, r) => s + r.voted, 0),
  };
}
