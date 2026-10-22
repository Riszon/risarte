import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerPorLotes } from "@/lib/paginar";
import {
  summarizePayables,
  viewPayable,
  type Payable,
  type PayablePaymentEntry,
  type PayableStatus,
} from "@/lib/finance/payables";
import { buildCashFlow, type CashSeriesRow } from "@/lib/finance/cash-flow";
import { unidadeRecebivelDoBanco } from "@/lib/finance/network-receivables";
import {
  linhaDeCaixa,
  type UnidadeCaixa,
  type UnidadeDre,
  type UnidadePagar,
  type UnidadeReceber,
} from "@/lib/finance/network-areas";

/**
 * OC-00121 — os números de cada aba do Painel da rede.
 *
 * ⚠️ SEM FUNÇÃO NOVA NO BANCO, DE PROPÓSITO (o plano previa duas; mudou ao
 * escrever). Cada unidade é lida pelas MESMAS tabelas e funções que a tela
 * dela usa, e somada pelas MESMAS funções puras (`viewPayable`,
 * `summarizePayables`, `buildCashFlow`). Assim o número da rede bate com o da
 * unidade por construção — duas contas para o mesmo indicador é como a rede e
 * a unidade passam a discordar sobre ele.
 *
 * Quem pode ler: o banco decide. `payables`, `payable_payments` e
 * `payment_receipts` respondem pela RLS (`finance_visible_clinic_ids`), e as
 * funções por unidade pela guarda `can_see_clinic_finance` — Admin e
 * Financeiro da Franqueadora veem todas; mais ninguém chega a esta tela.
 *
 * ⚠️ LEITURA QUE FALHA VIRA AVISO, NUNCA ZERO. Uma unidade com "R$ 0,00
 * vencido" porque a consulta caiu pareceria a mais saudável da rede.
 */

export type Lido<T> = { ok: true; unidades: T[] } | { ok: false; erro: string };

type Base = { clinicId: string; nome: string; ownership: "own" | "franchised" };

/** As unidades da rede: ativas, sem a franqueadora — o mesmo recorte das funções da rede. */
export async function unidadesDaRede(
  supabase: SupabaseClient
): Promise<Lido<Base>> {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, ownership")
    .eq("is_active", true)
    .neq("type", "franchisor")
    .order("name");
  if (error) return { ok: false, erro: "Não foi possível ler as unidades." };
  return {
    ok: true,
    unidades: ((data ?? []) as { id: string; name: string; ownership: string }[]).map(
      (c) => ({
        clinicId: c.id,
        nome: c.name,
        ownership: c.ownership === "own" ? "own" : "franchised",
      })
    ),
  };
}

// ---------------------------------------------------------------------------
// CONTAS A PAGAR
// ---------------------------------------------------------------------------

type PayableRow = {
  id: string;
  clinic_id: string;
  account_code: string;
  description: string;
  accrual_date: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  paid_fee_cents: number;
  paid_interest_cents: number;
  status: string;
  approval_mode: string;
  requires_approval: boolean;
};

type PaymentRow = {
  id: string;
  clinic_id: string;
  paid_at: string;
  amount_cents: number;
  fee_cents: number;
  interest_cents: number;
  reversed: boolean;
  reversal_of: string | null;
};

/** Só os campos que a conta do saldo usa; o resto do tipo vai vazio. */
function paraPayable(r: PayableRow): Payable {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    supplierId: null,
    supplierName: null,
    accountCode: r.account_code,
    accountName: null,
    costCenterId: null,
    costCenterName: null,
    description: r.description,
    documentNumber: null,
    accrualDate: r.accrual_date,
    dueDate: r.due_date,
    amountCents: Number(r.amount_cents ?? 0),
    paidAmountCents: Number(r.paid_amount_cents ?? 0),
    paidFeeCents: Number(r.paid_fee_cents ?? 0),
    paidInterestCents: Number(r.paid_interest_cents ?? 0),
    status: r.status as PayableStatus,
    approvalMode: r.approval_mode as Payable["approvalMode"],
    requiresApproval: !!r.requires_approval,
    approvedByName: null,
    approvalNote: null,
    cancelReason: null,
    createdByName: null,
    createdById: null,
    notes: null,
    recurrenceId: null,
  };
}

