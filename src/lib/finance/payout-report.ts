// Repasse dos dentistas, Etapa 2 (0390) — o RELATÓRIO DE REPASSE.
//
// A regra mora no banco (um procedimento em um relatório por vez, exclusão
// com motivo, quem pode). Aqui ficam os tipos, os rótulos e as frases dos
// erros — o que a pessoa lê.

import { formatIsoDateBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";

export type ReportStatus =
  | "rascunho"
  | "com_gerente"
  | "com_dentista"
  | "em_contestacao"
  | "em_desempate"
  | "aprovado"
  | "cancelado";
export type ExclusionKind = "adiar" | "nao_pagar";

export const REPORT_STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  com_gerente: "Com o aprovador",
  com_dentista: "Com o dentista",
  em_contestacao: "Em contestação",
  em_desempate: "Com o Financeiro (decisão)",
  aprovado: "Aprovado — liberado para pagar",
  cancelado: "Cancelado",
};

/** A mesma situação, dita para o dentista (sem o vocabulário interno). */
export const MY_STATUS_LABEL: Record<string, string> = {
  com_dentista: "Esperando a sua resposta",
  em_contestacao: "Sua contestação está em análise",
  em_desempate: "Em decisão do Financeiro",
  aprovado: "Aprovado",
};

/** Quem está no lugar do aprovador (0391, decisão 4 do dono). */
export const APPROVER_LABEL: Record<string, string> = {
  gerente: "Gerente da unidade",
  coordenador: "Coordenador clínico (unidade sem Gerente)",
  financeiro: "Financeiro da Franqueadora (relatório do próprio aprovador)",
};

export type ContestKind = "valor" | "nao_fui_eu" | "outro";
export const CONTEST_KINDS: ContestKind[] = ["valor", "nao_fui_eu", "outro"];
export const CONTEST_LABEL: Record<ContestKind, string> = {
  valor: "Valor diferente do combinado",
  nao_fui_eu: "Não fui eu que fiz",
  outro: "Outro motivo",
};

export type ReviewState = "pendente" | "aprovado" | "contestado" | "no_financeiro";
export const REVIEW_LABEL: Record<ReviewState, string> = {
  pendente: "Esperando o dentista",
  aprovado: "Liberado para pagar",
  contestado: "Contestado — com o aprovador",
  no_financeiro: "Em decisão do Financeiro",
};
/** As mesmas, ditas para o dentista. */
export const MY_REVIEW_LABEL: Record<ReviewState, string> = {
  pendente: "Esperando a sua resposta",
  aprovado: "Aprovado",
  contestado: "Contestado — em análise",
  no_financeiro: "Em decisão do Financeiro",
};

export type ManagerAction = "manter" | "excluir" | "financeiro";
export type FinanceAction = "manter" | "corrigir" | "excluir";
export const FINANCE_ACTION_LABEL: Record<FinanceAction, string> = {
  manter: "Financeiro manteve o valor",
  corrigir: "Financeiro corrigiu o valor",
  excluir: "Financeiro excluiu",
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
  approverKind: string | null;
  sentAt: string | null;
  sentByName: string | null;
  managerAt: string | null;
  managerByName: string | null;
  dentistDueOn: string | null;
  dentistRespondedAt: string | null;
  approvedAt: string | null;
  releasedCents: number;
  contestedCount: number;
  financeCount: number;
  missingNote: string | null;
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
  approver_kind?: string | null;
  sent_at?: string | null;
  sent_by_name?: string | null;
  manager_at?: string | null;
  manager_by_name?: string | null;
  dentist_due_on?: string | null;
  dentist_responded_at?: string | null;
  approved_at?: string | null;
  released_cents?: number | string | null;
  contested_count?: number | null;
  finance_count?: number | null;
  missing_note?: string | null;
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
    approverKind: r.approver_kind ?? null,
    sentAt: r.sent_at ?? null,
    sentByName: r.sent_by_name ?? null,
    managerAt: r.manager_at ?? null,
    managerByName: r.manager_by_name ?? null,
    dentistDueOn: r.dentist_due_on ?? null,
    dentistRespondedAt: r.dentist_responded_at ?? null,
    approvedAt: r.approved_at ?? null,
    releasedCents: Number(r.released_cents ?? 0),
    contestedCount: Number(r.contested_count ?? 0),
    financeCount: Number(r.finance_count ?? 0),
    missingNote: r.missing_note ?? null,
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
  reviewState: ReviewState | null;
  released: boolean;
  contestKind: ContestKind | null;
  contestText: string | null;
  contestRound: number;
  managerResponse: string | null;
  financeAction: FinanceAction | null;
  financeReason: string | null;
  originalAmountCents: number | null;
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
  review_state?: string | null;
  released?: boolean | null;
  contest_kind?: string | null;
  contest_text?: string | null;
  contest_round?: number | null;
  manager_response?: string | null;
  finance_action?: string | null;
  finance_reason?: string | null;
  original_amount_cents?: number | string | null;
};

