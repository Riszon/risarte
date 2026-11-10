// Repasse dos dentistas, Etapa 1 (0387) — as PENDÊNCIAS, com o motivo escrito.
//
// O banco (`payout_watchlist`) diz o tipo e o motivo; aqui mora só o texto que
// a pessoa lê. Antes a tela mostrava "R$ 0,00" e mais nada: quem testou o
// repasse no treino não tinha como saber se faltava o nível do dentista, o
// valor na tabela ou a última sessão do procedimento.

export type WatchKind =
  | "zerado"
  | "em_andamento"
  | "sem_procedimento"
  | "sem_profissional";
export type ZeroReason = "recalculavel" | "sem_nivel" | "sem_valor";

export type WatchRow = {
  kind: WatchKind;
  payoutId: string | null;
  sessionId: string | null;
  providerName: string | null;
  procedureName: string | null;
  /** AAAA-MM-DD */
  refDate: string | null;
  doneCount: number | null;
  totalCount: number | null;
  reason: ZeroReason | null;
  wouldPayCents: number | null;
};

/** O que o banco devolve (nomes das colunas de `payout_watchlist`). */
export type WatchDbRow = {
  kind: string;
  payout_id: string | null;
  session_id: string | null;
  provider_name: string | null;
  procedure_name: string | null;
  ref_date: string | null;
  done_count: number | null;
  total_count: number | null;
  reason: string | null;
  would_pay_cents: number | string | null;
};

const KINDS: WatchKind[] = [
  "zerado",
  "em_andamento",
  "sem_procedimento",
  "sem_profissional",
];
const REASONS: ZeroReason[] = ["recalculavel", "sem_nivel", "sem_valor"];

export function watchRowFromDb(r: WatchDbRow): WatchRow | null {
  if (!KINDS.includes(r.kind as WatchKind)) return null;
  return {
    kind: r.kind as WatchKind,
    payoutId: r.payout_id,
    sessionId: r.session_id,
    providerName: r.provider_name,
    procedureName: r.procedure_name,
    refDate: r.ref_date,
    doneCount: r.done_count,
    totalCount: r.total_count,
    reason: REASONS.includes(r.reason as ZeroReason)
      ? (r.reason as ZeroReason)
      : null,
    wouldPayCents: r.would_pay_cents === null ? null : Number(r.would_pay_cents),
  };
}

export const WATCH_TITLES: Record<WatchKind, string> = {
  zerado: "Apurados com R$ 0,00",
  em_andamento: "Em andamento (ainda não entram)",
  sem_procedimento: "Concluídos sem procedimento do catálogo",
  sem_profissional: "Concluídos sem profissional",
};

function brDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** O motivo, na frase que a pessoa lê. `brl` formata centavos. */
export function watchReasonText(
  row: WatchRow,
  brl: (cents: number) => string
): string {
  switch (row.kind) {
    case "zerado":
      if (row.reason === "recalculavel") {
        return `A tabela já tem valor para este procedimento. Recalcule para gravar ${brl(row.wouldPayCents ?? 0)}.`;
      }
      if (row.reason === "sem_nivel") {
        return "O dentista está sem nível de carreira nesta unidade. Defina o nível e recalcule.";
      }
      return `Não há valor de repasse para este procedimento, no nível do dentista, valendo em ${brDate(row.refDate)}. Cadastre o valor com início até essa data e recalcule — ou marque o procedimento como "sem repasse" no cadastro.`;
    case "em_andamento": {
      const falta = Math.max(0, (row.totalCount ?? 0) - (row.doneCount ?? 0));
      return `${row.doneCount ?? 0} de ${row.totalCount ?? 0} sessões concluídas. Entra no repasse quando ${falta === 1 ? "a última sessão terminar" : `as ${falta} sessões que faltam terminarem`}.`;
    }
    case "sem_procedimento":
      return "A sessão foi concluída, mas o item do plano não está ligado a um procedimento do catálogo. O sistema não sabe quanto pagar.";
    case "sem_profissional":
      return "A sessão foi concluída sem profissional. Não há a quem pagar.";
  }
}

export type WatchGroup = { kind: WatchKind; title: string; rows: WatchRow[] };

/** Agrupa na ordem em que a pessoa resolve: primeiro o que dá para consertar. */
export function groupWatchRows(rows: WatchRow[]): WatchGroup[] {
  const ordemDoMotivo: Record<string, number> = {
    recalculavel: 0,
    sem_nivel: 1,
    sem_valor: 2,
  };
  return KINDS.map((kind) => ({
    kind,
    title: WATCH_TITLES[kind],
    rows: rows
      .filter((r) => r.kind === kind)
      .sort(
        (a, b) =>
          (ordemDoMotivo[a.reason ?? ""] ?? 9) -
            (ordemDoMotivo[b.reason ?? ""] ?? 9) ||
          (a.refDate ?? "").localeCompare(b.refDate ?? "") ||
          (a.procedureName ?? "").localeCompare(b.procedureName ?? "")
      ),
  })).filter((g) => g.rows.length > 0);
}

/** Quantos zerados o botão "Recalcular todos" consertaria agora. */
export function countRecalculable(rows: WatchRow[]): number {
  return rows.filter((r) => r.kind === "zerado" && r.reason === "recalculavel")
    .length;
}

/** Os erros do banco, em português. */
export function recalculateErrorText(message: string): string {
  if (message.includes("NOT_ALLOWED")) {
    return "Sua função não permite recalcular o repasse.";
  }
  if (message.includes("PAYOUT_LOCKED")) {
    return "Este repasse já entrou em fechamento e não pode ser alterado.";
  }
  if (message.includes("PAYOUT_NOT_ZERO")) {
    return "Este repasse já tem valor. Valor apurado não é recalculado.";
  }
  if (message.includes("NOT_FOUND")) return "Repasse não encontrado.";
  return "Não foi possível recalcular.";
}
