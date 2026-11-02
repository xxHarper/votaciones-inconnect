import {
  randomBytes,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const codeHash = (value, pepper) =>
  createHmac("sha256", pepper).update(value.toUpperCase()).digest("hex");
export function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(16), (b) => alphabet[b % 32]).join("");
}
export function passwordHash(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
}
export function passwordOK(value, hash) {
  if (typeof value !== "string" || value.length > 256 || !hash) return false;
  const [salt, expected] = hash.split(":");
  const actual = scryptSync(value, salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
export function exact(body, keys) {
  assert(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).every((k) => keys.includes(k)),
    400,
    "La solicitud contiene campos no permitidos.",
  );
}
export function csv(rows) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v ?? "");
            if (/^[=+\-@\t\r]/.test(s.trimStart())) s = `'${s}`;
            return `"${s.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n")
  );
}
