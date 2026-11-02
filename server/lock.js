import { openSync, writeFileSync, closeSync, unlinkSync } from "node:fs";
export function lockDatabase(path) {
  const lock = `${path}.lock`;
  let fd;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch {
    throw new Error(
      `Base ocupada o bloqueo residual: ${lock}. Detén el servidor antes de continuar. Consulta README.`,
    );
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  let released = false;
  return () => {
    if (!released) {
      unlinkSync(lock);
      released = true;
    }
  };
}
