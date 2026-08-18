// FIN6.2 — O FLUXO DE CAIXA.
//
// A DRE responde "o mês deu lucro?". Esta responde a pergunta que quebra
// clínica lucrativa: **vai faltar dinheiro, e quando?**
//
// A conta mora aqui, e não no SQL, por dois motivos. O banco devolve só os dias
// COM movimento; a régua de dias vazios, o saldo acumulado e o agrupamento por
// semana/mês precisam existir de qualquer jeito — e aqui ficam cobertos por
// teste automatizado, que é a única rede que pega erro de saldo antes do dono.
//
// Dinheiro sempre em centavos.

import { addDays } from "@/lib/payments";

export type CashKind = "realizado" | "previsto";
export type CashActivity = "operacional" | "investimento" | "financiamento";
export type CashGroupBy = "dia" | "semana" | "mes";

/** Uma linha do `cash_flow_series` — um dia, um tipo, uma atividade. */
export type CashSeriesRow = {
  /** YYYY-MM-DD. */
  day: string;
  kind: CashKind;
  activity: CashActivity;
  inflowCents: number;
  outflowCents: number;
};

export type CashPeriod = {
  /** Primeiro dia do período (chave estável). */
  key: string;
  /** Início exibido (recortado pelo filtro). */
  start: string;
  /** Fim exibido (recortado pelo filtro). */
  end: string;
  realizedInflowCents: number;
  realizedOutflowCents: number;
  expectedInflowCents: number;
  expectedOutflowCents: number;
  inflowCents: number;
  outflowCents: number;
  /** Entradas − saídas do período. */
  netCents: number;
  /** Saldo ao FIM do período. */
  balanceCents: number;
  /** Resultado por atividade (operacional é o que sustenta a clínica). */
  activityCents: Record<CashActivity, number>;
  /** O período tem alguma coisa ainda não realizada. */
  hasExpected: boolean;
};

const EMPTY_ACTIVITY = (): Record<CashActivity, number> => ({
  operacional: 0,
  investimento: 0,
  financiamento: 0,
});

/** Segunda-feira da semana da data (a semana comercial começa na segunda). */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  // getUTCDay: 0 = domingo. Domingo pertence à semana que começou na segunda
  // anterior, por isso ele recua 6 dias, não 0.
  const back = (dt.getUTCDay() + 6) % 7;
  return addDays(iso, -back);
}

/** Primeiro dia do mês da data. */
export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Início do período que contém a data, conforme o agrupamento. */
export function periodStart(iso: string, groupBy: CashGroupBy): string {
  if (groupBy === "semana") return startOfWeek(iso);
  if (groupBy === "mes") return startOfMonth(iso);
  return iso;
}

/** Último dia do período que começa em `start`. */
export function periodEnd(start: string, groupBy: CashGroupBy): string {
  if (groupBy === "semana") return addDays(start, 6);
  if (groupBy === "mes") {
    const [y, m] = start.split("-").map(Number);
    const last = new Date(Date.UTC(y, m ?? 1, 0)).getUTCDate();
    return `${start.slice(0, 7)}-${String(last).padStart(2, "0")}`;
  }
  return start;
}

/** Início do período seguinte. */
function nextPeriod(start: string, groupBy: CashGroupBy): string {
  return addDays(periodEnd(start, groupBy), 1);
}

/**
 * A linha do tempo do caixa.
 *
 * Devolve TODOS os períodos entre `from` e `to`, inclusive os sem movimento:
 * dia vazio não some da tabela, senão o saldo pareceria pular de uma data para
 * outra e o dia em que o caixa vira negativo poderia simplesmente não aparecer.
 */
