"use server";

// Venda direta v3 (docs/comercial/VENDA-DIRETA-V3-PLANO.md) — as ações do
// CAIXA. Nenhuma regra nova mora aqui: cada passo chama a ação que já existia
// (lançar, condições, parcelas, passo do fechamento, baixa), na ordem certa,
// para a recepção fazer a venda inteira numa janela só.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRoleInClinic } from "@/lib/auth";
import { funcoesAtendemOTipo } from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import { proximoIntervalo } from "@/lib/venda-direta-caixa";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  enviarTermoDaVendaDireta,
  linkDoTermo,
  type LinkDoTermo,
} from "@/lib/venda-direta-termo";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { isoDateIn, todayInBrazil } from "@/lib/dates";
import {
  atendidoAntesDaVenda,
  ehEscolhaDoCartao,
  etapaDoCaixa,
  meioDaCobrancaNoAsaas,
  recebidoNoBalcao,
  type EscolhaDoCartao,
  type PagamentoDaVenda,
} from "@/lib/venda-direta-caixa";
import {
  loadClientDirectSales,
  loadDirectSaleContext,
  type DirectSaleContext,
} from "../../prontuarios/[id]/direct-sale-loader";
import { createDirectSaleFromChart } from "../../prontuarios/[id]/direct-sale-actions";
import { registerReceipt } from "../../prontuarios/[id]/receivables-actions";
import { savePaymentSchedule } from "../payment-schedule-actions";
import { closeDirectSaleStep, setDirectSaleConditions } from "./actions";
import type { DirectSaleRow } from "./direct-sale-item";

export type DadosDoCaixa = {
  clientId: string;
  clientName: string;
  /** VD3-3: o telefone do cliente (WhatsApp do comprovante e da cobrança). */
  clientPhone: string | null;
  contexto: DirectSaleContext;
  /** Quantas vezes cada procedimento saiu em venda direta na unidade. */
  vendidos: Record<string, number>;
  /** As vendas diretas do cliente (as abertas primeiro). */
  vendas: DirectSaleRow[];
  /** VD3-2 (0415): o termo de cada venda (vazio sem a 0415 no banco). */
  termos: Record<string, TermoDaVenda>;
  /** 4029: como a unidade cobra pelo Asaas (decide o que a caixa Pagamento oferece). */
  asaas: AsaasDaUnidade;
  /** 4029: o dinheiro REAL de cada venda (lido das parcelas) e o combinado no cartão. */
  pagamentos: Record<string, PagamentoDaVenda>;
};

export type AsaasDaUnidade = {
  /** A unidade está "Pronta" na Central: as cobranças saem pelo Asaas. */
  pronta: boolean;
  /** A criação automática está ligada: a cobrança nasce sozinha na assinatura. */
  automatica: boolean;
  /** A marca do débito na Central: habilitado, desabilitado ou sem marca. */
  debito: "habilitado" | "desabilitado" | null;
};

export type TermoDaVenda = {
  /** De onde veio a assinatura: assinatura_digital | papel | nulo. */
  source: string | null;
  packageNumber: string | null;
  /** draft | sent | partially_signed | signed | refused | expired | cancelled */
  packageStatus: string | null;
  expiresAt: string | null;
  paperName: string | null;
};

/** Tudo o que a janela precisa para um cliente. Lido ao abrir e a cada passo. */
export async function carregarCaixa(
  clientId: string
): Promise<{ ok: true; dados: DadosDoCaixa } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, full_name, clinic_id, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  const clinicId = client.clinic_id as string;

  const [contexto, doCliente, vendidos] = await Promise.all([
    loadDirectSaleContext(clientId, clinicId),
    loadClientDirectSales(clientId, clinicId),
    maisVendidosDaUnidade(clinicId),
  ]);
  const aberta = (v: DirectSaleRow) =>
    !v.cancelled && v.status !== "concluida" ? 0 : 1;
  return {
    ok: true,
    dados: {
      clientId,
      clientName: client.full_name as string,
      clientPhone: (client.phone as string | null) ?? null,
      contexto,
      vendidos,
      vendas: [...doCliente.sales].sort((a, b) => aberta(a) - aberta(b)),
      termos: await termosDasVendas(doCliente.sales.map((s) => s.id)),
      asaas: await asaasDaUnidade(clinicId),
      pagamentos: await pagamentosDasVendas(doCliente.sales.map((s) => s.id)),
    },
  };
}

