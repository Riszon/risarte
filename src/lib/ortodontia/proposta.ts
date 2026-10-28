import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orthoClauses, type OrthoTerms } from "./regras";
import type { OrthoKind, OrthoRetainerKind } from "./constants";
import { CASE_TERMS_EMBED } from "./db";

export type CondicoesOrtodonticas = {
  clausulas: string[];
  /**
   * De onde vieram os números: do caso já aberto; da proposta do Planner na
   * opção (ORTO7) + padrão da unidade para o dinheiro; ou só do padrão.
   */
  origem: "caso" | "proposta" | "padrao";
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
  input: { clientId: string; clinicId: string; procedureIds: string[]; optionId?: string | null }
): Promise<CondicoesOrtodonticas | null> {
  const ids = [...new Set(input.procedureIds)].filter(Boolean);
  if (ids.length === 0) return null;

  const { data: procs, error } = await supabase
    .from("procedures")
    .select("id, specialty")
    .in("id", ids.slice(0, 150));
  if (error || !procs?.some((p) => ehOrtodontia(p.specialty as string | null))) return null;

  // ORTO7 (0333): as características que o Planner definiu na opção (tipo,
  // meses de referência, intervalo, contenção final). Sem proposta, nulo.
  type Proposta = {
    treatment_kind: string;
    planned_months: number;
    maintenance_interval_days: number;
    retainer_kind: string;
  };
  let proposta: Proposta | null = null;
  if (input.optionId) {
    const { data } = await supabase
      .from("treatment_plan_ortho")
      .select("treatment_kind, planned_months, maintenance_interval_days, retainer_kind")
      .eq("option_id", input.optionId)
      .maybeSingle();
    proposta = (data as Proposta | null) ?? null;
  }

  // 0332: o dinheiro do caso vive na irmã `ortho_case_terms` (só quem vê
  // dinheiro a lê). Sem a irmã na resposta, vale o padrão da unidade.
  const { data: caso } = await supabase
    .from("ortho_cases")
    .select(`treatment_kind, planned_months, maintenance_interval_days, ${CASE_TERMS_EMBED}`)
    .eq("client_id", input.clientId)
    .in("status", ["aguardando_inicio", "em_tratamento", "contencao"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type Terms = {
    monthly_fee_cents: number | null;
    billing_day: number | null;
    installation_fee_cents: number | null;
    retainer_charged: boolean | null;
    retainer_fee_cents: number | null;
    retainer_terms: string | null;
  };
  const t = caso ? (Array.isArray(caso.terms) ? (caso.terms[0] as Terms | undefined) ?? null : (caso.terms as Terms | null)) : null;
  if (caso && t) {
    const termos: OrthoTerms = {
      kind: caso.treatment_kind as OrthoKind,
      monthlyCents: Number(t.monthly_fee_cents ?? 0),
      plannedMonths: Number(caso.planned_months ?? 24),
      maintenanceIntervalDays: Number(caso.maintenance_interval_days ?? 30),
      billingDay: Number(t.billing_day ?? 10),
      installationCents: Number(t.installation_fee_cents ?? 0),
      retainerCharged: t.retainer_charged === true,
      retainerFeeCents: Number(t.retainer_fee_cents ?? 0),
      retainerTerms: t.retainer_terms ?? null,
      retainerKind: (proposta?.retainer_kind as OrthoRetainerKind | undefined) ?? null,
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
  // Sem caso: as características vêm da proposta do Planner (quando há) e o
  // dinheiro do padrão da unidade — o Comercial ajusta na negociação (ORTO8).
  const termos: OrthoTerms = {
    kind: (proposta?.treatment_kind as OrthoKind | undefined) ?? null,
    monthlyCents: Number(s.monthly_fee_cents ?? 0),
    plannedMonths: Number(proposta?.planned_months ?? s.planned_months ?? 24),
    maintenanceIntervalDays: Number(proposta?.maintenance_interval_days ?? s.maintenance_interval_days ?? 30),
    billingDay: Number(s.billing_day ?? 10),
    installationCents: 0,
    retainerCharged: s.retainer_charge_enabled === true,
    retainerFeeCents: Number(s.retainer_fee_cents ?? 0),
    retainerTerms: s.retainer_terms ?? null,
    retainerKind: (proposta?.retainer_kind as OrthoRetainerKind | undefined) ?? null,
  };
  return { clausulas: orthoClauses(termos), origem: proposta ? "proposta" : "padrao", termos };
}
