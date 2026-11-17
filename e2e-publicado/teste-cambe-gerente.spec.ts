// O TESTE DE PONTA A PONTA EM CAMBÉ (pedido do dono, 17/11/2026): a parte do
// GERENTE, pela tela do projeto de teste. Contesta UMA linha e tenta conferir o
// resto. Não decide, não aprova, não emite (isso é do dono, como Admin Master).
import { expect, test } from "@playwright/test";
import { entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { anotar, foto, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const LOTE = "9b4d58a3-0f41-4460-893a-58ec275999d9";

test("Cambé, 10/2026 — a parte do Gerente", async ({ page, context }) => {
  test.setTimeout(300_000);
  const [cambe] = await sql<{ id: string }>("select id from public.clinics where name = 'Risarte Cambé - Centro'");
  const [ldn] = await sql<{ id: string }>(
    "select b.id from public.franchise_monthly_batches b join public.clinics c on c.id = b.clinic_id where c.name = 'Risarte Londrina - Centro' and b.status <> 'cancelada' limit 1");
  await entrarComo(context, "gerente@example.com", cambe.id, DOMINIO);

  // 1) Vê só Cambé.
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede`);
  await expect(page.getByRole("heading", { name: "Cobrança da rede" })).toBeVisible({ timeout: 60_000 });
  const lista = await textoDaTela(page);
  anotar("G1", lista.includes("10/2026") && !lista.includes("Londrina"), `lista: ${lista.includes("Londrina") ? "MOSTRA Londrina" : "sem Londrina"}; ${lista.includes("Abrir a prévia de um mês") ? "MOSTRA abrir prévia" : "sem 'Abrir a prévia'"}`);
  await foto(page, "cambe-g1-lista");
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede?lote=${ldn.id}`);
  await page.waitForLoadState("networkidle");
  const outra = await textoDaTela(page);
  anotar("G1b", !outra.includes("Londrina - Centro —") && !outra.includes("R$ 800,00"), `abrindo o lote de Londrina pelo endereço: ${outra.includes("R$ 800,00") ? "MOSTROU" : "não mostrou o demonstrativo"}`);
  await foto(page, "cambe-g1b-londrina");

  // 2) Abre a prévia de Cambé e contesta a linha Royalty · Maquininha.
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede?lote=${LOTE}`);
  await expect(page.getByText("Total a pagar")).toBeVisible({ timeout: 60_000 });
  const demo = await textoDaTela(page);
  anotar("G2a", demo.includes("Conferi, está de acordo") && !demo.includes("Aprovar e emitir"), `a prévia: ${demo.match(/Confira até [^.]*\.[^.]*\./)?.[0] ?? "sem a frase do prazo"}`);
  await foto(page, "cambe-g2-previa");
  const linha = page.locator("tr", { hasText: "Maquininha" }).filter({ hasText: /Royalt/i }).first();
  await linha.getByRole("button", { name: "Contestar" }).click();
  await page.locator("input[name=motivo]").fill("O recebimento da maquininha de 20/10 foi estornado pela adquirente (teste do dono).");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.waitForTimeout(4000);
  await page.reload();
  await expect(page.getByText("Contestada").first()).toBeVisible({ timeout: 30_000 });
  const [it] = await sql<{ status: string; contest_reason: string }>("select status, contest_reason from public.franchise_monthly_items where id = '7c480da9-52c5-478c-b584-ee36eb29662d'");
  anotar("G2", it.status === "contestado", `a linha Royalty · Maquininha (R$ 16,46) ficou "${it.status}": ${it.contest_reason}`);
  await foto(page, "cambe-g2-contestada");

  // 3) Tenta conferir o resto.
  await page.getByRole("button", { name: "Conferi, está de acordo" }).click();
  const aviso = page.locator("[data-sonner-toast]").first();
  await aviso.waitFor({ timeout: 15_000 }).catch(() => {});
  const msg = (await aviso.textContent().catch(() => null)) ?? "(nenhum aviso)";
  await foto(page, "cambe-g3-conferir");
  const [b] = await sql<{ unit_ack_at: string | null; status: string }>("select unit_ack_at, status from public.franchise_monthly_batches where id = $1", [LOTE]);
  anotar("G3", b.unit_ack_at === null, `"Conferi, está de acordo" com a contestação aberta: ${msg}; lote ${b.status}, conferido=${b.unit_ack_at ? "sim" : "não"}`);
});
