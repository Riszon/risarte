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

  return { canSell, plans, membership };
}
