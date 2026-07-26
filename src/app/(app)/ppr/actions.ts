"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatCpf } from "@/lib/masks";
import {
  canManagePpr,
  canSellPpr,
  extraDependentCount,
  maxDependentsOf,
  pprMonthlyCents,
  type PprPlan,
} from "@/lib/ppr/rules";
import type { PprRecurringMethod, PprSaleOrigin } from "@/lib/ppr/constants";
import type { UserRole } from "@/lib/roles";

export type PprActionResult = {
  ok: boolean;
  error?: string;
  membershipId?: string;
};

/** Dependente: ou já é cliente, ou é cadastrado na hora (CPF opcional). */
export type PprDependentInput = {
  clientId?: string;
  fullName?: string;
  cpf?: string;
  birthDate?: string;
  phone?: string;
  relationship: string;
};

type PlanRow = {
  id: string;
  name: string;
  monthly_cents: number;
  allows_dependents: boolean;
  included_dependents: number;
  allows_extra_dependents: boolean;
  extra_dependent_cents: number;
  max_dependents: number | null;
  is_active: boolean;
};

function toPlan(row: PlanRow): PprPlan {
  return {
    id: row.id,
    name: row.name,
    monthlyCents: row.monthly_cents,
    allowsDependents: row.allows_dependents,
    includedDependents: row.included_dependents,
    allowsExtraDependents: row.allows_extra_dependents,
    extraDependentCents: row.extra_dependent_cents,
    maxDependents: row.max_dependents,
    // Campos que não entram no cálculo da mensalidade.
    cashDiscountPercent: 0,
    maxInstallments: 1,
    minInstallmentCents: 0,
    gracePeriodDays: 0,
    socialEnabled: false,
    socialPointsPerCents: 5000,
  };
}

