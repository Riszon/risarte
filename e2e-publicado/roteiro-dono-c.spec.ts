// ROTEIRO DO DONO — PARTE C: as mensalidades pelo Asaas (4018), pela TELA do
// projeto de teste publicado (pedido do dono, 16/11/2026).
// A adesão e o caso de teste nascem pelo banco (clientes sem e-mail e sem
// celular: nada é enviado); o que o dono faria pela tela é feito pela tela:
// ligar, "Rodar agora", passar de meio, dar baixa à mão, cancelar e desligar.
// GRAVA no treino. Ao fim, Londrina volta com as mensalidades desligadas.
import { test, type Page } from "@playwright/test";
import { entrarComo, trocarPara } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";
import { CENARIO, anotar, asaas, esperar, foto, sql, textoDaTela } from "./roteiro-dono.apoio";

const DOMINIO = new URL(APP_PUBLICADO).hostname;
const C = CENARIO;

function cpfDeTeste(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
async function cliente(rotulo: string) {
  const [x] = await sql<{ id: string }>(
    "insert into public.clients (clinic_id, full_name, cpf, birth_date, email, phone) values ($1, $2, $3, '1990-01-01', null, null) returning id",
    [C.ldn, `Roteiro ${rotulo} sem contato`, cpfDeTeste()]);
  return x.id;
}
async function painel(page: Page) {
  await page.goto("/financeiro/cobrancas-automaticas");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Mensalidades pelo Asaas").first().waitFor({ timeout: 30_000 });
  return page.locator("section").filter({ hasText: "Mensalidades pelo Asaas" }).first();
}

test.describe.serial("roteiro do dono — parte C (mensalidades)", () => {
  test("C1 a C9", async ({ page, context }) => {
    test.setTimeout(900_000);
    let recusar = false;
    page.on("dialog", async (dlg) => {
      if (recusar) {
        recusar = false;
        await dlg.dismiss();
      } else if (dlg.type() === "prompt") await dlg.accept("Roteiro do dono");
      else await dlg.accept();
    });
    await entrarComo(context, "gerente@example.com", C.ldn, DOMINIO);

    // --- C1: ver antes de ligar ---------------------------------------------------------
    const s1 = await painel(page);
    const t1 = await s1.innerText();
    await foto(page, "C1-antes");
    anotar("C1 mostra quantos entram agora e quantos esperam a ASA4B, por programa, e quantos têm contato",
      /entram agora/.test(t1) && /esperam a ASA4B/.test(t1) && /e-mail ou celular/.test(t1), t1.replace(/\s+/g, " ").slice(0, 300));
    anotar("C1 o aviso das assinaturas antigas aparece", /Antes de ligar, cancele no painel do Asaas as assinaturas antigas dos clientes que entram\./.test(t1), "");
    const marca = s1.getByLabel("Avisei os clientes e cancelei as assinaturas antigas.");
    const ligar = s1.getByRole("button", { name: "Ligar" });
    const desligadoSemMarca = await ligar.isDisabled().catch(() => false);
    anotar("C1 o Ligar só funciona com a marca \"Avisei os clientes e cancelei as assinaturas antigas.\"", (await marca.isVisible().catch(() => false)) && desligadoSemMarca, `marca ${await marca.isVisible().catch(() => false) ? "visível" : "ausente"}; Ligar sem a marca: ${desligadoSemMarca ? "bloqueado" : "liberado"}`);

    // --- C2: ligar a partir de hoje -------------------------------------------------------
    await marca.check();
    await ligar.click();
    await page.waitForTimeout(4000);
    const [u] = await sql<{ f: string | null }>("select to_char(fees_enabled_from, 'YYYY-MM-DD') f from public.gateway_auto_charge_units where clinic_id = $1", [C.ldn]);
    anotar("C2 Londrina ligada a partir de hoje", Boolean(u?.f), `a partir de ${u?.f ?? "—"}`);

    // --- C3: PPR+ no boleto: a 1ª mensalidade na assinatura; o pagamento ativa ------------
    const cliPpr = await cliente("C3 PPR boleto");
    const [plano] = await sql<{ id: string }>("select id from public.ppr_plans order by created_at limit 1");
    const [m] = await sql<{ id: string }>(
      `insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed)
       values ($1, $2, $3, 'pendente', 9990, 10, 'boleto', false, false) returning id`, [C.ldn, plano.id, cliPpr]).catch(async () =>
      sql<{ id: string }>(
        `insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed)
         values ($1, $2, $3, 'ativo', 9990, 10, 'boleto', false, false) returning id`, [C.ldn, plano.id, cliPpr]));
    await sql("update public.ppr_memberships set contract_signed = true where id = $1", [m.id]);
    const [f1] = await sql<{ id: string; due_date: string }>("select id, to_char(due_date,'YYYY-MM-DD') due_date from public.ppr_charges where membership_id = $1", [m.id]);
    anotar("C3 a 1ª mensalidade nasce na assinatura", Boolean(f1), f1 ? `vence ${f1.due_date}` : "não nasceu");
    // A emissão: "Rodar agora" (Admin Master), como a rotina faria.
    await trocarPara(context, "admin@example.com", C.ldn);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Rodar agora/ }).first().click();
    const emitiu = await esperar(async () => (await sql<{ n: number }>("select count(*)::int n from public.charges where source_type = 'ppr_charge' and source_id = $1 and status = 'emitida'", [f1?.id]))[0].n === 1, 120_000);
    const [ch] = await sql<{ id: string; asaas_payment_id: string; gateway_account_id: string; fine_percent: number; interest_percent: number }>(
      "select id, asaas_payment_id, gateway_account_id, fine_percent, interest_percent from public.charges where source_type = 'ppr_charge' and source_id = $1 order by created_at desc limit 1", [f1?.id]);
    anotar("C3 o boleto da mensalidade no Asaas, sem multa nem juros", emitiu && Number(ch?.fine_percent) === 0 && Number(ch?.interest_percent) === 0, `cobrança ${ch?.asaas_payment_id ?? "não emitida"}; multa ${ch?.fine_percent ?? "—"}%, juros ${ch?.interest_percent ?? "—"}%`);
    if (ch) {
      await asaas(ch.gateway_account_id, `/sandbox/payment/${ch.asaas_payment_id}/confirm`, "POST", {});
      const ativou = await esperar(async () => (await sql<{ status: string }>("select status from public.ppr_charges where id = $1", [f1.id]))[0].status === "paga", 120_000);
      const [mm] = await sql<{ status: string; first_payment_confirmed: boolean }>("select status, first_payment_confirmed from public.ppr_memberships where id = $1", [m.id]);
      anotar("C3 pago no sandbox: a mensalidade paga e a adesão ativa sozinha", ativou && mm.status === "ativo" && mm.first_payment_confirmed, `mensalidade ${ativou ? "paga" : "não paga"}; adesão ${mm.status}, 1º pagamento ${mm.first_payment_confirmed}`);
    }

    // --- C4: Ortodontia com desconto de pontualidade -------------------------------------
    const cliOrto = await cliente("C4 Ortodontia");
    const [caso] = await sql<{ id: string }>("insert into public.ortho_cases (clinic_id, client_id, status, start_date) values ($1, $2, 'em_tratamento', current_date) returning id", [C.ldn, cliOrto]);
    const termos = await sql("insert into public.ortho_case_terms (case_id, billing_method, punctuality_discount_percent) values ($1, 'boleto', 5) returning case_id", [caso.id]).catch((e) => String(e.message));
    const [oc] = await sql<{ id: string }>(
      "insert into public.ortho_charges (case_id, clinic_id, client_id, reference_month, due_date, amount_cents, status, kind) values ($1, $2, $3, date_trunc('month', current_date + 40)::date, current_date + 10, 17600, 'em_aberto', 'mensalidade') returning id",
      [caso.id, C.ldn, cliOrto]);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Rodar agora/ }).first().click();
    await esperar(async () => (await sql<{ n: number }>("select count(*)::int n from public.charges where source_type = 'ortho_charge' and source_id = $1 and status = 'emitida'", [oc.id]))[0].n === 1, 120_000);
    const [cho] = await sql<{ asaas_payment_id: string; gateway_account_id: string; discount_cents: number }>(
      "select asaas_payment_id, gateway_account_id, discount_cents from public.charges where source_type = 'ortho_charge' and source_id = $1 order by created_at desc limit 1", [oc.id]);
    const po = cho ? await asaas(cho.gateway_account_id, `/payments/${cho.asaas_payment_id}`) : null;
    anotar("C4 a mensalidade da Ortodontia vai com o desconto de pontualidade até o vencimento", Number(po?.discount?.value) === 8.8 && Number(po?.discount?.dueDateLimitDays) === 0,
      cho ? `desconto no Asaas R$ ${po?.discount?.value} até ${po?.discount?.dueDateLimitDays} dia(s) antes (termos: ${Array.isArray(termos) ? "ok" : termos})` : `não emitida (termos: ${Array.isArray(termos) ? "ok" : termos})`);
    if (cho) {
      await asaas(cho.gateway_account_id, `/sandbox/payment/${cho.asaas_payment_id}/confirm`, "POST", {});
      const pagou = await esperar(async () => (await sql<{ status: string }>("select status from public.ortho_charges where id = $1", [oc.id]))[0].status === "paga", 120_000);
      const [rc] = await sql<{ v: number }>("select max(r.amount_cents) v from public.charges c left join public.payment_receipts r on r.id = c.receipt_id where c.source_type = 'ortho_charge' and c.source_id = $1", [oc.id]);
      anotar("C4 pago dentro do prazo: a baixa com o desconto", pagou, `mensalidade ${pagou ? "paga" : "não paga"} (valor pago no aviso: ${rc?.v ?? "—"})`);
    }

    // --- C5: passar da recorrência, com a concordância ------------------------------------
    await trocarPara(context, "gerente@example.com", C.ldn);
    const cliRec = await cliente("C5 recorrencia");
    const [mr] = await sql<{ id: string }>(
      "insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed) values ($1, $2, $3, 'ativo', 9990, 10, 'credito_recorrente', true, true) returning id",
      [C.ldn, plano.id, cliRec]);
    await page.goto(`/ppr/adesoes/${mr.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    recusar = true;
    await page.getByRole("button", { name: "Passar para boleto" }).click();
    await page.waitForTimeout(2000);
    const [semConc] = await sql<{ payment_method: string }>("select payment_method from public.ppr_memberships where id = $1", [mr.id]);
    await page.getByRole("button", { name: "Passar para boleto" }).click();
    await page.waitForTimeout(4000);
    const [comConc] = await sql<{ payment_method: string; consent: string | null }>("select payment_method, method_consent->>'texto' consent from public.ppr_memberships where id = $1", [mr.id]);
    anotar("C5 \"Passar para…\" pede a concordância do cliente e só segue com ela (registrada)", semConc.payment_method === "credito_recorrente" && comConc.payment_method === "boleto" && Boolean(comConc.consent),
      `sem a concordância: ${semConc.payment_method}; com: ${comConc.payment_method} ("${comConc.consent ?? "—"}")`);
    await foto(page, "C5-adesao");

    // --- C6: a mensalidade vencida no selo "Em atraso" ------------------------------------
    await sql("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date + 70)::date, current_date - 20, 9990, 'atrasada')", [mr.id, C.ldn]);
    await page.goto(`/prontuarios/${cliRec}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const t6 = await textoDaTela(page);
    anotar("C6 o selo \"Em atraso\" do cliente conta a mensalidade vencida", /Em atraso há \d+ dias?/.test(t6), (t6.match(/Em atraso há \d+ dias?/) ?? ["sem o selo"])[0]);

    // --- C7: baixa à mão com o boleto vivo: recusada --------------------------------------
    const cliVivo = await cliente("C7 boleto vivo");
    const [mv] = await sql<{ id: string }>(
      "insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed) values ($1, $2, $3, 'ativo', 9990, 10, 'boleto', true, true) returning id",
      [C.ldn, plano.id, cliVivo]);
    const [fv] = await sql<{ id: string }>("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date + 40)::date, current_date + 8, 9990, 'em_aberto') returning id", [mv.id, C.ldn]);
    await trocarPara(context, "admin@example.com", C.ldn);
    await page.goto("/financeiro/cobrancas-automaticas");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Rodar agora/ }).first().click();
    await esperar(async () => (await sql<{ n: number }>("select count(*)::int n from public.charges where source_type = 'ppr_charge' and source_id = $1 and status = 'emitida'", [fv.id]))[0].n === 1, 120_000);
    await trocarPara(context, "gerente@example.com", C.ldn);
    await page.goto(`/ppr/adesoes/${mv.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Dar baixa/ }).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    const toast7 = (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
    const [fv2] = await sql<{ status: string }>("select status from public.ppr_charges where id = $1", [fv.id]);
    anotar("C7 baixa à mão com o boleto vivo: recusada, com a orientação", fv2.status !== "paga", `mensalidade ${fv2.status}; a tela disse: ${toast7 || "nada"}`);
    await foto(page, "C7-baixa");

    // --- C8: cancelar a adesão: caem as que não venceram (com o boleto no Asaas) ---------
    await page.getByRole("button", { name: "Cancelar plano" }).first().click().catch(() => {});
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) {
      await dlg.locator("textarea, input[type=text]").first().fill("Roteiro do dono: cancelar a adesão").catch(() => {});
      await dlg.getByRole("button", { name: /Cancelar plano|Confirmar|Cancelar adesão/ }).last().click().catch(() => {});
    }
    await page.waitForTimeout(6000);
    const [mvd] = await sql<{ status: string }>("select status from public.ppr_memberships where id = $1", [mv.id]);
    const [fv3] = await sql<{ status: string }>("select status from public.ppr_charges where id = $1", [fv.id]);
    const [cvv] = await sql<{ status: string; asaas_payment_id: string; gateway_account_id: string }>("select status, asaas_payment_id, gateway_account_id from public.charges where source_type = 'ppr_charge' and source_id = $1 order by created_at desc limit 1", [fv.id]);
    const pa = cvv ? await asaas(cvv.gateway_account_id, `/payments/${cvv.asaas_payment_id}`) : null;
    anotar("C8 cancelada a adesão: a mensalidade que não venceu cai, com o boleto cancelado no Asaas", mvd.status === "cancelado" && fv3.status === "cancelada" && pa?.deleted === true,
      `adesão ${mvd.status}; mensalidade ${fv3.status}; boleto riSZon ${cvv?.status ?? "—"}, Asaas apagado ${pa?.deleted}`);
    await foto(page, "C8-cancelada");

    // --- C9: desligar (Londrina volta como estava) ----------------------------------------
    const s9 = await painel(page);
    await s9.getByRole("button", { name: "Desligar" }).click();
    await page.waitForTimeout(4000);
    const [u9] = await sql<{ f: string | null }>("select to_char(fees_enabled_from, 'YYYY-MM-DD') f from public.gateway_auto_charge_units where clinic_id = $1", [C.ldn]);
    anotar("C9 desligar: Londrina volta sem as mensalidades pelo Asaas", u9?.f === null, `fees_enabled_from ${u9?.f ?? "vazio"}`);
  });
});
