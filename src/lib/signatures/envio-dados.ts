import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { complementoDaNegociacao, lerApresentacao } from "@/lib/complemento-comercial";
import type { SessionContext } from "@/lib/auth";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/commercial";
import { todayInBrazil } from "@/lib/dates";
import { ehMenorDeIdade } from "@/lib/idade";
import { numerosDoOrcamento, somarDias, validadeDoOrcamento, type LinhaDeValidade } from "@/lib/orcamento";
import { formatBRL } from "@/lib/pricing";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isZapsignConfigured, isZapsignFake, zapsignEnv } from "@/lib/zapsign/env";
import { canSendSignatures } from "./access";
import { loadSignatureSettings } from "./settings";
import type { GuardianForSigning } from "./signers";
import type { PackageOriginType, SignatureKit, SignatureTemplate, StaffSignerOption } from "./types";
import type { ClientValues, ClinicValues, GuardianValues, TreatmentValues } from "./valores";
import { corpoValido } from "./variables";

/**
 * O QUE A JANELA "ENVIAR PARA ASSINATURA" PRECISA SABER, lido de uma vez
 * (plano ZS0 §5.3). Só leitura; a gravação é `send.ts`.
 *
 * O cliente, os responsáveis, a unidade, os modelos e kits e a configuração
 * vêm pelo cliente normal (a RLS vale). A lista de quem pode assinar pela
 * Risarte ou ser testemunha vem pela chave de serviço, DEPOIS da guarda de
 * envio: quem envia da Franqueadora não enxerga a equipe da unidade pela RLS,
 * e sem a lista o envio nunca resolveria o representante. Só o necessário
 * (nome, CPF, telefone, e-mail — o que vai para a ZapSign de qualquer jeito).
 */

export type SendOrigin = { type: PackageOriginType; id: string | null };

export type SendContext = {
  client: ClientValues & { id: string; clinic_id: string };
  guardians: (GuardianForSigning & GuardianValues)[];
  isMinor: boolean;
  clinic: ClinicValues & { id: string };
  templates: SignatureTemplate[];
  kits: SignatureKit[];
  settings: {
    thresholdCents: number;
    patientExpiryDays: number;
    defaultMessage: string;
    zapsignEmailsEnabled: boolean;
  };
  sender: StaffSignerOption;
  staff: StaffSignerOption[];
  byRole: Record<string, StaffSignerOption[]>;
  treatment: TreatmentValues | null;
  negotiationId: string | null;
  zapsign: { configured: boolean; fake: boolean; env: "sandbox" | "production" };
};

export type LoadResult = { ok: true; ctx: SendContext } | { ok: false; error: string };

