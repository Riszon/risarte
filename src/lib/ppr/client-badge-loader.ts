import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PprStatus } from "./constants";

export type PprFamilyMember = {
  beneficiaryId: string;
  clientId: string;
  name: string;
  code: string | null;
  relationship: string | null;
  cardCode: string | null;
};

export type PprClientBadge = {
  membershipId: string;
  beneficiaryId: string;
  planName: string;
  status: PprStatus;
  role: "titular" | "dependente";
  relationship: string | null;
  cardCode: string | null;
  monthlyCents: number;
  activatedAt: string | null;
  /** Preenchido quando o cliente é DEPENDENTE. */
  holder: PprFamilyMember | null;
  /** Preenchido quando o cliente é TITULAR. */
  dependents: PprFamilyMember[];
};

export type PprPastMembership = {
  planName: string;
  cancelledAt: string | null;
  reason: string | null;
};

type BenRow = {
  id: string;
  role: string;
  relationship: string | null;
  card_code: string | null;
  left_at: string | null;
  client:
    | { id: string; full_name: string; code: string | null }
    | { id: string; full_name: string; code: string | null }[]
    | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function toMember(b: BenRow): PprFamilyMember | null {
  const c = one(b.client);
  if (!c) return null;
  return {
    beneficiaryId: b.id,
    clientId: c.id,
    name: c.full_name,
    code: c.code,
    relationship: b.relationship,
    cardCode: b.card_code,
  };
}

/**
 * O que o prontuário precisa saber sobre o PPR+ deste cliente: o selo (plano +
 * situação), se é titular ou dependente, a família ligada a ele e os planos que
 * já teve (o cancelado sai do selo e fica só no histórico).
 */
export async function loadPprClientBadge(clientId: string): Promise<{
  current: PprClientBadge | null;
  past: PprPastMembership[];
}> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("ppr_beneficiaries")
    .select(
      "id, membership_id, role, relationship, card_code, left_at, membership:ppr_memberships ( id, status, monthly_cents, activated_at, cancelled_at, cancel_reason, plan:ppr_plans ( name ) )"
    )
    .eq("client_id", clientId);
  if (error) {
    console.error("loadPprClientBadge failed:", error.message);
    return { current: null, past: [] };
  }

  type Row = {
    id: string;
    membership_id: string;
    role: string;
    relationship: string | null;
    card_code: string | null;
    left_at: string | null;
    membership:
      | {
          id: string;
          status: string;
          monthly_cents: number;
          activated_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          plan: { name: string } | { name: string }[] | null;
        }
      | {
          id: string;
          status: string;
          monthly_cents: number;
          activated_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          plan: { name: string } | { name: string }[] | null;
        }[]
      | null;
  };

  const past: PprPastMembership[] = [];
  let live: Row | null = null;
  for (const r of (rows ?? []) as Row[]) {
    const m = one(r.membership);
    if (!m) continue;
    const planName = one(m.plan)?.name ?? "Plano";
    if (m.status === "cancelado" || r.left_at) {
      past.push({
        planName,
        cancelledAt: m.cancelled_at,
        reason: m.cancel_reason,
      });
      continue;
    }
    live = r;
  }
  if (!live) return { current: null, past };

  const m = one(live.membership)!;
  const planName = one(m.plan)?.name ?? "Plano";

  // Família da adesão (titular + dependentes ativos), para os links cruzados.
  const { data: familyRows } = await supabase
    .from("ppr_beneficiaries")
    .select(
      "id, role, relationship, card_code, left_at, client:clients!ppr_beneficiaries_client_id_fkey ( id, full_name, code )"
    )
    .eq("membership_id", live.membership_id)
    .is("left_at", null);
  const family = (familyRows ?? []) as BenRow[];

  const holderRow = family.find((b) => b.role === "titular");
  const dependents = family
    .filter((b) => b.role === "dependente" && b.id !== live.id)
    .map(toMember)
    .filter((x): x is PprFamilyMember => Boolean(x));

  return {
    current: {
      membershipId: live.membership_id,
      beneficiaryId: live.id,
      planName,
      status: m.status as PprStatus,
      role: live.role === "titular" ? "titular" : "dependente",
      relationship: live.relationship,
      cardCode: live.card_code,
      monthlyCents: m.monthly_cents,
      activatedAt: m.activated_at,
      holder:
        live.role === "dependente" && holderRow ? toMember(holderRow) : null,
      dependents: live.role === "titular" ? dependents : [],
    },
    past,
  };
}
