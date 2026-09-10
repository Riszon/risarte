import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDre,
  previousPeriod,
  variation,
  netMarginPercent,
  type DreLine,
} from "@/lib/finance/dre";
import {
  buildCashFlow,
  firstNegative,
  type CashSeriesRow,
} from "@/lib/finance/cash-flow";
import {
  byAttention,
  panelTotals,
  statusReasons,
  unitStatus,
  type PanelTotals,
  type UnitPanelRow,
} from "@/lib/finance/network-panel";
import { todayInBrazil, addDaysIso, monthRangeOf } from "@/lib/dates";

/**
 * O PAINEL DO FINANCEIRO — a tela que faltava na porta do módulo.
 *
 * ⚠️ ATÉ 10/09/2026 `/financeiro` NÃO TINHA TELA: era um `redirect` para a
 * Configuração. O dono: *"quando entra no financeiro já abre uma tela de
 * configuração e nada bonito"*. Está certo, e o defeito é de desenho, não de
 * aparência: entrar num módulo e cair no cadastro dele é o mesmo que abrir uma
 * loja pela sala das prateleiras vazias. Configuração é o que se faz uma vez;
 * o módulo existe para responder perguntas todo dia.
 *
 * O módulo tem DUAS perguntas centrais, e elas são diferentes de propósito —
 * é a distinção que faz clínica lucrativa quebrar:
 *
 *   - **"o mês deu lucro?"** → competência, a DRE (FIN6.1);
 *   - **"vai faltar dinheiro, e quando?"** → caixa, o fluxo (FIN6.2).
 *
 * ⚠️ E OS DOIS LEEM O RAZÃO POR METADES OPOSTAS. Cada venda grava duas linhas:
 * competência (`installment_accrual`) e caixa (`receipt_cash`). Somar as duas
 * foi o defeito da 0225, que dobrou a receita. Aqui o painel **não faz conta
 * nenhuma sobre o razão**: ele chama `dre_lines` e `cash_flow_series`, que são
 * as mesmas funções das telas de destino, e passa o resultado para `buildDre` e
 * `buildCashFlow`, que são as mesmas contas — com teste. Um painel que
 * refizesse a conta por fora poderia divergir da tela para onde ele leva, e
 * número que discorda da tela é pior que número nenhum (a lição do FIN8.3).
 *
 * ⚠️ ZERO NÃO APARECE, como na tela de início: pendência sem nada esperando não
 * vira cartão. Um "0" pendurado em todo cartão vira paisagem.
 */

export type Tom = "atencao" | "normal";

export type PendenciaFinanceira = {
  chave: string;
  /** Já formatado: pode ser dinheiro, uma data ou uma contagem. */
  valor: string;
  titulo: string;
  linha: string;
  href: string;
  tom: Tom;
};

export type ResumoDoMes = {
  /** Primeiro e último dia do mês corrente (data civil brasileira). */
  de: string;
  ate: string;
  receitaLiquidaCents: number;
  lucroLiquidoCents: number;
  margemPercent: number | null;
  /** Variação do lucro contra o mês anterior, do MESMO tamanho. */
  lucroDeltaCents: number;
  lucroDeltaPercent: number | null;
  saldoEmCaixaCents: number;
  /** Houve algum lançamento de competência no mês? */
  temMovimento: boolean;
};

