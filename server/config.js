import dotenv from "dotenv";
import { resolve } from "node:path";
dotenv.config({ path: process.env.ENV_FILE || ".env", quiet: true });
export function configFromEnv() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT debe ser un puerto válido.");
  const pepper = process.env.CODE_PEPPER;
  if (!pepper || !/^[a-f0-9]{64}$/.test(pepper))
    throw new Error("Ejecuta npm run setup para configurar CODE_PEPPER.");
  const secure = process.env.COOKIE_SECURE === "true";
  const duration = (key, fallback, min, max) => {
    const n = Number(process.env[key] || fallback);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${key} debe estar entre ${min} y ${max} segundos.`);
    return n;
  };
  const voterIdleSeconds = duration("VOTER_IDLE_SECONDS", 90, 10, 3600),
    voterMaxSeconds = duration("VOTER_MAX_SECONDS", 600, 10, 7200),
    adminIdleSeconds = duration("ADMIN_IDLE_SECONDS", 1800, 60, 86400);
  if (voterMaxSeconds < voterIdleSeconds)
    throw new Error(
      "VOTER_MAX_SECONDS debe ser mayor o igual que VOTER_IDLE_SECONDS.",
    );
  return {
    port,
    host: process.env.HOST || "0.0.0.0",
    dbPath: resolve(process.env.DB_PATH || "data/production.sqlite"),
    pepper,
    secure,
    tlsKey: process.env.TLS_KEY,
    tlsCert: process.env.TLS_CERT,
    origins: [
      ...(process.env.ALLOWED_ORIGINS || "").split(","),
      ...(process.env.NODE_ENV === "development"
        ? [process.env.DEV_ORIGIN || "http://localhost:5173"]
        : []),
    ].filter(Boolean),
    voterIdleSeconds,
    voterMaxSeconds,
    adminIdleSeconds,
  };
}