export async function carregarPagar(
  supabase: SupabaseClient,
  unidades: Base[],
  periodo: { de: string; ate: string },
  hoje: string
): Promise<Lido<UnidadePagar>> {
  const ids = unidades.map((u) => u.clinicId);
  if (!ids.length) return { ok: true, unidades: [] };

  const [contas, pagamentos] = await Promise.all([
    // Só o que ainda pode dever: paga, cancelada e recusada não entram no
    // "a pagar" (o pago do mês vem dos PAGAMENTOS, abaixo).
    lerPorLotes<PayableRow>(ids, (lote, de, ate) =>
      supabase
        .from("payables")
        .select(
          "id, clinic_id, account_code, description, accrual_date, due_date, amount_cents, paid_amount_cents, paid_fee_cents, paid_interest_cents, status, approval_mode, requires_approval"
        )
        .in("clinic_id", lote)
        .not("status", "in", "(paga,cancelada,recusada)")
        .order("id")
        .range(de, ate)
    ),
    lerPorLotes<PaymentRow>(ids, (lote, de, ate) =>
      supabase
        .from("payable_payments")
        .select(
          "id, clinic_id, paid_at, amount_cents, fee_cents, interest_cents, reversed, reversal_of"
        )
        .in("clinic_id", lote)
        .gte("paid_at", periodo.de)
        .lte("paid_at", periodo.ate)
        .order("id")
        .range(de, ate)
    ),
  ]);
  if (!contas.ok || !pagamentos.ok)
    return { ok: false, erro: "Não foi possível ler as contas a pagar da rede." };

  const period = { start: periodo.de, end: periodo.ate };
  return {
    ok: true,
    unidades: unidades.map((u) => {
      const views = contas.linhas
        .filter((r) => r.clinic_id === u.clinicId)
        .map((r) => viewPayable(paraPayable(r), hoje));
      const pays: PayablePaymentEntry[] = pagamentos.linhas
        .filter((p) => p.clinic_id === u.clinicId)
        .map((p) => ({
          paidAt: p.paid_at,
          amountCents: Number(p.amount_cents ?? 0),
          feeCents: Number(p.fee_cents ?? 0),
          interestCents: Number(p.interest_cents ?? 0),
          reversed: !!p.reversed,
          reversalOf: p.reversal_of,
        }));
      const s = summarizePayables(views, pays, period);
      const venceNoMes = views
        .filter(
          (v) =>
            v.isOpen &&
            !v.isOverdue &&
            v.dueDate >= periodo.de &&
            v.dueDate <= periodo.ate
        )
        .reduce((t, v) => t + v.balanceCents, 0);
      return {
        ...u,
        aPagarCents: s.openCents,
        vencidoCents: s.overdueCents,
        vencidoQuantidade: s.overdueCount,
        aAutorizarQuantidade: s.awaitingCount,
        aAutorizarCents: s.awaitingCents,
        venceNoMesCents: venceNoMes,
        pagoNoMesCents: s.paidCents,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// RECEBÍVEIS
// ---------------------------------------------------------------------------

type ReceiptRow = {
  id: string;
  clinic_id: string;
  amount_cents: number;
  reversed: boolean;
  reversal_of: string | null;
};

export async function carregarReceber(
  supabase: SupabaseClient,
  periodo: { de: string; ate: string }
): Promise<Lido<UnidadeReceber>> {
  const { data, error } = await supabase.rpc("network_receivables");
  if (error) return { ok: false, erro: "Não foi possível ler os recebíveis da rede." };
  const base = ((data ?? []) as Record<string, unknown>[]).map(unidadeRecebivelDoBanco);
  const ids = base.map((u) => u.clinicId);

  const recebidos = ids.length
    ? await lerPorLotes<ReceiptRow>(ids, (lote, de, ate) =>
        supabase
          .from("payment_receipts")
          .select("id, clinic_id, amount_cents, reversed, reversal_of")
          .in("clinic_id", lote)
          .gte("received_at", periodo.de)
          .lte("received_at", periodo.ate)
          .order("id")
          .range(de, ate)
      )
    : ({ ok: true, linhas: [], paginas: 0 } as const);
  if (!recebidos.ok)
    return { ok: false, erro: "Não foi possível ler o que a rede recebeu no mês." };

  return {
    ok: true,
    unidades: base.map((u) => ({
      ...u,
      // A mesma régua da tela da unidade (recebiveis/dados.ts): estornada e
      // estorno saem dos dois lados.
      recebidoNoMesCents: recebidos.linhas
        .filter((r) => r.clinic_id === u.clinicId && !r.reversed && !r.reversal_of)
        .reduce((s, r) => s + Number(r.amount_cents ?? 0), 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// FLUXO DE CAIXA
// ---------------------------------------------------------------------------

/** Quantas unidades são lidas ao mesmo tempo (cada uma são duas chamadas). */
const UNIDADES_POR_VEZ = 8;

type SeriesRow = {
  day: string;
  kind: string;
  activity: string;
  inflow_cents: number;
  outflow_cents: number;
};

/**
 * ⚠️ UMA LEITURA POR UNIDADE — as mesmas duas chamadas do Fluxo de caixa da
 * unidade (`cash_flow_series` + `cash_balance_before`), com o mesmo período.
 * Com 4 unidades isso é instantâneo; com 200 serão 400 chamadas, em lotes. Se
 * a aba ficar lenta quando a rede crescer, o próximo passo é uma função da
 * rede no banco — que tem de reusar a MESMA conta, não reescrevê-la.
 */
export async function carregarCaixa(
  supabase: SupabaseClient,
  unidades: Base[],
  periodo: { de: string; ate: string }
): Promise<Lido<UnidadeCaixa>> {
  const out: UnidadeCaixa[] = [];
  for (let i = 0; i < unidades.length; i += UNIDADES_POR_VEZ) {
    const lote = unidades.slice(i, i + UNIDADES_POR_VEZ);
    const lidas = await Promise.all(
      lote.map(async (u): Promise<UnidadeCaixa> => {
        const [serie, abertura] = await Promise.all([
          supabase.rpc("cash_flow_series", {
            p_clinic_id: u.clinicId,
            p_from: periodo.de,
            p_to: periodo.ate,
          }),
          supabase.rpc("cash_balance_before", {
            p_clinic_id: u.clinicId,
            p_date: periodo.de,
          }),
        ]);
        if (serie.error || abertura.error) {
          return {
            ...u,
            saldoInicialCents: 0,
            entradasCents: 0,
            saidasCents: 0,
            saldoFinalCents: 0,
            primeiroNegativo: null,
            falhou: true,
          };
        }
        const rows: CashSeriesRow[] = ((serie.data ?? []) as SeriesRow[]).map((r) => ({
          day: r.day,
          kind: r.kind === "previsto" ? "previsto" : "realizado",
          activity:
            r.activity === "investimento" || r.activity === "financiamento"
              ? r.activity
              : "operacional",
          inflowCents: Number(r.inflow_cents ?? 0),
          outflowCents: Number(r.outflow_cents ?? 0),
        }));
        const openingCents = Number(abertura.data ?? 0);
        const diario = buildCashFlow({
          rows,
          from: periodo.de,
          to: periodo.ate,
          groupBy: "dia",
          openingCents,
        });
        return linhaDeCaixa(u, diario, openingCents);
      })
    );
    out.push(...lidas);
  }
  return { ok: true, unidades: out };
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

export async function carregarDre(
  supabase: SupabaseClient,
  periodo: { de: string; ate: string }
): Promise<Lido<UnidadeDre>> {
  const { data, error } = await supabase.rpc("network_units_summary", {
    p_from: periodo.de,
    p_to: periodo.ate,
  });
  if (error) return { ok: false, erro: "Não foi possível ler o DRE das unidades." };
  return {
    ok: true,
    unidades: (
      (data ?? []) as {
        clinic_id: string;
        clinic_name: string;
        ownership: string;
        gross_revenue_cents: number;
        net_revenue_cents: number;
        result_cents: number;
      }[]
    ).map((r) => ({
      clinicId: r.clinic_id,
      nome: r.clinic_name,
      ownership: r.ownership === "own" ? "own" : "franchised",
      receitaBrutaCents: Number(r.gross_revenue_cents ?? 0),
      receitaLiquidaCents: Number(r.net_revenue_cents ?? 0),
      resultadoCents: Number(r.result_cents ?? 0),
    })),
  };
}
