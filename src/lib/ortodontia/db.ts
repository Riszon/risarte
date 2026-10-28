import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerPorLotes, lerTodasAsPaginas, type TudoLido } from "@/lib/paginar";
import type {
  OrthoBillingMethod,
  OrthoChargeKind,
  OrthoChargeStatus,
  OrthoKind,
  OrthoMaintenanceStatus,
  OrthoStatus,
} from "./constants";

// As LEITURAS do módulo — uma por pergunta, todas em páginas (a API corta em
// 1.000 linhas: AP47). As regras moram em `regras.ts`; aqui só se busca.

export type OrthoClientLite = {
  id: string;
  full_name: string;
  code: string | null;
  phone: string | null;
  ppr_membership_id: string | null;
  ppr_active: boolean | null;
  empresarial_company_id: string | null;
  referred_by_client_id: string | null;
  origin_program: string | null;
};

export type OrthoCaseRow = {
  id: string;
  code: string;
  clinic_id: string;
  client_id: string;
  orthodontist_id: string | null;
  treatment_kind: OrthoKind;
  status: OrthoStatus;
  start_date: string | null;
  planned_months: number;
  planned_end_date: string | null;
  maintenance_interval_days: number;
  next_reevaluation_date: string | null;
  monthly_fee_cents: number;
  billing_day: number;
  installation_fee_cents: number;
  maintenance_procedure_id: string | null;
  plan_id: string | null;
  negotiation_id: string | null;
  finished_at: string | null;
  finish_reason: string | null;
  interrupted_at: string | null;
  interrupt_reason: string | null;
  /** O1: a contenção combinada no caso (cópia da configuração ao abrir). */
  retainer_charged: boolean;
  retainer_fee_cents: number;
  retainer_terms: string | null;
  retainer_delivered_at: string | null;
  discharged_at: string | null;
  /** O3: faltas × intervalo — já somado em `planned_end_date`. */
  extension_days: number;
  /**
   * R13 (0332): o dinheiro vive em `ortho_case_terms`, que o banco só devolve a
   * quem vê dinheiro. Para o dentista o embed vem vazio e os campos acima
   * ficam em zero — a tela nem os pede (`canViewOrthoMoney`); isto diz se vieram.
   */
  terms_visible: boolean;
  /** R4/Q1 (0334): da venda do Comercial, ou legado (já em tratamento antes do sistema). */
  origin: "venda" | "legado";
  /** R7/R8 (0334): o acordo da negociação — o lote de N mensalidades e a forma de emissão (a ORTO9 usa). */
  installments_count: number;
  billing_method: OrthoBillingMethod | null;
  punctuality_discount_percent: number;
  notes: string | null;
  created_at: string;
  client: OrthoClientLite | null;
  clinic: { name: string } | null;
  orthodontist: { full_name: string } | null;
};

export type OrthoMaintenanceRow = {
  id: string;
  case_id: string;
  seq: number;
  planned_date: string | null;
  status: OrthoMaintenanceStatus;
  done_at: string | null;
  done_by: string | null;
  arch_wire: string | null;
  notes: string | null;
  next_steps: string | null;
  appointment_id: string | null;
  payout_id: string | null;
  appointment: { starts_at: string; status: string } | null;
  done_by_profile: { full_name: string } | null;
};

export type OrthoChargeRow = {
  id: string;
  case_id: string;
  clinic_id: string;
  client_id: string;
  kind: OrthoChargeKind;
  reference_month: string;
  due_date: string;
  amount_cents: number;
  status: OrthoChargeStatus;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
};

