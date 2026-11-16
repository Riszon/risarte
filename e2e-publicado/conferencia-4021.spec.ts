// Conferência rápida da 4021 pela tela publicada (Admin e Recepcionista): o quadro
// da cobrança mensal na Central e a tela "Cobrança da rede". Só lê; não grava.
import { expect, test } from "@playwright/test";
import { entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { CENARIO, foto } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;

test("4021 pela tela: Central e Cobrança da rede", async ({ page, context }) => {
  test.setTimeout(180_000);
  await entrarComo(context, "admin@example.com", CENARIO.ldn, DOMINIO);
  await page.goto(`${APP_PUBLICADO}/central/rede/taxas`);
  await expect(page.getByText("Cobrança mensal às unidades", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Taxas fixas no mês incompleto", { exact: true }).first()).toBeVisible();
  await foto(page, "4021-central");
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede`);
  await expect(page.getByRole("heading", { name: "Cobrança da rede" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Abrir a prévia de um mês").first()).toBeVisible();
  await foto(page, "4021-cobranca-da-rede");
  await context.clearCookies();
  await entrarComo(context, "recepcao@example.com", CENARIO.ldn, DOMINIO);
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede`);
  await page.waitForLoadState("networkidle");
  expect(page.url()).not.toContain("cobranca-da-rede");
});
