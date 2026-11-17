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

test("4021a pela tela: a aba Conferência das taxas", async ({ page, context }) => {
  test.setTimeout(180_000);
  await entrarComo(context, "admin@example.com", CENARIO.ldn, DOMINIO);
  await page.goto(`${APP_PUBLICADO}/financeiro/cobranca-da-rede?aba=conferencia`);
  await expect(page.getByText("Divergências abertas", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Conferir agora" })).toBeVisible();
  await foto(page, "4021a-conferencia");
});

// Os seis papéis que não veem: pela TELA, o endereço direto volta ao Financeiro (ou ao início).
test("4021: Dentista, Planner, ASB, TSB, SDR e Recepcionista não entram na Cobrança da rede", async ({ page, context }) => {
  test.setTimeout(400_000);
  const { sql } = await import("./roteiro-dono.apoio");
  const [u] = await sql<{ id: string }>("select id from public.profiles where email = 'consultor@example.com'");
  const [fr] = await sql<{ id: string }>("select id from public.clinics where type = 'franchisor' order by created_at limit 1");
  const antes = await sql<{ clinic_id: string; role: string }>("select clinic_id, role from public.user_clinic_roles_all where user_id = $1", [u.id]);
  try {
    for (const [papel, clinica] of [["dentist", CENARIO.ldn], ["planner_dentist", fr.id], ["asb", CENARIO.ldn], ["tsb", CENARIO.ldn], ["sdr", fr.id], ["receptionist", CENARIO.ldn]] as const) {
      await sql("delete from public.user_clinic_roles_all where user_id = $1", [u.id]);
      await sql("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [u.id, clinica, papel]);
      await context.clearCookies();
      await entrarComo(context, "consultor@example.com", clinica, DOMINIO);
      for (const rota of ["/financeiro/cobranca-da-rede", "/financeiro/cobranca-da-rede?aba=conferencia"]) {
        await page.goto(`${APP_PUBLICADO}${rota}`);
        await page.waitForLoadState("networkidle");
        expect(page.url(), `${papel} em ${rota}`).not.toContain("cobranca-da-rede");
      }
    }
  } finally {
    await sql("delete from public.user_clinic_roles_all where user_id = $1", [u.id]);
    for (const r of antes) await sql("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [u.id, r.clinic_id, r.role]);
  }
});