export type ResumoDaRede = {
  totais: PanelTotals;
  /** As unidades que pedem atenção primeiro, no máximo três. */
  piores: { clinicId: string; nome: string; motivos: string[] }[];
  /** Quando a apuração dos alertas rodou pela última vez. */
  apuradoEm: string | null;
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Dinheiro em centavos → "R$ 1.234,56". */
export function reais(cents: number): string {
  return BRL.format(Math.round(cents) / 100);
}

/** "2026-09-23" → "23/09". */
function diaMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * O mês corrente, em data civil brasileira (nunca `toISOString`).
 *
 * ⚠️ A CONTA É A MESMA DA DRE, por `monthRangeOf`. Escrever aqui uma segunda
 * versão do "último dia do mês" faria o painel e a DRE mostrarem períodos
 * diferentes no dia em que alguém arrumasse uma das duas — e um dia a mais ou a
 * menos no fim do mês é a divergência que ninguém percebe até fechar o ano.
 */
export function mesCorrente(): { de: string; ate: string } {
  const { from, to } = monthRangeOf(todayInBrazil());
  return { de: from, ate: to };
}

function paraLinhas(rows: unknown): DreLine[] {
  return (
    (rows ?? []) as {
      account_code: string;
      account_name: string;
      block: string;
      amount_cents: number;
    }[]
  ).map((r) => ({
    accountCode: r.account_code,
    accountName: r.account_name,
    block: r.block,
    amountCents: Number(r.amount_cents ?? 0),
  }));
}

/**
 * OS TRÊS NÚMEROS DO MÊS, para uma unidade.
 *
 * O saldo em caixa é pedido para **amanhã**, não para hoje: `cash_balance_before`
 * devolve o que já virou dinheiro ANTES da data, então pedir "hoje" deixaria de
 * fora o que entrou hoje de manhã — e o saldo apareceria menor que o extrato.
 * É a mesma chamada que a tela de fluxo de caixa faz, pelo mesmo motivo.
 */
export async function montarResumoDoMes(
  supabase: SupabaseClient,
  clinicId: string
): Promise<ResumoDoMes> {
  const { de, ate } = mesCorrente();
  const anterior = previousPeriod(de, ate);
  const hoje = todayInBrazil();

  const [atual, passado, saldo] = await Promise.all([
    supabase.rpc("dre_lines", { p_clinic_id: clinicId, p_from: de, p_to: ate }),
    supabase.rpc("dre_lines", {
      p_clinic_id: clinicId,
      p_from: anterior.from,
      p_to: anterior.to,
    }),
    supabase.rpc("cash_balance_before", {
      p_clinic_id: clinicId,
      p_date: addDaysIso(hoje, 1),
    }),
  ]);

  const linhasAtuais = paraLinhas(atual.data);
  const dre = buildDre(linhasAtuais);
  const dreAntes = buildDre(paraLinhas(passado.data));
  const delta = variation(dre.lucroLiquidoCents, dreAntes.lucroLiquidoCents);

  return {
    de,
    ate,
    receitaLiquidaCents: dre.receitaLiquidaCents,
    lucroLiquidoCents: dre.lucroLiquidoCents,
    margemPercent: netMarginPercent(dre),
    lucroDeltaCents: delta.deltaCents,
    lucroDeltaPercent: delta.percent,
    saldoEmCaixaCents: Number(saldo.data ?? 0),
    // ⚠️ SEM MOVIMENTO ≠ RESULTADO ZERO. Unidade que ainda não lançou nada no
    // mês mostraria "R$ 0,00 de lucro", que se lê como "trabalhou e não
    // sobrou". A tela precisa saber a diferença para dizer a verdade.
    temMovimento: linhasAtuais.length > 0,
  };
}

/**
 * O QUE PRECISA DE VOCÊ — as pendências de uma unidade.
 *
 * Todas as consultas saem juntas. As contas são as das telas de destino.
 */
export async function montarPendenciasFinanceiras(
  supabase: SupabaseClient,
  clinicId: string
): Promise<PendenciaFinanceira[]> {
  const hoje = todayInBrazil();
  // 90 dias é a janela padrão da tela de fluxo de caixa. Usar outra aqui faria
  // o painel avisar de um buraco que a tela não mostra, ou o contrário.
  const ate = addDaysIso(hoje, 90);

  const [serie, saldoInicial, vencidos, autorizacao, alertas] =
    await Promise.all([
      supabase.rpc("cash_flow_series", {
        p_clinic_id: clinicId,
        p_from: hoje,
        p_to: ate,
      }),
      supabase.rpc("cash_balance_before", {
        p_clinic_id: clinicId,
        p_date: hoje,
      }),
      supabase.rpc("cash_overdue", { p_clinic_id: clinicId }),
      supabase
        .from("payables")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "aguardando_autorizacao"),
      supabase
        .from("finance_alerts")
        .select("rule, detail")
        .eq("clinic_id", clinicId)
        .is("cleared_at", null),
    ]);

  const rows: CashSeriesRow[] = (
    (serie.data ?? []) as {
      day: string;
      kind: string;
      activity: string;
      inflow_cents: number;
      outflow_cents: number;
    }[]
  ).map((r) => ({
    day: r.day,
    kind: r.kind === "previsto" ? "previsto" : "realizado",
    activity:
      r.activity === "investimento" || r.activity === "financiamento"
        ? r.activity
        : "operacional",
    inflowCents: Number(r.inflow_cents ?? 0),
    outflowCents: Number(r.outflow_cents ?? 0),
  }));

  // ⚠️ O AVISO SAI DA SÉRIE DIÁRIA, SEMPRE. Agrupado por mês, um buraco no dia
  // 8 coberto por um recebimento no dia 25 desapareceria — e é justamente ele
  // que faz o cheque voltar. Mesma decisão da tela de fluxo de caixa (FIN6.2).
  const diario = buildCashFlow({
    rows,
    from: hoje,
    to: ate,
    groupBy: "dia",
    openingCents: Number(saldoInicial.data ?? 0),
  });
  const buraco = firstNegative(diario);

  const atraso = (
    (vencidos.data ?? []) as {
      receivable_cents: number;
      receivable_count: number;
      payable_cents: number;
      payable_count: number;
    }[]
  )[0];

  const lista: PendenciaFinanceira[] = [];

  if (buraco) {
    lista.push({
      chave: "caixa-negativo",
      valor: diaMes(buraco.key),
      titulo: "O caixa fica negativo",
      linha: `Pela projeção, o saldo chega a ${reais(
        buraco.balanceCents
      )} neste dia.`,
      href: "/financeiro/fluxo-de-caixa",
      tom: "atencao",
    });
  }

  const aReceber = Number(atraso?.receivable_cents ?? 0);
  if (aReceber > 0) {
    lista.push({
      chave: "receber-vencido",
      valor: reais(aReceber),
      titulo: "A receber vencido",
      linha: `${atraso?.receivable_count ?? 0} cobrança(s) passaram do vencimento. Não entram na projeção.`,
      href: "/financeiro/fluxo-de-caixa",
      tom: "atencao",
    });
  }

  const aPagar = Number(atraso?.payable_cents ?? 0);
  if (aPagar > 0) {
    lista.push({
      chave: "pagar-vencido",
      valor: reais(aPagar),
      titulo: "A pagar vencido",
      linha: `${atraso?.payable_count ?? 0} conta(s) passaram do vencimento.`,
      href: "/financeiro/contas-a-pagar",
      tom: "atencao",
    });
  }

  if ((autorizacao.count ?? 0) > 0) {
    lista.push({
      chave: "autorizacao",
      valor: String(autorizacao.count),
      titulo: "Contas aguardando autorização",
      linha: "Não são pagas antes da decisão de quem tem alçada.",
      href: "/financeiro/contas-a-pagar",
      tom: "atencao",
    });
  }

  const avisos = (alertas.data ?? []) as { rule: string; detail: string | null }[];
  if (avisos.length > 0) {
    lista.push({
      chave: "alertas",
      valor: String(avisos.length),
      titulo: "Alertas em aberto",
      linha:
        avisos[0]?.detail ??
        "Avisos do acompanhamento diário que ainda não foram resolvidos.",
      href: "/financeiro/orcamento",
      tom: "normal",
    });
  }

  return lista;
}

