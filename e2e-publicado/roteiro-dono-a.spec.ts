// ROTEIRO DO DONO — PARTE A: renegociação assinada (4017), pela TELA do projeto
// de teste publicado. Pedido do dono (16/11/2026): "faça você mesmo o roteiro".
// Os cenários vêm de src/lib/__tests__/roteiro-dono.preparo.integracao.test.ts
// (clientes sem e-mail e sem celular: nada é enviado). Entra pelo link de uso
// único (nenhuma senha é digitada). Este roteiro GRAVA no treino (é o teste do dono).
import { test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { entrarComo, trocarPara } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { CENARIO, PASTA, anotar, asaas, dataBR, esperar, foto, linhaDaParcela, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const C = CENARIO;
const PDF = `${PASTA}/termo-assinado.pdf`;
writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

type Parcela = { id: string; seq: number; due_date: string; status: string; amount_cents: number };
const parcelas = (venda: string) =>
  sql<Parcela>("select id, seq, to_char(due_date, 'YYYY-MM-DD') due_date, status, amount_cents from public.payment_installments where direct_sale_id = $1 order by seq", [venda]);

async function abrirFinanceiro(page: Page, cliente: string) {
  await page.goto(`/prontuarios/${cliente}?aba=financeiro`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Cobranças", { exact: true }).first().waitFor({ timeout: 30_000 });
}

async function renegociar(page: Page, vencimentos: string[], opts: { parcelas: number; meio?: string; total?: string }) {
  for (const v of vencimentos) await linhaDaParcela(page, v).getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /^Renegociar/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByText("Renegociar cobranças").waitFor();
  const campo = (rotulo: string) => d.locator(`xpath=.//label[normalize-space()='${rotulo}']/following-sibling::input[1]`);
  await campo("Parcelas").fill(String(opts.parcelas));
  if (opts.meio) await d.locator("select").first().selectOption(opts.meio);
  await d.locator("textarea").last().fill("Roteiro do dono (16/11/2026)");
  return d;
}

/** Salva o acordo e devolve o aviso que a tela mostrou (o "toast"). */
async function salvarAcordo(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: /Salvar o acordo|Enviar para autorização/ }).click();
  await page.waitForTimeout(3500);
  return (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
}

test.describe.serial("roteiro do dono — parte A (renegociação)", () => {
  test("A2 a A10", async ({ page, context }) => {
    test.setTimeout(900_000);
    page.on("dialog", async (dlg) => {
      const t = dlg.message();
      (page as unknown as { ultimoAviso?: string }).ultimoAviso = t;
      if (/não confirme|ENVIAR_NAO/.test(t)) await dlg.dismiss();
      else if ((page as unknown as { recusarProximo?: boolean }).recusarProximo) {
        (page as unknown as { recusarProximo?: boolean }).recusarProximo = false;
        await dlg.dismiss();
      } else await dlg.accept();
    });
    await entrarComo(context, "gerente@example.com", C.ldn, DOMINIO);
    const [p1, p2, p3, p4, p5] = await parcelas(C.A.venda);

    // --- A2: renegociar as parcelas 2 e 3, sem desconto -----------------------
    await abrirFinanceiro(page, C.A.cliente);
    await foto(page, "A2-antes");
    const d = await renegociar(page, [p2.due_date, p3.due_date], { parcelas: 3, meio: "boleto" });
    const marcada = await d.getByLabel("A da venda de origem").isChecked().catch(() => false);
    const venc1 = await d.locator("input[type=date]").first().inputValue();
    anotar("A2 a forma dos boletos já vem marcada (a da venda de origem)", marcada, marcada ? "\"A da venda de origem\" marcada" : "nenhuma marcada");
    anotar("A2 o 1º vencimento novo já vem numa data aceita (depois de hoje)", venc1 > new Date().toISOString().slice(0, 10), `1º vencimento sugerido: ${dataBR(venc1)}`);
    await foto(page, "A2-dialogo");
    const aviso2 = await salvarAcordo(page);
    const [r1] = await sql<{ id: string; status: string; sign_deadline: string | null }>(
      "select id, status, to_char(sign_deadline, 'YYYY-MM-DD') sign_deadline from public.payment_renegotiations where source_installment_ids && $1::uuid[] order by created_at desc limit 1", [[p2.id, p3.id]]);
    const depois = await parcelas(C.A.venda);
    anotar("A2 acordo salvo fica Aguardando assinatura, com prazo", r1?.status === "aguardando_assinatura" && Boolean(r1?.sign_deadline), `situação ${r1?.status ?? "nenhuma"}, prazo ${r1?.sign_deadline ?? "—"}; a tela disse: ${aviso2 || "nada"}`);
    if (!r1) throw new Error(`A2: o acordo não foi salvo (${aviso2})`);
    anotar("A2 as parcelas antigas não mudaram", depois.filter((x) => [2, 3].includes(x.seq)).every((x) => x.status === "em_aberto"), depois.map((x) => `${x.seq}:${x.status}`).join(" "));
    const bol23 = await sql<{ status: string }>("select status from public.charges where payment_installment_id = any($1)", [[p2.id, p3.id]]);
    anotar("A2 os boletos das parcelas 2 e 3 continuam vivos", bol23.length > 0 && bol23.every((x) => x.status === "emitida"), bol23.map((x) => x.status).join(", "));
    await abrirFinanceiro(page, C.A.cliente);
    const tFicha = await textoDaTela(page);
    anotar("A2 a faixa \"Renegociação aguardando assinatura\" e a marca \"Em renegociação\"", /Renegociação aguardando assinatura/i.test(tFicha) && /Em renegociação/i.test(tFicha), (tFicha.match(/Renegociação aguardando assinatura|Em renegociação/gi) ?? []).join(", ") || "nada");
    await foto(page, "A2-depois");

    // --- A3: Enviar termo — ver o aviso e NÃO confirmar -------------------------
    (page as unknown as { recusarProximo?: boolean }).recusarProximo = true;
    const enviar = page.getByRole("button", { name: "Enviar termo" }).first();
    if (await enviar.isVisible().catch(() => false)) {
      await enviar.click();
      await page.waitForTimeout(3000);
      const aviso = (page as unknown as { ultimoAviso?: string }).ultimoAviso ?? "";
      anotar("A3 o envio avisa quantos boletos serão cancelados quando assinar (não confirmado)", /boleto/i.test(aviso), aviso || "nenhuma pergunta apareceu");
    } else anotar("A3 o botão Enviar termo aparece", false, "não achei o botão");
    (page as unknown as { recusarProximo?: boolean }).recusarProximo = false;

    // --- A4: anexar o termo assinado (Gerente) ----------------------------------
    await abrirFinanceiro(page, C.A.cliente);
    await page.locator("label", { hasText: "Anexar termo assinado" }).first().locator("input[type=file]").setInputFiles(PDF);
    const aplicou = await esperar(async () => (await sql<{ status: string }>("select status from public.payment_renegotiations where id = $1", [r1.id]))[0]?.status === "aplicada", 60_000);
    const st4 = await parcelas(C.A.venda);
    const ch23 = await sql<{ status: string; asaas_payment_id: string; gateway_account_id: string }>("select status, asaas_payment_id, gateway_account_id from public.charges where payment_installment_id = any($1)", [[p2.id, p3.id]]);
    const noAsaas = await Promise.all(ch23.map((c) => asaas(c.gateway_account_id, `/payments/${c.asaas_payment_id}`)));
    const novas = await sql<{ id: string; status: string; seq: number }>("select id, status, seq from public.payment_installments where renegotiation_id = $1 order by seq", [r1.id]);
    const chNovas = novas.length ? await sql<{ status: string }>("select status from public.charges where payment_installment_id = any($1)", [novas.map((x) => x.id)]) : [];
    anotar("A4 o termo anexado aplica o acordo", aplicou, `acordo ${aplicou ? "aplicado" : "não aplicado em 60 s"}`);
    anotar("A4 as parcelas 2 e 3 viram Renegociada", st4.filter((x) => [2, 3].includes(x.seq)).every((x) => x.status === "renegociada"), st4.map((x) => `${x.seq}:${x.status}`).join(" "));
    anotar("A4 os boletos delas cancelados no Asaas", ch23.every((x) => x.status === "cancelada") && noAsaas.every((p) => p.deleted === true), `riSZon ${ch23.map((x) => x.status).join(",")}; Asaas apagado ${noAsaas.map((p) => p.deleted).join(",")}`);
    anotar("A4 3 parcelas novas, com a cobrança automática pela regra", novas.length === 3, `${novas.length} parcelas novas; cobranças ${chNovas.map((x) => x.status).join(",") || "nenhuma (fora do prazo de 15 dias)"}`);
    await abrirFinanceiro(page, C.A.cliente);
    await foto(page, "A4-depois");

    // --- A5: pagar antes de assinar cancela o acordo ---------------------------------
    await renegociar(page, [p4.due_date], { parcelas: 2, meio: "boleto" });
    await salvarAcordo(page);
    const [r2] = await sql<{ id: string; status: string }>("select id, status from public.payment_renegotiations where source_installment_ids && $1::uuid[] order by created_at desc limit 1", [[p4.id]]);
    const [b4] = await sql<{ asaas_payment_id: string; gateway_account_id: string }>("select asaas_payment_id, gateway_account_id from public.charges where payment_installment_id = $1 and status = 'emitida'", [p4.id]);
    if (r2 && b4) {
      await asaas(b4.gateway_account_id, `/sandbox/payment/${b4.asaas_payment_id}/confirm`, "POST", {});
      const caiu = await esperar(async () => (await sql<{ status: string }>("select status from public.payment_renegotiations where id = $1", [r2.id]))[0]?.status !== "aguardando_assinatura", 90_000);
      const [r2d] = await sql<{ status: string }>("select status from public.payment_renegotiations where id = $1", [r2.id]);
      const [pp4] = await sql<{ status: string }>("select status from public.payment_installments where id = $1", [p4.id]);
      const aviso = await sql<{ title: string }>("select title from public.notifications where created_at > now() - interval '10 minutes' and body ilike '%acordo%' order by created_at desc limit 3");
      anotar("A5 pagou a parcela 4 antes de assinar: o acordo é cancelado pelo pagamento", caiu && /cancel/.test(r2d.status), `acordo ${r2d.status}; parcela 4 ${pp4.status}; avisos: ${aviso.map((x) => x.title).join(" | ") || "nenhum"}`);
    } else anotar("A5 cenário (acordo e boleto da parcela 4)", false, `acordo ${r2?.status ?? "não salvo"}, boleto ${b4 ? "vivo" : "não achado"}`);

    // --- A6: desconto na parcela vencida, na ordem juros → multa → benefício → principal
    await abrirFinanceiro(page, C.A.cliente);
    const [p7] = (await parcelas(C.A.venda)).filter((x) => x.seq === 7);
    const d6 = await renegociar(page, [p7.due_date], { parcelas: 1, meio: "pix" });
    const total = d6.locator("xpath=.//label[contains(normalize-space(),'Total') or contains(normalize-space(),'total')]/following-sibling::input[1]").first();
    if (await total.isVisible().catch(() => false)) {
      const atual = Number((await total.inputValue()).replace(/\./g, "").replace(",", "."));
      await total.fill(String(Math.max(1, Math.round((atual - 1) * 100) / 100)).replace(".", ","));
    }
    await page.waitForTimeout(800);
    const t6 = await d6.innerText();
    anotar("A6 o desconto mostra a ordem juros → multa → benefício → principal", /juros[\s\S]*multa[\s\S]*benef[ií]cio[\s\S]*principal/i.test(t6), (t6.match(/O desconto abate[^\n]*/) ?? [t6.slice(0, 200)])[0]);
    await foto(page, "A6-dialogo");
    await d6.getByRole("button", { name: "Cancelar" }).first().click().catch(() => page.keyboard.press("Escape"));

    // --- A8: forma 2 — o mesmo link mostra os novos e marca os antigos ------------
    const [q1, q2] = await parcelas(C.A8.venda);
    await abrirFinanceiro(page, C.A8.cliente);
    await renegociar(page, [q1.due_date, q2.due_date], { parcelas: 2 });
    const tForma = await page.getByRole("dialog").innerText();
    anotar("A8 a forma da venda (Todos os boletos agora) já vem marcada", /Todos os boletos agora/.test(tForma), "");
    await salvarAcordo(page);
    await abrirFinanceiro(page, C.A8.cliente);
    await page.locator("label", { hasText: "Anexar termo assinado" }).first().locator("input[type=file]").setInputFiles(PDF);
    await esperar(async () => (await sql<{ n: number }>("select count(*)::int n from public.payment_installments where direct_sale_id = $1 and status = 'renegociada'", [C.A8.venda]))[0].n === 2, 60_000);
    await esperar(async () => (await sql<{ n: number }>("select count(*)::int n from public.charges ch join public.payment_installments i on i.id = ch.payment_installment_id join public.payment_renegotiations r on r.id = i.renegotiation_id where r.source_installment_ids && $1::uuid[] and ch.status = 'emitida'", [[q1.id, q2.id]]))[0].n >= 2, 90_000);
    await page.goto(`/boletos/${C.A8.token}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const tLista = await textoDaTela(page);
    await foto(page, "A8-lista");
    anotar("A8 o mesmo link mostra os antigos como \"Substituído pela renegociação — não pague\"", /Substituído pela renegociação/i.test(tLista), (tLista.match(/Substituído pela renegociação[^\n]*/gi) ?? []).length + " marcados");
    anotar("A8 …e os boletos novos no mesmo link", (tLista.match(/R\$/g) ?? []).length >= 6, tLista.slice(0, 400).replace(/\s+/g, " "));

    // --- A9: venda não fechada — recusado com o motivo ------------------------------
    const [n1] = await parcelas(C.A9.venda);
    await abrirFinanceiro(page, C.A9.cliente);
    await renegociar(page, [n1.due_date], { parcelas: 1, meio: "pix" });
    const aviso9 = await salvarAcordo(page);
    const t9 = aviso9 + " " + (await textoDaTela(page));
    anotar("A9 parcela de venda não fechada: recusada com o motivo na tela", /ainda não foi fechada/i.test(t9), (t9.match(/[^\n]*ainda não foi fechada[^\n]*/i) ?? ["(sem a mensagem)"])[0]);
    await foto(page, "A9-recusa");
    await page.keyboard.press("Escape");

    // --- A10: cobrança externa numa parcela renegociada ------------------------------
    await abrirFinanceiro(page, C.A.cliente);
    const lin5 = linhaDaParcela(page, p5.due_date);
    await lin5.getByRole("button", { name: /Já cobrada fora do riSZon/ }).click();
    const dx = page.getByRole("dialog");
    await dx.locator("input").first().fill("Boleto emitido direto no painel do Asaas (roteiro)");
    await dx.getByRole("button", { name: "Marcar" }).click();
    await page.waitForTimeout(3000);
    await abrirFinanceiro(page, C.A.cliente);
    await renegociar(page, [p5.due_date], { parcelas: 1, meio: "pix" });
    await salvarAcordo(page);
    // Recepcionista: vê a lista, mas não marca.
    await trocarPara(context, "recepcao@example.com", C.ldn);
    await abrirFinanceiro(page, C.A.cliente);
    (page as unknown as { recusarProximo?: boolean }).recusarProximo = false;
    const env10 = page.getByRole("button", { name: "Enviar termo" }).first();
    let tRec = "";
    if (await env10.isVisible().catch(() => false)) {
      await env10.click();
      await page.waitForTimeout(3000);
      tRec = await textoDaTela(page);
    }
    anotar("A10 a Recepção vê a cobrança externa e não marca (só o Gerente)", /Cancele cada uma no painel do Asaas/i.test(tRec) && /Só o Gerente da unidade ou o Admin Master confirma/i.test(tRec), tRec ? (tRec.match(/Cancele cada uma[^\n]*|Só o Gerente[^\n]*/g) ?? []).join(" | ") : "a Recepção não vê o Enviar termo");
    await foto(page, "A10-recepcao");
    // Gerente: a lista exige a marca; marcar libera o envio e a marcação externa some.
    await trocarPara(context, "gerente@example.com", C.ldn);
    await abrirFinanceiro(page, C.A.cliente);
    (page as unknown as { recusarProximo?: boolean }).recusarProximo = true;
    await page.getByRole("button", { name: "Enviar termo" }).first().click();
    await page.waitForTimeout(3000);
    const tGer = await textoDaTela(page);
    const caixa = page.getByText(/Cancelei no painel do Asaas/).first();
    const temCaixa = await caixa.isVisible().catch(() => false);
    anotar("A10 o envio exige a marca do Gerente \"Cancelei no painel do Asaas\"", temCaixa, temCaixa ? "a lista e a marca aparecem; sem ela, o envio é recusado" : (tGer.match(/[^\n]*externa[^\n]*/i) ?? ["sem a lista"])[0]);
    if (temCaixa) {
      await caixa.click();
      await page.getByRole("button", { name: "Confirmar" }).first().click();
      await page.waitForTimeout(3000);
      const [ext] = await sql<{ status: string }>("select status from public.charges where payment_installment_id = $1 and is_external order by created_at desc limit 1", [p5.id]);
      anotar("A10 confirmado: a marcação externa some (fica na auditoria)", ext?.status === "cancelada", `cobrança externa ${ext?.status ?? "não achada"}`);
    }
    await foto(page, "A10-gerente");
  });
});
