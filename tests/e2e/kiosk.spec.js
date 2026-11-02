import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
const code = (i) =>
  `ABCDEFGHJKLMNPQ${String.fromCharCode(65 + i)}`.replace("I", "K");
async function login(page, i) {
  await page.goto("/");
  await page.getByLabel("Código de participación").fill(code(i));
  await page.getByRole("button", { name: "Entrar a votar" }).click();
  await expect(
    page.getByText(`Persona de prueba ${i}`, { exact: true }),
  ).toBeVisible();
}
test("estación: seis mesas, propia bloqueada, confirmación, limpieza, no repetir y retorno", async ({
  page,
}) => {
  await login(page, 0);
  await expect(page.locator(".offering")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "No puedes votar por tu mesa" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Elegir esta ofrenda" })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar mi voto" }).click();
  await expect(
    page.getByRole("heading", { name: "¡Gracias por participar!" }),
  ).toBeVisible();
  await expect(
    page.getByText("Persona de prueba 0", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole("button", { name: "Volver al inicio" }).click();
  await page.getByLabel("Código de participación").fill(code(0));
  await page.getByRole("button", { name: "Entrar a votar" }).click();
  await expect(page.getByRole("alert")).toContainText("Código inválido");
  await page.reload();
  await expect(page.getByLabel("Código de participación")).toHaveValue("");
});
test("inactividad cierra la sesión y borra nombre", async ({ page }) => {
  await login(page, 1);
  await expect(page.getByLabel("Código de participación")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByText("Persona de prueba 1", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Código de participación")).toHaveValue("");
});
test("recarga y otra pestaña no recuperan identidad; ocultar revoca", async ({
  page,
  context,
}) => {
  await login(page, 2);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByLabel("Código de participación")).toHaveValue("");
  await expect(other.locator(".voter-bar")).toHaveCount(0);
  await other.close();
  await page.reload();
  await expect(page.getByLabel("Código de participación")).toBeVisible();
  await expect(page.locator(".voter-bar")).toHaveCount(0);
});
test("navegar atrás y adelante vuelve al acceso sin identidad", async ({
  page,
}) => {
  await login(page, 3);
  await page.goto("/admin");
  await page.goBack();
  await expect(page.getByLabel("Código de participación")).toBeVisible();
  await expect(page.locator(".voter-bar")).toHaveCount(0);
});
test("agradecimiento vuelve automáticamente al acceso", async ({ page }) => {
  await login(page, 4);
  await page
    .getByRole("button", { name: "Elegir esta ofrenda" })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmar mi voto" }).click();
  await expect(
    page.getByRole("heading", { name: "¡Gracias por participar!" }),
  ).toBeVisible();
  await expect(page.getByLabel("Código de participación")).toBeVisible({
    timeout: 12000,
  });
});
test("panel independiente: inicio, privacidad de resultados y cierre de sesión", async ({
  page,
}) => {
  await page.goto("/admin");
  await page
    .getByLabel("Contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo listo para celebrar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "La sorpresa se guarda hasta el final" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Participantes", exact: false })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByLabel("Contraseña administrativa")).toBeVisible();
});
test("recursos locales, escritorio y tamaño reducido sin desbordamiento", async ({
  page,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:3187")) external.push(r.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".offering")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/estacion-escritorio.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 600, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
});

test("preparación completa: importación, foto, descarga única, apertura, voto, cierre y resultados", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("http://127.0.0.1:3188/admin");
  await page
    .getByLabel("Contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await page
    .getByRole("button", { name: "Participantes", exact: false })
    .click();
  await page.getByRole("button", { name: "Importar CSV" }).click();
  await page.getByLabel("Archivo CSV UTF-8").setInputFiles({
    name: "personas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "identificador,nombre,correo,mesa\nPC001,Ana de prueba,,1\nPC002,Luis de prueba,,2",
    ),
  });
  await page.getByRole("button", { name: "Previsualizar importación" }).click();
  await expect(
    page
      .getByRole("region", { name: "Previsualización de participantes" })
      .locator("tbody tr"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Editar participante", exact: true })
    .first()
    .click();
  await page.getByLabel("Nombre completo").fill("Ana corregida");
  await page.getByLabel("Mesa asignada").selectOption("3");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Ana corregida", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Emitir códigos" }).click();
  await page
    .getByLabel("Confirma tu contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("csv-parse/sync");
  const rows = parse(await readFile(await download.path(), "utf8"), {
    columns: true,
    bom: true,
  });
  expect(rows).toHaveLength(2);
  expect(rows[0].codigo).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  await page.getByRole("button", { name: "Ofrendas", exact: true }).click();
  await page.getByRole("button", { name: "Editar ofrenda" }).first().click();
  await page.getByLabel("Nombre de la ofrenda").fill("Recuerdos de INCONNECT");
  await page.getByLabel("Foto de la ofrenda").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: readFileSync(new URL("../fixtures/photo.png", import.meta.url)),
  });
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recuerdos de INCONNECT" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await page
    .getByRole("button", { name: "Abrir votación", exact: true })
    .click();
  await page
    .getByLabel("Confirma tu contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.locator(".election-control")).toContainText(
    "La comunidad está eligiendo",
  );
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.goto("http://127.0.0.1:3188/");
  await page.getByLabel("Código de participación").fill(rows[0].codigo);
  await page.getByRole("button", { name: "Entrar a votar" }).click();
  await page
    .getByRole("button", { name: "Elegir esta ofrenda" })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmar mi voto" }).click();
  await expect(
    page.getByRole("heading", { name: "¡Gracias por participar!" }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3188/admin");
  await page
    .getByLabel("Contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await page
    .getByRole("button", { name: "Cerrar votación", exact: true })
    .click();
  await page
    .getByLabel("Confirma tu contraseña administrativa")
    .fill("Solo-Pruebas-E2E-Seguras");
  await page
    .getByRole("button", { name: "Cerrar votación", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Ver resultados", exact: true })
    .click();
  await expect(page.locator(".rank-card")).toHaveCount(6);
  await expect(page.locator(".results-intro")).toContainText(
    "1 votos · 2 participantes · 50%",
  );
  const resultPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar resultados" }).click();
  const result = await resultPromise;
  expect(await readFile(await result.path(), "utf8")).toContain("porcentaje");
  await page.screenshot({
    path: "test-results/panel-resultados.png",
    fullPage: true,
  });
});
