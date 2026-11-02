import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { connect, migrate, atomic } from "../server/db.js";
import {
  codeHash,
  generateCode,
  passwordHash,
  csv,
} from "../server/security.js";
import { createInterface } from "node:readline/promises";
const path = resolve("data/demo.sqlite");
mkdirSync("data", { recursive: true });
if (!existsSync(path)) {
  const pepper = randomBytes(32).toString("hex");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question(
    "Contraseña SOLO para demostración (mínimo 14 caracteres, visible al escribir): ",
  );
  rl.close();
  if (password.length < 14) {
    console.error("Contraseña demasiado corta.");
    process.exit(1);
  }
  const db = connect(path);
  migrate(db);
  const rows = [["identificador", "nombre", "mesa", "codigo"]];
  atomic(db, () => {
    db.prepare("INSERT INTO admin VALUES(1,?)").run(passwordHash(password));
    for (let i = 1; i <= 18; i++) {
      const c = generateCode(),
        table = ((i - 1) % 6) + 1;
      db.prepare(
        "INSERT INTO participants(id,name,table_id,code_hash,issued) VALUES(?,?,?,?,1)",
      ).run(
        `DEMO-${i}`,
        `Participante de ejemplo ${i}`,
        table,
        codeHash(c, pepper),
      );
      rows.push([`DEMO-${i}`, `Participante de ejemplo ${i}`, table, c]);
    }
  });
  db.close();
  writeFileSync("data/demo-codigos.csv", csv(rows), { mode: 0o600 });
  writeFileSync(
    ".env.demo",
    `HOST=0.0.0.0\nPORT=3001\nDB_PATH=./data/demo.sqlite\nCODE_PEPPER=${pepper}\nCOOKIE_SECURE=false\n`,
    { mode: 0o600 },
  );
  console.log(
    "DEMO independiente, 18 participantes. Entrega: data/demo-codigos.csv. Abre la votación en /admin.",
  );
}
const child = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
  env: { ...process.env, ENV_FILE: ".env.demo" },
});
child.on("exit", (code) => (process.exitCode = code));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
