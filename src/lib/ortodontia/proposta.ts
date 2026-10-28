import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orthoClauses, type OrthoTerms } from "./regras";
import type { OrthoKind } from "./constants";

export type CondicoesOrtodonticas = {
  clausulas: string[];
  /** De onde vieram os números: do caso já aberto, ou do padrão da unidade. */
  origem: "caso" | "padrao";
  termos: OrthoTerms;
};

/** A especialidade "Ortodontia" (0129) em qualquer grafia. */
export function ehOrtodontia(specialty: string | null | undefined): boolean {
  return /ortod/i.test(specialty ?? "");
}

/**
 * As condições do tratamento ortodôntico para a PROPOSTA (orçamento impresso):
 * só quando a opção aceita tem procedimento de Ortodontia. Os números vêm do
 * caso aberto do paciente, se houver; senão, do padrão da unidade (cascata).
 * Toda leitura é à parte e tolerante: sem a 0329 no banco, nada sai.
 */
export async function condicoesOrtodonticas(
  supabase: SupabaseClient,
  input: { clientId: string; clinicId: string; procedureIds: string[] }
): Promise<CondicoesOrtodonticas | null> {
  const ids = [...new Set(input.procedureIds)].filter(Boolean);
  if (ids.length === 0) return null;

  const { data: procs, error } = await supabase
    .from("procedures")
    .select("id, specialty")
    .in("id", ids.slice(0, 150));
  if (error || !procs?.some((p) => ehOrtodontia(p.specialty as string | null))) return null;

  const { data: caso } = await supabase
    .from("ortho_cases")
    .select("treatment_kind, monthly_fee_cents, planned_months, maintenance_interval_days, billing_day, installation_fee_cents, retainer_charged, retainer_fee_cents, retainer_terms")
    .eq("client_id", input.clientId)
    .in("status", ["aguardando_inicio", "em_tratamento", "contencao"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (caso) {
    const termos: OrthoTerms = {
      kind: caso.treatment_kind as OrthoKind,
      monthlyCents: Number(caso.monthly_fee_cents ?? 0),
      plannedMonths: Number(caso.planned_months ?? 24),
      maintenanceIntervalDays: Number(caso.maintenance_interval_days ?? 30),
      billingDay: Number(caso.billing_day ?? 10),
      installationCents: Number(caso.installation_fee_cents ?? 0),
      retainerCharged: caso.retainer_charged === true,
      retainerFeeCents: Number(caso.retainer_fee_cents ?? 0),
      retainerTerms: (caso.retainer_terms as string | null) ?? null,
    };
    return { clausulas: orthoClauses(termos), origem: "caso", termos };
  }

  const { data: cfg, error: cfgErro } = await supabase.rpc("ortho_effective_settings", {
    p_clinic_id: input.clinicId,
  });
  if (cfgErro) return null;
  const s = (Array.isArray(cfg) ? cfg[0] : cfg) as
    | {
        monthly_fee_cents: number;
        planned_months: number;
        maintenance_interval_days: number;
        billing_day: number;
        retainer_charge_enabled?: boolean | null;
        retainer_fee_cents?: number | null;
        retainer_terms?: string | null;
      }
    | null
    | undefined;
  if (!s) return null;
  const termos: OrthoTerms = {
    kind: null,
    monthlyCents: Number(s.monthly_fee_cents ?? 0),
    plannedMonths: Number(s.planned_months ?? 24),
    maintenanceIntervalDays: Number(s.maintenance_interval_days ?? 30),
    billingDay: Number(s.billing_day ?? 10),
    installationCents: 0,
    retainerCharged: s.retainer_charge_enabled === true,
    retainerFeeCents: Number(s.retainer_fee_cents ?? 0),
    retainerTerms: s.retainer_terms ?? null,
  };
  return { clausulas: orthoClauses(termos), origem: "padrao", termos };
}