export type OrthoEventRow = {
  id: string;
  event_type: string;
  description: string | null;
  created_at: string;
  author: { full_name: string } | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** O dinheiro do caso (0332): a irmã `ortho_case_terms`, embutida pela ligação de nome fixo. */
export const CASE_TERMS_EMBED =
  "terms:ortho_case_terms!ortho_case_terms_case_id_fkey ( monthly_fee_cents, billing_day, installation_fee_cents, retainer_charged, retainer_fee_cents, retainer_terms, installments_count, billing_method, punctuality_discount_percent )";

type TermsEmbed = {
  monthly_fee_cents: number | null;
  billing_day: number | null;
  installation_fee_cents: number | null;
  retainer_charged: boolean | null;
  retainer_fee_cents: number | null;
  retainer_terms: string | null;
  installments_count: number | null;
  billing_method: string | null;
  punctuality_discount_percent: number | string | null;
};

const CASE_SELECT =
  `id, code, clinic_id, client_id, orthodontist_id, treatment_kind, status, origin, start_date, planned_months, planned_end_date, maintenance_interval_days, next_reevaluation_date, maintenance_procedure_id, plan_id, negotiation_id, finished_at, finish_reason, interrupted_at, interrupt_reason, retainer_delivered_at, discharged_at, extension_days, notes, created_at, ${CASE_TERMS_EMBED}, client:clients!ortho_cases_client_id_fkey ( id, full_name, code, phone, ppr_membership_id, ppr_active, empresarial_company_id, referred_by_client_id, origin_program ), clinic:clinics!ortho_cases_clinic_id_fkey ( name ), orthodontist:profiles!ortho_cases_orthodontist_id_fkey ( full_name )`;

function toCase(r: Record<string, unknown>): OrthoCaseRow {
  const t = one(r.terms as TermsEmbed | TermsEmbed[] | null);
  return {
    ...(r as Omit<OrthoCaseRow, "client" | "clinic" | "orthodontist">),
    origin: r.origin === "legado" ? "legado" : "venda",
    terms_visible: t !== null,
    installments_count: Number(t?.installments_count ?? 12),
    billing_method: (t?.billing_method as OrthoBillingMethod | null) ?? null,
    punctuality_discount_percent: Number(t?.punctuality_discount_percent ?? 0),
    monthly_fee_cents: Number(t?.monthly_fee_cents ?? 0),
    installation_fee_cents: Number(t?.installation_fee_cents ?? 0),
    planned_months: Number(r.planned_months ?? 24),
    maintenance_interval_days: Number(r.maintenance_interval_days ?? 30),
    billing_day: Number(t?.billing_day ?? 10),
    retainer_charged: t?.retainer_charged === true,
    retainer_fee_cents: Number(t?.retainer_fee_cents ?? 0),
    retainer_terms: t?.retainer_terms ?? null,
    retainer_delivered_at: (r.retainer_delivered_at as string | null) ?? null,
    discharged_at: (r.discharged_at as string | null) ?? null,
    extension_days: Number(r.extension_days ?? 0),
    client: one(r.client as OrthoClientLite | OrthoClientLite[] | null),
    clinic: one(r.clinic as { name: string } | { name: string }[] | null),
    orthodontist: one(r.orthodontist as { full_name: string } | { full_name: string }[] | null),
  };
}

/**
 * Os casos visíveis. `clinicIds` nulo = o que a regra de linha deixar (a rede
 * vê todas as unidades); lista = só aquelas.
 */
export async function loadCases(
  supabase: SupabaseClient,
  f: {
    clinicIds: string[] | null;
    statuses?: OrthoStatus[];
    orthodontistId?: string | null;
  }
): Promise<TudoLido<OrthoCaseRow>> {
  const r = await lerTodasAsPaginas<Record<string, unknown>>((de, ate) => {
    let q = supabase.from("ortho_cases").select(CASE_SELECT).order("created_at", { ascending: false }).range(de, ate);
    if (f.clinicIds && f.clinicIds.length > 0) q = q.in("clinic_id", f.clinicIds);
    if (f.statuses && f.statuses.length > 0) q = q.in("status", f.statuses);
    if (f.orthodontistId) q = q.eq("orthodontist_id", f.orthodontistId);
    return q;
  });
  if (!r.ok) return r;
  return { ok: true, linhas: r.linhas.map(toCase), paginas: r.paginas };
}

export async function loadCase(supabase: SupabaseClient, id: string): Promise<OrthoCaseRow | null> {
  const { data } = await supabase.from("ortho_cases").select(CASE_SELECT).eq("id", id).maybeSingle();
  return data ? toCase(data as Record<string, unknown>) : null;
}

const MAINT_SELECT =
  "id, case_id, seq, planned_date, status, done_at, done_by, arch_wire, notes, next_steps, appointment_id, payout_id, appointment:appointments ( starts_at, status ), done_by_profile:profiles!ortho_maintenances_done_by_fkey ( full_name )";

function toMaint(r: Record<string, unknown>): OrthoMaintenanceRow {
  return {
    ...(r as Omit<OrthoMaintenanceRow, "appointment" | "done_by_profile">),
    seq: Number(r.seq ?? 0),
    appointment: one(r.appointment as OrthoMaintenanceRow["appointment"] | OrthoMaintenanceRow["appointment"][] | null),
    done_by_profile: one(r.done_by_profile as { full_name: string } | { full_name: string }[] | null),
  };
}

/** As manutenções dos casos pedidos, por caso. */
export async function loadMaintenancesFor(
  supabase: SupabaseClient,
  caseIds: string[]
): Promise<TudoLido<OrthoMaintenanceRow>> {
  if (caseIds.length === 0) return { ok: true, linhas: [], paginas: 0 };
  const r = await lerPorLotes<Record<string, unknown>>(caseIds, (lote, de, ate) =>
    supabase.from("ortho_maintenances").select(MAINT_SELECT).in("case_id", lote).order("seq").range(de, ate)
  );
  if (!r.ok) return r;
  return { ok: true, linhas: r.linhas.map(toMaint), paginas: r.paginas };
}

const CHARGE_SELECT =
  "id, case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, paid_at, payment_method, notes";

export async function loadChargesFor(
  supabase: SupabaseClient,
  caseIds: string[]
): Promise<TudoLido<OrthoChargeRow>> {
  if (caseIds.length === 0) return { ok: true, linhas: [], paginas: 0 };
  const r = await lerPorLotes<OrthoChargeRow>(caseIds, (lote, de, ate) =>
    supabase.from("ortho_charges").select(CHARGE_SELECT).in("case_id", lote).order("due_date").range(de, ate)
  );
  if (!r.ok) return r;
  return { ok: true, linhas: r.linhas.map((c) => ({ ...c, amount_cents: Number(c.amount_cents ?? 0) })), paginas: r.paginas };
}

/** Todas as mensalidades das unidades (a tela Mensalidades), em páginas. */
export async function loadChargesByClinic(
  supabase: SupabaseClient,
  clinicIds: string[] | null,
  status?: OrthoChargeStatus | null
): Promise<TudoLido<OrthoChargeRow>> {
  const r = await lerTodasAsPaginas<OrthoChargeRow>((de, ate) => {
    let q = supabase.from("ortho_charges").select(CHARGE_SELECT).order("due_date", { ascending: false }).range(de, ate);
    if (clinicIds && clinicIds.length > 0) q = q.in("clinic_id", clinicIds);
    if (status) q = q.eq("status", status);
    return q;
  });
  if (!r.ok) return r;
  return { ok: true, linhas: r.linhas.map((c) => ({ ...c, amount_cents: Number(c.amount_cents ?? 0) })), paginas: r.paginas };
}

export async function loadEvents(supabase: SupabaseClient, caseId: string): Promise<OrthoEventRow[]> {
  const { data } = await supabase
    .from("ortho_events")
    .select("id, event_type, description, created_at, author:profiles!ortho_events_created_by_fkey ( full_name )")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((e) => ({
    ...(e as Omit<OrthoEventRow, "author">),
    author: one(e.author as { full_name: string } | { full_name: string }[] | null),
  }));
}

/** Pedidos clínicos em aberto por paciente (reavaliação / revisão do plano). */
export async function loadOpenRequestsFor(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (clientIds.length === 0) return out;
  const r = await lerPorLotes<{ client_id: string }>(clientIds, (lote, de, ate) =>
    supabase.from("clinical_requests").select("client_id").in("client_id", lote).eq("status", "open").range(de, ate)
  );
  if (!r.ok) return out;
  for (const row of r.linhas) out.set(row.client_id, (out.get(row.client_id) ?? 0) + 1);
  return out;
}

/**
 * Quem chegou pelo Indica +Risos (schema `indica`). A leitura é tolerante:
 * quem não enxerga o Indica recebe vazio, e a origem cai para a próxima regra.
 */
export async function loadIndicaReferredSet(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (clientIds.length === 0) return out;
  const r = await lerPorLotes<{ cliente_indicado_id: string | null }>(clientIds, (lote, de, ate) =>
    supabase
      .schema("indica")
      .from("indicacoes")
      .select("cliente_indicado_id")
      .in("cliente_indicado_id", lote)
      .range(de, ate)
  );
  if (!r.ok) return out;
  for (const row of r.linhas) if (row.cliente_indicado_id) out.add(row.cliente_indicado_id);
  return out;
}

/** Indicações FEITAS pelos pacientes de ortodontia (quem eles trouxeram). */
export async function loadReferralsMadeBy(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, { id: string; full_name: string; code: string | null }[]>> {
  const out = new Map<string, { id: string; full_name: string; code: string | null }[]>();
  if (clientIds.length === 0) return out;
  const r = await lerPorLotes<{ id: string; full_name: string; code: string | null; referred_by_client_id: string }>(
    clientIds,
    (lote, de, ate) =>
      supabase
        .from("clients")
        .select("id, full_name, code, referred_by_client_id")
        .in("referred_by_client_id", lote)
        .range(de, ate)
  );
  if (!r.ok) return out;
  for (const row of r.linhas) {
    const list = out.get(row.referred_by_client_id) ?? [];
    list.push({ id: row.id, full_name: row.full_name, code: row.code });
    out.set(row.referred_by_client_id, list);
  }
  return out;
}

export type StaffOption = { userId: string; name: string; role: string };

/** Quem pode ser o ortodontista do caso: dentistas e coordenadores da unidade. */
export async function loadOrthodontistOptions(
  supabase: SupabaseClient,
  clinicId: string
): Promise<StaffOption[]> {
  const { data: roles } = await supabase
    .from("user_clinic_roles")
    .select("user_id, role")
    .eq("clinic_id", clinicId)
    .in("role", ["dentist", "clinical_coordinator"]);
  const ids = [...new Set((roles ?? []).map((r) => r.user_id as string))];
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, is_active")
    .in("id", ids.slice(0, 150));
  const roleOf = new Map((roles ?? []).map((r) => [r.user_id as string, r.role as string]));
  return (profiles ?? [])
    .filter((p) => p.is_active !== false)
    .map((p) => ({ userId: p.id as string, name: p.full_name as string, role: roleOf.get(p.id as string) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type ProcedureOption = { id: string; name: string; specialty: string | null };

/** Os procedimentos de Ortodontia do catálogo (para o repasse da manutenção). */
export async function loadOrthoProcedures(supabase: SupabaseClient): Promise<ProcedureOption[]> {
  const { data } = await supabase
    .from("procedures")
    .select("id, name, specialty")
    .eq("is_active", true)
    .ilike("specialty", "%ortod%")
    .order("name")
    .limit(500);
  return (data ?? []) as ProcedureOption[];
}

export type OrthoSettingsRow = {
  id: string;
  clinic_id: string | null;
  monthly_fee_cents: number;
  planned_months: number;
  maintenance_interval_days: number;
  reevaluation_interval_months: number;
  finish_tolerance_days: number;
  maintenance_procedure_id: string | null;
  billing_day: number;
  retainer_charge_enabled: boolean;
  retainer_fee_cents: number;
  retainer_terms: string | null;
  /** R1/Q4 (0334): pontualidade sugerida e máxima, mensalidade mínima, a porta do caso legado. */
  punctuality_discount_percent: number;
  max_punctuality_discount_percent: number;
  min_monthly_fee_cents: number;
  /** Nulo na unidade = herda da rede. */
  legacy_entry_enabled: boolean | null;
};

export async function loadOrthoSettingsRows(supabase: SupabaseClient): Promise<OrthoSettingsRow[] | null> {
  const { data, error } = await supabase
    .from("ortho_settings")
    .select(
      "id, clinic_id, monthly_fee_cents, planned_months, maintenance_interval_days, reevaluation_interval_months, finish_tolerance_days, maintenance_procedure_id, billing_day, retainer_charge_enabled, retainer_fee_cents, retainer_terms, punctuality_discount_percent, max_punctuality_discount_percent, min_monthly_fee_cents, legacy_entry_enabled"
    )
    .limit(500);
  if (error) return null;
  return (data ?? []).map((r) => ({
    ...(r as OrthoSettingsRow),
    retainer_charge_enabled: r.retainer_charge_enabled === true,
    retainer_fee_cents: Number(r.retainer_fee_cents ?? 0),
    retainer_terms: (r.retainer_terms as string | null) ?? null,
    punctuality_discount_percent: Number(r.punctuality_discount_percent ?? 0),
    max_punctuality_discount_percent: Number(r.max_punctuality_discount_percent ?? 10),
    min_monthly_fee_cents: Number(r.min_monthly_fee_cents ?? 0),
    legacy_entry_enabled: typeof r.legacy_entry_enabled === "boolean" ? r.legacy_entry_enabled : null,
  }));
}

export type EffectiveSettings = {
  monthly_fee_cents: number;
  planned_months: number;
  maintenance_interval_days: number;
  reevaluation_interval_months: number;
  finish_tolerance_days: number;
  maintenance_procedure_id: string | null;
  billing_day: number;
  retainer_charge_enabled: boolean;
  retainer_fee_cents: number;
  retainer_terms: string | null;
  punctuality_discount_percent: number;
  max_punctuality_discount_percent: number;
  min_monthly_fee_cents: number;
  legacy_entry_enabled: boolean;
};

export async function loadEffectiveSettings(
  supabase: SupabaseClient,
  clinicId: string
): Promise<EffectiveSettings | null> {
  const { data, error } = await supabase.rpc("ortho_effective_settings", { p_clinic_id: clinicId });
  if (error) return null;
  const s = (Array.isArray(data) ? data[0] : data) as EffectiveSettings | null | undefined;
  if (!s) return null;
  // `numeric` chega como texto pela API: normaliza (0334).
  return {
    ...s,
    punctuality_discount_percent: Number(s.punctuality_discount_percent ?? 0),
    max_punctuality_discount_percent: Number(s.max_punctuality_discount_percent ?? 10),
    min_monthly_fee_cents: Number(s.min_monthly_fee_cents ?? 0),
    legacy_entry_enabled: s.legacy_entry_enabled !== false,
  };
}

/**
 * R4 (0334): para cada paciente, o PRÓXIMO agendamento de início/sessão de
 * tratamento (qualquer profissional) — "instalação em dd/mm" ou "sem horário"
 * para quem aguarda início. Só agendados/confirmados, de hoje em diante.
 */
export async function loadStartAppointments(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(clientIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase
      .from("appointments")
      .select("client_id, starts_at")
      .in("client_id", ids.slice(i, i + 150))
      .in("type", ["treatment_start", "treatment_session"])
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", nowIso)
      .order("starts_at")
      .limit(1000);
    for (const a of data ?? []) {
      const cid = a.client_id as string;
      if (!out.has(cid)) out.set(cid, a.starts_at as string);
    }
  }
  return out;
}

/** Agendamentos futuros do paciente ainda não ligados a manutenção (para "Vincular"). */
export async function loadLinkableAppointments(
  supabase: SupabaseClient,
  clientId: string,
  linkedIds: string[]
): Promise<{ id: string; starts_at: string; type: string; status: string; provider: string | null }[]> {
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, type, status, provider:profiles!appointments_provider_user_id_fkey ( full_name )")
    .eq("client_id", clientId)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    .limit(30);
  const linked = new Set(linkedIds);
  return (data ?? [])
    .filter((a) => !linked.has(a.id as string))
    .map((a) => ({
      id: a.id as string,
      starts_at: a.starts_at as string,
      type: a.type as string,
      status: a.status as string,
      provider: one(a.provider as { full_name: string } | { full_name: string }[] | null)?.full_name ?? null,
    }));
}

/** Vendas fechadas com procedimento de Ortodontia e sem caso aberto (ORTO5 manual). */
export async function loadSalesWithoutCase(
  supabase: SupabaseClient,
  clinicIds: string[] | null
): Promise<{ negotiationId: string; clientId: string; clientName: string; closedAt: string | null }[]> {
  let q = supabase
    .from("commercial_sales")
    .select(
      "negotiation_id, client_id, closed_at, client:clients!commercial_sales_client_id_fkey ( full_name, ortho_active ), negotiation:plan_negotiations!commercial_sales_negotiation_id_fkey ( option_id )"
    )
    .eq("payment_confirmed", true)
    .eq("contract_signed", true)
    .order("closed_at", { ascending: false })
    .limit(200);
  if (clinicIds && clinicIds.length > 0) q = q.in("clinic_id", clinicIds);
  const { data: sales, error } = await q;
  if (error || !sales || sales.length === 0) return [];

  type Sale = (typeof sales)[number];
  const pending = sales.filter((s: Sale) => {
    const c = one(s.client as { full_name: string; ortho_active: boolean | null } | { full_name: string; ortho_active: boolean | null }[] | null);
    return !c?.ortho_active;
  });
  const optionIds = pending
    .map((s: Sale) => one(s.negotiation as { option_id: string } | { option_id: string }[] | null)?.option_id)
    .filter((x): x is string => Boolean(x));
  if (optionIds.length === 0) return [];

  const { data: items } = await supabase
    .from("treatment_plan_option_items")
    .select("option_id, procedure:procedures ( specialty )")
    .in("option_id", optionIds.slice(0, 150));
  const orthoOptions = new Set(
    (items ?? [])
      .filter((i) => /ortod/i.test(one(i.procedure as { specialty: string | null } | { specialty: string | null }[] | null)?.specialty ?? ""))
      .map((i) => i.option_id as string)
  );

  return pending
    .filter((s: Sale) => orthoOptions.has(one(s.negotiation as { option_id: string } | { option_id: string }[] | null)?.option_id ?? ""))
    .map((s: Sale) => ({
      negotiationId: s.negotiation_id as string,
      clientId: s.client_id as string,
      clientName: one(s.client as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "—",
      closedAt: (s.closed_at as string | null) ?? null,
    }));
}

/** Agrupa por caso. */
export function groupByCase<T extends { case_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.case_id) ?? [];
    list.push(r);
    m.set(r.case_id, list);
  }
  return m;
}