/**
 * 4029: como a unidade cobra pelo Asaas. Lido sem a regra de linha (são
 * funções internas): só três sim/não, nada sensível. Banco sem as migrações:
 * tudo falso — a janela se comporta como numa unidade sem Asaas.
 */
async function asaasDaUnidade(clinicId: string): Promise<AsaasDaUnidade> {
  const admin = createAdminClient();
  const [pronta, automatica, conta] = await Promise.all([
    admin.rpc("central_is_ready", { p_clinic_id: clinicId }),
    admin.rpc("_auto_charge_unit_on", { p_clinic_id: clinicId }),
    admin
      .from("gateway_accounts")
      .select("debit_enabled_declared_at, debit_disabled_declared_at")
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const c = conta.data as { debit_enabled_declared_at: string | null; debit_disabled_declared_at: string | null } | null;
  return {
    pronta: pronta.data === true,
    automatica: automatica.data === true,
    debito: c?.debit_enabled_declared_at ? "habilitado" : c?.debit_disabled_declared_at ? "desabilitado" : null,
  };
}

/**
 * 4029: o dinheiro REAL de cada venda. As vendas vieram pela regra de linha (a
 * pessoa as vê); as parcelas e o meio que o Asaas informou são lidos sem ela —
 * só somas e o meio, para o quadro final dizer a verdade.
 */
async function pagamentosDasVendas(saleIds: string[]): Promise<Record<string, PagamentoDaVenda>> {
  if (saleIds.length === 0) return {};
  const admin = createAdminClient();
  const { data: parcelas, error } = await admin
    .from("payment_installments")
    .select("id, direct_sale_id, amount_cents, paid_amount_cents, status")
    .in("direct_sale_id", saleIds);
  if (error || !parcelas) return {};
  // A coluna é da 4029: sem ela no banco, a escolha fica vazia (nada quebra).
  const { data: escolhas } = await admin.from("direct_sales").select("id, card_choice").in("id", saleIds);
  const ids = parcelas.map((p) => p.id as string);
  const { data: pagas } = ids.length
    ? await admin
        .from("charges")
        .select("payment_installment_id, billing_type, paid_billing_type, paid_on")
        .in("payment_installment_id", ids)
        .in("status", ["paga", "liquidada"])
        .order("paid_on", { ascending: false })
    : { data: [] as { payment_installment_id: string; billing_type: string; paid_billing_type: string | null }[] };
  const out: Record<string, PagamentoDaVenda> = {};
  for (const id of saleIds) {
    const dela = parcelas.filter((p) => p.direct_sale_id === id);
    const vivas = dela.filter((p) => !["cancelada", "renegociada"].includes(p.status as string));
    const abertas = vivas.filter((p) => ["em_aberto", "parcial"].includes(p.status as string));
    const paga = (pagas ?? []).find((c) => dela.some((p) => p.id === c.payment_installment_id));
    const escolha = ((escolhas ?? []) as { id: string; card_choice?: unknown }[]).find((e) => e.id === id)?.card_choice;
    out[id] = {
      escolhaDoCartao: ehEscolhaDoCartao(escolha) ? escolha : null,
      recebidoCents: vivas.reduce((s, p) => s + Number(p.paid_amount_cents ?? 0), 0),
      abertoCents: abertas.reduce((s, p) => s + Math.max(0, Number(p.amount_cents) - Number(p.paid_amount_cents ?? 0)), 0),
      parcelasAbertas: abertas.length,
      meioPagoNoAsaas: paga ? ((paga.paid_billing_type as string | null) ?? (paga.billing_type as string)) : null,
    };
  }
  return out;
}

/**
 * O termo de cada venda. As vendas vieram pela regra de linha (a pessoa as
 * vê); a situação do pacote é lida sem ela — a Recepção não lê as
 * Assinaturas, e aqui só saem número, situação e prazo (nada pessoal).
 * Banco sem a 0415: a coluna não existe e nada aparece (o caixa mostra o
 * jeito antigo).
 */
async function termosDasVendas(saleIds: string[]): Promise<Record<string, TermoDaVenda>> {
  if (saleIds.length === 0) return {};
  const supabase = await createClient();
  const { data: vendas, error } = await supabase
    .from("direct_sales")
    .select("id, contract_signed_source, signature_package_id, contract_paper_name")
    .in("id", saleIds);
  if (error || !vendas) return {};
  const pacotes = vendas.map((v) => v.signature_package_id as string | null).filter((x): x is string => !!x);
  const admin = createAdminClient();
  const { data: pkgs } = pacotes.length
    ? await admin.from("signature_packages").select("id, number, status, expires_at").in("id", pacotes)
    : { data: [] as { id: string; number: string; status: string; expires_at: string | null }[] };
  const out: Record<string, TermoDaVenda> = {};
  for (const v of vendas) {
    const p = (pkgs ?? []).find((x) => x.id === v.signature_package_id);
    out[v.id as string] = {
      source: (v.contract_signed_source as string | null) ?? null,
      packageNumber: (p?.number as string | undefined) ?? null,
      packageStatus: (p?.status as string | undefined) ?? null,
      expiresAt: (p?.expires_at as string | null | undefined) ?? null,
      paperName: (v.contract_paper_name as string | null) ?? null,
    };
  }
  return out;
}

/** Contagem dos procedimentos nas vendas diretas recentes da unidade. */
async function maisVendidosDaUnidade(
  clinicId: string
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data: vendas } = await supabase
    .from("direct_sales")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("cancelled", false)
    .order("created_at", { ascending: false })
    .limit(300);
  const ids = (vendas ?? []).map((v) => v.id as string);
  if (ids.length === 0) return {};
  const { data: itens } = await supabase
    .from("direct_sale_items")
    .select("procedure_id, quantity")
    .in("sale_id", ids);
  const contagem: Record<string, number> = {};
  for (const i of (itens ?? []) as {
    procedure_id: string | null;
    quantity: number;
  }[]) {
    if (!i.procedure_id) continue;
    contagem[i.procedure_id] = (contagem[i.procedure_id] ?? 0) + (i.quantity || 1);
  }
  return contagem;
}

export type PagamentoDoCaixa = {
  paymentMethod: string;
  installments: number;
  discountReais: string;
  surchargeReais: string;
  /** 4029: o combinado no cartão à vista (a fatura do Asaas oferece os dois). */
  cardChoice?: EscolhaDoCartao | null;
  /**
   * Parcelas ajustadas à mão ("Ajustar parcelas"). Sem isso, o servidor monta
   * parcelas iguais a partir de hoje, com o total que o banco gravou.
   */
  entries?: ScheduleEntry[];
};

export type ResultadoDoCaixa = {
  ok: boolean;
  error?: string;
  /** VD3-2: a venda entrou, mas o termo não saiu (o motivo, para a caixa Termo). */
  termoErro?: string;
  /** A venda existe mesmo quando `ok` é falso (o pagamento é que não entrou). */
  saleId?: string;
  precisaConfirmar?: number;
  closed?: boolean;
  /** 4029: a venda concluiu, mas a baixa da parcela ainda é do Financeiro. */
  baixaPendente?: boolean;
};

/** Grava as condições e as parcelas de uma venda aberta. */
async function gravarPagamento(
  saleId: string,
  pagamento: PagamentoDoCaixa,
  confirmarCancelamento: boolean
): Promise<ResultadoDoCaixa> {
  const cond = await setDirectSaleConditions(saleId, {
    paymentMethod: pagamento.paymentMethod,
    installments: pagamento.installments,
    discountReais: pagamento.discountReais,
    surchargeReais: pagamento.surchargeReais,
  });
  if (!cond.ok) return { ok: false, error: cond.error, saleId };

  // 4029: o combinado no cartão à vista fica na venda, pela porta do banco (o
  // app não grava direto na venda direta). Outro meio limpa. Banco sem a 4029:
  // a porta não existe, o erro é ignorado e a venda segue como antes.
  {
    const escolha =
      pagamento.paymentMethod === "cartao" && ehEscolhaDoCartao(pagamento.cardChoice) ? pagamento.cardChoice : null;
    const { error: ec } = await (await createClient()).rpc("direct_sale_set_card_choice", { p_sale_id: saleId, p_choice: escolha });
    if (ec && !/does not exist|schema cache|Could not find/i.test(ec.message)) console.error("card_choice save failed:", ec.message);
  }

  // O total é o que o BANCO gravou (desconto automático, faixa do plano) —
  // nunca o que a tela calculou.
  const supabase = await createClient();
  const { data: venda } = await supabase
    .from("direct_sales")
    .select("final_cents, installments")
    .eq("id", saleId)
    .single();
  const total = (venda?.final_cents as number | undefined) ?? 0;
  if (total <= 0) return { ok: true, saleId };

  const soma = (pagamento.entries ?? []).reduce((s, e) => s + e.amountCents, 0);
  const entries =
    pagamento.entries && pagamento.entries.length > 0 && soma === total
      ? pagamento.entries
      : buildSchedule({
          totalCents: total,
          downPaymentCents: 0,
          installments: Math.max(1, (venda?.installments as number) ?? 1),
          firstDueDate: todayInBrazil(),
        });
  const plano = await savePaymentSchedule({
    directSaleId: saleId,
    entries: entries.map((e, i) => ({ ...e, seq: i + 1 })),
    confirmarCancelamento,
  });
  if (!plano.ok)
    return {
      ok: false,
      error: plano.error,
      saleId,
      precisaConfirmar: plano.precisaConfirmar,
    };
  return { ok: true, saleId };
}

/**
 * O "Finalizar" do caixa: lança a venda e, para quem fecha, já grava como o
 * cliente paga. A exceção "atendeu antes de vender" é decidida AQUI, pelo
 * atendimento — ninguém marca caixa nenhuma.
 */
export async function finalizarVendaDireta(
  clientId: string,
  input: {
    appointmentId: string;
    items: { procedureId: string; quantity: number }[];
    notes: string;
    /** Ausente para quem só lança (Coordenador Clínico). */
    pagamento?: PagamentoDoCaixa;
  }
): Promise<ResultadoDoCaixa> {
  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("id, starts_at, status")
    .eq("id", input.appointmentId)
    .eq("client_id", clientId)
    .maybeSingle();
  const doneBefore = appt
    ? atendidoAntesDaVenda(
        {
          id: appt.id as string,
          startsAt: appt.starts_at as string,
          status: appt.status as string,
        },
        new Date(),
        (d) => isoDateIn(d)
      )
    : false;

  const criada = await createDirectSaleFromChart(clientId, {
    appointmentId: input.appointmentId,
    attendanceDoneBefore: doneBefore,
    items: input.items,
    notes: input.notes,
  });
  if (!criada.ok || !criada.saleId) return { ok: false, error: criada.error };
  if (!input.pagamento) return { ok: true, saleId: criada.saleId };

  const pago = await gravarPagamento(criada.saleId, input.pagamento, false);
  if (!pago.ok) {
    return {
      ok: false,
      saleId: criada.saleId,
      error: `A venda foi lançada, mas o pagamento não entrou: ${pago.error ?? "erro"}`,
    };
  }
  // VD3-2: o termo já sai junto. Se não sair (cadastro sem CPF, ZapSign fora),
  // a venda está gravada e a caixa Termo mostra o motivo e o "Enviar o termo".
  const termo = await enviarTermo(criada.saleId);
  return { ok: true, saleId: criada.saleId, termoErro: termo.ok ? undefined : termo.error };
}

/** Monta e envia o termo da venda à ZapSign (quem fecha a venda). */
export async function enviarTermo(saleId: string): Promise<ResultadoDoCaixa> {
  const session = await getSessionContext();
  const r = await enviarTermoDaVendaDireta(session, saleId);
  if (!r.ok) return { ok: false, error: r.error, saleId };
  await logAudit({ action: "create", entityType: "direct_sale_term", entityId: saleId });
  return { ok: true, saleId };
}

/** O link de assinatura do termo vivo (para assinar no balcão ou mandar). */
export async function pegarLinkDoTermo(
  saleId: string
): Promise<{ ok: true; link: LinkDoTermo } | { ok: false; error: string }> {
  await getSessionContext();
  return linkDoTermo(saleId);
}

/**
 * "Assinado em papel" (decisão D6/V2): o arquivo já está na pasta
 * `termos-venda-direta`; o banco confere o arquivo e marca, numa transação.
 */
export async function marcarTermoNoPapel(
  saleId: string,
  path: string,
  nome: string
): Promise<ResultadoDoCaixa> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("direct_sale_mark_paper", {
    p_sale_id: saleId,
    p_path: path,
    p_name: nome,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ALLOWED")) return { ok: false, error: "Quem marca o termo é quem fecha a venda direta." };
    if (m.includes("FILE_NOT_FOUND")) return { ok: false, error: "O arquivo não chegou. Escolha a foto de novo." };
    if (m.includes("ALREADY_SIGNED")) return { ok: false, error: "O termo desta venda já está assinado." };
    if (m.includes("SALE_CANCELLED")) return { ok: false, error: "Esta venda foi cancelada." };
    if (m.includes("CONDITIONS_REQUIRED")) return { ok: false, error: "Defina como o cliente paga antes." };
    console.error("direct_sale_mark_paper failed:", m);
    return { ok: false, error: "Não foi possível marcar o termo." };
  }
  // A cobrança automática (Asaas) da venda assinada, se a unidade estiver ligada.
  const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
  await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: saleId }).catch((e) =>
    console.error("auto charge on paper term failed:", e instanceof Error ? e.message : e)
  );
  return { ok: true, saleId, closed: Boolean((data as { closed?: boolean } | null)?.closed) };
}