export function buildCashFlow(input: {
  rows: CashSeriesRow[];
  /** YYYY-MM-DD. */
  from: string;
  to: string;
  groupBy: CashGroupBy;
  /** Saldo antes do primeiro dia do período. */
  openingCents: number;
}): CashPeriod[] {
  const { rows, from, to, groupBy, openingCents } = input;
  if (from > to) return [];

  const buckets = new Map<string, CashPeriod>();
  const periods: CashPeriod[] = [];

  for (let s = periodStart(from, groupBy); s <= to; s = nextPeriod(s, groupBy)) {
    const rawEnd = periodEnd(s, groupBy);
    const p: CashPeriod = {
      key: s,
      // Recortado pelo filtro: o mês pode começar antes do "de" escolhido.
      start: s < from ? from : s,
      end: rawEnd > to ? to : rawEnd,
      realizedInflowCents: 0,
      realizedOutflowCents: 0,
      expectedInflowCents: 0,
      expectedOutflowCents: 0,
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
      balanceCents: 0,
      activityCents: EMPTY_ACTIVITY(),
      hasExpected: false,
    };
    buckets.set(s, p);
    periods.push(p);
  }

  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    const p = buckets.get(periodStart(r.day, groupBy));
    if (!p) continue;

    const inflow = Math.max(0, Math.round(r.inflowCents));
    const outflow = Math.max(0, Math.round(r.outflowCents));

    if (r.kind === "previsto") {
      p.expectedInflowCents += inflow;
      p.expectedOutflowCents += outflow;
      if (inflow > 0 || outflow > 0) p.hasExpected = true;
    } else {
      p.realizedInflowCents += inflow;
      p.realizedOutflowCents += outflow;
    }
    p.inflowCents += inflow;
    p.outflowCents += outflow;
    p.activityCents[r.activity] += inflow - outflow;
  }

  let balance = Math.round(openingCents);
  for (const p of periods) {
    p.netCents = p.inflowCents - p.outflowCents;
    balance += p.netCents;
    p.balanceCents = balance;
  }
  return periods;
}

/**
 * O aviso que justifica a tela: o primeiro período em que o saldo fica
 * negativo. Calcule sempre sobre a série DIÁRIA — agrupado por mês, um buraco
 * no dia 8 coberto por um recebimento no dia 25 desapareceria, e é justamente
 * ele que faz o cheque voltar.
 */
export function firstNegative(periods: CashPeriod[]): CashPeriod | null {
  return periods.find((p) => p.balanceCents < 0) ?? null;
}

export type CashTotals = {
  realizedInflowCents: number;
  realizedOutflowCents: number;
  expectedInflowCents: number;
  expectedOutflowCents: number;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  /** Saldo ao fim do último período (ou o inicial, se não houver período). */
  endBalanceCents: number;
  activityCents: Record<CashActivity, number>;
};

export function cashTotals(
  periods: CashPeriod[],
  openingCents: number
): CashTotals {
  const t: CashTotals = {
    realizedInflowCents: 0,
    realizedOutflowCents: 0,
    expectedInflowCents: 0,
    expectedOutflowCents: 0,
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    endBalanceCents: Math.round(openingCents),
    activityCents: EMPTY_ACTIVITY(),
  };
  for (const p of periods) {
    t.realizedInflowCents += p.realizedInflowCents;
    t.realizedOutflowCents += p.realizedOutflowCents;
    t.expectedInflowCents += p.expectedInflowCents;
    t.expectedOutflowCents += p.expectedOutflowCents;
    t.inflowCents += p.inflowCents;
    t.outflowCents += p.outflowCents;
    t.activityCents.operacional += p.activityCents.operacional;
    t.activityCents.investimento += p.activityCents.investimento;
    t.activityCents.financiamento += p.activityCents.financiamento;
    t.endBalanceCents = p.balanceCents;
  }
  t.netCents = t.inflowCents - t.outflowCents;
  return t;
}

/** Rótulo curto do período, em pt-BR. */
export function periodLabel(p: CashPeriod, groupBy: CashGroupBy): string {
  const br = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return groupBy === "mes" ? `${m}/${y}` : `${d}/${m}`;
  };
  if (groupBy === "mes") return br(p.key);
  if (groupBy === "semana") return `${br(p.start)} a ${br(p.end)}`;
  return br(p.key);
}
