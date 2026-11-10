// Os papéis do procedimento para a assistente virtual (0369 — Rita, 0A.5).
// O banco tem o mesmo conjunto (`procedures_rita_role_check`); a régua
// `rita-procedimento.test.ts` compara os dois.

export const PAPEIS_DA_RITA = ["evaluation_new", "evaluation_returning", "urgency"] as const;
export type PapelDaRita = (typeof PAPEIS_DA_RITA)[number];

export const ROTULO_DO_PAPEL: Record<PapelDaRita, string> = {
  evaluation_new: "Avaliação de quem é novo",
  evaluation_returning: "Consulta de quem já é cliente",
  urgency: "Urgência (a assistente reconhece e passa para a equipe)",
};

export type RitaDoProcedimento = {
  canOffer: boolean;
  role: PapelDaRita | null;
  patientName: string | null;
};

/** Frase curta para o cartão do procedimento. */
export function resumoDaRita(r: RitaDoProcedimento): string {
  const partes: string[] = [];
  if (r.role) partes.push(ROTULO_DO_PAPEL[r.role].split(" (")[0]);
  partes.push(r.canOffer ? "a assistente pode oferecer" : "fora do rol da assistente");
  if (r.patientName) partes.push(`“${r.patientName}”`);
  return partes.join(" · ");
}

/**
 * AP132 (0383, decisão do dono em 10/11/2026) — URGÊNCIA NUNCA ENTRA NO ROL.
 *
 * A assistente RECONHECE a urgência e passa para a equipe (decisão 38); ela
 * não oferece nem agenda. A tela deixava marcar "pode oferecer" num
 * procedimento de urgência, e `rita.catalog` passava a listá-lo. Agora a tela
 * esconde a caixa, a ação recusa e o banco tem a trava
 * (`procedures_rita_urgency_not_offered`).
 */
export function podeEntrarNoRol(role: PapelDaRita | null): boolean {
  return role !== "urgency";
}

export const RECUSA_DA_URGENCIA_NO_ROL =
  "Urgência não entra no rol da assistente virtual: ela reconhece a urgência e passa para a equipe.";