export async function loadSendContext(input: {
  session: SessionContext;
  clientId: string;
  clinicId: string;
  origin: SendOrigin;
}): Promise<LoadResult> {
  const { session, clientId, clinicId } = input;
  if (!canSendSignatures(session, clinicId)) {
    return { ok: false, error: "Você não tem permissão para enviar documentos para assinatura nesta unidade." };
  }
  const supabase = await createClient();

  const [clientRes, guardiansRes, clinicRes, templatesRes, kitsRes, kitItemsRes, settings] = await Promise.all([
    supabase
      .from("clients")
      .select("id, clinic_id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, anonymized_at")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("client_guardians")
      .select("full_name, cpf, relationship, phone, email")
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("clinics")
      .select("id, name, cnpj, phone, address, address_number, complement, neighborhood, city, state, zip_code")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase
      .from("signature_templates")
      .select("id, code, name, audience, kind, body, source, variables, auth_level, witness_count, witness_mode, default_witness_staff_ids, risarte_signer_mode, risarte_signer_role, risarte_signer_user_id, is_active, is_provisional_text, sort_order")
      .eq("audience", "patient")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("signature_kits").select("id, name, audience, is_active, sort_order").eq("audience", "patient").eq("is_active", true).order("sort_order"),
    supabase.from("signature_kit_items").select("kit_id, template_id, sort_order").order("sort_order"),
    loadSignatureSettings(supabase),
  ]);

  if (clientRes.error || !clientRes.data) return { ok: false, error: "Não foi possível ler o cadastro do paciente." };
  if (clientRes.data.anonymized_at) return { ok: false, error: "Este cadastro foi anonimizado: não há mais para quem enviar." };
  if (clinicRes.error || !clinicRes.data) return { ok: false, error: "Não foi possível ler os dados da unidade." };
  if (templatesRes.error) return { ok: false, error: "Não foi possível ler os modelos de documento." };
  if (!settings) return { ok: false, error: "A assinatura digital ainda não está instalada neste banco (falta a migração 0340)." };

  const templates: SignatureTemplate[] = (templatesRes.data ?? []).map((t) => ({
    ...t,
    body: corpoValido(t.body) ? t.body : null,
    variables: t.variables ?? [],
    default_witness_staff_ids: t.default_witness_staff_ids ?? [],
  })) as SignatureTemplate[];
  if (templates.length === 0) {
    return { ok: false, error: "Nenhum modelo de documento ativo para pacientes (falta a migração 0342 ou todos foram desativados)." };
  }
  const kits: SignatureKit[] = (kitsRes.data ?? []).map((k) => ({
    ...k,
    template_ids: (kitItemsRes.data ?? [])
      .filter((i) => i.kit_id === k.id)
      .map((i) => i.template_id)
      .filter((id) => templates.some((t) => t.id === id)),
  }));

  const guardians = (guardiansRes.data ?? []).map((g) => ({
    name: g.full_name,
    full_name: g.full_name,
    cpf: g.cpf,
    email: g.email,
    phone: g.phone,
    relationship: g.relationship,
  }));
  const client = clientRes.data;
  const isMinor = ehMenorDeIdade(client.birth_date ?? "", todayInBrazil());

  const admin = createAdminClient();
  const [{ sender, staff, byRole }, treatmentInfo] = await Promise.all([
    loadStaffOptions(admin, session, clinicId),
    loadTreatment(supabase, input.origin, clientId, clinicId),
  ]);

  return {
    ok: true,
    ctx: {
      client: { ...client, anonymized_at: undefined } as SendContext["client"],
      guardians,
      isMinor,
      clinic: clinicRes.data,
      templates,
      kits,
      settings: {
        thresholdCents: settings.strong_auth_threshold_cents,
        patientExpiryDays: settings.patient_expiry_days,
        defaultMessage: settings.default_message,
        zapsignEmailsEnabled: settings.zapsign_emails_enabled,
      },
      sender,
      staff,
      byRole,
      treatment: treatmentInfo.treatment,
      negotiationId: treatmentInfo.negotiationId,
      zapsign: { configured: isZapsignConfigured() || isZapsignFake(), fake: isZapsignFake(), env: zapsignEnv() },
    },
  };
}

// ---------------------------------------------------------------- a equipe

type StaffRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  clinic_id: string;
  is_active: boolean;
};

type RoleRow = { user_id: string; clinic_id: string; role: UserRole };
type ProfileRow = { id: string; full_name: string | null; email: string | null; phone: string | null; is_owner: boolean | null; is_active: boolean | null };

