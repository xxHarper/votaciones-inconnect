import React, { useEffect, useRef, useState } from "react";
import {
  Images,
  ChevronLeft,
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
const adminPage = location.pathname.startsWith("/admin");
export const statusLabel = {
  draft: "En preparación",
  open: "Votación abierta",
  closed: "Votación finalizada",
};
function Brand() {
  return (
    <a className="brand" href={adminPage ? "/admin" : "/"}>
      <span className="brand-flower">
        <Flower2 size={30} />
      </span>
      <span>
        Ofrenda<span className="brand-light">Vote</span>
        <small>UNA TRADICIÓN QUE NOS CONECTA</small>
      </span>
    </a>
  );
}
export function Header({ status, children }) {
  return (
    <>
      <div className="papel" />
      <header>
        <Brand />
        <div className="header-right">
          <span className={`status ${status}`}>
            <i />
            {statusLabel[status] || "INCONNECT"}
          </span>
          <span className="company">
            INCONNECT<span>Conectamos historias.</span>
          </span>
          {children}
        </div>
      </header>
    </>
  );
}
export function Footer() {
  return (
    <footer>
      <span>
        <Flower2 size={16} /> Hecho para celebrar lo que nos une.
      </span>
      <span>INCONNECT · Concurso interno de ofrendas</span>
      {!adminPage && (
        <a href="/admin">
          Administración <LockKeyhole size={12} />
        </a>
      )}
    </footer>
  );
}
export function ErrorBox({ message }) {
  return message ? (
    <div className="error" role="alert">
      <AlertTriangle size={18} />
      {message}
    </div>
  ) : null;
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = ref.current.querySelectorAll(
          'button,input,select,[tabindex="0"]',
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <button className="icon close" onClick={onClose} aria-label="Cerrar">
          <X />
        </button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
export function Offering({ o, own, selected, onSelect, preview = false }) {
  const [gallery, setGallery] = useState(false);
  useEffect(() => setGallery(false), [o.galleryVersion]);
  return (
    <>
      <article
        className={`offering ${own ? "own" : ""} ${selected ? "selected" : ""}`}
      >
        <div className="offering-image">
          <img
            src={
              o.hasPhoto
                ? o.primaryPhoto?.thumbnailUrl ||
                  `/api/offerings/${o.id}/photo?v=${o.version || 0}`
                : `/art/mesa-${o.id}.svg`
            }
            alt={
              o.hasPhoto
                ? `Ofrenda de la mesa ${o.id}`
                : `Ilustración de referencia de la mesa ${o.id}`
            }
            loading="lazy"
          />
          <span className="mesa-tag">
            MESA {o.id.toString().padStart(2, "0")}
          </span>
          {own && (
            <span className="own-tag">
              <LockKeyhole size={13} />
              Tu mesa
            </span>
          )}
        </div>
        <div className="offering-content">
          <h3>{o.name}</h3>
          {!o.hasPhoto && <small>Ilustración · foto por confirmar</small>}
          <button
            className="view-photos"
            type="button"
            disabled={!o.photos?.length}
            onClick={() => setGallery(true)}
          >
            <Images size={16} />
            Ver fotos{o.photos?.length ? ` (${o.photos.length})` : ""}
          </button>
          {!preview && (
            <button
              className={own ? "muted-button" : "select-button"}
              disabled={own}
              onClick={() => onSelect(o)}
            >
              {own ? (
                <>
                  <LockKeyhole size={14} />
                  No puedes votar por tu mesa
                </>
              ) : (
                <>
                  Elegir esta ofrenda <ArrowRight size={16} />
                </>
              )}
            </button>
          )}
        </div>
      </article>
      {gallery && o.photos?.length > 0 && (
        <GalleryViewer offering={o} onClose={() => setGallery(false)} />
      )}
    </>
  );
}
export function GalleryViewer({ offering, onClose }) {
  const photos = offering.photos;
  const [index, setIndex] = useState(
    Math.max(
      0,
      photos.findIndex((p) => p.isPrimary),
    ),
  );
  const previous = () =>
      setIndex((i) => (i - 1 + photos.length) % photos.length),
    next = () => setIndex((i) => (i + 1) % photos.length);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        previous();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [photos.length]);
  return (
    <Modal
      title={`Mesa ${offering.id} · ${offering.name}`}
      onClose={onClose}
      wide
    >
      <div className="gallery-stage">
        <img
          src={photos[Math.min(index, photos.length - 1)].url}
          alt={`Mesa ${offering.id}, fotografía ${index + 1} de ${photos.length}`}
        />
      </div>
      <div className="gallery-controls">
        <button
          className="secondary"
          onClick={previous}
          disabled={photos.length < 2}
          aria-label="Foto anterior"
        >
          <ChevronLeft size={18} />
          Anterior
        </button>
        <span aria-live="polite">
          Foto {index + 1} de {photos.length}
        </span>
        <button
          className="secondary"
          onClick={next}
          disabled={photos.length < 2}
          aria-label="Foto siguiente"
        >
          Siguiente
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="gallery-thumbnails">
        {photos.map((p, i) => (
          <button
            key={p.id}
            className={i === index ? "active" : ""}
            onClick={() => setIndex(i)}
            aria-label={`Ver foto ${i + 1}`}
            aria-pressed={i === index}
          >
            <img src={p.thumbnailUrl} alt="" />
          </button>
        ))}
      </div>
      <button className="secondary full" onClick={onClose}>
        Cerrar y regresar
      </button>
    </Modal>
  );
}