/** Define (ou troca) como o cliente paga numa venda já lançada. */
export async function salvarPagamentoDaVenda(
  saleId: string,
  pagamento: PagamentoDoCaixa,
  confirmarCancelamento = false
): Promise<ResultadoDoCaixa> {
  return gravarPagamento(saleId, pagamento, confirmarCancelamento);
}

/**
 * "Recebi R$ X" — dinheiro, permuta ou maquininha. É a BAIXA da primeira
 * parcela em aberto: o dinheiro entra no Financeiro e o banco conclui a venda
 * na mesma transação (4011, `_counter_confirm_sale`). Exige o termo assinado.
 */
export async function receberNoBalcao(input: {
  saleId: string;
  clientToken: string;
  /** Obrigatório na permuta: o que foi trocado e com quem. */
  notes: string;
  confirmarCancelamento?: boolean;
}): Promise<ResultadoDoCaixa> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: venda } = await supabase
    .from("direct_sales")
    .select(
      "id, client_id, final_cents, payment_method, contract_signed, payment_confirmed, cancelled, closed_at"
    )
    .eq("id", input.saleId)
    .maybeSingle();
  if (!venda) return { ok: false, error: "Venda não encontrada." };
  const etapa = etapaDoCaixa({
    cancelled: Boolean(venda.cancelled),
    closed: Boolean(venda.closed_at),
    finalCents: venda.final_cents as number,
    paymentMethod: (venda.payment_method as string | null) ?? null,
    contractSigned: Boolean(venda.contract_signed),
    paymentConfirmed: Boolean(venda.payment_confirmed),
  });
  if (etapa === "cancelada") return { ok: false, error: "Venda cancelada." };
  if (etapa === "concluida") return { ok: true, saleId: input.saleId, closed: true };
  if (!venda.contract_signed)
    return { ok: false, error: "Assine o termo da venda antes de receber." };

  const { data: parcelas } = await supabase
    .from("payment_installments")
    .select("id, seq, amount_cents, paid_amount_cents, payment_method, status")
    .eq("direct_sale_id", input.saleId)
    .in("status", ["em_aberto", "parcial"])
    .order("seq")
    .limit(1);
  const parcela = (parcelas ?? [])[0] as
    | {
        id: string;
        amount_cents: number;
        paid_amount_cents: number | null;
        payment_method: string | null;
      }
    | undefined;
  if (!parcela)
    return {
      ok: false,
      error: "Esta venda não tem parcela em aberto. Confira o pagamento.",
    };
  const meio = parcela.payment_method ?? (venda.payment_method as string | null);
  if (!recebidoNoBalcao(meio))
    return {
      ok: false,
      error:
        "Esta parcela é paga pelo Asaas (Pix, boleto ou cartão). Para receber no balcão, troque o meio para dinheiro.",
    };

  const r = await registerReceipt({
    clientId: venda.client_id as string,
    installmentId: parcela.id,
    amountCents: Math.max(0, parcela.amount_cents - (parcela.paid_amount_cents ?? 0)),
    receivedAt: todayInBrazil(),
    paymentMethod: meio as string,
    reference: "",
    notes: input.notes.trim(),
    clientToken: input.clientToken,
    confirmarCancelamento: input.confirmarCancelamento,
  });
  if (!r.ok)
    return {
      ok: false,
      error: r.error,
      saleId: input.saleId,
      precisaConfirmar: r.precisaConfirmar,
    };
  return { ok: true, saleId: input.saleId, closed: true };
}

