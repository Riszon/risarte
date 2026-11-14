// ASA3, entrega 3 (4010) — REPASSES DA FRANQUIA, na tela de verdade.
//
// Só LÊ telas (e baixa uma planilha, que vira um registro de auditoria — é
// isso que se quer provar). Roda contra o projeto de teste publicado
// (`npm run test:e2e:publicado`) ou, com `APP_PUBLICADO=http://localhost:PORTA`,
// contra um servidor local apontado para o banco de TREINO.
//
// Confere: o Admin vê a tela com as partes e o saldo; o item fica no grupo
// Rede; a planilha baixa e fica na auditoria; Gerente, Franqueado, Financeiro
// e Recepcionista, sem a permissão liberada (padrão de fábrica), não entram.
import { expect, test, type Page } from "@playwright/test";
import { banco, entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const CAPTURAS = "test-results/capturas-repasses";
let ldn: string;

test.beforeAll(async () => {
  const db = await banco();
  try {
    ldn = (await db.query("select id from public.clinics where name = 'Risarte Londrina - Centro'")).rows[0].id;
  } finally {
    await db.end();
  }
});

async function abrir(page: Page, caminho: string) {
  await page.goto(caminho, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
}

test.describe.configure({ mode: "serial" });

test("Admin Master — a tela inteira, com o saldo e as partes", async ({ context, page }) => {
  await entrarComo(context, "admin@example.com", ldn, DOMINIO);
  await abrir(page, "/financeiro/repasses-da-franquia");
  await expect(page.getByRole("heading", { name: "Repasses da franquia" })).toBeVisible();
  for (const t of ["Resumo", "Recebido com split × por fora", "Liquidado por unidade e taxa", "Repasses a receber", "Divergências e ocorrências", "Dispensas do período"]) {
    await expect(page.getByRole("heading", { name: t })).toBeVisible();
  }
  await expect(page.getByText(/Saldo da conta Asaas da franqueadora/)).toBeVisible();
  await expect(page.getByText(/Não foi possível ler/)).toHaveCount(0);
  await page.screenshot({ path: `${CAPTURAS}/admin-1-topo.png`, fullPage: true });

  // 0.447.0 — o botão lê o saldo na hora (GET /finance/balance no sandbox: só leitura).
  const db0 = await banco();
  const conferidoAntes = (await db0.query("select balance_checked_at from public.gateway_accounts where owner_type = 'franchisor' and disabled_at is null order by created_at limit 1")).rows[0]?.balance_checked_at ?? null;
  await page.getByRole("button", { name: "Atualizar saldo" }).click();
  await expect(page.getByText("Saldo atualizado com o Asaas.")).toBeVisible({ timeout: 20000 });
  const conferidoDepois = (await db0.query("select balance_checked_at from public.gateway_accounts where owner_type = 'franchisor' and disabled_at is null order by created_at limit 1")).rows[0].balance_checked_at;
  const usos = Number((await db0.query("select count(*) n from public.gateway_key_usage where purpose = 'balance_check_manual' and actor is not null and used_at > now() - interval '2 minutes'")).rows[0].n);
  await db0.end();
  expect(conferidoAntes == null || new Date(conferidoDepois) > new Date(conferidoAntes), "a conferência fica com a hora nova").toBe(true);
  expect(usos, "o uso da chave fica registrado com o autor").toBeGreaterThan(0);
  await expect(page.getByText(/Conferido no Asaas em/)).toBeVisible();
  await page.screenshot({ path: `${CAPTURAS}/admin-1b-saldo-atualizado.png` });

  // O mês com as cobranças das provas (novembro de 2026), só Londrina.
  await abrir(page, `/financeiro/repasses-da-franquia?mes=2026-11&unidade=${ldn}`);
  await page.getByText(/Cobrança por cobrança/).click();
  await page.screenshot({ path: `${CAPTURAS}/admin-2-londrina-novembro.png`, fullPage: true });

  // A planilha: baixa e fica na auditoria.
  const db = await banco();
  const antes = Number((await db.query("select count(*) n from public.audit_logs where entity_type = 'franchise_payouts'")).rows[0].n);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Planilha" }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/^repasses-da-franquia-resumo-2026-11-01-a-2026-11-30\.xlsx$/);
  const depois = Number((await db.query("select count(*) n from public.audit_logs where entity_type = 'franchise_payouts'")).rows[0].n);
  await db.end();
  expect(depois, "o download fica na auditoria").toBe(antes + 1);
});

test("o item fica no grupo Rede do Financeiro", async ({ context, page }) => {
  await entrarComo(context, "admin@example.com", ldn, DOMINIO);
  await abrir(page, "/financeiro");
  await page.getByRole("button", { name: "Rede" }).click();
  await expect(page.getByRole("menuitem", { name: "Repasses da franquia" })).toBeVisible();
});

for (const email of ["gerente@example.com", "franqueado@example.com", "financeiro@example.com", "recepcao@example.com"]) {
  test(`${email} — sem a permissão liberada, não entra`, async ({ context, page }) => {
    await context.clearCookies();
    await entrarComo(context, email, ldn, DOMINIO);
    await abrir(page, "/financeiro/repasses-da-franquia");
    expect(new URL(page.url()).pathname).not.toBe("/financeiro/repasses-da-franquia");
  });
}
