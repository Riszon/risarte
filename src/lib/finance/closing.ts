// FIN7.4 — FECHAMENTO DE COMPETÊNCIA.
//
// Depois que alguém conferiu janeiro e disse "janeiro está fechado", o resultado
// de janeiro não pode mudar sozinho na semana seguinte.
//
// A conferência antes de fechar NÃO bloqueia: ela lista o que ficou pendente e
// o botão passa a dizer "fechar mesmo assim". Bloquear faria o mês nunca fechar
// — que dá no mesmo que não ter trava.

export type ChecklistSeverity = "alta" | "media";

export type ChecklistItem = {
  key: string;
  label: string;
  items: number;
  amountCents: number;
  severity: ChecklistSeverity;
};

export type MonthStatus = {
  month: number;
  status: "open" | "closed";
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  entries: number;
};

export const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function monthName(month: number): string {
  return MONTH_NAMES[Math.min(12, Math.max(1, month)) - 1];
}

/** Só o que deixa o RESULTADO errado se o mês fechar assim. */
export function highSeverity(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => i.severity === "alta");
}

export type CloseBlock =
  | { can: true }
  | { can: false; reason: "nao_terminou" | "mes_anterior_aberto" | "ja_fechado"; detail?: string };

/**
 * O que IMPEDE de fechar — e é curto de propósito. São duas regras, e nenhuma
 * delas é "tem pendência":
 *
 *  • Mês que ainda não terminou não fecha: sempre entraria lançamento depois.
 *  • Fora de ordem não fecha: se fevereiro está aberto e tem movimento, março
 *    fechado não significa nada.
 */
export function closeBlock(input: {
  year: number;
  month: number;
  /** Situação de todos os meses do ano, do banco. */
  months: MonthStatus[];
  /** "YYYY-MM-DD" de hoje. */
  today: string;
}): CloseBlock {
  const { year, month, months, today } = input;

  const target = months.find((m) => m.month === month);
  if (target?.status === "closed") {
    return { can: false, reason: "ja_fechado" };
  }

  // Último dia do mês alvo.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  if (end >= today) {
    return { can: false, reason: "nao_terminou" };
  }

  const earlier = months.find(
    (m) => m.month < month && m.status === "open" && m.entries > 0
  );
  if (earlier) {
    return {
      can: false,
      reason: "mes_anterior_aberto",
      detail: monthName(earlier.month),
    };
  }

  return { can: true };
}

/** Mensagem pt-BR para o que impede o fechamento. */
export function closeBlockMessage(block: CloseBlock): string | null {
  if (block.can) return null;
  if (block.reason === "ja_fechado") return "Este mês já está fechado.";
  if (block.reason === "nao_terminou") {
    return "O mês ainda não terminou — sempre entraria lançamento depois.";
  }
  return `${block.detail} ainda está aberto e tem movimento. Feche os meses em ordem, senão "fechado" não significa nada.`;
}
