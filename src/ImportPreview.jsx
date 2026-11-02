import React from "react";
export default function ImportPreview({ plan }) {
  return (
    <section
      className="import-preview"
      aria-label="Previsualización de participantes"
    >
      <h3>Revisa los {plan.summary.total} participantes</h3>
      <div className="import-summary">
        <span>
          <strong>{plan.summary.new}</strong> nuevos
        </span>
        <span>
          <strong>{plan.summary.existing}</strong> ya existentes
        </span>
        <span>
          <strong>{plan.summary.conflicts}</strong> conflictos
        </span>
      </div>
      <div className="import-distribution">
        {plan.distribution.tables.map((t) => (
          <span key={t.id}>
            Mesa {t.id}: <strong>{t.total}</strong>
          </span>
        ))}
        <span>
          Solo votantes: <strong>{plan.distribution.solo}</strong>
        </span>
      </div>
      <p className="help">
        Los registros existentes idénticos se omiten. No se reemplazan datos,
        códigos ni votos. Un conflicto impide confirmar el lote.
      </p>
      <div className="table-wrap preview-table">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Mesa</th>
              <th>Importación</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>
                  {p.type === "solo_votante" ? "Solo votante" : "Integrante"}
                </td>
                <td>{p.tableId ?? "Sin mesa"}</td>
                <td>
                  {
                    {
                      new: "Nuevo",
                      existing: "Se omite",
                      conflict: "Conflicto",
                    }[p.status]
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
