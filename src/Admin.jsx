import React, { useEffect, useRef, useState } from "react";
import {
  Flower2,
  ArrowRight,
  LockKeyhole,
  Check,
  ShieldCheck,
  LogOut,
  Users,
  LayoutDashboard,
  Image,
  Trophy,
  Download,
  Upload,
  Plus,
  KeyRound,
  X,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ChevronRight,
  Sparkles,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import { request, save } from "./api";
import {
  statusLabel,
  Header,
  Footer,
  ErrorBox,
  Modal,
  Offering,
} from "./components";
export default function Admin() {
  const [csrf, setCsrf] = useState(null),
    [loading, setLoading] = useState(true),
    [data, setData] = useState(null),
    [results, setResults] = useState(null),
    [tab, setTab] = useState("overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [logs, setLogs] = useState([]);
  const api = (p, o = {}) => request(`/admin${p}`, { csrf, ...o });
  async function refresh() {
    try {
      const d = await api("/dashboard");
      setData(d);
      if (d.status === "closed") setResults(await api("/results"));
    } catch (e) {
      if (e.status === 401) {
        setCsrf(null);
        setData(null);
      } else setError(e.message);
    }
  }
  useEffect(() => {
    api("/session")
      .then((d) => setCsrf(d.csrf))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (csrf) {
      refresh();
      const t = setInterval(refresh, 15000);
      return () => clearInterval(t);
    }
  }, [csrf]);
  useEffect(() => {
    if (tab === "audit" && csrf)
      api("/audit")
        .then(setLogs)
        .catch((e) => setError(e.message));
  }, [tab, csrf]);
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const p = password;
    setPassword("");
    try {
      const d = await api("/login", { method: "POST", body: { password: p } });
      setCsrf(d.csrf);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", { method: "POST", body: {} });
      setCsrf(null);
      setData(null);
      setResults(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function submitAction(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      p = f.get("password");
    try {
      if (modal.type === "add" || modal.type === "edit") {
        await api(
          modal.type === "add"
            ? "/participants"
            : `/participants/${encodeURIComponent(modal.p.id)}`,
          {
            method: modal.type === "add" ? "POST" : "PUT",
            body: {
              ...(modal.type === "add" ? { id: f.get("id") } : {}),
              name: f.get("name"),
              email: f.get("email"),
              tableId: Number(f.get("tableId")),
            },
          },
        );
      } else if (modal.type === "import") {
        const file = f.get("csv");
        if (file.size > 1000000) throw new Error("El CSV supera 1 MB.");
        const r = await api("/participants/import", {
          method: "POST",
          body: { csv: await file.text() },
        });
        setNotice(`${r.count} participantes importados.`);
      } else if (modal.type === "codes") {
        const b = await api("/codes/export", {
          method: "POST",
          body: { password: p },
          download: true,
        });
        save(b, "codigos-entrega-unica.csv");
        setNotice(
          "Códigos exportados. Guárdalos y entrégalos individualmente; no pueden volver a descargarse.",
        );
      } else if (modal.type === "regenerate") {
        const b = await api("/codes/regenerate", {
          method: "POST",
          body: {
            id: modal.p.id,
            confirmation: f.get("confirmation"),
            password: p,
          },
          download: true,
        });
        save(b, "codigo-regenerado.csv");
        setNotice(
          "Nuevo código exportado. El anterior y sus sesiones quedaron invalidados.",
        );
      } else if (modal.type === "open" || modal.type === "close") {
        await api("/election", {
          method: "POST",
          body: { action: modal.type, password: p },
        });
        setNotice(
          modal.type === "open"
            ? "La votación está abierta."
            : "La votación se cerró definitivamente.",
        );
      } else if (modal.type === "offering") {
        f.delete("password");
        if (!f.get("photo")?.size) f.delete("photo");
        await api(`/offerings/${modal.o.id}`, {
          method: "PUT",
          body: f,
          file: true,
        });
        setNotice("Ofrenda actualizada.");
      }
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const p = data?.participation;
  const participants =
    data?.participants.filter(
      (p) =>
        `${p.id} ${p.name} ${p.email}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "voted" && p.voted) ||
          (filter === "pending" && !p.voted && p.enabled) ||
          (filter === "disabled" && !p.voted && !p.enabled)),
    ) || [];
  if (loading) return <div className="loading">Preparando panel…</div>;
  if (!csrf)
    return (
      <div className="app-shell">
        <Header />
        <main className="admin-login">
          <section className="access-card">
            <span className="round-icon">
              <LockKeyhole />
            </span>
            <span className="eyebrow orange">ACCESO RESTRINGIDO</span>
            <h1>Administración</h1>
            <p>Gestiona el concurso interno de INCONNECT.</p>
            <form onSubmit={login}>
              <label htmlFor="admin-password">Contraseña administrativa</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                maxLength={256}
              />
              <ErrorBox message={error} />
              <button className="primary" disabled={busy}>
                {busy ? "Verificando…" : "Entrar al panel"}
                <ArrowRight size={18} />
              </button>
            </form>
            <a className="back-link" href="/">
              Volver a la estación de votación
            </a>
          </section>
        </main>
        <Footer />
      </div>
    );
  return (
    <div className="admin-shell">
      <Header status={data?.status}>
        <button className="icon" onClick={logout} title="Cerrar sesión">
          <LogOut size={19} />
        </button>
      </Header>
      <div className="admin-layout">
        <aside>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          {[
            ["overview", "Resumen", LayoutDashboard],
            ["participants", "Participantes", Users],
            ["offerings", "Ofrendas", Image],
            ["results", "Resultados", Trophy],
            ["audit", "Actividad", ShieldCheck],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setError("");
              }}
            >
              <Icon size={19} />
              {label}
              {id === "participants" && <small>{p?.total || 0}</small>}
            </button>
          ))}
          <div className="sidebar-note">
            <ShieldCheck size={24} />
            <strong>El voto es secreto.</strong>
            <p>Este panel nunca relaciona una persona con su elección.</p>
          </div>
          <a href="/" target="_blank" rel="noreferrer">
            <Monitor size={16} /> Abrir estación
          </a>
        </aside>
        <main className="admin-main">
          <div className="section-heading">
            <div>
              <span className="eyebrow orange">
                CONCURSO DE OFRENDAS · INCONNECT
              </span>
              <h1>
                {
                  {
                    overview: "Todo listo para celebrar",
                    participants: "Nuestra comunidad",
                    offerings: "Seis mesas, seis historias",
                    results: "El resultado de la tradición",
                    audit: "Actividad administrativa",
                  }[tab]
                }
              </h1>
              <p>
                {
                  {
                    overview:
                      "La participación, de un vistazo. Cada voto cuenta.",
                    participants:
                      "Gestiona registros y códigos de acceso individuales.",
                    offerings:
                      "Configura el nombre y la foto de cada ofrenda antes de abrir.",
                    results:
                      "El conteo se revela únicamente al cerrar las votaciones.",
                    audit:
                      "Registro de operaciones sin elecciones individuales.",
                  }[tab]
                }
              </p>
            </div>
            <button className="icon" title="Actualizar" onClick={refresh}>
              <RefreshCw size={19} />
            </button>
          </div>
          <ErrorBox message={!modal && error} />
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button
                className="icon"
                onClick={() => setNotice("")}
                aria-label="Cerrar aviso"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data ? (
            <p>Cargando datos…</p>
          ) : (
            <>
              {tab === "overview" && (
                <>
                  <div className="stats">
                    <Stat
                      icon={Users}
                      label="Participantes registrados"
                      value={p.total}
                    />
                    <Stat
                      icon={CheckCircle2}
                      label="Votos emitidos"
                      value={p.voted}
                    />
                    <Stat
                      icon={Clock3}
                      label="Pendientes de votar"
                      value={p.total - p.voted}
                    />
                    <Stat
                      icon={Flower2}
                      label="Participación total"
                      value={`${p.total ? Math.round((100 * p.voted) / p.total) : 0}%`}
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-title">
                        <h2>Participación por mesa</h2>
                        <span className="badge">Sin conteo por ofrenda</span>
                      </div>
                      {p.tables.map((t) => (
                        <div className="progress-row" key={t.id}>
                          <span className="table-number">{t.id}</span>
                          <div>
                            <div>
                              <strong>Mesa {t.id}</strong>
                              <span>
                                {t.voted} de {t.total} participaron
                              </span>
                            </div>
                            <progress value={t.voted} max={t.total || 1} />
                          </div>
                          <b>
                            {t.total
                              ? Math.round((100 * t.voted) / t.total)
                              : 0}
                            %
                          </b>
                        </div>
                      ))}
                    </section>
                    <section className="panel election-control">
                      <Flower2 size={40} />
                      <span className={`status ${data.status}`}>
                        <i />
                        {statusLabel[data.status]}
                      </span>
                      <h2>
                        {data.status === "draft"
                          ? "Prepara una gran tradición"
                          : data.status === "open"
                            ? "La comunidad está eligiendo"
                            : "Cada voto ya tiene su lugar"}
                      </h2>
                      <p>
                        {data.status === "draft"
                          ? "Registra participantes, entrega sus códigos y configura las seis ofrendas. Al abrir, los registros quedarán bloqueados."
                          : data.status === "open"
                            ? "Puedes consultar la participación. El conteo por ofrenda permanecerá oculto hasta el cierre definitivo."
                            : "Consulta el ranking, los porcentajes y los empates en Resultados."}
                      </p>
                      {data.status !== "closed" ? (
                        <button
                          className={
                            data.status === "open" ? "danger" : "primary"
                          }
                          onClick={() => {
                            setError("");
                            setModal({
                              type: data.status === "draft" ? "open" : "close",
                            });
                          }}
                        >
                          {data.status === "draft"
                            ? "Abrir votación"
                            : "Cerrar votación"}
                          <ArrowRight size={18} />
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => setTab("results")}
                        >
                          Ver resultados
                          <Trophy size={18} />
                        </button>
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === "participants" && (
                <>
                  <div className="toolbar">
                    <div>
                      <input
                        aria-label="Buscar participante"
                        placeholder="Buscar nombre o identificador…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <select
                        aria-label="Filtrar participantes"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">Todos los estados</option>
                        <option value="pending">
                          Habilitados · pendientes
                        </option>
                        <option value="voted">Ya votaron</option>
                        <option value="disabled">Sin código emitido</option>
                      </select>
                    </div>
                    <div>
                      {data.status === "draft" && (
                        <>
                          <button
                            className="secondary"
                            onClick={() => {
                              setError("");
                              setModal({ type: "import" });
                            }}
                          >
                            <Upload size={16} />
                            Importar CSV
                          </button>
                          <button
                            className="secondary"
                            onClick={() => {
                              setError("");
                              setModal({ type: "add" });
                            }}
                          >
                            <Plus size={16} />
                            Alta individual
                          </button>
                          <button
                            className="primary"
                            onClick={() => {
                              setError("");
                              setModal({ type: "codes" });
                            }}
                          >
                            <Download size={16} />
                            Emitir códigos
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="panel table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Participante</th>
                          <th>Identificador</th>
                          <th>Mesa</th>
                          <th>Estado</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participants.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                              <small>{p.email || "Sin correo"}</small>
                            </td>
                            <td>{p.id}</td>
                            <td>
                              <span className="table-number">{p.tableId}</span>
                            </td>
                            <td>
                              <span
                                className={`participant-status ${p.voted ? "done" : p.enabled ? "pending" : "disabled"}`}
                              >
                                {p.voted
                                  ? "Ya votó"
                                  : p.enabled
                                    ? "Habilitado · pendiente"
                                    : "Sin código"}
                              </span>
                            </td>
                            <td>
                              {data.status === "draft" && (
                                <button
                                  className="text-button edit-participant"
                                  onClick={() => {
                                    setError("");
                                    setModal({ type: "edit", p });
                                  }}
                                >
                                  Editar participante
                                </button>
                              )}
                              {!p.voted && data.status !== "closed" && (
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setError("");
                                    setModal({ type: "regenerate", p });
                                  }}
                                >
                                  <KeyRound size={15} />
                                  Regenerar código
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!participants.length && (
                      <div className="empty">
                        <Users />
                        <h3>No hay participantes en esta vista</h3>
                        <p>
                          Importa un CSV o agrega registros durante la
                          preparación.
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="help">
                    Los códigos se exportan una sola vez. Su contenido nunca se
                    conserva en la base de datos.
                  </p>
                </>
              )}
              {tab === "offerings" && (
                <>
                  <div className="offering-grid admin-offerings">
                    {data.offerings.map((o) => (
                      <div key={o.id}>
                        <Offering o={{ ...o, version: Date.now() }} preview />
                        {data.status === "draft" && (
                          <button
                            className="secondary full"
                            onClick={() => {
                              setError("");
                              setModal({ type: "offering", o });
                            }}
                          >
                            Editar ofrenda <Image size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {data.status !== "draft" && (
                    <p className="help">
                      <LockKeyhole size={16} /> Las ofrendas están bloqueadas
                      porque el concurso ya inició.
                    </p>
                  )}
                </>
              )}
              {tab === "results" &&
                (data.status !== "closed" ? (
                  <section className="panel empty result-locked">
                    <LockKeyhole size={42} />
                    <h2>La sorpresa se guarda hasta el final</h2>
                    <p>
                      Los votos por ofrenda se mostrarán después del cierre
                      definitivo.
                      <br />
                      Puedes revisar la participación en Resumen.
                    </p>
                  </section>
                ) : (
                  results && (
                    <>
                      <div className="results-intro">
                        <span>
                          <Trophy size={25} /> {results.participation.voted}{" "}
                          votos · {results.participation.total} participantes ·{" "}
                          {results.participation.total
                            ? Math.round(
                                (100 * results.participation.voted) /
                                  results.participation.total,
                              )
                            : 0}
                          % de participación
                        </span>
                        <button
                          className="primary"
                          onClick={async () => {
                            try {
                              save(
                                await api("/results.csv", { download: true }),
                                "resultados-ofrendavote.csv",
                              );
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          <Download size={16} />
                          Exportar resultados
                        </button>
                      </div>
                      <div className="ranking">
                        {results.ranking.map((r) => (
                          <section
                            key={r.id}
                            className={`panel rank-card ${r.rank === 1 ? "winner" : ""}`}
                          >
                            <span className="rank">
                              {r.rank === 1 ? (
                                <Trophy />
                              ) : (
                                String(r.rank).padStart(2, "0")
                              )}
                            </span>
                            <div>
                              <span className="eyebrow">
                                MESA {r.id}
                                {r.tied ? " · EMPATE" : ""}
                              </span>
                              <h3>{r.name}</h3>
                              <progress
                                value={r.votes}
                                max={results.participation.voted || 1}
                              />
                            </div>
                            <strong>
                              {r.votes}
                              <small>votos</small>
                            </strong>
                            <b>{r.percent}%</b>
                          </section>
                        ))}
                      </div>
                      {results.participation.voted === 0 && (
                        <p className="help">
                          No se emitieron votos. Las seis mesas empatan con cero
                          votos.
                        </p>
                      )}
                    </>
                  )
                ))}
              {tab === "audit" && (
                <div className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha UTC</th>
                        <th>Operación</th>
                        <th>Referencia administrativa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((r, i) => (
                        <tr key={i}>
                          <td>{r.occurred_at}</td>
                          <td>
                            {{
                              admin_login: "Inicio administrativo",
                              participant_added: "Alta de participante",
                              participant_updated:
                                "Actualización de participante",
                              participants_imported:
                                "Importación de participantes",
                              codes_issued: "Emisión de códigos",
                              code_regenerated: "Regeneración de código",
                              offering_updated: "Actualización de ofrenda",
                              election_open: "Apertura",
                              election_close: "Cierre",
                            }[r.action] || r.action}
                          </td>
                          <td>{r.subject || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <Footer />
      {modal && (
        <Modal
          title={
            {
              add: "Alta de participante",
              edit: "Editar participante",
              import: "Importar participantes",
              codes: "Exportación única de códigos",
              regenerate: "Regenerar código personal",
              open: "Abrir la votación",
              close: "Cerrar definitivamente la votación",
              offering: `Editar mesa ${modal.o?.id}`,
            }[modal.type]
          }
          onClose={() => !busy && setModal(null)}
        >
          <form onSubmit={submitAction} autoComplete="off">
            {(modal.type === "add" || modal.type === "edit") && (
              <>
                <label>
                  Identificador único
                  <input
                    name="id"
                    required
                    maxLength={64}
                    defaultValue={modal.p?.id}
                    readOnly={modal.type === "edit"}
                  />
                </label>
                <label>
                  Nombre completo
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={modal.p?.name}
                  />
                </label>
                <label>
                  Correo (opcional)
                  <input
                    name="email"
                    type="email"
                    maxLength={254}
                    defaultValue={modal.p?.email}
                  />
                </label>
                <label>
                  Mesa asignada
                  <select name="tableId" defaultValue={modal.p?.tableId || 1}>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        Mesa {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {modal.type === "edit" && (
              <p className="help">
                Si cambias la mesa, se invalidará el código anterior. Emite y
                entrega uno nuevo antes de abrir.
              </p>
            )}
            {modal.type === "import" && (
              <>
                <p>
                  Todos los datos se validan antes de importar. Si hay un error,
                  no se guardará ningún registro.
                </p>
                <code className="csv-example">
                  identificador,nombre,correo,mesa
                  <br />
                  EMP001,Ana López,,1
                </code>
                <label>
                  Archivo CSV UTF-8 (hasta 1 MB)
                  <input
                    name="csv"
                    type="file"
                    accept=".csv,text/csv"
                    required
                  />
                </label>
              </>
            )}
            {modal.type === "codes" && (
              <p>
                Se generará un CSV para los participantes que aún no tienen
                código. Esta descarga es única. Guarda el archivo de forma
                segura para entregar cada código individualmente.
              </p>
            )}
            {modal.type === "regenerate" && (
              <>
                <p>
                  El código anterior de <strong>{modal.p.name}</strong> quedará
                  invalidado, junto con cualquier sesión activa. El nuevo código
                  se descargará una sola vez.
                </p>
                <label>
                  Escribe el identificador {modal.p.id} para confirmar
                  <input name="confirmation" autoComplete="off" required />
                </label>
              </>
            )}
            {modal.type === "open" && (
              <p>
                Se bloquearán las altas, las mesas asignadas y las fotos. Todos
                los participantes deben tener su código emitido. Esta apertura
                no puede deshacerse.
              </p>
            )}
            {modal.type === "close" && (
              <p>
                Se impedirán nuevos votos y se mostrarán los resultados
                definitivos. No se podrá reabrir este concurso.
              </p>
            )}
            {modal.type === "offering" && (
              <>
                <label>
                  Nombre de la ofrenda
                  <input
                    name="name"
                    defaultValue={modal.o.name}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                <label>
                  Foto de la ofrenda (PNG, JPG o WebP, hasta 5 MB)
                  <input
                    name="photo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                </label>
                <p className="help">
                  Si no eliges una foto, se conserva la imagen actual.
                </p>
              </>
            )}
            {["codes", "regenerate", "open", "close"].includes(modal.type) && (
              <label>
                Confirma tu contraseña administrativa
                <input
                  name="password"
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={256}
                />
              </label>
            )}
            <ErrorBox message={error} />
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                className={modal.type === "close" ? "danger" : "primary"}
                disabled={busy}
              >
                {busy
                  ? "Procesando…"
                  : modal.type === "import"
                    ? "Validar e importar"
                    : modal.type === "close"
                      ? "Cerrar votación"
                      : "Confirmar"}
                <Check size={17} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <span>
        <Icon size={20} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
