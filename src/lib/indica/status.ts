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

/** Colunas do kanban, na ordem do caminho. As encerradas ficam na lista. */
export const COLUNAS_KANBAN: readonly IndicacaoStatus[] = [
  "registrada",
  "validada",
  "agendada",
  "faltou",
  "compareceu",
  "nao_fechou",
  "fechou",
  "convertida",
];

/**
 * A mesma cor em todas as telas (diretriz do documento): o olho aprende a cor
 * da etapa e deixa de ler o rótulo.
 */
export const STATUS_COR: Record<IndicacaoStatus, string> = {
  registrada: "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  validada: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  agendada: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  faltou: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  compareceu: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  nao_fechou: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  fechou: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  convertida: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  recusada: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelada: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  expirada: "border-zinc-400/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export const CANAIS = ["agendamento", "embaixador", "link", "qr", "parceiro"] as const;
export type Canal = (typeof CANAIS)[number];

export const CANAL_LABEL: Record<Canal, string> = {
  agendamento: "Na recepção / agendamento",
  embaixador: "O Embaixador cadastrou o amigo",
  link: "Link pessoal",
  qr: "QR Code na unidade",
  parceiro: "Parceiro",
};

/** Canais que a recepção escolhe à mão (link e QR chegam sozinhos na IND3). */
export const CANAIS_DA_RECEPCAO: readonly Canal[] = ["agendamento", "embaixador"];

/**
 * O que cada botão de avanço precisa antes de chamar o banco:
 *   simples      só confirmar
 *   motivo       motivo escrito (o banco recusa sem)
 *   agendamento  escolher a AVALIAÇÃO na agenda do indicado
 *   venda        escolher a venda fechada
 */
export type TipoDeAcao = "simples" | "motivo" | "agendamento" | "venda";

export function tipoDaAcao(para: IndicacaoStatus): TipoDeAcao {
  if (para === "agendada") return "agendamento";
  if (para === "fechou") return "venda";
  if (EXIGE_MOTIVO.includes(para)) return "motivo";
  return "simples";
}

export const ROTULO_DA_ACAO: Record<IndicacaoStatus, string> = {
  registrada: "Registrar",
  validada: "Validar",
  agendada: "Ligar à avaliação",
  compareceu: "Compareceu",
  faltou: "Faltou",
  fechou: "Fechou",
  nao_fechou: "Não fechou",
  convertida: "Converter",
  recusada: "Recusar",
  cancelada: "Cancelar e estornar",
  expirada: "Expirar",
};

/** Só o gestor cancela (o banco também confere). */
export const SO_GESTOR: readonly IndicacaoStatus[] = ["cancelada"];
