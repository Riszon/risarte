// Repasse dos dentistas, Etapa 2 (0390) — o RELATÓRIO DE REPASSE.
//
// A regra mora no banco (um procedimento em um relatório por vez, exclusão
// com motivo, quem pode). Aqui ficam os tipos, os rótulos e as frases dos
// erros — o que a pessoa lê.

export type ReportStatus = "rascunho" | "cancelado";
export type ExclusionKind = "adiar" | "nao_pagar";

export const REPORT_STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  cancelado: "Cancelado",
};

export const EXCLUSION_LABEL: Record<ExclusionKind, string> = {
  adiar: "Adiado para o próximo relatório",
  nao_pagar: "Não pagar",
};

export const EXCLUSION_HELP: Record<ExclusionKind, string> = {
  adiar: "Sai deste relatório e volta no próximo.",
  nao_pagar:
    "Fica fora de todos os relatórios, até o Financeiro reverter com motivo.",
};

/** Tamanho mínimo do motivo — o mesmo que o banco exige. */
export const MIN_REASON = 5;

export type Candidate = {
  providerId: string;
  providerName: string;
  levelName: string | null;
  readyCount: number;
  readyCents: number;
  zeroCount: number;
  draftId: string | null;
  draftCode: string | null;
};

export type CandidateDb = {
  provider_id: string;
  provider_name: string | null;
  level_name: string | null;
  ready_count: number;
  ready_cents: number | string;
  zero_count: number;
  draft_id: string | null;
  draft_code: string | null;
};

export function candidateFromDb(r: CandidateDb): Candidate {
  return {
    providerId: r.provider_id,
    providerName: r.provider_name ?? "—",
    levelName: r.level_name,
    readyCount: Number(r.ready_count ?? 0),
    readyCents: Number(r.ready_cents ?? 0),
    zeroCount: Number(r.zero_count ?? 0),
    draftId: r.draft_id,
    draftCode: r.draft_code,
  };
}

export type Report = {
  id: string;
  code: string;
  clinicId: string;
  clinicName: string;
  providerId: string;
  providerName: string;
  /** AAAA-MM-01 */
  periodMonth: string;
  levelName: string | null;
  status: string;
  totalCents: number;
  itemCount: number;
  excludedCount: number;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
};

export type ReportDb = {
  id: string;
  code: string;
  clinic_id: string;
  clinic_name: string;
  provider_id: string;
  provider_name: string | null;
  period_month: string;
  level_name: string | null;
  status: string;
  total_cents: number | string;
  item_count: number;
  excluded_count: number;
  created_at: string;
  created_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
};

export function reportFromDb(r: ReportDb): Report {
  return {
    id: r.id,
    code: r.code,
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    providerId: r.provider_id,
    providerName: r.provider_name ?? "—",
    periodMonth: r.period_month,
    levelName: r.level_name,
    status: r.status,
    totalCents: Number(r.total_cents ?? 0),
    itemCount: Number(r.item_count ?? 0),
    excludedCount: Number(r.excluded_count ?? 0),
    createdAt: r.created_at,
    createdByName: r.created_by_name,
    cancelledAt: r.cancelled_at,
    cancelledByName: r.cancelled_by_name,
    cancelReason: r.cancel_reason,
  };
}

export type ReportItem = {
  itemId: string;
  payoutId: string;
  /** AAAA-MM-DD */
  finishedOn: string;
  procedureName: string;
  clientId: string | null;
  clientName: string | null;
  sessionId: string | null;
  origin: "sessao" | "ortodontia";
  amountCents: number;
  status: "incluido" | "excluido";
  exclusionKind: ExclusionKind | null;
  exclusionReason: string | null;
  excludedByName: string | null;
  excludedAt: string | null;
};

export type ReportItemDb = {
  item_id: string;
  payout_id: string;
  finished_on: string;
  procedure_name: string | null;
  client_id: string | null;
  client_name: string | null;
  session_id: string | null;
  origin: string;
  amount_cents: number | string;
  status: string;
  exclusion_kind: string | null;
  exclusion_reason: string | null;
  excluded_by_name: string | null;
  excluded_at: string | null;
};

