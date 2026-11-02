import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
const password = "Solo-Pruebas-E2E-Seguras",
  url = "http://127.0.0.1:3190";
const photo = readFileSync(new URL("../fixtures/photo.png", import.meta.url));
function participantsCSV() {
  let id = 0;
  const rows = ["id_participante,nombre,mesa,tipo"];
  [8, 6, 8, 6, 5, 1].forEach((total, index) => {
    for (let i = 0; i < total; i++)
      rows.push(
        `OF-${String(++id).padStart(3, "0")},Persona de prueba ${id},${index + 1},integrante`,
      );
  });
  for (let i = 0; i < 6; i++)
    rows.push(
      `OF-${String(++id).padStart(3, "0")},Persona de prueba ${id},,solo_votante`,
    );
  return "\uFEFF" + rows.join("\r\n");
}
async function adminLogin(page) {
  await page.goto(url + "/admin");
  await page.getByLabel("Contraseña administrativa").fill(password);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo listo para celebrar" }),
  ).toBeVisible();
}
async function importPreview(page) {
  await page.getByRole("button", { name: "Importar CSV" }).click();
  await page
    .getByLabel("Archivo CSV UTF-8")
    .setInputFiles({
      name: "participantes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(participantsCSV()),
    });
  await page.getByRole("button", { name: "Previsualizar importación" }).click();
  await expect(page.locator(".preview-table tbody tr")).toHaveCount(40);
  await expect(page.locator(".import-distribution")).toContainText(
    "Solo votantes: 6",
  );
}

test("40 participantes, importación idempotente, edición completa de galería y votación de solo_votante", async ({
  page,
}) => {
  test.setTimeout(90000);
  await adminLogin(page);
  await page
    .getByRole("button", { name: "Participantes", exact: false })
    .click();
  await importPreview(page);
  await expect(page.locator(".import-summary")).toContainText("40 nuevos");
  await page.screenshot({
    path: "test-results/importacion-40.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(40);
  await expect(page.locator("tbody")).toContainText("Sin mesa");
  await importPreview(page);
  await expect(page.locator(".import-summary")).toContainText(
    "40 ya existentes",
  );
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(40);
  await page.getByRole("button", { name: "Emitir códigos" }).click();
  await page.getByLabel("Confirma tu contraseña administrativa").fill(password);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  const download = await downloadPromise;
  const codes = parse(await readFile(await download.path(), "utf8"), {
    columns: true,
    bom: true,
  });
  expect(codes).toHaveLength(40);
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.locator(".stats")).toContainText("Solo votantes6");
  await expect(page.locator(".solo-participation")).toContainText(
    "0 de 6 participaron",
  );
  await page.getByRole("button", { name: "Ofrendas", exact: true }).click();
  await page.getByRole("button", { name: "Editar ofrenda" }).first().click();
  await page
    .getByLabel("Foto de la ofrenda")
    .setInputFiles(
      [1, 2, 3].map((i) => ({
        name: `foto-${i}.png`,
        mimeType: "image/png",
        buffer: photo,
      })),
    );
  await expect(page.locator(".photo-edit")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Marcar foto 2 como principal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mover foto 3 antes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Eliminar foto 1", exact: true })
    .click();
  await expect(page.locator(".photo-edit")).toHaveCount(2);
  await page
    .getByLabel("Reemplazar foto 1", { exact: true })
    .setInputFiles({
      name: "reemplazo.webp",
      mimeType: "image/png",
      buffer: photo,
    });
  await expect(page.locator(".photo-edit").nth(1)).toContainText("Principal");
  await page.screenshot({
    path: "test-results/editor-galeria.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  const firstCard = page.locator(".admin-offerings .offering").first();
  await firstCard
    .getByRole("button", { name: "Ver fotos (2)", exact: true })
    .click();
  await expect(page.locator(".gallery-controls")).toContainText("Foto 2 de 2");
  await page
    .getByRole("button", { name: "Foto anterior", exact: true })
    .click();
  await expect(page.locator(".gallery-controls")).toContainText("Foto 1 de 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".gallery-controls")).toContainText("Foto 2 de 2");
  await page.getByRole("button", { name: "Cerrar y regresar" }).click();
  // Cancelar no borra fotografías persistidas.
  await page.getByRole("button", { name: "Editar ofrenda" }).first().click();
  await page
    .getByRole("button", { name: "Eliminar foto 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    firstCard.getByRole("button", { name: "Ver fotos (2)", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await page
    .getByRole("button", { name: "Abrir votación", exact: true })
    .click();
  await page.getByLabel("Confirma tu contraseña administrativa").fill(password);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.locator(".election-control")).toContainText(
    "La comunidad está eligiendo",
  );
  await page.getByRole("button", { name: "Ofrendas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Editar ofrenda" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.goto(url + "/");
  await page
    .getByLabel("Código de participación")
    .fill(codes.find((p) => p.identificador === "OF-001").codigo);
  await page.getByRole("button", { name: "Entrar a votar" }).click();
  const own = page.locator(".offering.own");
  await expect(
    own.getByRole("button", { name: "No puedes votar por tu mesa" }),
  ).toBeDisabled();
  await own.getByRole("button", { name: "Ver fotos (2)" }).click();
  await expect(page.locator(".gallery-stage img")).toBeVisible();
  await page.screenshot({
    path: "test-results/galeria-votante.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cerrar y regresar" }).click();
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await page
    .getByLabel("Código de participación")
    .fill(codes.find((p) => p.identificador === "OF-035").codigo);
  await page.getByRole("button", { name: "Entrar a votar" }).click();
  await expect(page.locator(".voter-bar")).toContainText("Solo votante");
  await expect(
    page.getByRole("button", { name: "Elegir esta ofrenda" }),
  ).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "No puedes votar por tu mesa" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Elegir esta ofrenda" })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmar mi voto" }).click();
  await expect(
    page.getByRole("heading", { name: "¡Gracias por participar!" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByLabel("Código de participación")).toHaveValue("");
});
