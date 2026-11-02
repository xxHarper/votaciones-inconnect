import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { atomic, audit, state } from "./db.js";
import { assert, exact } from "./security.js";
export async function optimizePhoto(file) {
  assert(
    file?.buffer && file.buffer.length <= 5 * 1024 * 1024,
    400,
    "Cada foto debe pesar hasta 5 MB.",
  );
  const b = file.buffer;
  const signature = b
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : b[0] === 255 && b[1] === 216 && b[2] === 255
      ? "jpeg"
      : b.toString("ascii", 0, 4) === "RIFF" &&
          b.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : null;
  assert(signature, 400, "Solo fotografías reales JPG, PNG o WebP.");
  try {
    const pipeline = sharp(b, {
        limitInputPixels: 40000000,
        failOn: "warning",
      }),
      meta = await pipeline.metadata();
    assert(
      meta.format === signature && (!meta.pages || meta.pages === 1),
      400,
      "Utiliza una fotografía estática JPG, PNG o WebP.",
    );
    const { data, info } = await pipeline
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(data)
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
    return {
      id: randomUUID(),
      data,
      thumbnail,
      mime: "image/webp",
      width: info.width,
      height: info.height,
    };
  } catch (e) {
    if (e.status) throw e;
    assert(
      false,
      400,
      "La fotografía está dañada, incompleta o excede 40 megapíxeles.",
    );
  }
}
export function photoList(db, id) {
  return db
    .prepare(
      "SELECT id,position,is_primary AS isPrimary,width,height FROM offering_photos WHERE offering_id=? ORDER BY position",
    )
    .all(id)
    .map((p) => ({
      ...p,
      url: `/api/offerings/${id}/photos/${p.id}`,
      thumbnailUrl: `/api/offerings/${id}/photos/${p.id}?size=thumb`,
    }));
}
export function offeringList(db) {
  return db
    .prepare(
      "SELECT id,name,gallery_version AS galleryVersion FROM offerings ORDER BY id",
    )
    .all()
    .map((o) => {
      const photos = photoList(db, o.id);
      return {
        ...o,
        photos,
        hasPhoto: photos.length > 0 ? 1 : 0,
        primaryPhoto: photos.find((p) => p.isPrimary) || null,
      };
    });
}
export function saveGallery(db, { id, name, version, manifest, uploads }) {
  assert(Number.isInteger(id) && id >= 1 && id <= 6, 400, "Mesa inválida.");
  assert(
    typeof name === "string" &&
      name.trim().length >= 2 &&
      name.length <= 100 &&
      !/[\x00-\x1f]/.test(name),
    400,
    "Nombre inválido.",
  );
  assert(
    Number.isInteger(version) && version >= 0,
    400,
    "Versión de galería inválida.",
  );
  assert(
    Array.isArray(manifest) && manifest.length <= 5,
    400,
    "Máximo cinco fotografías por mesa.",
  );
  assert(
    manifest.every((p) => p && typeof p === "object" && !Array.isArray(p)),
    400,
    "Referencia de fotografía inválida.",
  );
  assert(
    manifest.length === 0 ||
      manifest.filter((p) => p.primary === true).length === 1,
    400,
    "Selecciona exactamente una foto principal.",
  );
  return atomic(db, () => {
    assert(
      state(db) === "draft",
      409,
      "Las fotografías están bloqueadas porque el concurso ya inició.",
    );
    const current = db
      .prepare("SELECT gallery_version FROM offerings WHERE id=?")
      .get(id);
    assert(
      current.gallery_version === version,
      409,
      "La galería cambió en otra sesión. Cierra el editor y vuelve a abrirlo.",
    );
    const stored = new Map(
      db
        .prepare("SELECT * FROM offering_photos WHERE offering_id=?")
        .all(id)
        .map((p) => [p.id, p]),
    );
    const keys = new Set(),
      usedUploads = new Set();
    const rows = manifest.map((p) => {
      exact(p, ["id", "upload", "primary"]);
      assert(typeof p.primary === "boolean", 400, "Principal inválida.");
      assert(
        (typeof p.id === "string") !== Number.isInteger(p.upload),
        400,
        "Referencia de fotografía inválida.",
      );
      const key = p.id ? `id:${p.id}` : `upload:${p.upload}`;
      assert(!keys.has(key), 400, "Fotografía repetida.");
      keys.add(key);
      if (p.id) {
        assert(
          stored.has(p.id),
          400,
          "La fotografía no pertenece a esta mesa.",
        );
        return { ...stored.get(p.id), primary: p.primary };
      }
      assert(
        p.upload >= 0 && p.upload < uploads.length,
        400,
        "Archivo de fotografía inexistente.",
      );
      usedUploads.add(p.upload);
      return { ...uploads[p.upload], primary: p.primary };
    });
    assert(
      usedUploads.size === uploads.length,
      400,
      "Hay archivos sin incluir en la galería.",
    );
    db.prepare("DELETE FROM offering_photos WHERE offering_id=?").run(id);
    const insert = db.prepare(
      "INSERT INTO offering_photos(id,offering_id,data,thumbnail,mime,width,height,position,is_primary) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    rows.forEach((p, index) =>
      insert.run(
        p.id,
        id,
        p.data,
        p.thumbnail,
        p.mime,
        p.width ?? null,
        p.height ?? null,
        index,
        p.primary ? 1 : 0,
      ),
    );
    db.prepare(
      "UPDATE offerings SET name=?,photo=NULL,mime=NULL,gallery_version=gallery_version+1 WHERE id=?",
    ).run(name.trim(), id);
    audit(db, "offering_updated", String(id));
    return { ok: true };
  });
}