/**
 * "Confirmar que recebeu" — a pessoa atesta um recebimento que o Asaas não vai
 * confirmar: venda sem valor, ou unidade que não cobra pelo Asaas.
 *
 * 4029 (relato do dono, 27/11/2026): antes este botão concluía a venda mesmo
 * na unidade com Asaas, sem dinheiro nenhum. Agora:
 *  - na unidade pronta, o meio do Asaas é recusado (quem confirma é o Asaas:
 *    gere a cobrança, ou troque o meio se recebeu no balcão) — a recusa mora
 *    em `closeDirectSaleStep`, e vale também para a tela antiga;
 *  - fora dela, conclui a venda e, no PIX, já dá a baixa da parcela (entra no
 *    Financeiro). Nos outros meios a baixa segue no Financeiro, que escolhe a
 *    maquininha e a conta: o resultado avisa, e o quadro final mostra "sem
 *    recebimento registrado" até ela entrar.
 * A ordem é do banco (0203): só se recebe por venda fechada.
 */
export async function confirmarRecebimento(saleId: string, clientToken?: string): Promise<ResultadoDoCaixa> {
  const supabase = await createClient();
  const { data: venda } = await supabase
    .from("direct_sales")
    .select("id, client_id, final_cents, payment_method, contract_signed, cancelled, closed_at")
    .eq("id", saleId)
    .maybeSingle();
  if (!venda) return { ok: false, error: "Venda não encontrada.", saleId };
  if (venda.cancelled) return { ok: false, error: "Venda cancelada.", saleId };
  if (venda.closed_at) return { ok: true, saleId, closed: true };
  const finalCents = Number(venda.final_cents ?? 0);
  if (finalCents > 0 && !venda.contract_signed)
    return { ok: false, saleId, error: "Assine o termo da venda antes de receber." };

  const emitida = await closeDirectSaleStep(saleId, "payment_issued", true);
  if (!emitida.ok) return { ok: false, error: emitida.error, saleId };
  let fechou = Boolean(emitida.closed);
  if (!fechou) {
    const confirmada = await closeDirectSaleStep(saleId, "payment_confirmed", true);
    if (!confirmada.ok) {
      // A recusa não pode deixar a marca "cobrança emitida" para trás.
      await closeDirectSaleStep(saleId, "payment_issued", false);
      return { ok: false, error: confirmada.error, saleId };
    }
    fechou = Boolean(confirmada.closed);
  }
  if (finalCents <= 0 || !fechou) return { ok: true, saleId, closed: fechou };

  // A baixa da parcela da vez, quando o meio não pede mais nada (Pix).
  const { data: parcelas } = await supabase
    .from("payment_installments")
    .select("id, amount_cents, paid_amount_cents, payment_method")
    .eq("direct_sale_id", saleId)
    .in("status", ["em_aberto", "parcial"])
    .order("seq")
    .limit(1);
  const parcela = (parcelas ?? [])[0] as
    | { id: string; amount_cents: number; paid_amount_cents: number | null; payment_method: string | null }
    | undefined;
  const meio = parcela?.payment_method ?? (venda.payment_method as string | null);
  if (!parcela) return { ok: true, saleId, closed: true };
  if (meio !== "pix") return { ok: true, saleId, closed: true, baixaPendente: true };
  const r = await registerReceipt({
    clientId: venda.client_id as string,
    installmentId: parcela.id,
    amountCents: Math.max(0, parcela.amount_cents - (parcela.paid_amount_cents ?? 0)),
    receivedAt: todayInBrazil(),
    paymentMethod: "pix",
    reference: "",
    notes: "Recebido fora do Asaas (confirmado no caixa da venda direta).",
    clientToken: clientToken ?? crypto.randomUUID(),
  });
  if (!r.ok) {
    console.error("direct sale pix receipt failed:", r.error);
    return { ok: true, saleId, closed: true, baixaPendente: true };
  }
  return { ok: true, saleId, closed: true };
}

