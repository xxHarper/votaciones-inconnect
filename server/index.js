import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configFromEnv } from "./config.js";
import { connect, migrate } from "./db.js";
import { createApp } from "./app.js";
import { lockDatabase } from "./lock.js";
const c = configFromEnv();
mkdirSync(dirname(c.dbPath), { recursive: true, mode: 0o700 });
const unlock = lockDatabase(c.dbPath);
let db, server;
try {
  db = connect(c.dbPath);
  migrate(db);
  if (!db.prepare("SELECT id FROM admin").get())
    throw new Error("Falta administrador: ejecuta npm run setup.");
  if (Boolean(c.tlsKey) !== Boolean(c.tlsCert))
    throw new Error("Configura TLS_KEY y TLS_CERT juntos.");
  const tls = !!(c.tlsKey && c.tlsCert);
  if (c.secure !== tls)
    throw new Error(
      "COOKIE_SECURE debe ser true con HTTPS directo y false con HTTP. Configura TLS_KEY y TLS_CERT juntos.",
    );
  const app = createApp(db, c);
  server = tls
    ? httpsServer(
        { key: readFileSync(c.tlsKey), cert: readFileSync(c.tlsCert) },
        app,
      )
    : httpServer(app);
  server.on("error", (e) => {
    console.error(e.message);
    db.close();
    unlock();
    process.exit(1);
  });
  server.listen(c.port, c.host, () =>
    console.log(
      `OfrendaVote: ${tls ? "https" : "http"}://${c.host}:${c.port}\nAdministración: /admin · Ctrl+C para detener`,
    ),
  );
  const cleanup = setInterval(() => {
    const t = Date.now();
    db.prepare("DELETE FROM voter_sessions WHERE expires<? OR deadline<?").run(
      t,
      t,
    );
    db.prepare("DELETE FROM admin_sessions WHERE expires<?").run(t);
  }, 60000);
  cleanup.unref();
  let closing = false;
  function stop() {
    if (closing) return;
    closing = true;
    clearInterval(cleanup);
    server.close(() => {
      db.close();
      unlock();
      process.exit(0);
    });
    server.closeIdleConnections();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (e) {
  db?.close();
  unlock();
  console.error(e.message);
  process.exit(1);
}