export async function loadStaffOptions(
  admin: SupabaseClient,
  session: SessionContext,
  clinicId: string
): Promise<{ sender: StaffSignerOption; staff: StaffSignerOption[]; byRole: Record<string, StaffSignerOption[]> }> {
  const [staffRes, franchisorRes] = await Promise.all([
    admin
      .from("staff_members")
      .select("id, user_id, full_name, cpf, whatsapp, email, clinic_id, is_active")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name")
      .returns<StaffRow[]>(),
    admin.from("clinics").select("id").eq("type", "franchisor").returns<{ id: string }[]>(),
  ]);
  const clinicIds = [clinicId, ...(franchisorRes.data ?? []).map((c) => c.id)];
  const rolesRes = await admin
    .from("user_clinic_roles_all")
    .select("user_id, clinic_id, role")
    .in("clinic_id", clinicIds)
    .returns<RoleRow[]>();
  const roleRows = rolesRes.data ?? [];
  const userIds = [...new Set([session.userId, ...roleRows.map((r) => r.user_id)])];
  const [profilesRes, staffByUserRes, ownersRes] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, phone, is_owner, is_active").in("id", userIds).returns<ProfileRow[]>(),
    admin
      .from("staff_members")
      .select("id, user_id, full_name, cpf, whatsapp, email, clinic_id, is_active")
      .in("user_id", userIds)
      .eq("is_active", true)
      .returns<StaffRow[]>(),
    admin.from("profiles").select("id, full_name, email, phone, is_owner, is_active").eq("is_owner", true).eq("is_active", true).returns<ProfileRow[]>(),
  ]);
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
  const staffByUser = new Map<string, StaffRow>();
  for (const s of staffByUserRes.data ?? []) if (s.user_id && !staffByUser.has(s.user_id)) staffByUser.set(s.user_id, s);

  const fromUser = (userId: string, roleLabel: string): StaffSignerOption | null => {
    const p = profiles.get(userId);
    const s = staffByUser.get(userId);
    if (!p && !s) return null;
    if (p && p.is_active === false) return null;
    return {
      key: `user:${userId}`,
      user_id: userId,
      staff_member_id: s?.id ?? null,
      name: (s?.full_name || p?.full_name || "").trim() || "Sem nome",
      cpf: s?.cpf ?? null,
      email: s?.email || p?.email || null,
      phone: s?.whatsapp || p?.phone || null,
      role_label: roleLabel,
    };
  };

  const byRole: Record<string, StaffSignerOption[]> = {};
  for (const r of roleRows) {
    const opt = fromUser(r.user_id, ROLE_LABELS[r.role] ?? r.role);
    if (!opt) continue;
    const list = (byRole[r.role] ??= []);
    if (!list.some((o) => o.key === opt.key)) list.push(opt);
  }
  // Papel nulo no modelo = o titular (Admin Principal). A chave "owner" é
  // interna à janela; não é um `user_role`.
  byRole.owner = (ownersRes.data ?? [])
    .map((p) => {
      profiles.set(p.id, p);
      return fromUser(p.id, "Titular");
    })
    .filter((o): o is StaffSignerOption => o !== null);

  const staff: StaffSignerOption[] = [];
  const seen = new Set<string>();
  for (const s of staffRes.data ?? []) {
    const key = s.user_id ? `user:${s.user_id}` : `staff:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    staff.push({
      key,
      user_id: s.user_id,
      staff_member_id: s.id,
      name: s.full_name,
      cpf: s.cpf,
      email: s.email,
      phone: s.whatsapp,
      role_label: "Equipe da unidade",
    });
  }
  for (const list of Object.values(byRole)) {
    for (const o of list) {
      if (!seen.has(o.key)) {
        seen.add(o.key);
        staff.push(o);
      }
    }
  }

  const sender =
    fromUser(session.userId, "Quem envia") ??
    ({
      key: `user:${session.userId}`,
      user_id: session.userId,
      staff_member_id: null,
      name: session.fullName,
      cpf: null,
      email: session.email,
      phone: null,
      role_label: "Quem envia",
    } satisfies StaffSignerOption);
  if (!seen.has(sender.key)) staff.push(sender);

  return { sender, staff, byRole };
}

// ------------------------------------------------------------ o tratamento

type NegotiationRow = {
  id: string;
  plan_id: string;
  option_id: string;
  status: string;
  adjustment_cents: number;
  final_cents: number;
  payment_method: PaymentMethod | null;
  installments: number | null;
  down_payment_cents: number | null;
  created_at: string;
};

async function loadTreatment(
  supabase: SupabaseClient,
  origin: SendOrigin,
  clientId: string,
  clinicId: string
): Promise<{ treatment: TreatmentValues | null; negotiationId: string | null }> {
  const cols = "id, plan_id, option_id, status, adjustment_cents, final_cents, payment_method, installments, down_payment_cents, created_at";
  let negotiation: NegotiationRow | null = null;
  let planId: string | null = origin.type === "treatment_plan" ? origin.id : null;

  if (origin.type === "plan_negotiation" && origin.id) {
    // AP158 (item 7): a negociação tem de ser DESTE paciente — um id de outro
    // levaria os valores dele para o contrato e o corte da autenticação.
    const { data } = await supabase.from("plan_negotiations").select(cols).eq("id", origin.id).eq("client_id", clientId).maybeSingle<NegotiationRow>();
    negotiation = data ?? null;
  } else {
    let q = supabase
      .from("plan_negotiations")
      .select(cols)
      .eq("client_id", clientId)
      .in("status", ["aceita", "em_negociacao", "aguardando_autorizacao"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (planId) q = q.eq("plan_id", planId);
    const { data } = await q.maybeSingle<NegotiationRow>();
    negotiation = data ?? null;
  }
  if (!planId && !negotiation) {
    const { data } = await supabase
      .from("treatment_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    planId = data?.id ?? null;
  }
  if (!planId && !negotiation) return { treatment: null, negotiationId: null };

  const optionId = negotiation?.option_id ?? null;
  let optionQuery = supabase
    .from("treatment_plan_option_items")
    .select("id, option_id, description, quantity, unit_price_cents, planned_sessions, tooth_code, sort_order")
    .order("sort_order");
  if (optionId) optionQuery = optionQuery.eq("option_id", optionId);
  else {
    const { data: opt } = await supabase
      .from("treatment_plan_options")
      .select("id")
      .eq("plan_id", planId!)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!opt) return { treatment: null, negotiationId: null };
    optionQuery = optionQuery.eq("option_id", opt.id);
  }
  const [itemsRes, negItemsRes, rulesRes, presRes] = await Promise.all([
    optionQuery.returns<{ id: string; description: string; quantity: number; unit_price_cents: number; planned_sessions: number | null; tooth_code: string | null }[]>(),
    negotiation
      ? supabase.from("plan_negotiation_items").select("item_id, included, program_discount_cents").eq("negotiation_id", negotiation.id)
      : Promise.resolve({ data: [] as { item_id: string; included: boolean; program_discount_cents: number | null }[] }),
    supabase.from("commercial_rules").select("clinic_id, budget_validity_days").returns<LinhaDeValidade[]>(),
    // OC-00158: o resumo que o Consultor escreveu no cockpit (`{{apresentacao_resumo}}`).
    // AP64 (C2): a negociação de um plano complementar leva o resumo da
    // apresentação DO COMPLEMENTO.
    complementoDaNegociacao(supabase, negotiation?.plan_id ?? planId).then((comp) =>
      lerApresentacao(supabase, clientId, comp).then((a) => ({ data: a ? { summary: a.summary } : null }))
    ),
  ]);
  const items = itemsRes.data ?? [];
  const negItems = new Map((negItemsRes.data ?? []).map((n) => [n.item_id, n]));
  const linhas = items.map((i) => ({
    id: i.id,
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: i.unit_price_cents,
    programDiscountCents: negItems.get(i.id)?.program_discount_cents ?? 0,
    plannedSessions: i.planned_sessions,
    toothCode: i.tooth_code,
    included: negotiation ? (negItems.get(i.id)?.included ?? true) : true,
  }));
  const numeros = negotiation
    ? numerosDoOrcamento(linhas, { adjustmentCents: negotiation.adjustment_cents, finalCents: negotiation.final_cents })
    : null;
  const incluidos = numeros ? numeros.incluidos : linhas;
  const totalCents = numeros ? numeros.totalCents : linhas.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);

  let conditions: string | null = null;
  if (negotiation?.payment_method) {
    const label = PAYMENT_METHOD_LABELS[negotiation.payment_method] ?? negotiation.payment_method;
    const parcelas = negotiation.installments && negotiation.installments > 1 ? ` em ${negotiation.installments} parcelas` : "";
    const entrada = negotiation.down_payment_cents ? `; entrada de ${formatBRL(negotiation.down_payment_cents)}` : "";
    conditions = `${label}${parcelas}${entrada}`;
  }
  const validadeDias = validadeDoOrcamento(rulesRes.data ?? [], clinicId);

  return {
    treatment: {
      procedures: incluidos.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        toothCode: i.toothCode,
        plannedSessions: i.plannedSessions,
      })),
      totalCents,
      conditions,
      validityIso: somarDias(todayInBrazil(), validadeDias),
      dentistName: null,
      presentationSummary: presRes.data?.summary ?? null,
    },
    negotiationId: negotiation?.id ?? null,
  };
}
