"use server";

// Venda direta v3 (docs/comercial/VENDA-DIRETA-V3-PLANO.md) — as ações do
// CAIXA. Nenhuma regra nova mora aqui: cada passo chama a ação que já existia
// (lançar, condições, parcelas, passo do fechamento, baixa), na ordem certa,
// para a recepção fazer a venda inteira numa janela só.

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { buildSchedule, type ScheduleEntry } from "@/lib/payments";
import { isoDateIn, todayInBrazil } from "@/lib/dates";
import {
  atendidoAntesDaVenda,
  etapaDoCaixa,
  recebidoNoBalcao,
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
  contexto: DirectSaleContext;
  /** Quantas vezes cada procedimento saiu em venda direta na unidade. */
  vendidos: Record<string, number>;
  /** As vendas diretas do cliente (as abertas primeiro). */
  vendas: DirectSaleRow[];
};

/** Tudo o que a janela precisa para um cliente. Lido ao abrir e a cada passo. */
export async function carregarCaixa(
  clientId: string
): Promise<{ ok: true; dados: DadosDoCaixa } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, full_name, clinic_id")
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
      contexto,
      vendidos,
      vendas: [...doCliente.sales].sort((a, b) => aberta(a) - aberta(b)),
    },
  };
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
  /**
   * Parcelas ajustadas à mão ("Ajustar parcelas"). Sem isso, o servidor monta
   * parcelas iguais a partir de hoje, com o total que o banco gravou.
   */
  entries?: ScheduleEntry[];
};

export type ResultadoDoCaixa = {
  ok: boolean;
  error?: string;
  /** A venda existe mesmo quando `ok` é falso (o pagamento é que não entrou). */
  saleId?: string;
  precisaConfirmar?: number;
  closed?: boolean;
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
  return { ok: true, saleId: criada.saleId };
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
 * "Confirmar que recebeu" — para o que é pago pelo Asaas enquanto a baixa
 * automática não chega (unidade sem Asaas ligado). Marca a cobrança emitida e
 * o pagamento confirmado de uma vez; o banco conclui a venda se o termo já
 * estiver assinado.
 */
export async function confirmarRecebimento(saleId: string): Promise<ResultadoDoCaixa> {
  const emitida = await closeDirectSaleStep(saleId, "payment_issued", true);
  if (!emitida.ok) return { ok: false, error: emitida.error, saleId };
  if (emitida.closed) return { ok: true, saleId, closed: true };
  const confirmada = await closeDirectSaleStep(saleId, "payment_confirmed", true);
  if (!confirmada.ok) return { ok: false, error: confirmada.error, saleId };
  return { ok: true, saleId, closed: confirmada.closed };
}