const REVIEW_STATES: ReviewState[] = ["pendente", "aprovado", "contestado", "no_financeiro"];
const FINANCE_ACTIONS: FinanceAction[] = ["manter", "corrigir", "excluir"];

/** A conversa de uma linha (contestação, resposta, decisão), lida do banco. */
export function reviewFromDb(r: {
  review_state?: string | null;
  released?: boolean | null;
  contest_kind?: string | null;
  contest_text?: string | null;
  contest_round?: number | null;
  manager_response?: string | null;
  finance_action?: string | null;
  finance_reason?: string | null;
  original_amount_cents?: number | string | null;
}) {
  return {
    reviewState: REVIEW_STATES.includes(r.review_state as ReviewState)
      ? (r.review_state as ReviewState)
      : null,
    released: Boolean(r.released),
    contestKind: CONTEST_KINDS.includes(r.contest_kind as ContestKind)
      ? (r.contest_kind as ContestKind)
      : null,
    contestText: r.contest_text ?? null,
    contestRound: Number(r.contest_round ?? 0),
    managerResponse: r.manager_response ?? null,
    financeAction: FINANCE_ACTIONS.includes(r.finance_action as FinanceAction)
      ? (r.finance_action as FinanceAction)
      : null,
    financeReason: r.finance_reason ?? null,
    originalAmountCents:
      r.original_amount_cents === null || r.original_amount_cents === undefined
        ? null
        : Number(r.original_amount_cents),
  };
}

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
    ...reviewFromDb(r),
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
  enviado_para_aprovacao: "Enviado para aprovação",
  devolvido_ao_financeiro: "Devolvido ao Financeiro",
  enviado_ao_dentista: "Aprovado e enviado ao dentista",
  dentista_respondeu: "O dentista respondeu",
  contestado: "Procedimento contestado pelo dentista",
  contestado_de_novo: "Procedimento contestado de novo (vai ao Financeiro)",
  faltando_procedimento: "O dentista avisou que falta procedimento",
  resposta_mantem: "Aprovador manteve e respondeu ao dentista",
  pedido_ao_financeiro: "Aprovador pediu a decisão do Financeiro",
  financeiro_manteve: "Financeiro manteve o valor",
  financeiro_corrigiu: "Financeiro corrigiu o valor",
  em_contestacao: "Relatório em contestação",
  em_desempate: "Relatório com o Financeiro para decisão",
  voltou_ao_dentista: "Voltou ao dentista",
  aprovado: "Relatório aprovado — liberado para pagar",
  prazo_vencido: "Prazo do dentista vencido",
  conta_gerada: "Conta a pagar gerada",
  conta_cancelada: "Conta a pagar cancelada (os procedimentos voltaram para liberado)",
  pago: "Repasse pago",
  pagamento_estornado: "Pagamento estornado",
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