/**
 * O RESUMO DA REDE — o que a Franqueadora vê ao entrar.
 *
 * ⚠️ ELE LÊ O QUE O MOTOR DE ALERTAS JÁ APUROU, e não recalcula. Recalcular por
 * unidade a cada abertura refaria a projeção diária de caixa de toda a rede — e
 * poderia divergir do aviso que a unidade recebeu. Painel que discorda do aviso
 * é confusão. É a mesma decisão do FIN8.3, e a consequência é assumida: o que
 * se vê é o retrato da última apuração.
 */
export async function montarResumoDaRede(
  supabase: SupabaseClient
): Promise<ResumoDaRede | null> {
  const hoje = todayInBrazil();
  const [ano, mes] = hoje.split("-").map(Number);

  const [painel, ultima] = await Promise.all([
    supabase.rpc("network_panel", { p_year: ano, p_month: mes }),
    supabase
      .from("finance_alerts")
      .select("first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(1),
  ]);

  const rows: UnitPanelRow[] = (
    (painel.data ?? []) as {
      clinic_id: string;
      clinic_name: string;
      ownership: string;
      alerts: number;
      alert_caixa: string | null;
      alert_orcamento: string | null;
      alert_equilibrio: string | null;
      alert_atraso: string | null;
      overdue_cents: number;
      prev_month_closed: boolean;
      fees_due_cents: number;
      fees_paid_cents: number;
      fees_open_cents: number;
      fees_overdue_cents: number;
    }[]
  ).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    ownership: r.ownership === "own" ? "own" : "franchised",
    alerts: Number(r.alerts ?? 0),
    alertCaixa: r.alert_caixa,
    alertOrcamento: r.alert_orcamento,
    alertEquilibrio: r.alert_equilibrio,
    alertAtraso: r.alert_atraso,
    overdueCents: Number(r.overdue_cents ?? 0),
    prevMonthClosed: !!r.prev_month_closed,
    feesDueCents: Number(r.fees_due_cents ?? 0),
    feesPaidCents: Number(r.fees_paid_cents ?? 0),
    feesOpenCents: Number(r.fees_open_cents ?? 0),
    feesOverdueCents: Number(r.fees_overdue_cents ?? 0),
  }));

  if (rows.length === 0) return null;

  const piores = [...rows]
    .sort(byAttention)
    .filter((u) => unitStatus(u) !== "verde")
    .slice(0, 3)
    .map((u) => ({
      clinicId: u.clinicId,
      nome: u.clinicName,
      motivos: statusReasons(u),
    }));

  const apurado = (ultima.data ?? []) as { first_seen_at: string }[];

  return {
    totais: panelTotals(rows),
    piores,
    apuradoEm: apurado[0]?.first_seen_at ?? null,
  };
}