/**
 * 4029: "Gerar a cobrança agora" — a parcela da vez é do Asaas e não tem
 * cobrança (a criação automática está desligada na unidade, ou demorou). É a
 * MESMA emissão da ficha (`emitirCobranca`: mesma permissão, mesmas travas).
 */
export async function gerarCobrancaDaVez(saleId: string): Promise<ResultadoDoCaixa> {
  const supabase = await createClient();
  const { data: venda } = await supabase
    .from("direct_sales")
    .select("id, client_id, payment_method, contract_signed, cancelled")
    .eq("id", saleId)
    .maybeSingle();
  if (!venda) return { ok: false, error: "Venda não encontrada.", saleId };
  if (venda.cancelled) return { ok: false, error: "Venda cancelada.", saleId };
  if (!venda.contract_signed) return { ok: false, error: "A cobrança sai depois do termo assinado.", saleId };
  const { data: parcelas } = await supabase
    .from("payment_installments")
    .select("id, payment_method")
    .eq("direct_sale_id", saleId)
    .in("status", ["em_aberto", "parcial"])
    .order("seq")
    .limit(1);
  const parcela = (parcelas ?? [])[0] as { id: string; payment_method: string | null } | undefined;
  if (!parcela) return { ok: false, error: "Esta venda não tem parcela em aberto.", saleId };
  const billingType = meioDaCobrancaNoAsaas(parcela.payment_method ?? (venda.payment_method as string | null));
  if (!billingType)
    return { ok: false, error: 'Este meio não gera cobrança avulsa no Asaas. Veja "Todas as cobranças da venda".', saleId };
  const { emitirCobranca } = await import("../../prontuarios/[id]/cobranca-actions");
  const r = await emitirCobranca({
    clientId: venda.client_id as string,
    installmentId: parcela.id,
    billingType,
    dueDate: null,
  });
  if (!r.ok) return { ok: false, error: r.error, saleId };
  return { ok: true, saleId };
}

