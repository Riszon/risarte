import "server-only";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canSellPpr } from "./rules";
import type { PprSaleOrigin, PprStatus } from "./constants";

export type PprOfferPlan = {
  id: string;
  name: string;
  description: string | null;
  monthlyCents: number;
  allowsDependents: boolean;
  includedDependents: number;
  allowsExtraDependents: boolean;
  extraDependentCents: number;
  maxDependents: number | null;
  perks: string[];
};

/** Plano anterior do cliente em OUTRA unidade — base da continuidade (PPR5). */
export type PprPreviousMembership = {
  id: string;
  planId: string;
  planName: string;
  clinicName: string | null;
  cancelledAt: string | null;
  dependents: {
    clientId: string;
    name: string;
    relationship: string | null;
    clinicId: string;
  }[];
};

export type PprOfferContext = {
  /** O usuário pode vender o PPR+ por este fluxo? */
  canSell: boolean;
  plans: PprOfferPlan[];
  /** Adesão viva do cliente (se já participa). */
  membership: {
    id: string;
    status: PprStatus;
    planName: string;
    role: "titular" | "dependente";
  } | null;
  /** Unidades da rede (o dependente pode ficar em outra unidade). */
  units: { id: string; name: string }[];
  /** Último plano cancelado do cliente — para sugerir a continuidade. */
  previous: PprPreviousMembership | null;
};

/**
 * Tudo que o botão "Oferecer PPR+" precisa: planos ativos com as vantagens e a
 * situação atual do cliente no programa.
 */
export async function loadPprOffer(
  clientId: string,
  clinicId: string,
  origin: PprSaleOrigin
): Promise<PprOfferContext> {
  const session = await getSessionContext();
  const canSell = canSellPpr(
    session.rolesByClinic[clinicId] ?? [],
    origin,
    session.isAdminMaster
  );

  const supabase = await createClient();
  const [{ data: planRows }, { data: perkRows }, { data: benRows }] =
    await Promise.all([
      supabase
        .from("ppr_plans")
        .select(
          "id, name, description, monthly_cents, allows_dependents, included_dependents, allows_extra_dependents, extra_dependent_cents, max_dependents, sort_order"
        )
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("ppr_plan_perks")
        .select("plan_id, label, sort_order")
        .order("sort_order"),
      supabase
        .from("ppr_beneficiaries")
        .select(
          "id, role, membership:ppr_memberships ( id, status, plan:ppr_plans ( name ) )"
        )
        .eq("client_id", clientId)
        .is("left_at", null),
    ]);

  const perks = (perkRows ?? []) as { plan_id: string; label: string }[];
  const plans: PprOfferPlan[] = (
    (planRows ?? []) as {
      id: string;
      name: string;
      description: string | null;
      monthly_cents: number;
      allows_dependents: boolean;
      included_dependents: number;
      allows_extra_dependents: boolean;
      extra_dependent_cents: number;
      max_dependents: number | null;
    }[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    monthlyCents: p.monthly_cents,
    allowsDependents: p.allows_dependents,
    includedDependents: p.included_dependents,
    allowsExtraDependents: p.allows_extra_dependents,
    extraDependentCents: p.extra_dependent_cents,
    maxDependents: p.max_dependents,
    perks: perks.filter((k) => k.plan_id === p.id).map((k) => k.label),
  }));

  let membership: PprOfferContext["membership"] = null;
  for (const row of (benRows ?? []) as {
    role: string;
    membership:
      | { id: string; status: string; plan: { name: string } | { name: string }[] | null }
      | { id: string; status: string; plan: { name: string } | { name: string }[] | null }[]
      | null;
  }[]) {
    const m = Array.isArray(row.membership) ? row.membership[0] : row.membership;
    if (!m || m.status === "cancelado") continue;
    const plan = Array.isArray(m.plan) ? m.plan[0] : m.plan;
    membership = {
      id: m.id,
      status: m.status as PprStatus,
      planName: plan?.name ?? "Plano",
      role: row.role === "titular" ? "titular" : "dependente",
    };
    break;
  }

  // Unidades da rede — o dependente pode ficar em outra unidade (PPR5).
  const { data: unitRows } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");
  const units = (unitRows ?? []) as { id: string; name: string }[];

  // Continuidade: se o cliente já teve um plano (cancelado, normalmente por
  // transferência de unidade), a nova unidade puxa plano e dependentes.
  let previous: PprPreviousMembership | null = null;
  if (!membership) {
    const { data: prevRows } = await supabase
      .from("ppr_memberships")
      .select(
        "id, plan_id, cancelled_at, clinic_id, plan:ppr_plans ( name ), clinic:clinics!ppr_memberships_clinic_id_fkey ( name )"
      )
      .eq("holder_client_id", clientId)
      .eq("status", "cancelado")
      .order("cancelled_at", { ascending: false })
      .limit(1);
    const prev = (prevRows ?? [])[0] as
      | {
          id: string;
          plan_id: string;
          cancelled_at: string | null;
          clinic_id: string;
          plan: { name: string } | { name: string }[] | null;
          clinic: { name: string } | { name: string }[] | null;
        }
      | undefined;
    if (prev) {
      const { data: depRows } = await supabase
        .from("ppr_beneficiaries")
        .select(
          "client_id, relationship, clinic_id, client:clients!ppr_beneficiaries_client_id_fkey ( full_name )"
        )
        .eq("membership_id", prev.id)
        .eq("role", "dependente")
        .is("left_at", null);
      const planEmbed = Array.isArray(prev.plan) ? prev.plan[0] : prev.plan;
      const clinicEmbed = Array.isArray(prev.clinic) ? prev.clinic[0] : prev.clinic;
      previous = {
        id: prev.id,
        planId: prev.plan_id,
        planName: planEmbed?.name ?? "Plano",
        clinicName: clinicEmbed?.name ?? null,
        cancelledAt: prev.cancelled_at,
        dependents: (
          (depRows ?? []) as {
            client_id: string;
            relationship: string | null;
            clinic_id: string;
            client: { full_name: string } | { full_name: string }[] | null;
          }[]
        ).map((d) => {
          const c = Array.isArray(d.client) ? d.client[0] : d.client;
          return {
            clientId: d.client_id,
            name: c?.full_name ?? "Dependente",
            relationship: d.relationship,
            clinicId: d.clinic_id,
          };
        }),
      };
    }
  }

  return { canSell, plans, membership, units, previous };
}
