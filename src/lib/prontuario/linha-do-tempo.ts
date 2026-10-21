// OD6 (J2) — a LINHA DO TEMPO CLÍNICA: o que já existe espalhado (avaliação,
// diagnóstico, plano, venda, sessão, evolução, adendo, documento,
// consentimento, anamnese, prontuário gerado), numa lista só. Puro.

import { isoDateIn } from "@/lib/dates";

export type TipoDeEvento =
  | "consentimento"
  | "anamnese"
  | "avaliacao"
  | "diagnostico"
  | "achado"
  | "plano"
  | "sessao"
  | "evolucao"
  | "adendo"
  | "documento"
  | "prontuario";

export const ROTULO_DO_TIPO: Record<TipoDeEvento, string> = {
  consentimento: "Consentimento",
  anamnese: "Anamnese",
  avaliacao: "Avaliação",
  diagnostico: "Diagnóstico",
  achado: "Odontograma",
  plano: "Plano",
  sessao: "Sessão",
  evolucao: "Evolução",
  adendo: "Adendo",
  documento: "Documento",
  prontuario: "Prontuário",
};

export type EventoClinico = {
  /** Instante (ISO). */
  quando: string;
  tipo: TipoDeEvento;
  titulo: string;
  detalhe?: string | null;
  quem?: string | null;
};

/** Mais novo primeiro; no mesmo instante, a ordem em que chegaram. */
export function ordenarLinhaDoTempo(eventos: EventoClinico[]): EventoClinico[] {
  return eventos
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !Number.isNaN(new Date(e.quando).getTime()))
    .sort((a, b) => new Date(b.e.quando).getTime() - new Date(a.e.quando).getTime() || a.i - b.i)
    .map(({ e }) => e);
}

/** Os eventos por dia do BRASIL ("AAAA-MM-DD"), mais novo primeiro. */
export function porDia(eventos: EventoClinico[]): { dia: string; eventos: EventoClinico[] }[] {
  const dias: { dia: string; eventos: EventoClinico[] }[] = [];
  for (const e of ordenarLinhaDoTempo(eventos)) {
    const dia = isoDateIn(new Date(e.quando));
    const ultimo = dias.at(-1);
    if (ultimo?.dia === dia) ultimo.eventos.push(e);
    else dias.push({ dia, eventos: [e] });
  }
  return dias;
}

/** O link do prontuário completo vale por 24 horas a partir da geração. */
export const VALIDADE_DO_PRONTUARIO_HORAS = 24;
export function prontuarioVencido(criadoEm: string, agora: Date = new Date()): boolean {
  return agora.getTime() - new Date(criadoEm).getTime() > VALIDADE_DO_PRONTUARIO_HORAS * 3_600_000;
}

/** Os motivos do prontuário completo (J3) — os mesmos códigos da 0315. */
export const MOTIVOS_DO_PRONTUARIO = {
  pedido_do_paciente: "Pedido do paciente",
  transferencia: "Transferência do paciente",
  auditoria: "Auditoria",
  ordem_judicial: "Ordem judicial",
  outro: "Outro",
} as const;
export type MotivoDoProntuario = keyof typeof MOTIVOS_DO_PRONTUARIO;
