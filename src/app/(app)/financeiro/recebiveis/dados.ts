import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  viewInstallment,
  type Installment,
  type InstallmentView,
} from "@/lib/finance/receivables";
import { todayInBrazil, addDaysIso, monthRangeOf } from "@/lib/dates";
import { daysApart, groupByAging, type AgingBand } from "@/lib/finance/aging";

/**
 * OS RECEBÍVEIS DA UNIDADE (relato OC-00005).
 *
 * ⚠️ A RÉGUA JÁ EXISTIA — o que faltava era o alcance. `receivables.ts` calcula
 * atraso, multa, juros e o indicador de inadimplência desde o FIN1, com teste.
 * Só que ela vivia dentro da ficha de UM paciente: dava para ver a
 * inadimplência do Fulano, nunca a da unidade. Este arquivo traz a mesma conta
 * para o nível da clínica, reusando `viewInstallment` — escrever uma segunda
 * versão aqui faria a tela da unidade discordar da ficha do cliente sobre a
 * mesma parcela, e aí nenhum dos dois números valeria nada.
 *
 * ⚠️ E A LEITURA É PODADA. Trazer toda parcela da unidade funcionaria hoje e
 * ficaria caro sozinho: em três anos são dezenas de milhares, e a tela ficaria
 * lenta sem nada denunciando (a mesma armadilha do prazo estourado na home).
 * Aqui só vêm as parcelas que ainda devem alguma coisa — que é exatamente o
 * assunto da tela. As pagas entram só pelo total recebido no período, que o
 * banco soma sem trazer linha.
 */

export type LinhaRecebivel = InstallmentView & {
  clientId: string | null;
  cliente: string;
  /** Data que vale para o vencimento: a de liquidação, quando existe. */
  dataEfetiva: string;
};

export type ResumoDeRecebiveis = {
  /** Principal ainda devido, tudo somado. */
  abertoCents: number;
  /** Só a parte vencida, já com benefício perdido, multa e juros. */
  vencidoCents: number;
  vencidoQuantidade: number;
  abertoQuantidade: number;
  /** Vencido ÷ a receber. `null` quando não há nada a receber. */
  taxaPercent: number | null;
  /** O teto que a REDE (ou a unidade) definiu. Não é referência de mercado. */
  limitePercent: number | null;
  /** Recebido no mês corrente, pelas baixas ativas. */
  recebidoNoMesCents: number;
  /** A vencer, por prazo — é o que dá para antecipar. */
  aVencer: AgingBand[];
  /** Vencido, por tempo de atraso — é o que dá para cobrar. */
  atrasadas: AgingBand[];
};

type LinhaBruta = {
  id: string;
  seq: number;
  kind: "entrada" | "parcela";
  due_date: string;
  expected_settlement_date: string | null;
  amount_cents: number;
  benefit_discount_cents: number | null;
  paid_amount_cents: number | null;
  paid_benefit_cents: number | null;
  paid_fee_cents: number | null;
  paid_interest_cents: number | null;
  status: Installment["status"];
  payment_method: string | null;
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  grace_days: number | null;
  was_overdue: boolean | null;
  negotiation_id: string | null;
  direct_sale_id: string | null;
  renegotiation_id: string | null;
  renegotiated_by_id: string | null;
  client_id: string | null;
  clients: { full_name: string } | null;
};

/**
 * ⚠️ SÃO DUAS ESCADAS, E NÃO SE MISTURAM. "A vencer" olha para a frente e
 * responde *quanto eu tenho para antecipar*; "atrasadas" olha para trás e
 * responde *o que eu preciso cobrar, e há quanto tempo*. Numa escada só, o que
 * vence semana que vem apareceria ao lado do que está parado há seis meses, e
 * as duas decisões são opostas: uma é negociar com o banco, a outra é ligar
 * para o cliente.
 *
 * A conta das faixas mora em `finance/aging.ts`, pura e com teste — ela erra
 * por UM DIA em silêncio, e o total continua batendo quando erra.
 */

