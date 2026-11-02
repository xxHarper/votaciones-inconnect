import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Star, Trash2, Images } from "lucide-react";
import { ErrorBox } from "./components";
export function galleryPayload(items, name, version) {
  const form = new FormData(),
    manifest = [];
  let index = 0;
  form.append("name", name);
  form.append("version", String(version));
  for (const item of items) {
    if (item.file) {
      form.append("photos", item.file);
      manifest.push({ upload: index++, primary: item.primary });
    } else manifest.push({ id: item.id, primary: item.primary });
  }
  form.append("manifest", JSON.stringify(manifest));
  return form;
}
export default function GalleryEditor({ offering, onChange, disabled }) {
  const [items, setItems] = useState(() =>
      offering.photos.map((p) => ({
        ...p,
        key: p.id,
        preview: p.thumbnailUrl,
        primary: !!p.isPrimary,
      })),
    ),
    [error, setError] = useState("");
  const urls = useRef(new Set()),
    counter = useRef(0);
  useEffect(() => {
    onChange(items);
  }, [items, onChange]);
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  function fromFile(file, primary) {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("Cada foto debe pesar hasta 5 MB.");
    if (!/\.(jpe?g|png|webp)$/i.test(file.name))
      throw new Error("Selecciona archivos JPG, PNG o WebP.");
    const preview = URL.createObjectURL(file);
    urls.current.add(preview);
    return { key: `upload-${++counter.current}`, file, preview, primary };
  }
  function add(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setError("");
    try {
      if (items.length + files.length > 5)
        throw new Error("Puedes guardar hasta cinco fotografías por mesa.");
      const next = files.map((file, i) =>
        fromFile(file, items.length === 0 && i === 0),
      );
      setItems([...items, ...next]);
    } catch (e) {
      setError(e.message);
    }
  }
  function replace(index, e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      const next = [...items];
      next[index] = fromFile(file, next[index].primary);
      setItems(next);
    } catch (e) {
      setError(e.message);
    }
  }
  function move(index, direction) {
    const next = [...items];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    setItems(next);
  }
  function remove(index) {
    const next = items.filter((_, i) => i !== index);
    if (next.length && !next.some((p) => p.primary))
      next[0] = { ...next[0], primary: true };
    setItems(next);
  }
  return (
    <section className="gallery-editor" aria-label="Editor de galería">
      <div className="gallery-editor-heading">
        <strong>
          <Images size={16} /> Galería de la mesa {offering.id}
        </strong>
        <span>{items.length}/5 fotos</span>
      </div>
      <p className="help">
        Revisa la vista previa, elige la principal y ordena las fotos. Los
        cambios se aplican juntos al guardar.
      </p>
      <label>
        Foto de la ofrenda (JPG, PNG o WebP, hasta 5 MB por archivo)
        <input
          name="photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={add}
          disabled={disabled || items.length === 5}
        />
      </label>
      <ErrorBox message={error} />
      <div className="gallery-editor-list">
        {items.map((item, index) => (
          <article className="photo-edit" key={item.key}>
            <img
              src={item.preview}
              alt={`Vista previa de la foto ${index + 1}`}
            />
            <div>
              <strong>
                Foto {index + 1}
                {item.primary && (
                  <span className="primary-label">Principal</span>
                )}
              </strong>
              <div className="photo-edit-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled || item.primary}
                  onClick={() =>
                    setItems(
                      items.map((p) => ({ ...p, primary: p.key === item.key })),
                    )
                  }
                  aria-label={`Marcar foto ${index + 1} como principal`}
                >
                  <Star size={14} />
                  Principal
                </button>
                <button
                  type="button"
                  className="icon"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Mover foto ${index + 1} antes`}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  className="icon"
                  disabled={disabled || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Mover foto ${index + 1} después`}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  className="icon"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  aria-label={`Eliminar foto ${index + 1}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <label className="replace-photo">
                Reemplazar foto {index + 1}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => replace(index, e)}
                  disabled={disabled}
                />
              </label>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <p className="help">
          Sin fotografías: se mostrará la ilustración de referencia.
        </p>
      )}
    </section>
  );
}
