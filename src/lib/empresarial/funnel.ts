// Risarte Empresarial — as 8 fases do funil comercial e o RELÓGIO de cada fase.
//
// Puro de propósito (nada de banco, nada de `server-only`): a mesma conta serve
// ao quadro, ao painel e ao teste. Regra do projeto — conta de negócio mora em
// `src/lib`, nunca dentro de componente de tela.
//
// Ver migração 1007 (`commercial_lead_stage_history`).

import type { LeadStage } from "./constants";

// -----------------------------------------------------------------------------
// As colunas do quadro
// -----------------------------------------------------------------------------
// A numeração NÃO é enfeite: o funil é uma sequência, e o número é o que deixa
// o consultor dizer "está na 4" sem abrir a tela.
//
// FECHAMENTO é UMA coluna com DOIS valores de banco (ganho e perda). Foi decisão
// do dono, e evita reescrever registro que já existe: o resultado aparece no
// cartão, e a coluna tem filtro de Todos / Ganhos / Perdas.

export type FunnelColumnKey =
  | "CAPTURE"
  | "CONTACT"
  | "MEETING_SCHEDULED"
  | "PRESENTED"
  | "PROPOSAL_SENT"
  | "FOLLOW_UP"
  | "CLOSING"
  | "IMPLEMENTATION";

export type FunnelColumn = {
  key: FunnelColumnKey;
  numero: number;
  titulo: string;
  stages: readonly LeadStage[];
};

export const FUNNEL_COLUMNS: readonly FunnelColumn[] = [
  { key: "CAPTURE", numero: 1, titulo: "Captação", stages: ["CAPTURE"] },
  { key: "CONTACT", numero: 2, titulo: "Contato", stages: ["CONTACT"] },
  {
    key: "MEETING_SCHEDULED",
    numero: 3,
    titulo: "Reunião agendada",
    stages: ["MEETING_SCHEDULED"],
  },
  { key: "PRESENTED", numero: 4, titulo: "Apresentado", stages: ["PRESENTED"] },
  {
    key: "PROPOSAL_SENT",
    numero: 5,
    titulo: "Proposta enviada",
    stages: ["PROPOSAL_SENT"],
  },
  { key: "FOLLOW_UP", numero: 6, titulo: "Follow-up", stages: ["FOLLOW_UP"] },
  {
    key: "CLOSING",
    numero: 7,
    titulo: "Fechamento",
    stages: ["CLOSED_WON", "CLOSED_LOST"],
  },
  {
    key: "IMPLEMENTATION",
    numero: 8,
    titulo: "Implantação",
    stages: ["IMPLEMENTATION"],
  },
] as const;

/** Em qual coluna do quadro esta fase aparece. */
export function columnOfStage(stage: LeadStage): FunnelColumnKey {
  const col = FUNNEL_COLUMNS.find((c) =>
    (c.stages as readonly string[]).includes(stage)
  );
  // Fase sem coluna é defeito de cadastro, não caso a tratar em silêncio: o
  // cartão sumiria do quadro e ninguém descobriria até a empresa reclamar.
  if (!col) throw new Error(`Fase sem coluna no funil: ${stage}`);
  return col.key;
}

/** Fases em que o lead ainda se move sozinho (não fechou nem foi implantado). */
export function isOpenStage(stage: LeadStage): boolean {
  return (
    stage !== "CLOSED_WON" &&
    stage !== "CLOSED_LOST" &&
    stage !== "IMPLEMENTATION"
  );
}

/**
 * Fases em que um lead NOVO pode entrar.
 *
 * O dono pediu para perguntar a fase no cadastro (padrão: Captação) — uma
 * empresa já em negociação não precisa fingir que começou do zero. Fechamento e
 * Implantação ficam de fora: fechar cria a empresa e exige a conferência do
 * consultor, e nascer "fechado" pularia os dois.
 */
export const ENTRY_STAGES: readonly LeadStage[] = FUNNEL_COLUMNS.filter(
  (c) => c.stages.length === 1 && isOpenStage(c.stages[0])
).map((c) => c.stages[0]);

// -----------------------------------------------------------------------------
// O filtro da coluna de Fechamento
// -----------------------------------------------------------------------------
export const CLOSING_FILTERS = ["ALL", "WON", "LOST"] as const;
export type ClosingFilter = (typeof CLOSING_FILTERS)[number];
export const CLOSING_FILTER_LABELS: Record<ClosingFilter, string> = {
  ALL: "Todos",
  WON: "Ganhos",
  LOST: "Perdas",
};

export function matchesClosingFilter(
  stage: LeadStage,
  filtro: ClosingFilter
): boolean {
  if (filtro === "WON") return stage === "CLOSED_WON";
  if (filtro === "LOST") return stage === "CLOSED_LOST";
  return true;
}

// -----------------------------------------------------------------------------
// O relógio
// -----------------------------------------------------------------------------
export type StagePeriod = {
  stage: LeadStage;
  enteredAt: string;
  leftAt: string | null;
  /** Linha aberta pela migração 1007: antes dela não há histórico nenhum. */
  isInitial: boolean;
};

export type TempoNaFase = {
  ms: number;
  dias: number;
  /**
   * true quando o único registro é o da migração — o tempo mostrado conta a
   * partir do dia em que o relógio foi ligado, não de quando a empresa entrou
   * de verdade naquela fase. A tela precisa dizer isso; número sem essa
   * ressalva vira medição inventada.
   */
  desdeQueORelogioLigou: boolean;
};

const UM_DIA = 24 * 60 * 60 * 1000;

/**
 * Há quanto tempo o lead está na fase em que está.
 * Devolve `null` quando não há período aberto — lead sem histórico nenhum é
 * ausência de MEDIÇÃO, não "zero dias na fase".
 */
export function tempoNaFaseAtual(
  history: readonly StagePeriod[],
  agora: Date
): TempoNaFase | null {
  const aberto = history.find((h) => h.leftAt == null);
  if (!aberto) return null;
  const ms = Math.max(0, agora.getTime() - new Date(aberto.enteredAt).getTime());
  return {
    ms,
    dias: Math.floor(ms / UM_DIA),
    desdeQueORelogioLigou: aberto.isInitial,
  };
}

/**
 * Quanto tempo o lead passou em CADA fase por onde andou. Períodos repetidos na
 * mesma fase somam (voltar do follow-up para o contato é normal, e o total do
 * contato tem de incluir as duas passagens).
 */
export function tempoPorFase(
  history: readonly StagePeriod[],
  agora: Date
): Map<LeadStage, number> {
  const total = new Map<LeadStage, number>();
  for (const h of history) {
    const fim = h.leftAt ? new Date(h.leftAt).getTime() : agora.getTime();
    const ms = Math.max(0, fim - new Date(h.enteredAt).getTime());
    total.set(h.stage, (total.get(h.stage) ?? 0) + ms);
  }
  return total;
}

/** "hoje", "1 dia", "12 dias" — o funil se mede em dias, não em minutos. */
export function rotuloDeDuracao(ms: number): string {
  const dias = Math.floor(ms / UM_DIA);
  if (dias <= 0) return "hoje";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}