export async function carregarRecebiveis(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ linhas: LinhaRecebivel[]; resumo: ResumoDeRecebiveis }> {
  const hoje = todayInBrazil();
  const mes = monthRangeOf(hoje);

  const [parcelas, taxa, recebido] = await Promise.all([
    supabase
      .from("payment_installments")
      .select(
        "id, seq, kind, due_date, expected_settlement_date, amount_cents, benefit_discount_cents, paid_amount_cents, paid_benefit_cents, paid_fee_cents, paid_interest_cents, status, payment_method, late_fee_percent, monthly_interest_percent, grace_days, was_overdue, negotiation_id, direct_sale_id, renegotiation_id, renegotiated_by_id, client_id, clients ( full_name )"
      )
      .eq("clinic_id", clinicId)
      // Só o que ainda deve. Cancelada não é dívida; renegociada foi
      // SUBSTITUÍDA por outra cobrança que já está nesta lista — contá-la
      // somaria a mesma dívida duas vezes.
      .in("status", ["em_aberto", "parcial"])
      .order("due_date")
      .returns<LinhaBruta[]>(),
    // ⚠️ A TAXA VEM DO BANCO, não de uma soma minha sobre as linhas acima.
    // É a MESMA função que a tela da rede vai usar; duas contas para o mesmo
    // indicador é como a unidade e a rede passam a discordar sobre ela.
    supabase.rpc("clinic_overdue_rate", { p_clinic_id: clinicId }),
    supabase
      .from("payment_receipts")
      .select("amount_cents, reversed, reversal_of")
      .eq("clinic_id", clinicId)
      .gte("received_at", mes.from)
      .lte("received_at", mes.to)
      .returns<
        { amount_cents: number; reversed: boolean; reversal_of: string | null }[]
      >(),
  ]);

  const linhas: LinhaRecebivel[] = (parcelas.data ?? []).map((r) => {
    const inst: Installment = {
      id: r.id,
      seq: r.seq,
      kind: r.kind,
      dueDate: r.due_date,
      amountCents: r.amount_cents,
      benefitDiscountCents: r.benefit_discount_cents ?? 0,
      paidAmountCents: r.paid_amount_cents ?? 0,
      paidBenefitCents: r.paid_benefit_cents ?? 0,
      paidFeeCents: r.paid_fee_cents ?? 0,
      paidInterestCents: r.paid_interest_cents ?? 0,
      status: r.status,
      paymentMethod: r.payment_method,
      terms: {
        lateFeePercent: r.late_fee_percent ?? 2,
        monthlyInterestPercent: r.monthly_interest_percent ?? 1,
        graceDays: r.grace_days ?? 0,
      },
      origin: r.renegotiation_id
        ? "renegotiation"
        : r.direct_sale_id
          ? "direct_sale"
          : "negotiation",
      sourceId: r.renegotiation_id ?? r.direct_sale_id ?? r.negotiation_id,
      sourceCode: null,
      renegotiatedById: r.renegotiated_by_id,
      wasOverdue: Boolean(r.was_overdue),
    };
    return {
      ...viewInstallment(inst, hoje),
      clientId: r.client_id,
      cliente: r.clients?.full_name ?? "—",
      // ⚠️ CARTÃO NÃO ESTÁ ATRASADO ENQUANTO NÃO LIQUIDOU. A adquirente paga em
      // D+30; usar o vencimento aqui acusaria de inadimplência o que é só prazo
      // combinado. Mesma data que a projeção de caixa usa.
      dataEfetiva: r.expected_settlement_date ?? r.due_date,
    };
  });

  const t = ((taxa.data ?? []) as {
    open_cents: number;
    overdue_cents: number;
    overdue_count: number;
    open_count: number;
    overdue_percent: number | null;
    limit_percent: number | null;
  }[])[0];

  const recebidoNoMesCents = (recebido.data ?? [])
    // Estornada e estorno saem dos DOIS lados: deixar o contra-lançamento
    // sozinho faria o recebido do mês ficar NEGATIVO no valor do estorno.
    .filter((r) => !r.reversed && !r.reversal_of)
    .reduce((s, r) => s + Number(r.amount_cents ?? 0), 0);

  const aVencer = groupByAging(
    linhas.filter((l) => l.dataEfetiva >= hoje),
    (l) => daysApart(hoje, l.dataEfetiva),
    (l) => l.balanceCents
  );

  const atrasadas = groupByAging(
    linhas.filter((l) => l.dataEfetiva < hoje),
    (l) => daysApart(l.dataEfetiva, hoje),
    // Vencida vale o que falta HOJE: principal + benefício perdido + multa +
    // juros. É esse o valor de cobrança, e é o que a ficha do cliente mostra.
    (l) => l.updatedBalanceCents
  );

  return {
    linhas,
    resumo: {
      abertoCents: Number(t?.open_cents ?? 0),
      vencidoCents: Number(t?.overdue_cents ?? 0),
      vencidoQuantidade: Number(t?.overdue_count ?? 0),
      abertoQuantidade: Number(t?.open_count ?? 0),
      taxaPercent: t?.overdue_percent === null || t?.overdue_percent === undefined
        ? null
        : Number(t.overdue_percent),
      limitePercent:
        t?.limit_percent === null || t?.limit_percent === undefined
          ? null
          : Number(t.limit_percent),
      recebidoNoMesCents,
      aVencer,
      atrasadas,
    },
  };
}

/** O primeiro dia fora da janela de 90 dias — usado no texto da antecipação. */
export function limiteDaAntecipacao(): string {
  return addDaysIso(todayInBrazil(), 90);
}
