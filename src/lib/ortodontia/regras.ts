// Ortodontia — as REGRAS PURAS do módulo (sem banco, sem tela).
//
// O que decide "no prazo × atrasado", "precisa de atenção", a previsão de
// término e as cláusulas do termo mora aqui, com teste. As telas só desenham;
// o banco espelha o que precisa (ver docs/ortodontia/ORTO-PLANO.md).

import {
  ORTHO_DEFAULTS,
  ORTHO_KIND_LABELS,
  ORTHO_RETAINER_KIND_LABELS,
  type OrthoChargeStatus,
  type OrthoKind,
  type OrthoMaintenanceStatus,
  type OrthoRetainerKind,
  type OrthoStatus,
} from "./constants";

// ---------------------------------------------------------------------------
// Datas (ISO `aaaa-mm-dd`, relógio de parede — nunca `new Date(texto)`)
// ---------------------------------------------------------------------------

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Dias inteiros entre duas datas ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Soma meses pelo calendário. Dia 31 em mês curto cai no último dia do mês
 * (a mesma regra do vencimento das cobranças da rede).
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return toIso(ny, nm, Math.min(d, last));
}

/** Primeiro dia do mês de uma data. */
export function monthStart(iso: string): string {
  const [y, m] = parts(iso);
  return toIso(y, m, 1);
}

// ---------------------------------------------------------------------------
// Cronograma
// ---------------------------------------------------------------------------

/**
 * A data prevista de término = início + meses previstos + a prorrogação das
 * faltas (decisão O3: cada falta prorroga um intervalo de manutenção — o
 * banco guarda `extension_days` = faltas × intervalo).
 */
export function plannedEndDate(startDate: string, plannedMonths: number, extensionDays = 0): string {
  return addDays(addMonths(startDate, Math.max(0, plannedMonths)), Math.max(0, extensionDays));
}

/** Quantos dias as faltas prorrogam o término (O3). */
export function extensionForMisses(missed: number, intervalDays: number): number {
  return Math.max(0, missed) * Math.max(0, intervalDays);
}

/**
 * As datas previstas das manutenções: do início até o término previsto, a cada
 * N dias. A primeira é a de instalação + intervalo (a instalação não é
 * manutenção). Teto de 120 para um cronograma mal digitado não virar mil linhas.
 */
