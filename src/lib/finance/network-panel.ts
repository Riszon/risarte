// FIN8.3 — O PAINEL DA REDE.
//
// É onde os alertas da rede moram desde que ficou decidido, no FIN7.3, que a
// franqueadora NÃO entra na lista do sino: com 200 unidades seriam centenas de
// notificações por dia. Rede é assunto de painel.
//
// O painel lê o que o motor de alertas JÁ APUROU. Recalcular a cada abertura
// seria refazer a projeção diária de caixa por unidade — e, pior, poderia
// divergir do aviso que a pessoa recebeu. Painel que mostra número diferente do
// aviso não é painel, é confusão.

export type UnitPanelRow = {
  clinicId: string;
  clinicName: string;
  ownership: "own" | "franchised";
  alerts: number;
  alertCaixa: string | null;
  alertOrcamento: string | null;
  alertEquilibrio: string | null;
  alertAtraso: string | null;
  overdueCents: number;
  prevMonthClosed: boolean;
  feesDueCents: number;
  feesPaidCents: number;
  feesOpenCents: number;
  feesOverdueCents: number;
};

/**
 * O farol de uma unidade.
 *
 * VERMELHO é só o que já dói: caixa negativo previsto ou taxa vencida. AMARELO
 * é o que ainda dá para resolver. Se tudo virasse vermelho, o painel deixaria
 * de ordenar prioridade — e um painel que não ordena prioridade é uma lista.
 */
export type UnitStatus = "vermelho" | "amarelo" | "verde";

export function unitStatus(u: UnitPanelRow): UnitStatus {
  if (u.alertCaixa || u.feesOverdueCents > 0) return "vermelho";
  if (
    u.alertOrcamento ||
    u.alertEquilibrio ||
    u.alertAtraso ||
    !u.prevMonthClosed
  ) {
    return "amarelo";
  }
  return "verde";
}

/** Os motivos do farol, em pt-BR, na ordem em que se resolve. */
export function statusReasons(u: UnitPanelRow): string[] {
  const reasons: string[] = [];
  if (u.alertCaixa) reasons.push("caixa negativo previsto");
  if (u.feesOverdueCents > 0) reasons.push("taxa da rede vencida");
  if (u.alertOrcamento) reasons.push("orçamento estourando");
  if (u.alertEquilibrio) reasons.push("atrás do ponto de equilíbrio");
  if (u.alertAtraso) reasons.push("atraso a receber alto");
  if (!u.prevMonthClosed) reasons.push("mês anterior não fechado");
  return reasons;
}

/** Ordem de atenção: quem está pior primeiro; empate, por nome. */
export function byAttention(a: UnitPanelRow, b: UnitPanelRow): number {
  const rank: Record<UnitStatus, number> = {
    vermelho: 0,
    amarelo: 1,
    verde: 2,
  };
  const d = rank[unitStatus(a)] - rank[unitStatus(b)];
  if (d !== 0) return d;
  if (a.alerts !== b.alerts) return b.alerts - a.alerts;
  return a.clinicName.localeCompare(b.clinicName);
}

export type PanelTotals = {
  units: number;
  red: number;
  yellow: number;
  green: number;
  feesDueCents: number;
  feesPaidCents: number;
  feesOpenCents: number;
  feesOverdueCents: number;
  overdueCents: number;
  /** Unidades que ainda não fecharam o mês anterior. */
  notClosed: number;
};

export function panelTotals(rows: UnitPanelRow[]): PanelTotals {
  const t: PanelTotals = {
    units: rows.length,
    red: 0,
    yellow: 0,
    green: 0,
    feesDueCents: 0,
    feesPaidCents: 0,
    feesOpenCents: 0,
    feesOverdueCents: 0,
    overdueCents: 0,
    notClosed: 0,
  };
  for (const r of rows) {
    const s = unitStatus(r);
    if (s === "vermelho") t.red++;
    else if (s === "amarelo") t.yellow++;
    else t.green++;
    t.feesDueCents += r.feesDueCents;
    t.feesPaidCents += r.feesPaidCents;
    t.feesOpenCents += r.feesOpenCents;
    t.feesOverdueCents += r.feesOverdueCents;
    t.overdueCents += r.overdueCents;
    if (!r.prevMonthClosed) t.notClosed++;
  }
  return t;
}

export type MonthPoint = {
  /** "YYYY-MM-DD" do primeiro dia do mês. */
  month: string;
  grossCents: number;
  units: number;
};

/**
 * A variação do mês contra o anterior, em fração. `null` quando não há mês
 * anterior ou quando ele foi zero — dividir por zero daria "infinito por cento",
 * que não informa nada.
 */
export function monthOverMonth(points: MonthPoint[], index: number): number | null {
  if (index <= 0 || index >= points.length) return null;
  const prev = points[index - 1].grossCents;
  if (prev === 0) return null;
  return points[index].grossCents / prev - 1;
}

/** Faturamento médio por unidade no mês. */
export function averagePerUnit(p: MonthPoint): number {
  return p.units > 0 ? Math.round(p.grossCents / p.units) : 0;
}