export function reportItemFromDb(r: ReportItemDb): ReportItem {
  return {
    itemId: r.item_id,
    payoutId: r.payout_id,
    finishedOn: r.finished_on,
    procedureName: r.procedure_name ?? "Procedimento",
    clientId: r.client_id,
    clientName: r.client_name,
    sessionId: r.session_id,
    origin: r.origin === "ortodontia" ? "ortodontia" : "sessao",
    amountCents: Number(r.amount_cents ?? 0),
    status: r.status === "excluido" ? "excluido" : "incluido",
    exclusionKind:
      r.exclusion_kind === "adiar" || r.exclusion_kind === "nao_pagar"
        ? r.exclusion_kind
        : null,
    exclusionReason: r.exclusion_reason,
    excludedByName: r.excluded_by_name,
    excludedAt: r.excluded_at,
  };
}

/** A linha do tempo, na frase que a pessoa lê. */
export const EVENT_LABEL: Record<string, string> = {
  gerado: "Relatório gerado",
  itens_adicionados: "Procedimentos acrescentados",
  item_adiado: "Procedimento adiado para o próximo relatório",
  item_nao_pagar: "Procedimento marcado como não pagar",
  item_devolvido: "Procedimento devolvido ao relatório",
  cancelado: "Relatório cancelado",
  nao_pagar_revertido: "Não pagar revertido",
};

export function eventLabel(action: string): string {
  return EVENT_LABEL[action] ?? action;
}

/** O motivo é obrigatório e tem tamanho mínimo — conferido antes de ir ao banco. */
export function reasonError(reason: string): string | null {
  return reason.trim().length < MIN_REASON
    ? `Escreva o motivo (pelo menos ${MIN_REASON} letras).`
    : null;
}

/** "AAAA-MM" válido e não futuro (o banco também recusa mês futuro). */
export function monthError(month: string, today: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "Escolha o mês do relatório.";
  if (month > today.slice(0, 7)) return "O mês do relatório não pode ser futuro.";
  return null;
}

/** Soma do que a geração de todos criaria agora. */
export function totalReady(cands: Candidate[]): {
  dentists: number;
  count: number;
  cents: number;
  zeros: number;
} {
  const prontos = cands.filter((c) => c.readyCount > 0);
  return {
    dentists: prontos.length,
    count: prontos.reduce((s, c) => s + c.readyCount, 0),
    cents: prontos.reduce((s, c) => s + c.readyCents, 0),
    zeros: cands.reduce((s, c) => s + c.zeroCount, 0),
  };
}

/** Os erros do banco, em português. */
export function reportErrorText(message: string): string {
  const m = message;
  if (m.includes("NOT_ALLOWED")) {
    return "Só o Financeiro da Franqueadora monta o relatório de repasse.";
  }
  if (m.includes("REASON_REQUIRED")) {
    return `Escreva o motivo (pelo menos ${MIN_REASON} letras).`;
  }
  if (m.includes("REPORT_NOT_DRAFT")) {
    return "Este relatório não é mais rascunho e não pode ser ajustado.";
  }
  if (m.includes("ALREADY_EXCLUDED")) return "Este procedimento já foi excluído.";
  if (m.includes("NOT_EXCLUDED")) return "Este procedimento não está excluído.";
  if (m.includes("PAYOUT_IN_OTHER_REPORT")) {
    return "Este procedimento já entrou em outro relatório.";
  }
  if (m.includes("FUTURE_MONTH")) return "O mês do relatório não pode ser futuro.";
  if (m.includes("NOT_WITHHELD")) return 'Este procedimento não está em "não pagar".';
  if (m.includes("INVALID_KIND")) return "Escolha adiar ou não pagar.";
  if (m.includes("NOT_FOUND")) return "Registro não encontrado.";
  return "Não foi possível concluir. Tente de novo.";
}
