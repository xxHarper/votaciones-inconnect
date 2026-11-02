import { parse } from "csv-parse/sync";
import { assert, exact, digest } from "./security.js";
export function validateParticipant(r) {
  exact(r, ["id", "name", "email", "tableId", "type"]);
  assert(
    typeof r.id === "string" && /^[\p{L}\p{N}_-]{1,64}$/u.test(r.id),
    400,
    "Identificador inválido (1–64 letras, números, guion o guion bajo).",
  );
  assert(
    typeof r.name === "string" &&
      r.name.trim().length >= 2 &&
      r.name.length <= 120 &&
      !/[\x00-\x1f]/.test(r.name),
    400,
    "Nombre inválido (2–120 caracteres).",
  );
  const email = r.email === undefined ? "" : r.email;
  assert(
    typeof email === "string" &&
      email.length <= 254 &&
      (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    400,
    "Correo inválido.",
  );
  const type = r.type === undefined ? "integrante" : r.type;
  assert(
    ["integrante", "solo_votante"].includes(type),
    400,
    "Tipo inválido: integrante o solo_votante.",
  );
  assert(
    type === "solo_votante"
      ? r.tableId === null
      : Number.isInteger(r.tableId) && r.tableId >= 1 && r.tableId <= 6,
    400,
    type === "solo_votante"
      ? "Una persona solo votante debe tener la mesa vacía."
      : "Los integrantes requieren una mesa entre 1 y 6.",
  );
  return {
    ...r,
    id: r.id.normalize("NFC"),
    name: r.name.trim().normalize("NFC"),
    email,
    type,
  };
}
export const idKey = (id) => id.normalize("NFC").toLowerCase();
export function parseParticipantsCSV(content) {
  assert(
    typeof content === "string" &&
      Buffer.byteLength(content, "utf8") <= 1000000,
    400,
    "CSV requerido, hasta 1 MB.",
  );
  let format;
  let rows;
  try {
    rows = parse(content, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 10000,
      columns: (headers) => {
        assert(
          new Set(headers).size === headers.length,
          400,
          "Encabezados CSV repetidos.",
        );
        if (
          headers.length === 4 &&
          ["id_participante", "nombre", "mesa", "tipo"].every((k) =>
            headers.includes(k),
          )
        )
          format = "typed";
        else if (
          headers.length >= 3 &&
          headers.length <= 4 &&
          ["identificador", "nombre", "mesa"].every((k) =>
            headers.includes(k),
          ) &&
          headers.every((k) =>
            ["identificador", "nombre", "mesa", "correo"].includes(k),
          )
        )
          format = "legacy";
        else
          assert(
            false,
            400,
            "Encabezados esperados: id_participante,nombre,mesa,tipo. También se admite el CSV anterior.",
          );
        return headers;
      },
    });
  } catch (e) {
    if (e.status) throw e;
    assert(false, 400, "CSV mal formado.");
  }
  assert(
    rows.length > 0 && rows.length <= 10000,
    400,
    "Importa entre 1 y 10000 participantes.",
  );
  const ids = new Set();
  const valid = rows.map((r, index) => {
    try {
      const row = {
        id: format === "typed" ? r.id_participante : r.identificador,
        name: r.nombre,
        tableId:
          r.mesa === "" ? null : /^[1-6]$/.test(r.mesa) ? Number(r.mesa) : 0,
        type: format === "typed" ? r.tipo : "integrante",
        ...("correo" in r ? { email: r.correo } : {}),
      };
      const p = validateParticipant(row),
        key = idKey(p.id);
      assert(
        !ids.has(key),
        409,
        `Identificador duplicado en el archivo: ${p.id}`,
      );
      ids.add(key);
      return { ...p, emailProvided: "correo" in r };
    } catch (e) {
      e.message = `Fila ${index + 2}: ${e.message}`;
      throw e;
    }
  });
  return { format, rows: valid };
}
export function planImport(db, parsed) {
  const existing = new Map(
    db
      .prepare("SELECT id,name,email,table_id,type,voted FROM participants")
      .all()
      .map((p) => [idKey(p.id), p]),
  );
  const rows = parsed.rows.map((r) => {
    const p = existing.get(idKey(r.id));
    const same =
      p &&
      p.name === r.name &&
      p.table_id === r.tableId &&
      p.type === r.type &&
      (!r.emailProvided || p.email === r.email);
    return {
      ...r,
      status: !p ? "new" : same ? "existing" : "conflict",
      voted: p?.voted || 0,
    };
  });
  const summary = {
    total: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    existing: rows.filter((r) => r.status === "existing").length,
    conflicts: rows.filter((r) => r.status === "conflict").length,
  };
  const distribution = {
    tables: [1, 2, 3, 4, 5, 6].map((id) => ({
      id,
      total: rows.filter((r) => r.tableId === id).length,
    })),
    solo: rows.filter((r) => r.type === "solo_votante").length,
  };
  return {
    rows,
    summary,
    distribution,
    previewHash: digest(JSON.stringify(parsed.rows)),
  };
}
export function insertParticipant(db, p) {
  db.prepare(
    "INSERT INTO participants(id,name,email,table_id,type) VALUES(?,?,?,?,?)",
  ).run(p.id, p.name, p.email, p.tableId, p.type);
}