/** Código do cartão do beneficiário: PPR-XXXX-XXXX (sem letras ambíguas). */
function cardCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () =>
    Array.from(
      { length: 4 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  return `PPR-${block()}-${block()}`;
}

function rolesAt(
  session: Awaited<ReturnType<typeof getSessionContext>>,
  clinicId: string
): UserRole[] {
  return session.rolesByClinic[clinicId] ?? [];
}

function refresh(membershipId?: string, clientId?: string) {
  revalidatePath("/ppr");
  revalidatePath("/ppr/adesoes");
  if (membershipId) revalidatePath(`/ppr/adesoes/${membershipId}`);
  if (clientId) {
    revalidatePath(`/prontuarios/${clientId}`);
    revalidatePath(`/comercial/${clientId}`);
  }
}

async function logEvent(
  membershipId: string,
  clinicId: string,
  type: string,
  description: string
) {
  const session = await getSessionContext();
  const supabase = await createClient();
  await supabase.from("ppr_events").insert({
    membership_id: membershipId,
    clinic_id: clinicId,
    event_type: type,
    description,
    created_by: session.userId,
  });
}

// ---------------------------------------------------------------------------
// Venda / adesão
// ---------------------------------------------------------------------------

/**
 * Vende o PPR+ para um cliente: cria a adesão (aguardando ativação), o titular
 * e os dependentes. A adesão só vira ATIVA com contrato assinado + primeira
 * mensalidade confirmada (decisão 5).
 */
export async function createPprMembership(input: {
  clinicId: string;
  planId: string;
  holderClientId: string;
  origin: PprSaleOrigin;
  paymentMethod: PprRecurringMethod;
  billingDay: number;
  dependents: PprDependentInput[];
  notes?: string;
}): Promise<PprActionResult> {
  const session = await getSessionContext();
  if (
    !canSellPpr(rolesAt(session, input.clinicId), input.origin, session.isAdminMaster)
  ) {
    return { ok: false, error: "Você não pode vender o PPR+ por este fluxo." };
  }

  const supabase = await createClient();
  const { data: planRow } = await supabase
    .from("ppr_plans")
    .select(
      "id, name, monthly_cents, allows_dependents, included_dependents, allows_extra_dependents, extra_dependent_cents, max_dependents, is_active"
    )
    .eq("id", input.planId)
    .maybeSingle();
  if (!planRow || !(planRow as PlanRow).is_active)
    return { ok: false, error: "Plano indisponível." };
  const plan = toPlan(planRow as PlanRow);

  const deps = input.dependents.filter(
    (d) => d.clientId || (d.fullName ?? "").trim()
  );
  if (deps.length > 0 && !plan.allowsDependents)
    return { ok: false, error: `O ${plan.name} é individual, sem dependentes.` };
  const max = maxDependentsOf(plan);
  if (max !== null && deps.length > max)
    return {
      ok: false,
      error: `O ${plan.name} aceita no máximo ${max} dependente(s).`,
    };

  // Um cliente não pode ter duas adesões vivas ao mesmo tempo.
  const { data: current } = await supabase
    .from("ppr_beneficiaries")
    .select("membership_id, membership:ppr_memberships ( status )")
    .eq("client_id", input.holderClientId)
    .is("left_at", null);
  const alive = (current ?? []).some((r) => {
    const m = Array.isArray(r.membership) ? r.membership[0] : r.membership;
    return m && (m as { status: string }).status !== "cancelado";
  });
  if (alive)
    return { ok: false, error: "Este cliente já participa de um plano do PPR+." };

  const extras = extraDependentCount(plan, deps.length);
  const monthly = pprMonthlyCents(plan, extras);

  const { data: created, error } = await supabase
    .from("ppr_memberships")
    .insert({
      clinic_id: input.clinicId,
      plan_id: input.planId,
      holder_client_id: input.holderClientId,
      status: "aguardando_ativacao",
      monthly_cents: monthly,
      extra_dependents: extras,
      payment_method: input.paymentMethod,
      billing_day: input.billingDay,
      sale_origin: input.origin,
      sold_by: session.userId,
      notes: input.notes?.trim() || null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("createPprMembership failed:", error?.message);
    return { ok: false, error: "Não foi possível registrar a adesão." };
  }
  const membershipId = created.id as string;

  // Titular.
  const rows: Record<string, unknown>[] = [
    {
      membership_id: membershipId,
      clinic_id: input.clinicId,
      client_id: input.holderClientId,
      role: "titular",
      card_code: cardCode(),
    },
  ];

  // Dependentes: reaproveita o cliente que já existe (por CPF) e só cadastra
  // quem ainda não está na rede (decisão 8 — mesma unidade do titular).
  for (const [i, d] of deps.entries()) {
    let clientId = d.clientId ?? null;
    if (!clientId) {
      const cpf = d.cpf ? formatCpf(d.cpf) : "";
      if (cpf.replace(/\D/g, "").length === 11) {
        const { data: dup } = await supabase.rpc("find_duplicate_client", {
          p_cpf: cpf,
          p_full_name: "",
          p_birth_date: null,
        });
        if (dup && dup.length > 0) clientId = dup[0].client_id as string;
      }
      if (!clientId) {
        const { data: codeData } = await supabase.rpc("next_client_code", {
          p_clinic_id: input.clinicId,
        });
        const { data: newClient, error: cErr } = await supabase
          .from("clients")
          .insert({
            clinic_id: input.clinicId,
            full_name: (d.fullName ?? "").trim(),
            cpf: cpf || null,
            birth_date: d.birthDate || null,
            phone: d.phone || null,
            code: typeof codeData === "string" ? codeData : null,
            created_by: session.userId,
          })
          .select("id")
          .single();
        if (cErr || !newClient) {
          console.error("createPprMembership dependent failed:", cErr?.message);
          return {
            ok: false,
            error: `Não foi possível cadastrar o dependente ${d.fullName ?? ""}.`,
          };
        }
        clientId = newClient.id as string;
      }
    }
    rows.push({
      membership_id: membershipId,
      clinic_id: input.clinicId,
      client_id: clientId,
      role: "dependente",
      relationship: d.relationship?.trim() || null,
      card_code: cardCode(),
      is_extra: i >= plan.includedDependents,
    });
  }

  const { error: bErr } = await supabase.from("ppr_beneficiaries").insert(rows);
  if (bErr) {
    console.error("ppr_beneficiaries insert failed:", bErr.message);
    return { ok: false, error: "Adesão criada, mas falhou ao ligar os beneficiários." };
  }

  await logEvent(
    membershipId,
    input.clinicId,
    "adesao",
    `Adesão ao ${plan.name} — ${deps.length} dependente(s)`
  );
  await logAudit({
    action: "create",
    entityType: "ppr_membership",
    entityId: membershipId,
    clinicId: input.clinicId,
  });
  refresh(membershipId, input.holderClientId);
  return { ok: true, membershipId };
}

/**
 * Regra de ouro do PPR+: contrato assinado + 1ª mensalidade confirmada. Com os
 * dois marcados, a adesão vira ATIVA e a carência começa a contar.
 */
export async function pprCloseStep(
  membershipId: string,
  step: "contract" | "payment",
  value: boolean
): Promise<PprActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select(
      "id, clinic_id, status, contract_signed, first_payment_confirmed, holder_client_id"
    )
    .eq("id", membershipId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Adesão não encontrada." };
  if (m.status === "cancelado")
    return { ok: false, error: "Adesão cancelada." };

  const roles = rolesAt(session, m.clinic_id as string);
  const allowed =
    session.isAdminMaster ||
    canSellPpr(roles, "venda_direta") ||
    canSellPpr(roles, "comercial") ||
    canManagePpr(roles);
  if (!allowed) return { ok: false, error: "Você não pode alterar esta adesão." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (step === "contract") {
    patch.contract_signed = value;
    patch.contract_signed_at = value ? now : null;
    patch.contract_signed_by = value ? session.userId : null;
  } else {
    patch.first_payment_confirmed = value;
    patch.first_payment_at = value ? now : null;
    patch.first_payment_by = value ? session.userId : null;
  }

  const contract = step === "contract" ? value : (m.contract_signed as boolean);
  const paid = step === "payment" ? value : (m.first_payment_confirmed as boolean);
  const activating = contract && paid && m.status === "aguardando_ativacao";
  if (activating) {
    patch.status = "ativo";
    patch.activated_at = now;
  }

  const { error } = await supabase
    .from("ppr_memberships")
    .update(patch)
    .eq("id", membershipId);
  if (error) {
    console.error("pprCloseStep failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a adesão." };
  }

  await logEvent(
    membershipId,
    m.clinic_id as string,
    activating ? "ativacao" : step,
    activating
      ? "Plano ATIVADO (contrato assinado + 1ª mensalidade confirmada)"
      : step === "contract"
        ? value
          ? "Contrato de adesão assinado"
          : "Assinatura do contrato desmarcada"
        : value
          ? "Primeira mensalidade confirmada"
          : "Pagamento desmarcado"
  );
  await logAudit({
    action: "update",
    entityType: "ppr_membership",
    entityId: membershipId,
    clinicId: m.clinic_id as string,
  });
  refresh(membershipId, m.holder_client_id as string);
  return { ok: true };
}

/** Cancela a adesão: todos perdem os benefícios e o selo (fica no histórico). */
export async function cancelPprMembership(
  membershipId: string,
  reason: string
): Promise<PprActionResult> {
  const session = await getSessionContext();
  if (!reason.trim())
    return { ok: false, error: "Informe o motivo do cancelamento." };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select("id, clinic_id, holder_client_id, status")
    .eq("id", membershipId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Adesão não encontrada." };
  if (!canManagePpr(rolesAt(session, m.clinic_id as string), session.isAdminMaster))
    return { ok: false, error: "Só o Gerente da unidade pode cancelar." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ppr_memberships")
    .update({
      status: "cancelado",
      cancelled_at: now,
      cancelled_by: session.userId,
      cancel_reason: reason.trim(),
      updated_at: now,
    })
    .eq("id", membershipId);
  if (error) return { ok: false, error: "Não foi possível cancelar." };

  await logEvent(
    membershipId,
    m.clinic_id as string,
    "cancelamento",
    `Cancelado — ${reason.trim()}`
  );
  await logAudit({
    action: "update",
    entityType: "ppr_membership_cancel",
    entityId: membershipId,
    clinicId: m.clinic_id as string,
  });
  refresh(membershipId, m.holder_client_id as string);
  return { ok: true };
}

/** Suspende/reativa manualmente (a suspensão automática vem no PPR6). */
export async function setPprStatus(
  membershipId: string,
  status: "ativo" | "suspenso"
): Promise<PprActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select("id, clinic_id, holder_client_id, contract_signed, first_payment_confirmed")
    .eq("id", membershipId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Adesão não encontrada." };
  if (!canManagePpr(rolesAt(session, m.clinic_id as string), session.isAdminMaster))
    return { ok: false, error: "Só o Gerente da unidade pode fazer isso." };
  if (status === "ativo" && !(m.contract_signed && m.first_payment_confirmed))
    return {
      ok: false,
      error: "Para ativar, o contrato precisa estar assinado e a 1ª mensalidade paga.",
    };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ppr_memberships")
    .update({
      status,
      suspended_at: status === "suspenso" ? now : null,
      activated_at: status === "ativo" ? now : undefined,
      updated_at: now,
    })
    .eq("id", membershipId);
  if (error) return { ok: false, error: "Não foi possível alterar a situação." };

  await logEvent(
    membershipId,
    m.clinic_id as string,
    status,
    status === "suspenso" ? "Plano suspenso" : "Plano reativado"
  );
  refresh(membershipId, m.holder_client_id as string);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dependentes depois da venda
// ---------------------------------------------------------------------------

/** Recalcula a mensalidade pelo número de dependentes vivos na adesão. */
async function recalcMonthly(membershipId: string) {
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select("id, plan:ppr_plans ( * )")
    .eq("id", membershipId)
    .maybeSingle();
  if (!m) return;
  const planRow = (Array.isArray(m.plan) ? m.plan[0] : m.plan) as PlanRow | null;
  if (!planRow) return;
  const { count } = await supabase
    .from("ppr_beneficiaries")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membershipId)
    .eq("role", "dependente")
    .is("left_at", null);
  const plan = toPlan(planRow);
  const deps = count ?? 0;
  await supabase
    .from("ppr_memberships")
    .update({
      extra_dependents: extraDependentCount(plan, deps),
      monthly_cents: pprMonthlyCents(plan, extraDependentCount(plan, deps)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);
}

export async function addPprDependent(
  membershipId: string,
  dependent: PprDependentInput
): Promise<PprActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select("id, clinic_id, status, holder_client_id, plan:ppr_plans ( * )")
    .eq("id", membershipId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Adesão não encontrada." };
  if (m.status === "cancelado")
    return { ok: false, error: "Adesão cancelada." };
  const roles = rolesAt(session, m.clinic_id as string);
  if (
    !session.isAdminMaster &&
    !canSellPpr(roles, "venda_direta") &&
    !canSellPpr(roles, "comercial") &&
    !canManagePpr(roles)
  )
    return { ok: false, error: "Você não pode alterar esta adesão." };

  const planRow = (Array.isArray(m.plan) ? m.plan[0] : m.plan) as PlanRow | null;
  if (!planRow) return { ok: false, error: "Plano não encontrado." };
  const plan = toPlan(planRow);
  const { count } = await supabase
    .from("ppr_beneficiaries")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membershipId)
    .eq("role", "dependente")
    .is("left_at", null);
  const current = count ?? 0;
  const max = maxDependentsOf(plan);
  if (!plan.allowsDependents)
    return { ok: false, error: "Este plano é individual." };
  if (max !== null && current >= max)
    return { ok: false, error: `Este plano aceita no máximo ${max} dependente(s).` };

  let clientId = dependent.clientId ?? null;
  if (!clientId) {
    const cpf = dependent.cpf ? formatCpf(dependent.cpf) : "";
    if (cpf.replace(/\D/g, "").length === 11) {
      const { data: dup } = await supabase.rpc("find_duplicate_client", {
        p_cpf: cpf,
        p_full_name: "",
        p_birth_date: null,
      });
      if (dup && dup.length > 0) clientId = dup[0].client_id as string;
    }
    if (!clientId) {
      const { data: codeData } = await supabase.rpc("next_client_code", {
        p_clinic_id: m.clinic_id as string,
      });
      const { data: newClient, error: cErr } = await supabase
        .from("clients")
        .insert({
          clinic_id: m.clinic_id,
          full_name: (dependent.fullName ?? "").trim(),
          cpf: cpf || null,
          birth_date: dependent.birthDate || null,
          phone: dependent.phone || null,
          code: typeof codeData === "string" ? codeData : null,
          created_by: session.userId,
        })
        .select("id")
        .single();
      if (cErr || !newClient)
        return { ok: false, error: "Não foi possível cadastrar o dependente." };
      clientId = newClient.id as string;
    }
  }

  const { error } = await supabase.from("ppr_beneficiaries").insert({
    membership_id: membershipId,
    clinic_id: m.clinic_id,
    client_id: clientId,
    role: "dependente",
    relationship: dependent.relationship?.trim() || null,
    card_code: cardCode(),
    is_extra: current >= plan.includedDependents,
  });
  if (error) {
    console.error("addPprDependent failed:", error.message);
    return { ok: false, error: "Não foi possível incluir o dependente." };
  }

  await recalcMonthly(membershipId);
  await logEvent(
    membershipId,
    m.clinic_id as string,
    "dependente_incluido",
    `Dependente incluído (${dependent.relationship ?? "—"})`
  );
  refresh(membershipId, m.holder_client_id as string);
  return { ok: true };
}

/** Tira um dependente do plano (o titular sai só cancelando a adesão). */
export async function removePprBeneficiary(
  beneficiaryId: string
): Promise<PprActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("ppr_beneficiaries")
    .select("id, membership_id, clinic_id, client_id, role")
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (!b) return { ok: false, error: "Beneficiário não encontrado." };
  if (b.role === "titular")
    return { ok: false, error: "O titular sai apenas cancelando a adesão." };
  const roles = rolesAt(session, b.clinic_id as string);
  if (
    !session.isAdminMaster &&
    !canSellPpr(roles, "venda_direta") &&
    !canSellPpr(roles, "comercial") &&
    !canManagePpr(roles)
  )
    return { ok: false, error: "Você não pode alterar esta adesão." };

  const { error } = await supabase
    .from("ppr_beneficiaries")
    .update({ left_at: new Date().toISOString() })
    .eq("id", beneficiaryId);
  if (error) return { ok: false, error: "Não foi possível remover." };

  await recalcMonthly(b.membership_id as string);
  await logEvent(
    b.membership_id as string,
    b.clinic_id as string,
    "dependente_removido",
    "Dependente saiu do plano"
  );
  refresh(b.membership_id as string, b.client_id as string);
  return { ok: true };
}
