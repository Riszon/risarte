// O TESTE DE CAMBÉ (17/11/2026): depois da decisão do dono, o GERENTE confere a prévia pela tela.
import { expect, test } from "@playwright/test";
import { entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { anotar, foto, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const LOTE = "9b4d58a3-0f41-4460-893a-58ec275999d9";

test("Cambé, 10/2026 — o Gerente confere", async ({ page, context }) => {
  test.setTimeout(180_000);
  const [cambe] = await sql<{ id: string }>("select id from public.clinics where name = 'Risarte Cambé - Centro'");
  await entrarComo(context, "gerente@example.com", cambe.id, DOMINIO);
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede?lote=${LOTE}`);
  await expect(page.getByText("Total a pagar")).toBeVisible({ timeout: 60_000 });
  const antes = await textoDaTela(page);
  anotar("G4a", antes.includes("Aceita: dispensada"), `a linha aceita aparece como "Aceita: dispensada"; total ${antes.match(/Total a pagar\s*R\$\s*[\d.,]+/)?.[0] ?? "?"}`);
  await page.getByRole("button", { name: "Conferi, está de acordo" }).click();
  await page.waitForTimeout(4000);
  const [b] = await sql<{ unit_ack_at: string | null }>("select unit_ack_at from public.franchise_monthly_batches where id = $1", [LOTE]);
  await page.reload();
  await foto(page, "cambe-g4-conferida");
  anotar("G4", b.unit_ack_at !== null, `conferida pelo Gerente: ${b.unit_ack_at ? "sim" : "não"}`);
});