export function maintenanceSchedule(
  startDate: string,
  endDate: string,
  intervalDays: number
): string[] {
  const step = Math.max(7, intervalDays || ORTHO_DEFAULTS.maintenanceIntervalDays);
  const out: string[] = [];
  let d = addDays(startDate, step);
  while (daysBetween(d, endDate) >= 0 && out.length < 120) {
    out.push(d);
    d = addDays(d, step);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Situação do caso
// ---------------------------------------------------------------------------

export type OrthoCaseLike = {
  status: OrthoStatus;
  start_date: string | null;
  /** Já inclui a prorrogação das faltas (o banco calcula). */
  planned_end_date: string | null;
  /** Em `contencao` e `finalizado`: a data em que o tratamento terminou (entrega das contenções). */
  finished_at: string | null;
  next_reevaluation_date?: string | null;
  extension_days?: number | null;
};

export type Timeliness =
  | "no_prazo"
  | "atrasado"
  | "finalizado_no_prazo"
  | "finalizado_atrasado"
  | "nao_se_aplica";

export const TIMELINESS_LABELS: Record<Timeliness, string> = {
  no_prazo: "No prazo",
  atrasado: "Atrasado",
  finalizado_no_prazo: "Finalizado no prazo",
  finalizado_atrasado: "Finalizado com atraso",
  nao_se_aplica: "—",
};

/**
 * No prazo × atrasado (decisão O3): em tratamento, passou da data prevista de
 * término (que já carrega as faltas) + tolerância = atrasado. Tratamento
 * finalizado (contenções entregues — `contencao` — ou alta) compara a data em
 * que terminou com a prevista + tolerância.
 */
export function caseTimeliness(
  c: OrthoCaseLike,
  today: string,
  toleranceDays: number = ORTHO_DEFAULTS.finishToleranceDays
): Timeliness {
  if (!c.planned_end_date) return "nao_se_aplica";
  const limit = addDays(c.planned_end_date, Math.max(0, toleranceDays));
  if (c.status === "em_tratamento") {
    return daysBetween(limit, today) > 0 ? "atrasado" : "no_prazo";
  }
  if ((c.status === "finalizado" || c.status === "contencao") && c.finished_at) {
    return daysBetween(limit, c.finished_at.slice(0, 10)) > 0
      ? "finalizado_atrasado"
      : "finalizado_no_prazo";
  }
  return "nao_se_aplica";
}

/** O tratamento terminou (contenções entregues ou alta)? */
export function isFinished(c: Pick<OrthoCaseLike, "status">): boolean {
  return c.status === "contencao" || c.status === "finalizado";
}

export type Attendance = {
  done: number;
  missed: number;
  /** % de comparecimento entre o que aconteceu (realizadas ÷ (realizadas + faltas)); nulo sem histórico. */
  ratePercent: number | null;
  /** Dias que as faltas prorrogaram o término (O3). */
  extensionDays: number;
};

/** A assiduidade do paciente: o que ela custou ao prazo e quanto ele compareceu. */
export function attendance(
  maintenances: { status: OrthoMaintenanceStatus }[],
  intervalDays: number = ORTHO_DEFAULTS.maintenanceIntervalDays
): Attendance {
  const done = maintenances.filter((m) => m.status === "realizada").length;
  const missed = maintenances.filter((m) => m.status === "faltou").length;
  const happened = done + missed;
  return {
    done,
    missed,
    ratePercent: happened > 0 ? Math.round((done / happened) * 100) : null,
    extensionDays: extensionForMisses(missed, intervalDays),
  };
}

/** Quantos % do prazo previsto já passaram (para a barra da ficha). */
export function progressPercent(c: OrthoCaseLike, today: string): number | null {
  if (!c.start_date || !c.planned_end_date) return null;
  const total = daysBetween(c.start_date, c.planned_end_date);
  if (total <= 0) return 100;
  const done = daysBetween(c.start_date, today);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

// ---------------------------------------------------------------------------
// Atenção (a lista da recepção)
// ---------------------------------------------------------------------------

export type MaintenanceLike = {
  status: OrthoMaintenanceStatus;
  planned_date: string | null;
  /** Data do agendamento ligado (ISO date), quando houver. */
  appointment_date?: string | null;
  done_at?: string | null;
};

export type ChargeLike = {
  status: OrthoChargeStatus;
  due_date: string;
};

export type AttentionReason =
  | "sem_agendamento"
  | "manutencao_vencida"
  | "faltou"
  | "reavaliacao_vencida"
  | "termino_atrasado"
  | "mensalidade_atrasada"
  | "pedido_clinico_aberto"
  | "aguardando_inicio"
  | "lote_terminando"
  | "lote_encerrado"
  | "suspenso";

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  sem_agendamento: "Sem próximo agendamento",
  manutencao_vencida: "Manutenção vencida",
  faltou: "Faltou na última manutenção",
  reavaliacao_vencida: "Reavaliação vencida",
  termino_atrasado: "Término atrasado",
  mensalidade_atrasada: "Mensalidade atrasada",
  pedido_clinico_aberto: "Pedido clínico em aberto",
  aguardando_inicio: "Aguardando início (agendar instalação)",
  lote_terminando: "Lote de mensalidades terminando (renovar ou encerrar?)",
  lote_encerrado: "Sem mensalidades assumidas (lote terminou)",
  suspenso: "Tratamento suspenso",
};

/**
 * R8 (0335): o lote de mensalidades que vale para o caso — o que a tela
 * precisa para dizer "terminando" ou "terminou sem decisão".
 */
export type BatchLike = {
  status: "ativo" | "encerrado";
  decision: "renovar" | "nao_renovar" | null;
  /** O vencimento da última mensalidade do lote (ISO). */
  last_due_date: string;
};

/** A quantos dias do fim do lote o aviso começa (o primeiro marco da rotina). */
export const BATCH_ALERT_FROM_DAYS = 60;

/**
 * R8: o que o lote ativo do caso pede. Nulo = nada. Só em tratamento; lote
 * com decisão "renovar" já virou outro; "não renovar" só avisa quando acabou.
 */
export function batchAttention(
  batch: BatchLike | null | undefined,
  today: string
): "lote_terminando" | "lote_encerrado" | null {
  if (!batch || batch.status !== "ativo") return null;
  const days = daysBetween(today, batch.last_due_date.slice(0, 10));
  if (batch.decision === "renovar") return null;
  if (days < 0) return "lote_encerrado";
  if (batch.decision === null && days <= BATCH_ALERT_FROM_DAYS) return "lote_terminando";
  return null;
}

/**
 * Q2: o valor SUGERIDO para o lote novo — o reajuste anual entra quando o
 * tratamento já passou de 12 meses desde o início (uma vez por renovação; a
 * tela mostra, quem gere decide).
 */
export function suggestedRenewalAmount(
  amountCents: number,
  startDate: string | null,
  today: string,
  annualAdjustmentPercent: number
): { amountCents: number; adjusted: boolean } {
  if (!startDate || !(annualAdjustmentPercent > 0)) return { amountCents, adjusted: false };
  const months = Math.floor(daysBetween(startDate.slice(0, 10), today) / 30.4375);
  if (months < 12) return { amountCents, adjusted: false };
  return { amountCents: Math.round(amountCents * (1 + annualAdjustmentPercent / 100)), adjusted: true };
}

/** R1/Q6: o desconto de pontualidade de uma cobrança paga até o vencimento. */
export function punctualityDiscount(
  amountCents: number,
  dueDate: string,
  paidOn: string,
  percent: number
): number {
  if (!(percent > 0) || daysBetween(dueDate.slice(0, 10), paidOn.slice(0, 10)) > 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * percent) / 100));
}

