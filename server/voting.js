import { randomUUID } from "node:crypto";
import { atomic, state } from "./db.js";
import { assert } from "./security.js";
export function castVote(db, sessionHash, tableId, time = Date.now()) {
  assert(
    Number.isInteger(tableId) && tableId >= 1 && tableId <= 6,
    400,
    "Elige una mesa válida del 1 al 6.",
  );
  return atomic(db, () => {
    assert(state(db) === "open", 409, "La votación no está abierta.");
    const s = db
      .prepare(
        "SELECT * FROM voter_sessions WHERE token_hash=? AND expires>? AND deadline>?",
      )
      .get(sessionHash, time, time);
    assert(s, 401, "Sesión expirada.");
    const p = db
      .prepare("SELECT table_id,voted FROM participants WHERE id=?")
      .get(s.participant_id);
    assert(p && !p.voted, 409, "Este participante ya votó.");
    assert(
      p.table_id === null || p.table_id !== tableId,
      403,
      "No puedes votar por tu propia mesa.",
    );
    const changed = db
      .prepare(
        "UPDATE participants SET voted=1,code_hash=NULL WHERE id=? AND voted=0",
      )
      .run(s.participant_id);
    assert(changed.changes === 1, 409, "Este participante ya votó.");
    db.prepare("INSERT INTO ballots(id,table_id) VALUES(?,?)").run(
      randomUUID(),
      tableId,
    );
    db.prepare("DELETE FROM voter_sessions WHERE participant_id=?").run(
      s.participant_id,
    );
    return { ok: true };
  });
}
