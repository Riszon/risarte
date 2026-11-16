// ROTEIRO DO DONO — PARTE D: o distrato (4020, seção 4 do relatório), pela TELA
// do projeto de teste publicado (pedido do dono, 16/11/2026).
// O contrato é o LDN-00047 do treino (parcelas em depósito à vista: nenhuma
// cobrança no Asaas é criada nem apagada); o acordo novo é em dinheiro (sem
// Asaas). A venda direta é a do preparo (sem contato). GRAVA no treino.
import { test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { entrarComo, trocarPara } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { CENARIO, PASTA, anotar, esperar, foto, linhaDaParcela, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const C = CENARIO;
const PDF = `${PASTA}/termo-assinado.pdf`;
writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function aba(page: Page, cliente: string, nome: string) {
  await page.goto(`/prontuarios/${cliente}?aba=${nome}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}
async function checklistInteira(page: Page) {
  for (let k = 0; k < 8; k++) {
    const b = page.getByRole("button", { name: "Feito", exact: true }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
    await page.waitForTimeout(1500);
  }
}

test.describe.serial("roteiro do dono — parte D (distrato)", () => {
  test("D1 a D7", async ({ page, context }) => {
    test.setTimeout(900_000);
    page.on("dialog", async (dlg) => {
      if (dlg.type() === "prompt") await dlg.accept("Roteiro do dono");
      else await dlg.accept();
    });
    const [cli] = await sql<{ id: string }>("select id from public.clients where code = 'LDN-00047'");
    const [neg] = await sql<{ id: string }>("select n.id from public.plan_negotiations n join public.commercial_sales cs on cs.negotiation_id = n.id where n.client_id = $1 and cs.closed_at is not null and cs.cancelled_at is null limit 1", [cli.id]);

    // --- D1: o pedido de distrato (Recepção) e "Manter o contrato" (Gerente) ------------
    await entrarComo(context, "recepcao@example.com", C.ldn, DOMINIO);
    await aba(page, cli.id, "plano");
    const pedir = page.getByRole("button", { name: "Pedir distrato" }).first();
    const recVe = await pedir.isVisible().catch(() => false);
    if (recVe) {
      await pedir.click();
      await page.locator("textarea").last().fill("O paciente pediu para encerrar o tratamento (roteiro)");
      await page.getByRole("button", { name: "Registrar o pedido" }).click();
      await page.waitForTimeout(4000);
    }
    const [ped] = await sql<{ id: string; status: string }>("select id, status from public.distrato_requests where negotiation_id = $1 order by requested_at desc limit 1", [neg.id]);
    anotar("D1 a Recepção registra o pedido de distrato na ficha", recVe && ped?.status === "aberto", `botão ${recVe ? "visível" : "AUSENTE"}; pedido ${ped?.status ?? "não gravado"}`);
    await foto(page, "D1-recepcao");
    await trocarPara(context, "gerente@example.com", C.ldn);
    const [ger] = await sql<{ id: string }>("select id from public.profiles where email = 'gerente@example.com'");
    const [av] = await sql<{ n: number }>("select count(*)::int n from public.notifications where user_id = $1 and title = 'Pedido de distrato para decidir' and created_at > now() - interval '30 minutes'", [ger.id]);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    const sec = page.locator("section").filter({ hasText: "Distratos e devoluções" }).first();
    const tSec = await sec.innerText().catch(() => "");
    anotar("D1 o Gerente é avisado e o pedido aparece em Distratos e devoluções", av.n > 0 && /Pedido de distrato/.test(tSec), `avisos ${av.n}; lista: ${tSec.replace(/\s+/g, " ").slice(0, 160)}`);
    const linhaPed = sec.locator("div").filter({ hasText: "Lucas Henrique Barbosa" }).filter({ has: page.getByRole("button", { name: "Manter o contrato" }) }).last();
    await linhaPed.locator("input").first().fill("Conversei com o paciente: ele vai seguir (roteiro)");
    await linhaPed.getByRole("button", { name: "Manter o contrato" }).click();
    await page.waitForTimeout(4000);
    const [ped2] = await sql<{ status: string }>("select status from public.distrato_requests where id = $1", [ped?.id]);
    anotar("D1 \"Manter o contrato\" com o motivo: o pedido sai da lista", ped2?.status === "mantido", `pedido ${ped2?.status ?? "—"}`);

    // --- D4 (cenário): o acordo que junta o contrato e uma venda direta ------------------
    const [vd] = await sql<{ id: string }>(
      `insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, contract_signed, contract_signed_at)
       values ($1, $2, 'Lucas Henrique Barbosa', 20000, 'dinheiro', 2, true, now()) returning id`, [C.ldn, cli.id]);
    await sql("insert into public.payment_installments (seq, kind, due_date, payment_method, amount_cents, clinic_id, client_id, direct_sale_id) values (1, 'parcela', current_date + 30, 'dinheiro', 10000, $1, $2, $3), (2, 'parcela', current_date + 60, 'dinheiro', 10000, $1, $2, $3)", [C.ldn, cli.id, vd.id]);
    const [pp] = await sql<{ due: string }>("select to_char(due_date,'YYYY-MM-DD') due from public.payment_installments where negotiation_id = $1 and status = 'em_aberto' order by due_date desc limit 1", [neg.id]);
    const [pd] = await sql<{ due: string }>("select to_char(due_date,'YYYY-MM-DD') due from public.payment_installments where direct_sale_id = $1 order by seq limit 1", [vd.id]);
    await aba(page, cli.id, "financeiro");
    await linhaDaParcela(page, pp.due).getByRole("checkbox").first().check();
    await linhaDaParcela(page, pd.due).getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /^Renegociar/ }).first().click();
    const d = page.getByRole("dialog");
    await d.locator("xpath=.//label[normalize-space()='Parcelas']/following-sibling::input[1]").fill("2");
    await d.locator("select").first().selectOption("dinheiro");
    await d.locator("textarea").last().fill("Roteiro do dono (16/11/2026)");
    await d.getByRole("button", { name: /Salvar o acordo|Enviar para autorização/ }).click();
    await d.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => {});
    await aba(page, cli.id, "financeiro");
    await page.locator("label", { hasText: "Anexar termo assinado" }).first().locator("input[type=file]").setInputFiles(PDF);
    await page.waitForTimeout(8000);
    const [ag] = await sql<{ id: string; status: string }>("select id, status from public.payment_renegotiations where client_id = $1 order by created_at desc limit 1", [cli.id]);
    anotar("D4 cenário: o acordo do contrato com a venda direta, assinado", ag?.status === "aplicada", `acordo ${ag?.status ?? "—"}`);
    const antes = await sql<{ amount_cents: number }>("select amount_cents from public.payment_installments where renegotiation_id = $1 and status in ('em_aberto','parcial') order by seq", [ag?.id]);

    // --- D2: abrir o distrato do contrato (Cancelar tratamento) -----------------------
    await aba(page, cli.id, "plano");
    await page.getByRole("button", { name: /Cancelar tratamento|Cancelar ·/ }).first().click();
    const card = page.locator("div").filter({ hasText: "Gerar termo de distrato" }).last();
    await page.locator("textarea").first().fill("O paciente pediu o distrato (roteiro do dono)");
    const reav = page.getByText(/Reavaliação/).first();
    if (await reav.isVisible().catch(() => false)) await reav.click().catch(() => {});
    const sel = page.locator("select").first();
    if (await sel.isVisible().catch(() => false)) await sel.selectOption({ index: 1 }).catch(() => {});
    await page.getByRole("button", { name: "Gerar termo de distrato" }).click();
    await page.waitForURL(/\/cancelamentos\/.+\/termo/, { timeout: 45_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const t2 = await textoDaTela(page);
    await foto(page, "D2-termo");
    anotar("D2 o termo de distrato, com a frase das cobranças e a checklist", /Termo de distrato/.test(t2) && /As cobranças em aberto continuam valendo até a assinatura deste termo/.test(t2) && /Checklist do distrato/.test(t2),
      `${/Termo de distrato/.test(t2) ? "título ok" : "SEM o título"}; ${/Checklist do distrato/.test(t2) ? "checklist ok" : "SEM a checklist"}; ${page.url()}`);
    anotar("D4 o termo mostra o acordo antes e depois, marcado [REVISÃO JURÍDICA]", /\[REVISÃO JURÍDICA\]/.test(t2) && /Deixa de ser cobrado/.test(t2), (t2.match(/Deixa de ser cobrado[^\n]*/) ?? ["sem a tabela"])[0]);
    void card;

    // --- D3: a checklist bloqueia o Efetivar ---------------------------------------------
    await page.getByRole("button", { name: "Marcar termo como assinado" }).click();
    await page.waitForTimeout(3000);
    const efetivar = page.getByRole("button", { name: /Efetivar cancelamento/ });
    anotar("D3 com o termo assinado e a checklist aberta, o Efetivar fica bloqueado", await efetivar.isDisabled().catch(() => false), `título do botão: ${await efetivar.getAttribute("title").catch(() => "")}`);
    await page.getByRole("button", { name: "Não se aplica" }).first().click();
    await page.getByRole("button", { name: "Salvar" }).first().click();
    await page.waitForTimeout(2000);
    const toastNsa = (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
    anotar("D3 \"Não se aplica\" sem motivo pede o motivo", /motivo|não se aplica/i.test(toastNsa), toastNsa || "sem aviso");
    await page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {});
    await page.reload();
    await checklistInteira(page);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Efetivar cancelamento/ }).click();
    const [pc] = await sql<{ id: string }>("select id from public.plan_cancellations where negotiation_id = $1 order by created_at desc limit 1", [neg.id]);
    const efet = await esperar(async () => (await sql<{ status: string }>("select status from public.plan_cancellations where id = $1", [pc.id]))[0].status === "efetivado", 60_000);
    const depois = await sql<{ amount_cents: number; status: string }>("select amount_cents, status from public.payment_installments where renegotiation_id = $1 order by seq", [ag?.id]);
    const [abertasPlano] = await sql<{ n: number }>("select count(*)::int n from public.payment_installments where negotiation_id = $1 and status in ('em_aberto','parcial')", [neg.id]);
    anotar("D3 com os 8 itens, o distrato é efetivado e as parcelas do contrato caem", efet && abertasPlano.n === 0, `distrato ${efet ? "efetivado" : "NÃO efetivado"}; parcelas abertas do contrato: ${abertasPlano.n}`);
    const somaA = antes.reduce((s, x) => s + Number(x.amount_cents), 0);
    const somaD = depois.filter((x) => ["em_aberto", "parcial"].includes(x.status)).reduce((s, x) => s + Number(x.amount_cents), 0);
    const [ag2] = await sql<{ status: string }>("select status from public.payment_renegotiations where id = $1", [ag?.id]);
    anotar("D4 as parcelas do acordo reduzidas na parte do contrato, e o acordo continua para a venda direta", somaD < somaA && somaD > 0 && ag2?.status !== "encerrada", `em aberto antes ${somaA}, depois ${somaD}; acordo ${ag2?.status}`);
    await foto(page, "D3-efetivado");

    // --- D5: venda direta com algo pago: o caminho é o distrato --------------------------
    const [p1] = await sql<{ id: string }>("select id from public.payment_installments where direct_sale_id = $1 order by seq limit 1", [C.D.venda]);
    await sql("insert into public.payment_receipts (clinic_id, client_id, installment_id, amount_cents, received_at, payment_method) values ($1, $2, $3, 10000, current_date, 'dinheiro')", [C.ldn, C.D.cliente, p1.id]);
    await sql("update public.direct_sales set closed_at = null where id = $1", [C.D.venda]);
    const [codD] = await sql<{ code: string }>("select code from public.direct_sales where id = $1", [C.D.venda]);
    await page.goto("/comercial/venda-direta?periodo=mes");
    await page.waitForLoadState("networkidle").catch(() => {});
    const item = page.locator("div.rounded-lg.border").filter({ hasText: codD.code }).first();
    await item.getByRole("button").first().click();
    await item.getByRole("button", { name: "Cancelar venda" }).click();
    await page.waitForTimeout(4000);
    const toast5 = (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
    anotar("D5 cancelar a venda direta com algo pago mostra o caminho do distrato", /distrato/i.test(toast5), toast5 || "sem aviso");
    await item.getByRole("button", { name: "Abrir distrato" }).click();
    await item.locator("textarea").last().fill("Desistiu depois de pagar a 1ª (roteiro)");
    await item.getByRole("button", { name: "Abrir o distrato" }).click();
    await page.waitForURL(/\/cancelamentos\/.+\/termo/, { timeout: 45_000 }).catch(() => {});
    const t5 = await textoDaTela(page);
    anotar("D5 o termo de distrato da venda direta, sem multa", /Termo de distrato de venda direta/.test(t5) && !/Multa de rescisão/.test(t5), page.url());
    await page.getByRole("button", { name: "Marcar termo como assinado" }).click();
    await page.waitForTimeout(2500);
    await checklistInteira(page);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Efetivar cancelamento/ }).click();
    const [pcd] = await sql<{ id: string; clinic_refunds_cents: number }>("select id, clinic_refunds_cents from public.plan_cancellations where direct_sale_id = $1 order by created_at desc limit 1", [C.D.venda]);
    const efD = await esperar(async () => (await sql<{ status: string }>("select status from public.plan_cancellations where id = $1", [pcd.id]))[0].status === "efetivado", 60_000);
    anotar("D5 efetivado: a venda direta cancelada; a unidade devolve o pago", efD && Number(pcd.clinic_refunds_cents) === 10000, `distrato ${efD ? "efetivado" : "NÃO"}; devolve ${pcd.clinic_refunds_cents}`);

    // --- D6: a devolução por Pix da unidade ----------------------------------------------
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    const sDev = page.locator("div").filter({ hasText: /Devolução ao paciente/ }).filter({ has: page.getByRole("button", { name: "Pedir a devolução" }) }).last();
    await sDev.locator("input").nth(0).fill("100,00");
    await sDev.locator("input").nth(1).fill("Devolver o que foi pago (roteiro)");
    await sDev.locator("input[type=file]").setInputFiles(PDF);
    await sDev.getByRole("button", { name: "Pedir a devolução" }).click();
    await page.waitForTimeout(5000);
    const [dv] = await sql<{ id: string; status: string }>("select id, status from public.distrato_refunds where cancellation_id = $1", [pcd.id]);
    anotar("D6 o Gerente pede a devolução com o termo anexado", dv?.status === "pedida", `pedido ${dv?.status ?? "não gravado"}`);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    const gerVeAutorizar = await page.locator("section").filter({ hasText: "Distratos e devoluções" }).getByRole("button", { name: "Autorizar" }).first().isVisible().catch(() => false);
    anotar("D6 o Gerente (quem pediu) não autoriza", !gerVeAutorizar, gerVeAutorizar ? "o botão Autorizar APARECE para o Gerente" : "sem o botão");
    await trocarPara(context, "financeiro@example.com");
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    const secF = page.locator("section").filter({ hasText: "Distratos e devoluções" }).first();
    await foto(page, "D6-financeiro");
    const linhaDev = secF.locator("div").filter({ hasText: "Roteiro D distrato venda direta" }).filter({ has: page.getByRole("button", { name: "Autorizar" }) }).last();
    await linhaDev.locator("input").first().fill("ok (roteiro)");
    await linhaDev.getByRole("button", { name: "Autorizar" }).click();
    await page.waitForTimeout(4000);
    const [dv2] = await sql<{ status: string; payable_id: string | null }>("select status, payable_id from public.distrato_refunds where id = $1", [dv?.id]);
    const [pay] = dv2?.payable_id ? await sql<{ account_code: string; amount_cents: number }>("select account_code, amount_cents from public.payables where id = $1", [dv2.payable_id]) : [];
    anotar("D6 o Financeiro autoriza: a conta a pagar 1.9.03", dv2?.status === "autorizada" && pay?.account_code === "1.9.03", `pedido ${dv2?.status}; conta ${pay?.account_code ?? "—"} de ${pay?.amount_cents ?? "—"}`);

    // --- D7: a Central mostra o prazo do aviso --------------------------------------------
    await trocarPara(context, "admin@example.com", C.ldn);
    await page.goto("/central?aba=financeiro");
    await page.waitForLoadState("networkidle").catch(() => {});
    const t7 = await textoDaTela(page);
    anotar("D7 a Central › Financeiro tem o prazo do aviso do distrato (15 a 365), com 60", /Distrato: avisar o Gerente com o contrato em atraso há quantos dias \(15 a 365\)/.test(t7), (t7.match(/Distrato: avisar[^\n]*/) ?? ["campo não encontrado"])[0]);
    await foto(page, "D7-central");
  });
});