/** Em quantos dias uma manutenção prevista vira "vencida" (decisão O4). */
export const MAINTENANCE_GRACE_DAYS = 7;

/**
 * Por que este caso precisa de atenção hoje. Vazio = está em dia.
 * A ordem da lista é a ordem de urgência para a recepção.
 */
export function attentionReasons(input: {
  caso: OrthoCaseLike;
  maintenances: MaintenanceLike[];
  charges?: ChargeLike[];
  openClinicalRequests?: number;
  today: string;
  toleranceDays?: number;
  includeMoney?: boolean;
  /**
   * R4 (0334): há agendamento futuro de início/sessão de tratamento para o
   * paciente (qualquer profissional)? Sem ortodontista escolhido o cronograma
   * ainda não liga — mas o horário existe, e quem aguarda início com horário
   * marcado não precisa de atenção.
   */
  startScheduled?: boolean;
  /** R8 (0335): o lote de mensalidades ativo (só para quem vê dinheiro). */
  batch?: BatchLike | null;
}): AttentionReason[] {
  const { caso, maintenances, today } = input;
  const reasons: AttentionReason[] = [];
  // Q5: suspenso não pede agendamento nem cobra — pede uma decisão (retomar ou interromper).
  if (caso.status === "suspenso") return ["suspenso"];
  // Em tratamento pede agendamento e prazo; em acompanhamento (contenções
  // entregues) só o que foi previsto à mão e a reavaliação (o controle).
  const inTreatment = caso.status === "em_tratamento";
  const active = inTreatment || caso.status === "contencao";

  if (caso.status === "aguardando_inicio") {
    const scheduled =
      input.startScheduled === true ||
      maintenances.some(
        (m) => m.status === "agendada" && m.appointment_date && daysBetween(today, m.appointment_date) >= 0
      );
    if (!scheduled) reasons.push("aguardando_inicio");
  }

  if (active) {
    const hasFuture = maintenances.some(
      (m) =>
        m.status === "agendada" &&
        (!m.appointment_date || daysBetween(today, m.appointment_date) >= 0)
    );
    const sorted = [...maintenances]
      .filter((m) => m.status !== "cancelada")
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    const past = sorted.filter((m) => daysBetween(dateOf(m), today) >= 0);
    const last = past.at(-1);

    if (last?.status === "faltou" && !hasFuture) reasons.push("faltou");

    const overdue = maintenances.some(
      (m) =>
        m.status === "prevista" &&
        m.planned_date &&
        daysBetween(m.planned_date, today) > MAINTENANCE_GRACE_DAYS
    );
    if (overdue && !hasFuture) reasons.push("manutencao_vencida");
    else if (!hasFuture && inTreatment && !reasons.includes("faltou")) {
      reasons.push("sem_agendamento");
    }

    if (caso.next_reevaluation_date && daysBetween(caso.next_reevaluation_date, today) > 0) {
      reasons.push("reavaliacao_vencida");
    }
    if (inTreatment && caseTimeliness(caso, today, input.toleranceDays) === "atrasado") {
      reasons.push("termino_atrasado");
    }
  }

  if ((input.openClinicalRequests ?? 0) > 0 && caso.status !== "finalizado" && caso.status !== "interrompido") {
    reasons.push("pedido_clinico_aberto");
  }

  if (input.includeMoney !== false) {
    const late = (input.charges ?? []).some(
      (c) => c.status === "atrasada" || (c.status === "em_aberto" && daysBetween(c.due_date, today) > 0)
    );
    if (late) reasons.push("mensalidade_atrasada");
    // R8: o lote está acabando (ou acabou) sem decisão.
    if (inTreatment) {
      const b = batchAttention(input.batch, today);
      if (b) reasons.push(b);
    }
  }

  return reasons;
}