/** O que o dentista vê de um relatório dele (0391). */
export type MyReport = {
  id: string;
  code: string;
  clinicName: string;
  periodMonth: string;
  levelName: string | null;
  status: string;
  totalCents: number;
  itemCount: number;
  releasedCents: number;
  pendingCount: number;
  dentistDueOn: string | null;
  managerAt: string | null;
  approvedAt: string | null;
};

export type MyReportDb = {
  id: string;
  code: string;
  clinic_name: string;
  period_month: string;
  level_name: string | null;
  status: string;
  total_cents: number | string;
  item_count: number;
  released_cents: number | string;
  pending_count: number;
  dentist_due_on: string | null;
  manager_at: string | null;
  approved_at: string | null;
};

export function myReportFromDb(r: MyReportDb): MyReport {
  return {
    id: r.id,
    code: r.code,
    clinicName: r.clinic_name,
    periodMonth: r.period_month,
    levelName: r.level_name,
    status: r.status,
    totalCents: Number(r.total_cents ?? 0),
    itemCount: Number(r.item_count ?? 0),
    releasedCents: Number(r.released_cents ?? 0),
    pendingCount: Number(r.pending_count ?? 0),
    dentistDueOn: r.dentist_due_on,
    managerAt: r.manager_at,
    approvedAt: r.approved_at,
  };
}

export type MyItem = ReturnType<typeof reviewFromDb> & {
  itemId: string;
  finishedOn: string;
  procedureName: string;
  clientId: string | null;
  clientName: string | null;
  amountCents: number;
};

export type MyItemDb = Parameters<typeof reviewFromDb>[0] & {
  item_id: string;
  finished_on: string;
  procedure_name: string | null;
  client_id: string | null;
  client_name: string | null;
  amount_cents: number | string;
};

export function myItemFromDb(r: MyItemDb): MyItem {
  return {
    itemId: r.item_id,
    finishedOn: r.finished_on,
    procedureName: r.procedure_name ?? "Procedimento",
    clientId: r.client_id,
    clientName: r.client_name,
    amountCents: Number(r.amount_cents ?? 0),
    ...reviewFromDb(r),
  };
}

/** Uma contestação do dentista, como vai ao banco. */
export type ContestInput = { itemId: string; kind: ContestKind; text: string };

/**
 * Confere a resposta do dentista antes de ir ao banco: cada contestação com
 * motivo da lista e texto, e o aviso de "faltando" (quando vem) com texto.
 */
export function dentistResponseError(
  contests: ContestInput[],
  missing: string
): string | null {
  for (const c of contests) {
    if (!CONTEST_KINDS.includes(c.kind)) return "Escolha o motivo da contestação.";
    if (c.text.trim().length < MIN_REASON) {
      return `Explique cada contestação (pelo menos ${MIN_REASON} letras).`;
    }
  }
  const m = missing.trim();
  if (m.length > 0 && m.length < MIN_REASON) {
    return `Descreva o procedimento que está faltando (pelo menos ${MIN_REASON} letras).`;
  }
  return null;
}

/** O valor novo de uma correção do Financeiro: maior que zero e diferente. */
export function correctionError(
  newCents: number | null,
  currentCents: number
): string | null {
  if (newCents === null || !Number.isFinite(newCents) || newCents <= 0) {
    return "Informe o valor corrigido.";
  }
  if (newCents === currentCents) return "O valor corrigido é igual ao atual.";
  return null;
}

/** O que falta acontecer neste relatório, numa frase. */
export function nextStepText(r: {
  status: string;
  approverKind: string | null;
  dentistDueOn: string | null;
}): string {
  switch (r.status) {
    case "rascunho":
      return "Confira e envie para aprovação.";
    case "com_gerente":
      return `Esperando a conferência: ${APPROVER_LABEL[r.approverKind ?? ""] ?? "aprovador"}.`;
    case "com_dentista":
      return r.dentistDueOn
        ? `Esperando a resposta do dentista até ${r.dentistDueOn.slice(8, 10)}/${r.dentistDueOn.slice(5, 7)}/${r.dentistDueOn.slice(0, 4)}.`
        : "Esperando a resposta do dentista.";
    case "em_contestacao":
      return "O dentista contestou: o aprovador precisa responder.";
    case "em_desempate":
      return "Esperando a decisão do Financeiro da Franqueadora.";
    case "aprovado":
      return "Aprovado pelo aprovador e pelo dentista. Liberado para pagar.";
    case "cancelado":
      return "Cancelado.";
    default:
      return "";
  }
}

