// ROTEIRO DO DONO — PARTE B: a exceção para cancelar venda com acordo (4017a),
// pela TELA do projeto de teste publicado (pedido do dono, 16/11/2026).
//
// ⚠️ O projeto de teste já está com a 4020 (0.456.5): o cancelamento do PLANO
// virou o distrato (que trata o acordo). A exceção da 4017a continua valendo na
// VENDA DIRETA sem nada pago, e é nela que esta parte roda.
// Clientes sem e-mail e sem celular; venda em dinheiro (sem Asaas). GRAVA no treino.
import { test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { CENARIO, PASTA, anotar, esperar, foto, linhaDaParcela, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const C = CENARIO;
const PDF = `${PASTA}/termo-assinado.pdf`;
writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
type Parcela = { id: string; seq: number; due_date: string; status: string };
const parcelas = (venda: string) =>
  sql<Parcela>("select id, seq, to_char(due_date, 'YYYY-MM-DD') due_date, status from public.payment_installments where direct_sale_id = $1 order by seq", [venda]);

async function abrirFinanceiro(page: Page, cliente: string) {
  await page.goto(`/prontuarios/${cliente}?aba=financeiro`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Cobranças", { exact: true }).first().waitFor({ timeout: 30_000 });
}
async function acordo(page: Page, cliente: string, vencimentos: string[], nParcelas: number, anexar: boolean) {
  await abrirFinanceiro(page, cliente);
  for (const v of vencimentos) await linhaDaParcela(page, v).getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /^Renegociar/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByText("Renegociar cobranças").waitFor();
  await d.locator("xpath=.//label[normalize-space()='Parcelas']/following-sibling::input[1]").fill(String(nParcelas));
  await d.locator("select").first().selectOption("dinheiro");
  await d.locator("textarea").last().fill("Roteiro do dono (16/11/2026)");
  await d.getByRole("button", { name: /Salvar o acordo|Enviar para autorização/ }).click();
  await d.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => {});
  if (anexar) {
    await abrirFinanceiro(page, cliente);
    await page.locator("label", { hasText: "Anexar termo assinado" }).first().locator("input[type=file]").setInputFiles(PDF);
    await page.waitForTimeout(6000);
  }
}
/**
 * Abre a venda direta na lista do Comercial e clica em "Cancelar venda". A venda
 * criada pelo roteiro não tem código: acha pelo nome do cliente e pela ordem da
 * lista (a mais nova primeiro), entre as vendas ainda abertas daquele cliente.
 */
async function cancelarVenda(page: Page, vendaId: string) {
  const [v] = await sql<{ client_name: string }>("select client_name from public.direct_sales where id = $1", [vendaId]);
  const irmas = await sql<{ id: string }>("select id from public.direct_sales where client_name = $1 and not coalesce(cancelled, false) and closed_at is null order by created_at desc", [v.client_name]);
  const k = irmas.findIndex((x) => x.id === vendaId);
  await page.goto("/comercial/venda-direta?periodo=mes");
  await page.waitForLoadState("networkidle").catch(() => {});
  const item = page.locator("div.rounded-lg.border.p-3").filter({ hasText: v.client_name }).nth(Math.max(0, k));
  await item.getByRole("button").first().click();
  await item.getByRole("button", { name: "Cancelar venda" }).click();
  await page.waitForTimeout(5000);
  return { item, texto: await item.innerText(), toast: (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ") };
}

// Nenhum clique espera para sempre: o passo que trava vira falha com a foto.
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

test.describe.serial("roteiro do dono — parte B (exceção)", () => {
  test("B1 a B5", async ({ page, context }) => {
    test.setTimeout(900_000);
    const respostas: string[] = [];
    page.on("dialog", async (dlg) => {
      if (dlg.type() === "prompt") await dlg.accept(respostas.shift() ?? "Roteiro do dono");
      else await dlg.accept();
    });
    await entrarComo(context, "gerente@example.com", C.ldn, DOMINIO);
    const [vB1, vB2] = C.B.vendas as string[];

    // --- B1: o acordo pendente se cancela ali, sem a franqueadora ----------------------
    const [b1p1] = await parcelas(vB1);
    await acordo(page, C.B.cliente, [b1p1.due_date], 1, false);
    const c1 = await cancelarVenda(page, vB1);
    await foto(page, "B1-recusa");
    anotar("B1 venda com acordo pendente: o cancelamento é recusado e mostra os acordos", /Acordos de renegociação desta venda/.test(c1.texto) && /Cancelar o acordo pendente/.test(c1.texto), c1.toast || c1.texto.slice(0, 200));
    respostas.push("O cliente desistiu do acordo (roteiro)");
    await c1.item.getByRole("button", { name: "Cancelar o acordo pendente" }).click();
    await page.waitForTimeout(4000);
    const c1b = await cancelarVenda(page, vB1);
    const [s1] = await sql<{ cancelled: boolean }>("select cancelled from public.direct_sales where id = $1", [vB1]);
    anotar("B1 cancelado o acordo pendente, o cancelamento da venda segue normal", s1.cancelled === true, `venda ${s1.cancelled ? "cancelada" : "não cancelada"}; a tela disse: ${c1b.toast}`);

    // --- B2: o acordo assinado, só desta venda: Recepção x Gerente ----------------------
    const [b2p1] = await parcelas(vB2);
    await acordo(page, C.B.cliente, [b2p1.due_date], 2, true);
    const [rB2] = await sql<{ id: string; status: string }>("select id, status from public.payment_renegotiations where source_installment_ids && $1::uuid[] order by created_at desc limit 1", [[b2p1.id]]);
    anotar("B2 cenário: o acordo assinado (termo anexado), com parcela em aberto", rB2?.status === "aplicada", `acordo ${rB2?.status ?? "não achado"}`);
    await context.clearCookies();
    await entrarComo(context, "recepcao@example.com", C.ldn, DOMINIO);
    const c2r = await cancelarVenda(page, vB2);
    await foto(page, "B2-recepcao");
    anotar("B2 a Recepção não vê \"Pedir exceção\" e vê a orientação de chamar o Gerente", /Chame o Gerente da unidade/.test(c2r.texto) && !/Pedir exceção ao Financeiro/.test(c2r.texto), (c2r.texto.match(/Chame o Gerente[^\n]*/) ?? [c2r.toast])[0]);
    await context.clearCookies();
    await entrarComo(context, "gerente@example.com", C.ldn, DOMINIO);
    const c2g = await cancelarVenda(page, vB2);
    respostas.push("O cliente mudou de cidade e desistiu (roteiro)");
    const pedirBtn = c2g.item.getByRole("button", { name: "Pedir exceção ao Financeiro" });
    const temPedir = await pedirBtn.isVisible().catch(() => false);
    if (temPedir) {
      await pedirBtn.click();
      await page.waitForTimeout(4000);
    }
    const [ex] = await sql<{ id: string; status: string }>("select id, status from public.sale_cancel_exceptions where direct_sale_id = $1 order by requested_at desc limit 1", [vB2]);
    anotar("B2 o Gerente pede a exceção ao Financeiro, com o motivo", temPedir && ex?.status === "pedida", `botão ${temPedir ? "visível" : "ausente"}; pedido ${ex?.status ?? "não gravado"}`);

    // --- B3: a decisão do Financeiro --------------------------------------------------
    await context.clearCookies();
    await entrarComo(context, "financeiro@example.com", undefined, DOMINIO);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    const t3 = await textoDaTela(page);
    await foto(page, "B3-pedidos");
    const [fin] = await sql<{ id: string }>("select id from public.profiles where email = 'financeiro@example.com'");
    const notas = await sql<{ n: number }>("select count(*)::int n from public.notifications where user_id = $1 and created_at > now() - interval '30 minutes' and title ilike '%exce%'", [fin.id]);
    anotar("B3 o pedido aparece em Pedidos de exceção, e chegou o aviso", /Pedidos de exceção/i.test(t3) && /Roteiro B excecao/.test(t3) && notas[0].n > 0, `lista ${/Roteiro B excecao/.test(t3) ? "com o pedido" : "sem o pedido"}; avisos ${notas[0].n}`);
    const linha = page.locator("li, div").filter({ hasText: "Roteiro B excecao" }).filter({ has: page.getByRole("button", { name: "Autorizar" }) }).last();
    await linha.getByRole("button", { name: "Autorizar" }).click();
    await page.waitForTimeout(4000);
    const [ex2] = await sql<{ status: string; valid_until: string }>("select status, to_char(valid_until, 'YYYY-MM-DD') valid_until from public.sale_cancel_exceptions where id = $1", [ex?.id]);
    anotar("B3 o Financeiro autoriza (vale 7 dias)", ex2?.status === "autorizada", `${ex2?.status ?? "—"} até ${ex2?.valid_until ?? "—"}`);
    // Quem pediu não autoriza o próprio pedido, nem o Admin Master: um pedido do Admin.
    const [vB3] = await sql<{ id: string }>(
      `insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, contract_signed, contract_signed_at)
       values ($1, $2, 'Roteiro B excecao sem contato', 10000, 'dinheiro', 1, true, now()) returning id`, [C.ldn, C.B.cliente]);
    await sql("insert into public.payment_installments (seq, kind, due_date, payment_method, amount_cents, clinic_id, client_id, direct_sale_id) values (1, 'parcela', current_date + 30, 'dinheiro', 10000, $1, $2, $3)", [C.ldn, C.B.cliente, vB3.id]);
    await context.clearCookies();
    await entrarComo(context, "admin@example.com", C.ldn, DOMINIO);
    const [b3p] = await parcelas(vB3.id);
    await acordo(page, C.B.cliente, [b3p.due_date], 2, true);
    const c3 = await cancelarVenda(page, vB3.id);
    respostas.push("Pedido do Admin (roteiro: autoaprovação)");
    await c3.item.getByRole("button", { name: "Pedir exceção ao Financeiro" }).click().catch(() => {});
    await page.waitForTimeout(4000);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    const linhaAdm = page.locator("li, div").filter({ hasText: "Pedido do Admin (roteiro: autoaprovação)" }).last();
    const adminVeBotao = await linhaAdm.getByRole("button", { name: "Autorizar" }).isVisible().catch(() => false);
    const [exA] = await sql<{ status: string }>("select status from public.sale_cancel_exceptions where direct_sale_id = $1 order by requested_at desc limit 1", [vB3.id]);
    anotar("B3 quem pediu não autoriza o próprio pedido, nem o Admin Master", exA?.status === "pedida" && !adminVeBotao, `pedido do Admin ${exA?.status ?? "não gravado"}; botão Autorizar para ele: ${adminVeBotao ? "VISÍVEL" : "ausente"}`);
    await foto(page, "B3-autoaprovacao");

    // --- B4: usar a exceção -------------------------------------------------------------
    await context.clearCookies();
    await entrarComo(context, "gerente@example.com", C.ldn, DOMINIO);
    const c4 = await cancelarVenda(page, vB2);
    const [s4] = await sql<{ cancelled: boolean }>("select cancelled from public.direct_sales where id = $1", [vB2]);
    const [r4] = await sql<{ status: string }>("select status from public.payment_renegotiations where id = $1", [rB2?.id]);
    const [e4] = await sql<{ status: string }>("select status from public.sale_cancel_exceptions where id = $1", [ex?.id]);
    const abertas = await sql<{ n: number }>("select count(*)::int n from public.payment_installments where renegotiation_id = $1 and status in ('em_aberto','parcial')", [rB2?.id]);
    anotar("B4 com a exceção, a venda é cancelada; as parcelas do acordo caem; o acordo fica Encerrado; a exceção usada", s4.cancelled && abertas[0].n === 0 && r4?.status === "encerrada" && e4?.status === "usada", `venda ${s4.cancelled ? "cancelada" : "não"}; acordo ${r4?.status}; abertas ${abertas[0].n}; exceção ${e4?.status}; a tela disse: ${c4.toast}`);

    // --- B5: o acordo que junta duas vendas ---------------------------------------------
    const [vA, vB] = C.B5.vendas as string[];
    const [a1] = await parcelas(vA);
    const [b1] = await parcelas(vB);
    await acordo(page, C.B5.cliente, [a1.due_date, b1.due_date], 1, true);
    const c5 = await cancelarVenda(page, vA);
    await foto(page, "B5-duas-vendas");
    anotar("B5 acordo de duas vendas: \"Este acordo junta parcelas de outras vendas. O cancelamento fica para o distrato.\"", /Este acordo junta parcelas de outras vendas\. O cancelamento fica para o distrato\./.test(c5.texto), (c5.texto.match(/Este acordo junta[^\n]*/) ?? [c5.toast || c5.texto.slice(0, 200)])[0]);
    anotar("B5 (com a 4020) o Gerente já tem o \"Abrir distrato\" na venda", /Abrir distrato/.test(c5.texto), /Abrir distrato/.test(c5.texto) ? "o botão aparece" : "sem o botão");
    await esperar(async () => true, 1);
  });
});