// ---------------------------------------------------------------------------
// VD3-4 — "Atender agora": o ENCAIXE criado na própria janela (decisões A1–A4,
// docs/comercial/VENDA-DIRETA-V3-PLANO.md §9). Pelo MESMO caminho da Agenda
// (`createAppointment`): quem agenda, cadastro completo (I4), bloqueios da
// agenda e a função do profissional continuam valendo. O encaixe passa pelo
// conflito de horário do profissional e da sala e pode ficar sem sala (0424).
// ---------------------------------------------------------------------------

export type ProfissionalDoEncaixe = { userId: string; nome: string };
export type TipoDoEncaixe = "evaluation" | "urgency";

export async function dadosDoEncaixe(clientId: string): Promise<
  | {
      ok: true;
      podeAgendar: boolean;
      faltaNoCadastro: string[];
      profissionais: Record<TipoDoEncaixe, ProfissionalDoEncaixe[]>;
    }
  | { ok: false; error: string }
> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("clinic_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  const clinicId = client.clinic_id as string;
  // A2: quem já agenda na Agenda (Recepção, SDR, Admin).
  const podeAgendar =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["receptionist"]) ||
    Object.values(session.rolesByClinic).some((r) => r.includes("sdr"));
  const { getClientRegistrationGaps } = await import("../../agenda/actions");
  const gaps = await getClientRegistrationGaps(clientId);
  const { data: equipe } = await supabase.rpc("unit_scheduling_staff", { p_clinic_id: clinicId });
  const linhas = (equipe ?? []) as { user_id: string; role: UserRole; full_name?: string | null }[];
  const ids = [...new Set(linhas.map((l) => l.user_id))];
  const { data: perfis } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nome = new Map((perfis ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? "Profissional"]));
  const porTipo = (tipo: TipoDoEncaixe) => {
    const out: ProfissionalDoEncaixe[] = [];
    for (const id of ids) {
      const funcoes = linhas.filter((l) => l.user_id === id).map((l) => l.role);
      if (funcoesAtendemOTipo(tipo, funcoes)) out.push({ userId: id, nome: nome.get(id) ?? "Profissional" });
    }
    return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };
  return {
    ok: true,
    podeAgendar,
    faltaNoCadastro: gaps,
    profissionais: { evaluation: porTipo("evaluation"), urgency: porTipo("urgency") },
  };
}

