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
import { Header, Footer, ErrorBox, Modal, Offering } from "./components";
export default function Kiosk() {
  const [info, setInfo] = useState(null),
    [screen, setScreen] = useState("login"),
    [code, setCode] = useState(""),
    [participant, setParticipant] = useState(null),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(90);
  const tokenRef = useRef(null),
    lastActivity = useRef(Date.now()),
    lastPing = useRef(0),
    epoch = useRef(0),
    idleRef = useRef(90);
  function clear(next = "login", message = "") {
    const old = tokenRef.current;
    tokenRef.current = null;
    epoch.current++;
    setCode("");
    setParticipant(null);
    setSelected(null);
    setError(message);
    setBusy(false);
    setScreen(next);
    if (old)
      request("/voter/logout", {
        method: "POST",
        body: {},
        token: old,
        keepalive: true,
      }).catch(() => {});
  }
  useEffect(() => {
    let alive = true;
    const load = () =>
      request("/public")
        .then((d) => {
          if (alive) {
            setInfo(d);
            idleRef.current = d.idleSeconds;
          }
        })
        .catch(() => {
          if (alive) setError("No se pudo conectar al servidor local.");
        });
    load();
    const poll = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    const leave = () => clear();
    const visibility = () => {
      if (document.hidden) clear();
    };
    const pageshow = (e) => {
      if (e.persisted) clear();
    };
    const activity = () => {
      if (!tokenRef.current) return;
      lastActivity.current = Date.now();
      if (
        Date.now() - lastPing.current >
        Math.min(10000, (idleRef.current * 1000) / 3)
      ) {
        lastPing.current = Date.now();
        const active = tokenRef.current;
        request("/voter/activity", {
          method: "POST",
          body: {},
          token: active,
        }).catch(() => {
          if (tokenRef.current === active)
            clear("login", "Tu sesión terminó. Ingresa nuevamente tu código.");
        });
      }
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visibility);
    for (const type of ["pointerdown", "keydown", "pointermove"])
      window.addEventListener(type, activity);
    const timer = setInterval(() => {
      if (tokenRef.current) {
        const r = Math.max(
          0,
          Math.ceil(
            idleRef.current - (Date.now() - lastActivity.current) / 1000,
          ),
        );
        setRemaining(r);
        if (r <= 0) clear("login", "La sesión se cerró por inactividad.");
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("visibilitychange", visibility);
      for (const type of ["pointerdown", "keydown", "pointermove"])
        window.removeEventListener(type, activity);
    };
  }, []);
  useEffect(() => {
    if (screen === "thanks") {
      const t = setTimeout(() => clear(), 7000);
      return () => clearTimeout(t);
    }
  }, [screen]);
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const generation = epoch.current;
    const submitted = code;
    setCode("");
    try {
      const d = await request("/voter/login", {
        method: "POST",
        body: { code: submitted },
      });
      if (generation !== epoch.current) {
        request("/voter/logout", {
          method: "POST",
          token: d.token,
          body: {},
        }).catch(() => {});
        return;
      }
      tokenRef.current = d.token;
      setParticipant(d.participant);
      idleRef.current = d.idleSeconds;
      lastActivity.current = Date.now();
      setRemaining(d.idleSeconds);
      setScreen("vote");
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function vote() {
    setBusy(true);
    setError("");
    const generation = epoch.current;
    try {
      await request("/voter/vote", {
        method: "POST",
        token: tokenRef.current,
        body: { tableId: selected.id },
      });
      if (generation === epoch.current) clear("thanks");
    } catch (e) {
      if (generation === epoch.current) {
        setSelected(null);
        if (e.status === 401) clear("login", e.message);
        else setError(e.message);
      }
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <Header status={info?.status} />
      <main>
        {screen === "login" ? (
          <>
            <section className="welcome">
              <div className="welcome-copy">
                <span className="eyebrow">
                  <Sparkles size={15} /> DÍA DE MUERTOS · INCONNECT
                </span>
                <h1>
                  Honramos recuerdos.
                  <br />
                  Celebramos <em>tradiciones.</em>
                </h1>
                <p>
                  Seis mesas, muchas historias y una misma tradición.
                  <br />
                  Elige la ofrenda que más te inspire.
                </p>
                <div className="hero-notes">
                  <span>
                    <ShieldCheck />
                    Tu voto es secreto
                  </span>
                  <span>
                    <CheckCircle2 />
                    Una persona, un voto
                  </span>
                </div>
                <div className="petal petal-1">✳</div>
                <div className="petal petal-2">✳</div>
              </div>
              <section className="access-card">
                <span className="round-icon">
                  <KeyRound size={24} />
                </span>
                <h2>Tu tradición. Tu voto.</h2>
                <p>Ingresa el código personal que recibiste para participar.</p>
                <form onSubmit={login} autoComplete="off">
                  <label htmlFor="personal-code">Código de participación</label>
                  <input
                    id="personal-code"
                    name="participation-key"
                    type="password"
                    autoComplete="off"
                    spellCheck="false"
                    autoCapitalize="characters"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.toUpperCase().replace(/\s/g, ""))
                    }
                    placeholder="Escribe tus 16 caracteres"
                    minLength={16}
                    maxLength={16}
                    required
                    disabled={busy || info?.status !== "open"}
                  />
                  <ErrorBox message={error} />
                  <button
                    className="primary"
                    disabled={busy || info?.status !== "open"}
                  >
                    {busy
                      ? "Validando…"
                      : info?.status === "open"
                        ? "Entrar a votar"
                        : info?.status === "closed"
                          ? "La votación ha finalizado"
                          : "Pronto comenzamos"}
                    <ArrowRight size={18} />
                  </button>
                </form>
                <small>
                  <Monitor size={14} /> Estación de votación compartida
                </small>
                <div className="privacy-note">
                  <LockKeyhole size={15} />
                  <span>
                    Tu código es personal. Al terminar, tu sesión se cerrará
                    automáticamente.
                  </span>
                </div>
              </section>
            </section>
            <section className="gallery">
              <div className="section-heading">
                <div>
                  <span className="eyebrow orange">
                    NUESTRA TRADICIÓN, EN SEIS OFRENDAS
                  </span>
                  <h2>Un homenaje en cada mesa</h2>
                </div>
                <span className="subtle">
                  Conoce a las participantes <Flower2 size={20} />
                </span>
              </div>
              <div className="offering-grid">
                {info?.offerings.map((o) => (
                  <Offering key={o.id} o={o} preview />
                ))}
              </div>
            </section>
            <div className="rules-strip">
              <Flower2 />
              <p>
                <strong>Una elección que cuenta.</strong> Puedes votar una sola
                vez. Si perteneces a una mesa, elige una distinta a la tuya. Tu
                elección es definitiva.
              </p>
              <ShieldCheck />
            </div>
          </>
        ) : screen === "thanks" ? (
          <section className="thanks">
            <div className="thank-flower">
              <Flower2 size={90} />
              <Check size={40} />
            </div>
            <span className="eyebrow orange">TRADICIONES QUE PERDURAN</span>
            <h1>¡Gracias por participar!</h1>
            <p>
              Tu voto quedó registrado de forma segura.
              <br />
              Tu sesión ha finalizado. La estación está lista para la siguiente
              persona.
            </p>
            <button className="primary" onClick={() => clear()}>
              Volver al inicio <ArrowRight size={18} />
            </button>
            <small>
              Volveremos al inicio automáticamente en unos segundos.
            </small>
          </section>
        ) : (
          <section className="voting">
            <div className="voter-bar">
              <span>
                <span className="avatar">{participant?.name.slice(0, 1)}</span>
                <span>
                  Hola, <strong>{participant?.name}</strong>
                  <small>
                    {participant?.type === "solo_votante"
                      ? "Solo votante · Puedes elegir cualquiera de las seis mesas"
                      : `Participas con la mesa ${participant?.tableId}`}
                  </small>
                </span>
              </span>
              <div>
                <span className="idle">
                  <Clock3 size={15} /> Cierre por inactividad en {remaining}s
                </span>
                <button className="secondary" onClick={() => clear()}>
                  Salir <LogOut size={15} />
                </button>
              </div>
            </div>
            <div className="section-heading">
              <div>
                <span className="eyebrow orange">
                  CADA DETALLE CUENTA UNA HISTORIA
                </span>
                <h1>¿Cuál es tu ofrenda favorita?</h1>
                <p>
                  {participant?.type === "solo_votante"
                    ? "Puedes elegir cualquiera de las seis mesas."
                    : "Elige una de las otras cinco mesas."}{" "}
                  Tendrás que confirmar tu elección.
                </p>
              </div>
              <span className="secret">
                <ShieldCheck />
                Voto secreto y definitivo
              </span>
            </div>
            <ErrorBox message={error} />
            <div className="offering-grid">
              {info?.offerings.map((o) => (
                <Offering
                  key={o.id}
                  o={o}
                  own={o.id === participant?.tableId}
                  selected={selected?.id === o.id}
                  onSelect={setSelected}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
      {selected && screen === "vote" && (
        <Modal
          title="Confirma tu elección"
          onClose={() => !busy && setSelected(null)}
        >
          <div className="confirmation-table">
            <Flower2 size={32} />
            <span>
              Mesa {selected.id}
              <strong>{selected.name}</strong>
            </span>
          </div>
          <p>
            Tu voto es secreto y definitivo. Después de confirmar no podrás
            cambiarlo ni votar de nuevo.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Volver a elegir
            </button>
            <button className="primary" disabled={busy} onClick={vote}>
              {busy ? "Registrando…" : "Confirmar mi voto"}
              <Check size={18} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
