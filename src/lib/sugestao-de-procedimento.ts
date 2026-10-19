// A SUGESTÃO DE PROCEDIMENTO (relatos OC-00067/OC-00068, 19/10/2026).
//
// O Dentista Planner não cria procedimento nem item livre no orçamento: quando
// o catálogo da rede não tem o que o caso pede, ele SUGERE, e o Admin Master
// pede mais informações, recusa ou aprova (aprovar cria o procedimento). O
// banco confere tudo de novo (`suggest_procedure` e companhia, 0306); isto é
// a mesma régua na tela, para a pessoa saber o que falta antes de enviar.
//
// Puro e testado.

import { METHODOLOGY_PILLARS, type MethodologyPillar } from "@/lib/journey";

export type SituacaoDaSugestao = "enviada" | "precisa_info" | "aprovada" | "recusada";

export const ROTULO_DA_SUGESTAO: Record<SituacaoDaSugestao, string> = {
  enviada: "Aguardando a rede",
  precisa_info: "A rede pediu informações",
  aprovada: "Aprovada — no catálogo",
  recusada: "Recusada",
};

export type CamposDaSugestao = {
  name: string;
  specialty: string;
  pillar: string;
  sessions: string;
  totalMinutes: string;
  justification: string;
};

export type SugestaoValida = {
  name: string;
  specialty: string | null;
  pillar: MethodologyPillar | null;
  sessions: number;
  totalMinutes: number | null;
  justification: string;
};

/** A mesma régua do banco: nome ≥ 3, justificativa ≥ 10, 1 a 50 sessões. */
export function validarSugestao(c: CamposDaSugestao): { erro: string } | { valores: SugestaoValida } {
  const name = c.name.trim();
  if (name.length < 3) return { erro: "Informe o nome do procedimento." };
  const sessions = Number(c.sessions);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 50) {
    return { erro: "Quantidade de sessões: de 1 a 50." };
  }
  let totalMinutes: number | null = null;
  if (c.totalMinutes.trim()) {
    const n = Number(c.totalMinutes.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return { erro: "Tempo total inválido (minutos, ex.: 120)." };
    totalMinutes = Math.round(n);
  }
  const justification = c.justification.trim();
  if (justification.length < 10) {
    return { erro: "Conte por que incluir este procedimento (pelo menos uma frase)." };
  }
  const pillar = METHODOLOGY_PILLARS.includes(c.pillar as MethodologyPillar)
    ? (c.pillar as MethodologyPillar)
    : null;
  return {
    valores: { name, specialty: c.specialty.trim() || null, pillar, sessions, totalMinutes, justification },
  };
}

/** Os recados do banco, em português. Desconhecido → nulo (nunca chuta). */
export function mensagemDaSugestao(erro: string): string | null {
  const mapa: [string, string][] = [
    ["PROCEDURE_EXISTS", "Esse procedimento já está no catálogo — escolha-o na lista."],
    ["NAME_REQUIRED", "Informe o nome do procedimento."],
    ["JUSTIFICATION_REQUIRED", "Conte por que incluir este procedimento."],
    ["INVALID_SESSIONS", "Quantidade de sessões: de 1 a 50."],
    ["INVALID_MINUTES", "Tempo total inválido."],
    ["QUESTION_REQUIRED", "Escreva a pergunta."],
    ["REASON_REQUIRED", "Escreva o motivo."],
    ["ANSWER_REQUIRED", "Escreva a resposta."],
    ["NOT_WAITING_INFO", "Esta sugestão não está esperando resposta."],
    ["NOT_OPEN", "Esta sugestão já foi decidida."],
    ["SUGGESTION_NOT_FOUND", "Sugestão não encontrada."],
    ["NOT_ALLOWED", "Sua função não permite esta ação."],
  ];
  for (const [codigo, texto] of mapa) if (erro.includes(codigo)) return texto;
  return null;
}