/** Cria o encaixe AGORA (o próximo intervalo de 5 min) e devolve o id. */
export async function atenderAgora(input: {
  clientId: string;
  providerUserId: string;
  tipo: TipoDoEncaixe;
  duracao: number;
}): Promise<{ ok: true; appointmentId: string; aviso?: string } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("clinic_id").eq("id", input.clientId).maybeSingle();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  const { data: hora, time: horario } = proximoIntervalo(new Date());
  const fd = new FormData();
  fd.set("clinic_id", client.clinic_id as string);
  fd.set("client_id", input.clientId);
  fd.set("type", input.tipo);
  fd.set("date", hora);
  fd.set("time", horario);
  fd.set("duration", String(Math.max(15, Math.min(120, Math.round(input.duracao)))));
  fd.set("provider_user_id", input.providerUserId);
  fd.set("fit_in", "1");
  fd.set("notes", "Encaixe pelo caixa da venda direta (Atender agora).");
  const { createAppointment } = await import("../../agenda/actions");
  const r = await createAppointment(fd);
  if (!r.ok) return { ok: false, error: r.error ?? "Não foi possível criar o encaixe." };
  // O id do encaixe recém-criado: o do cliente, neste horário, marcado.
  const { data: novo } = await supabase
    .from("appointments")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("is_fit_in", true)
    .eq("provider_user_id", input.providerUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!novo) return { ok: false, error: "O encaixe foi criado, mas não consegui achá-lo. Reabra a venda." };
  return { ok: true, appointmentId: novo.id as string, aviso: r.warning };
}