/** Os erros do banco, em português. */
export function reportErrorText(message: string): string {
  const m = message;
  if (m.includes("WRONG_STAGE")) {
    return "Este relatório não está mais nesta etapa. Atualize a tela.";
  }
  if (m.includes("EMPTY_REPORT")) {
    return "O relatório não tem nenhum procedimento incluído.";
  }
  if (m.includes("INVALID_ITEM")) {
    return "Um dos procedimentos não pode mais ser contestado. Atualize a tela.";
  }
  if (m.includes("INVALID_AMOUNT")) {
    return "Informe um valor corrigido, maior que zero e diferente do atual.";
  }
  if (m.includes("NOT_ALLOWED")) {
    return "Você não pode fazer isto neste relatório.";
  }
  if (m.includes("REASON_REQUIRED")) {
    return `Escreva o motivo (pelo menos ${MIN_REASON} letras).`;
  }
  if (m.includes("REPORT_NOT_DRAFT")) {
    return "Este relatório já saiu desta etapa e não pode mais ser ajustado.";
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

// -----------------------------------------------------------------------------
// Etapa 4 (0393) — O PAGAMENTO PELO RELATÓRIO
//
// O que está liberado vira conta a pagar por um botão do Financeiro. "Pago"
// não é uma marca copiada: o banco lê da própria conta a pagar.
// -----------------------------------------------------------------------------
export type PaymentState = "programado" | "parcial" | "pago" | "cancelado";

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  programado: "Pagamento programado",
  parcial: "Pago em parte",
  pago: "Pago",
  cancelado: "Conta cancelada",
};

/** Uma conta a pagar gerada de um relatório de repasse. */
export type ReportPayment = {
  paymentId: string;
  payableId: string;
  amountCents: number;
  itemCount: number;
  /** AAAA-MM-DD */
  accrualDate: string;
  dueDate: string;
  state: PaymentState;
  paidCents: number;
  paidOn: string | null;
  createdAt: string;
  createdByName: string | null;
  cancelReason: string | null;
  itemIds: string[];
};

export type ReportPaymentDb = {
  payment_id: string;
  payable_id: string;
  amount_cents: number | string;
  item_count: number;
  accrual_date: string;
  due_date: string;
  state: string;
  paid_cents: number | string | null;
  paid_on: string | null;
  created_at: string;
  created_by_name: string | null;
  cancel_reason: string | null;
  item_ids: string[] | null;
};

const PAYMENT_STATES: PaymentState[] = ["programado", "parcial", "pago", "cancelado"];

export function reportPaymentFromDb(r: ReportPaymentDb): ReportPayment {
  return {
    paymentId: r.payment_id,
    payableId: r.payable_id,
    amountCents: Number(r.amount_cents ?? 0),
    itemCount: Number(r.item_count ?? 0),
    accrualDate: r.accrual_date,
    dueDate: r.due_date,
    state: PAYMENT_STATES.includes(r.state as PaymentState)
      ? (r.state as PaymentState)
      : "programado",
    paidCents: Number(r.paid_cents ?? 0),
    paidOn: r.paid_on,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
    cancelReason: r.cancel_reason,
    itemIds: r.item_ids ?? [],
  };
}

/** O resumo do pagamento de um relatório (as listas). */
export type ReportBilling = {
  reportId: string;
  /** Liberado e ainda sem conta a pagar. */
  toBillCents: number;
  toBillCount: number;
  /** Em conta a pagar ainda não paga. */
  scheduledCents: number;
  paidCents: number;
  nextDue: string | null;
  lastPaidOn: string | null;
};

export type ReportBillingDb = {
  report_id: string;
  to_bill_cents: number | string | null;
  to_bill_count: number | null;
  scheduled_cents: number | string | null;
  paid_cents: number | string | null;
  next_due: string | null;
  last_paid_on: string | null;
};

export function billingFromDb(r: ReportBillingDb): ReportBilling {
  return {
    reportId: r.report_id,
    toBillCents: Number(r.to_bill_cents ?? 0),
    toBillCount: Number(r.to_bill_count ?? 0),
    scheduledCents: Number(r.scheduled_cents ?? 0),
    paidCents: Number(r.paid_cents ?? 0),
    nextDue: r.next_due,
    lastPaidOn: r.last_paid_on,
  };
}

const dataBr = formatIsoDateBr;
const reais = formatBRL;

/** Em qual conta (que ainda vale) cada linha do relatório está. */
export function paymentByItem(payments: ReportPayment[]): Map<string, ReportPayment> {
  const mapa = new Map<string, ReportPayment>();
  for (const p of payments) {
    if (p.state === "cancelado") continue;
    for (const id of p.itemIds) mapa.set(id, p);
  }
  return mapa;
}

/**
 * O pagamento de UMA linha, numa frase. `null` = a linha ainda não está
 * liberada (a conversa dela é que aparece).
 */
export function itemPaymentText(
  released: boolean,
  payment: ReportPayment | undefined
): string | null {
  if (!released) return null;
  if (!payment) return "Liberado — ainda sem conta a pagar";
  if (payment.state === "pago") {
    return payment.paidOn ? `Pago em ${dataBr(payment.paidOn)}` : "Pago";
  }
  if (payment.state === "parcial") {
    return `Conta paga em parte — vencimento ${dataBr(payment.dueDate)}`;
  }
  return `Pagamento programado para ${dataBr(payment.dueDate)}`;
}

/** O pagamento do relatório inteiro, numa frase curta (as listas). */
export function billingText(b: ReportBilling | undefined): string | null {
  if (!b) return null;
  const partes: string[] = [];
  if (b.paidCents > 0) {
    partes.push(
      `${reais(b.paidCents)} pago${b.lastPaidOn ? ` em ${dataBr(b.lastPaidOn)}` : ""}`
    );
  }
  if (b.scheduledCents > 0) {
    partes.push(
      `${reais(b.scheduledCents)} com pagamento programado${b.nextDue ? ` para ${dataBr(b.nextDue)}` : ""}`
    );
  }
  if (b.toBillCents > 0) {
    partes.push(`${reais(b.toBillCents)} liberado, sem conta a pagar`);
  }
  return partes.length ? partes.join(" · ") : null;
}

/** Soma do que o "gerar de todos" criaria agora. */
export function totalToBill(billing: ReportBilling[]): { reports: number; cents: number } {
  const prontos = billing.filter((b) => b.toBillCents > 0);
  return {
    reports: prontos.length,
    cents: prontos.reduce((s, b) => s + b.toBillCents, 0),
  };
}

/** Os erros do pagamento, em português (os demais caem em `reportErrorText`). */
export function billingErrorText(message: string): string {
  const m = message;
  if (m.includes("NOTHING_TO_BILL")) {
    return "Não há nada liberado esperando conta a pagar neste relatório.";
  }
  if (m.includes("ITEM_IN_PAYMENT")) {
    return "Este procedimento já está em uma conta a pagar e não pode mais mudar.";
  }
  if (m.includes("PERIOD_CLOSED")) {
    return "O mês está fechado na contabilidade. Fale com quem cuida do fechamento.";
  }
  if (m.includes("WRONG_STAGE")) {
    return "Este relatório ainda não foi aprovado pelo dentista.";
  }
  if (m.includes("NOT_ALLOWED")) {
    return "Só o Financeiro da Franqueadora gera a conta a pagar — e nunca a do próprio repasse.";
  }
  return reportErrorText(m);
}
