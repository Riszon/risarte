import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth";
import { QUEM_GRAVA_NA_REDE, canEditFinanceNetwork, canPostFinance } from "@/lib/finance/access";
import { AlertSettingsForm } from "../financeiro/configuracao/alerts-form";
import { FinanceiroDaRede, FinanceiroDaUnidade, type ValoresDaRede, type ValoresDaUnidade } from "./financeiro-form";

/**
 * A ABA FINANCEIRO (ASA1, entrega 1), nos dois níveis. Lê `finance_settings`
 * como a pessoa logada (a regra de linha decide); quem GRAVA é o Admin Master
 * e o Financeiro da Franqueadora (o banco e `canEditFinanceNetwork`).
 */

type Linha = {
  clinic_id: string | null;
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  rounding_mode: "half_up" | "half_even" | null;
  alert_overdue_percent: number | null;
  overdue_reissue_max_days?: number | null;
  gateway_rounding_tolerance_cents?: number | null;
  overdue_badge_business_days?: number | null;
};

async function lerLinhas(supabase: SupabaseClient): Promise<Linha[]> {
  const colunas = "clinic_id, late_fee_percent, monthly_interest_percent, rounding_mode, alert_overdue_percent";
  // 4006: com os dias úteis do selo "Em atraso".
  const com4006 = await supabase
    .from("finance_settings")
    .select(`${colunas}, overdue_reissue_max_days, gateway_rounding_tolerance_cents, overdue_badge_business_days`)
    .returns<Linha[]>();
  if (!com4006.error) return com4006.data ?? [];
  // 4004: com a coluna do limite da reemissão; sem a 4004, sem ela.
  const com = await supabase
    .from("finance_settings")
    .select(`${colunas}, overdue_reissue_max_days, gateway_rounding_tolerance_cents`)
    .returns<Linha[]>();
  if (!com.error) return com.data ?? [];
  // 4004 sem a 4005: só o limite da reemissão.
  const so4004 = await supabase.from("finance_settings").select(`${colunas}, overdue_reissue_max_days`).returns<Linha[]>();
  if (!so4004.error) return so4004.data ?? [];
  const { data } = await supabase.from("finance_settings").select(colunas).returns<Linha[]>();
  return data ?? [];
}

function daRede(linhas: Linha[]): ValoresDaRede {
  const r = linhas.find((l) => l.clinic_id === null);
  return {
    late_fee_percent: Number(r?.late_fee_percent ?? 2),
    monthly_interest_percent: Number(r?.monthly_interest_percent ?? 1),
    rounding_mode: r?.rounding_mode ?? "half_up",
    alert_overdue_percent: r?.alert_overdue_percent == null ? 5 : Number(r.alert_overdue_percent),
    overdue_reissue_max_days:
      r && "overdue_reissue_max_days" in r ? Number(r.overdue_reissue_max_days ?? 7) : null,
    gateway_rounding_tolerance_cents:
      r && "gateway_rounding_tolerance_cents" in r ? Number(r.gateway_rounding_tolerance_cents ?? 10) : null,
    overdue_badge_business_days:
      r && "overdue_badge_business_days" in r ? Number(r.overdue_badge_business_days ?? 3) : null,
  };
}

function daUnidade(linhas: Linha[], clinicId: string): ValoresDaUnidade | null {
  const u = linhas.find((l) => l.clinic_id === clinicId);
  if (!u) return null;
  const n = (v: number | null) => (v === null ? null : Number(v));
  return {
    late_fee_percent: n(u.late_fee_percent),
    monthly_interest_percent: n(u.monthly_interest_percent),
    rounding_mode: u.rounding_mode,
    alert_overdue_percent: n(u.alert_overdue_percent),
  };
}

function AvisoSoConsulta() {
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <strong>Só consulta.</strong> Quem altera multa e juros é {QUEM_GRAVA_NA_REDE}.
    </p>
  );
}

export async function AbaFinanceiroDaRede({
  supabase,
  session,
  franqueadoras,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
  franqueadoras: { id: string; name: string }[];
}) {
  const linhas = await lerLinhas(supabase);
  const rede = daRede(linhas);
  const podeEditar = canEditFinanceNetwork(session);
  return (
    <div className="space-y-4">
      {!podeEditar && <AvisoSoConsulta />}
      <FinanceiroDaRede rede={rede} canEdit={podeEditar} />
      {franqueadoras.map((f) => (
        <FinanceiroDaUnidade
          key={f.id}
          titulo={`${f.name} — as cobranças próprias da franqueadora`}
          clinicId={f.id}
          rede={rede}
          propria={daUnidade(linhas, f.id)}
          canEdit={podeEditar}
        />
      ))}
    </div>
  );
}

export async function AbaFinanceiroDaUnidade({
  supabase,
  session,
  clinicId,
  clinicName,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
  clinicId: string;
  clinicName: string;
}) {
  const [linhas, alertas] = await Promise.all([
    lerLinhas(supabase),
    supabase.rpc("finance_settings_for", { p_clinic_id: clinicId }),
  ]);
  const rede = daRede(linhas);
  const podeEditar = canEditFinanceNetwork(session);
  const cfg = ((alertas.data ?? []) as {
    alerts_enabled: boolean;
    alert_budget_percent: number;
    alert_cash_days: number;
    alert_breakeven_days: number;
    alert_overdue_cents: number;
  }[])[0];

  return (
    <div className="space-y-4">
      {!podeEditar && <AvisoSoConsulta />}
      <FinanceiroDaUnidade clinicId={clinicId} rede={rede} propria={daUnidade(linhas, clinicId)} canEdit={podeEditar} />
      <AlertSettingsForm
        clinicId={clinicId}
        clinicName={clinicName}
        canEdit={canPostFinance(session, clinicId)}
        initial={{
          enabled: cfg?.alerts_enabled ?? true,
          budgetPercent: Number(cfg?.alert_budget_percent ?? 90),
          cashDays: Number(cfg?.alert_cash_days ?? 15),
          breakevenDays: Number(cfg?.alert_breakeven_days ?? 7),
          overdueCents: Number(cfg?.alert_overdue_cents ?? 500000),
        }}
      />
    </div>
  );
}
