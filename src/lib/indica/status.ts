// Indica +Risos — status da indicação (espelho da máquina de estados do banco).
//
// A regra de verdade mora em `indica.transicao_permitida`
// (supabase/migrations/2002_indica_motor.sql) e é ela que o banco obedece.
// Este espelho existe para as telas mostrarem só os botões que o banco aceita;
// `indica-status.test.ts` lê a migração e reprova se os dois divergirem.

export const INDICACAO_STATUS = [
  "registrada",
  "validada",
  "agendada",
  "compareceu",
  "fechou",
  "convertida",
  "recusada",
  "faltou",
  "nao_fechou",
  "cancelada",
  "expirada",
] as const;

export type IndicacaoStatus = (typeof INDICACAO_STATUS)[number];

export const INDICACAO_STATUS_LABEL: Record<IndicacaoStatus, string> = {
  registrada: "Registrada",
  validada: "Validada",
  agendada: "Agendada",
  compareceu: "Compareceu",
  fechou: "Fechou",
  convertida: "Convertida",
  recusada: "Recusada",
  faltou: "Faltou",
  nao_fechou: "Não fechou",
  cancelada: "Cancelada",
  expirada: "Expirada",
};

export const TRANSICOES: Record<IndicacaoStatus, readonly IndicacaoStatus[]> = {
  registrada: ["validada", "recusada", "expirada"],
  validada: ["agendada", "recusada", "expirada"],
  agendada: ["agendada", "compareceu", "faltou", "recusada", "expirada"],
  faltou: ["agendada", "expirada"],
  compareceu: ["fechou", "nao_fechou"],
  nao_fechou: ["fechou", "expirada"],
  fechou: ["convertida", "cancelada"],
  convertida: [],
  recusada: [],
  cancelada: [],
  expirada: [],
};

/** Status que encerram a indicação (não andam mais). */
export const STATUS_FINAIS: readonly IndicacaoStatus[] = INDICACAO_STATUS.filter(
  (s) => TRANSICOES[s].length === 0
);

/** Mudanças que o banco só aceita com motivo escrito. */
export const EXIGE_MOTIVO: readonly IndicacaoStatus[] = ["recusada", "cancelada", "nao_fechou"];

export function transicaoPermitida(de: IndicacaoStatus, para: IndicacaoStatus): boolean {
  return TRANSICOES[de].includes(para);
}