function dateOf(m: MaintenanceLike): string {
  return (m.done_at ?? m.appointment_date ?? m.planned_date ?? "9999-12-31").slice(0, 10);
}

/** A próxima manutenção que vale (agendada futura, senão a prevista mais próxima). */
export function nextMaintenance<T extends MaintenanceLike>(
  maintenances: T[],
  today: string
): T | null {
  const future = maintenances
    .filter((m) => m.status === "agendada" || m.status === "prevista")
    .map((m) => ({ m, d: dateOf(m) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const ahead = future.find((x) => daysBetween(today, x.d) >= 0 && x.m.status === "agendada");
  if (ahead) return ahead.m;
  return future[0]?.m ?? null;
}

// ---------------------------------------------------------------------------
// Mensalidade
// ---------------------------------------------------------------------------

/** O que a cobrança É hoje: em aberto e vencida mostra "atrasada" mesmo antes da rotina marcar. */
export function chargeStatusToday(c: ChargeLike, today: string): OrthoChargeStatus {
  if (c.status === "em_aberto" && daysBetween(c.due_date, today) > 0) return "atrasada";
  return c.status;
}

/** Vencimento da competência: dia de cobrança, limitado ao fim do mês. */
export function dueDateFor(referenceMonth: string, billingDay: number): string {
  const [y, m] = parts(referenceMonth);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIso(y, m, Math.min(Math.max(1, billingDay || ORTHO_DEFAULTS.billingDay), last));
}

// ---------------------------------------------------------------------------
// Previsão e evolução
// ---------------------------------------------------------------------------

export type ForecastBuckets = { in3: number; in6: number; in12: number; overdue: number };

/** Quantos casos em tratamento devem terminar nos próximos 3, 6 e 12 meses (e quantos já passaram). */
export function finishForecast(cases: OrthoCaseLike[], today: string): ForecastBuckets {
  const b: ForecastBuckets = { in3: 0, in6: 0, in12: 0, overdue: 0 };
  const h3 = addMonths(today, 3);
  const h6 = addMonths(today, 6);
  const h12 = addMonths(today, 12);
  for (const c of cases) {
    if (c.status !== "em_tratamento" || !c.planned_end_date) continue;
    const e = c.planned_end_date;
    if (daysBetween(e, today) > 0) b.overdue += 1;
    else if (daysBetween(e, h3) >= 0) b.in3 += 1;
    else if (daysBetween(e, h6) >= 0) b.in6 += 1;
    else if (daysBetween(e, h12) >= 0) b.in12 += 1;
  }
  return b;
}

export type MonthPoint = { month: string; active: number; started: number; finished: number };

/**
 * Evolução mês a mês (últimos N meses): quantos estavam em tratamento no fim
 * do mês, quantos começaram e quantos terminaram naquele mês.
 */
export function monthlyEvolution(
  cases: OrthoCaseLike[],
  today: string,
  months = 12
): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ms = monthStart(addMonths(today, -i));
    const next = addMonths(ms, 1);
    const endOfMonth = addDays(next, -1);
    let active = 0;
    let started = 0;
    let finished = 0;
    for (const c of cases) {
      const s = c.start_date;
      if (!s) continue;
      const f = c.finished_at?.slice(0, 10) ?? null;
      if (daysBetween(ms, s) >= 0 && daysBetween(s, endOfMonth) >= 0) started += 1;
      if (f && daysBetween(ms, f) >= 0 && daysBetween(f, endOfMonth) >= 0 && isFinished(c)) {
        finished += 1;
      }
      const startedBy = daysBetween(s, endOfMonth) >= 0;
      const stillOpen =
        c.status === "em_tratamento"
          ? true
          : f
            ? daysBetween(endOfMonth, f) > 0
            : false;
      if (startedBy && stillOpen) active += 1;
    }
    out.push({ month: ms, active, started, finished });
  }
  return out;
}

// ---------------------------------------------------------------------------
// De onde veio o paciente
// ---------------------------------------------------------------------------

export type OrthoOrigin = "indica" | "riso_mais" | "empresarial" | "indicacao_direta" | "unidade";

export const ORIGIN_LABELS: Record<OrthoOrigin, string> = {
  indica: "Indica +Risos",
  riso_mais: "Riso+ (PPR+)",
  empresarial: "Empresarial",
  indicacao_direta: "Indicação de cliente",
  unidade: "Unidade (direto)",
};

/**
 * A origem do paciente de ortodontia, na ordem de precedência: veio por uma
 * indicação do Indica, é beneficiário do Riso+, é colaborador do Empresarial,
 * tem "indicado por" na ficha, ou chegou direto.
 */
export function originOf(client: {
  has_indica_referral?: boolean;
  ppr_active?: boolean | null;
  ppr_membership_id?: string | null;
  empresarial_company_id?: string | null;
  referred_by_client_id?: string | null;
  origin_program?: string | null;
}): OrthoOrigin {
  if (client.has_indica_referral) return "indica";
  if (client.ppr_membership_id || client.ppr_active || client.origin_program === "ppr") return "riso_mais";
  if (client.empresarial_company_id || client.origin_program === "empresarial") return "empresarial";
  if (client.referred_by_client_id) return "indicacao_direta";
  return "unidade";
}

// ---------------------------------------------------------------------------
// Proposta e termo
// ---------------------------------------------------------------------------

export type OrthoTerms = {
  kind: OrthoKind | null;
  monthlyCents: number;
  plannedMonths: number;
  maintenanceIntervalDays: number;
  billingDay: number;
  installationCents?: number | null;
  /** O1: a contenção é cobrada? quanto? em que condição? */
  retainerCharged?: boolean | null;
  retainerFeeCents?: number | null;
  retainerTerms?: string | null;
  /** R5 (0333): o tipo de contenção final definido pelo Planner na proposta. */
  retainerKind?: OrthoRetainerKind | null;
  /**
   * R10 (0333): quem INICIA o tratamento. Nulo = "a ser designado pela
   * clínica". O termo diz que outro ortodontista da equipe pode continuar.
   */
  orthodontistName?: string | null;
  /** R7/R9 (0335): o lote — quantas mensalidades são emitidas de uma vez. */
  installmentsCount?: number | null;
  /** R1/Q6: desconto para pagamento até o vencimento (%). */
  punctualityDiscountPercent?: number | null;
  /** Q2: o reajuste anual (%), quando houver. */
  annualAdjustmentPercent?: number | null;
  /** R7: como as mensalidades são emitidas. */
  billingMethod?: string | null;
};

const BILLING_METHOD_TEXT: Record<string, string> = {
  pix_recorrente: "PIX recorrente",
  debito_recorrente: "débito recorrente",
  credito_recorrente: "cartão de crédito recorrente",
  cartao_parcelado: "cartão de crédito parcelado",
  boleto: "boleto",
  avista_periodo: "pagamento à vista do período",
};

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * As cláusulas do acordo ortodôntico — as MESMAS na proposta e no termo
 * (regra do dono: o cliente paga a mensalidade mesmo sem vir à manutenção).
 */
export function orthoClauses(t: OrthoTerms): string[] {
  const tipo = t.kind ? ORTHO_KIND_LABELS[t.kind].toLowerCase() : "ortodôntico";
  const out: string[] = [];
  // R6: o prazo é REFERÊNCIA, não compromisso de data (decisão do dono, 28/10/2026).
  out.push(
    `O tratamento ortodôntico (${tipo}) tem duração prevista de ${t.plannedMonths} ${t.plannedMonths === 1 ? "mês" : "meses"}. Esse prazo é uma referência, e não um compromisso de conclusão em data certa: a duração real depende da resposta biológica de cada paciente, da colaboração com as orientações e da assiduidade às manutenções, podendo ser menor ou maior.`
  );
  // R10: quem INICIA; outro ortodontista da equipe pode continuar.
  out.push(
    t.orthodontistName?.trim()
      ? `O tratamento será iniciado pelo(a) ortodontista ${t.orthodontistName.trim()}. Ao longo do tratamento, por necessidade da clínica (como a saída do profissional da equipe) ou do paciente, o acompanhamento poderá ser continuado por outro(a) ortodontista da equipe Risarte, sem prejuízo da continuidade e sem alteração das condições deste termo.`
      : `O(a) ortodontista que iniciará o tratamento será designado(a) pela clínica. Ao longo do tratamento, por necessidade da clínica (como a saída do profissional da equipe) ou do paciente, o acompanhamento poderá ser continuado por outro(a) ortodontista da equipe Risarte, sem prejuízo da continuidade e sem alteração das condições deste termo.`
  );
  if (t.installationCents && t.installationCents > 0) {
    out.push(
      `A instalação do aparelho (documentação e montagem) é cobrada à parte, no valor de ${brl(t.installationCents)}, conforme o plano de tratamento aceito.`
    );
  }
  out.push(
    `O paciente paga uma mensalidade de tratamento ortodôntico de ${brl(t.monthlyCents)}, com vencimento todo dia ${t.billingDay}, do início do tratamento até a entrega das contenções. A mensalidade remunera o acompanhamento contínuo do caso e não é um procedimento avulso.`
  );
  // R7/R8/R9 (0335): o lote, a renovação, a pontualidade, o reajuste e a suspensão.
  if (t.installmentsCount && t.installmentsCount > 0) {
    out.push(
      `Serão emitidas ${t.installmentsCount} ${t.installmentsCount === 1 ? "mensalidade" : "mensalidades"}${t.billingMethod && BILLING_METHOD_TEXT[t.billingMethod] ? `, por ${BILLING_METHOD_TEXT[t.billingMethod]}` : ""}. Ao fim desse lote, se o tratamento continuar, novas mensalidades serão emitidas nas mesmas condições, até a entrega das contenções.`
    );
  }
  if (t.punctualityDiscountPercent && t.punctualityDiscountPercent > 0) {
    out.push(
      `O pagamento da mensalidade até a data de vencimento tem desconto de pontualidade de ${String(t.punctualityDiscountPercent).replace(".", ",")}%; após o vencimento, vale o valor integral.`
    );
  }
  if (t.annualAdjustmentPercent && t.annualAdjustmentPercent > 0) {
    out.push(
      `As mensalidades sofrem reajuste anual de ${String(t.annualAdjustmentPercent).replace(".", ",")}%, aplicado a cada 12 meses do início do tratamento, na emissão das novas mensalidades.`
    );
  } else {
    out.push(`As mensalidades estão sujeitas a reajuste anual, aplicado a cada 12 meses do início do tratamento, na emissão das novas mensalidades.`);
  }
  out.push(
    `Se o paciente não assumir as novas mensalidades ao fim do lote, o tratamento será suspenso — as manutenções param e nenhuma mensalidade nova é emitida — e, mantida a situação, poderá ser cancelado pela unidade, sem prejuízo das mensalidades já devidas.`
  );
  out.push(
    `A mensalidade é devida independentemente do comparecimento às manutenções: a falta à manutenção não suspende nem reduz a mensalidade do mês.`
  );
  out.push(
    `As manutenções acontecem, em média, a cada ${t.maintenanceIntervalDays} dias, em horário agendado com a unidade. O paciente deve comunicar a impossibilidade de comparecer com antecedência para reagendar.`
  );
  out.push(
    `Cada falta a uma manutenção prorroga a data prevista de término em ${t.maintenanceIntervalDays} dias (um intervalo de manutenção), porque a etapa não realizada precisa ser refeita. A assiduidade do paciente (manutenções realizadas e faltas) fica registrada no caso e é considerada na avaliação do prazo.`
  );
  out.push(
    `Atrasos na mensalidade seguem a regra de multa e juros da unidade; a inadimplência pode suspender o atendimento até a regularização, mantendo-se a cobrança dos meses em tratamento.`
  );
  out.push(
    `A entrega das contenções encerra o tratamento ativo e a cobrança da mensalidade: a partir dela o tratamento é considerado finalizado e o paciente passa ao acompanhamento ortodôntico, com controles periódicos conforme a orientação do ortodontista, sem mensalidade.`
  );
  const contencaoPrevista =
    t.retainerKind && t.retainerKind !== "a_definir"
      ? ` Contenção prevista: ${ORTHO_RETAINER_KIND_LABELS[t.retainerKind].toLowerCase()}, podendo ser ajustada pelo ortodontista ao fim do tratamento.`
      : "";
  if (t.retainerCharged && (t.retainerFeeCents ?? 0) > 0) {
    out.push(
      `As contenções são cobradas à parte, no valor de ${brl(t.retainerFeeCents ?? 0)}, na entrega${t.retainerTerms?.trim() ? `, nas seguintes condições: ${t.retainerTerms.trim()}` : ""}.${contencaoPrevista}`
    );
  } else {
    out.push(`As contenções estão incluídas no tratamento, sem cobrança adicional na entrega.${contencaoPrevista}`);
  }
  return out;
}

/** Texto curto para o cartão do prontuário e as listas. */
export function caseSummary(c: {
  status: OrthoStatus;
  treatment_kind: OrthoKind;
  planned_end_date: string | null;
}): string {
  const kind = ORTHO_KIND_LABELS[c.treatment_kind];
  if (c.planned_end_date && c.status === "em_tratamento") {
    const [y, m] = parts(c.planned_end_date);
    return `${kind} · término previsto ${String(m).padStart(2, "0")}/${y}`;
  }
  if (c.status === "contencao") return `${kind} · em acompanhamento`;
  return kind;
}
