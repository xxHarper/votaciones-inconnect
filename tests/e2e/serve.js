import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, migrate } from "../../server/db.js";
import { createApp } from "../../server/app.js";
import { codeHash, passwordHash } from "../../server/security.js";
const dir = mkdtempSync(join(tmpdir(), "ov-e2e-"));
const db = connect(join(dir, "e2e.sqlite"));
migrate(db);
const pepper = "e".repeat(64);
db.prepare("INSERT INTO admin VALUES(1,?)").run(
  passwordHash("Solo-Pruebas-E2E-Seguras"),
);
for (let i = 0; i < 10; i++)
  db.prepare(
    "INSERT INTO participants(id,name,table_id,code_hash,issued) VALUES(?,?,?,?,1)",
  ).run(
    `E2E${i}`,
    `Persona de prueba ${i}`,
    (i % 6) + 1,
    codeHash(
      `ABCDEFGHJKLMNPQ${String.fromCharCode(65 + i)}`.replace("I", "K"),
      pepper,
    ),
  );
db.exec("UPDATE election SET status='open'");
const app = createApp(db, {
  pepper,
  testLimits: true,
  voterIdleSeconds: 4,
  voterMaxSeconds: 60,
});
const server = app.listen(3187, "127.0.0.1");
function close() {
  draftServer.close(() => draftDb.close());
  draftServer.closeIdleConnections();
  server.close(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);

const draftDb = connect(join(dir, "draft.sqlite"));
migrate(draftDb);
draftDb
  .prepare("INSERT INTO admin VALUES(1,?)")
  .run(passwordHash("Solo-Pruebas-E2E-Seguras"));
const draftServer = createApp(draftDb, { pepper, testLimits: true }).listen(
  3188,
  "127.0.0.1",
);
