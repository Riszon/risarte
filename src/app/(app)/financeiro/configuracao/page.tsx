import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canConfigureFinanceNetwork,
  canPostFinance,
  canViewFinance,
} from "@/lib/finance/access";
import { FinanceSettingsForm, type SettingsRow } from "./settings-form";
import { AlertSettingsForm } from "./alerts-form";

/**
 * Linha crua da tabela: desde a 0230 as colunas antigas são ANULÁVEIS, para a
 * cascata funcionar campo a campo de verdade. A tela resolve o que está nulo
 * contra a rede antes de exibir — que é exatamente o que vale na prática.
 */
type RawSettingsRow = {
  clinic_id: string | null;
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  grace_days: number | null;
  rounding_mode: "half_up" | "half_even" | null;
  alert_overdue_percent: number | null;
};

/**
 * FIN0 — configuração financeira em CASCATA: o padrão da rede vale para todas
 * as unidades; cada unidade pode sobrescrever. A tela deixa explícito o que é
 * herdado e o que foi sobrescrito (pedido do dono).
 */
export default async function FinanceSettingsPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const activeClinic = session.activeClinic?.id ?? null;
  const supabase = await createClient();
  const [{ data: settings }, { data: clinics }, { data: alertCfg }] =
    await Promise.all([
      supabase
        .from("finance_settings")
        .select(
          "clinic_id, late_fee_percent, monthly_interest_percent, grace_days, rounding_mode, alert_overdue_percent"
        )
        .returns<RawSettingsRow[]>(),
      supabase
        .from("clinics")
        .select("id, name, type, ownership")
        .eq("is_active", true)
        .order("name"),
      activeClinic
        ? supabase.rpc("finance_settings_for", { p_clinic_id: activeClinic })
        : Promise.resolve({ data: null }),
    ]);

  const rawNetwork = (settings ?? []).find((s) => s.clinic_id === null);
  const network: SettingsRow = {
    clinic_id: null,
    late_fee_percent: rawNetwork?.late_fee_percent ?? 2,
    monthly_interest_percent: rawNetwork?.monthly_interest_percent ?? 1,
    grace_days: rawNetwork?.grace_days ?? 0,
    rounding_mode: rawNetwork?.rounding_mode ?? "half_up",
    alert_overdue_percent: rawNetwork?.alert_overdue_percent ?? 5,
  };

  // Campo nulo na unidade = herdado da rede. Mostrar o valor que VALE evita a
  // tela dizer "0%" onde a unidade só não sobrescreveu nada.
  const overrides: SettingsRow[] = (settings ?? [])
    .filter((s) => s.clinic_id !== null)
    .map((s) => ({
      clinic_id: s.clinic_id,
      late_fee_percent: s.late_fee_percent ?? network.late_fee_percent,
      monthly_interest_percent:
        s.monthly_interest_percent ?? network.monthly_interest_percent,
      grace_days: s.grace_days ?? network.grace_days,
      rounding_mode: s.rounding_mode ?? network.rounding_mode,
      // ⚠️ ESTE NÃO HERDA NA EXIBIÇÃO, de propósito. Nos outros campos mostrar
      // o valor da rede ajuda; aqui o VAZIO é a informação — ele diz que a
      // unidade não tem teto próprio. Preenchendo com o da rede, salvar
      // gravaria uma exceção que ninguém pediu, e a unidade deixaria de
      // acompanhar a rede sem nada na tela denunciando.
      alert_overdue_percent: s.alert_overdue_percent ?? null,
    }));

  const cfg = (
    (alertCfg ?? []) as {
      alerts_enabled: boolean;
      alert_budget_percent: number;
      alert_cash_days: number;
      alert_breakeven_days: number;
      alert_overdue_cents: number;
    }[]
  )[0];

  // Gerente/Franqueado veem SÓ a configuração que vale para a própria unidade
  // (decisão do dono, 31/07/2026) — nada da rede nem das outras unidades.
  const isNetworkAdmin = canConfigureFinanceNetwork(session);
  const activeClinicId = session.activeClinic?.id ?? null;
  const visibleClinics = (clinics ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      type: c.type as "franchisor" | "franchise_unit",
    }))
    .filter((c) => isNetworkAdmin || c.id === activeClinicId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-primary" />
          Configuração financeira
        </h1>
        <p className="text-sm text-muted-foreground">
          {isNetworkAdmin
            ? "Multa, juros e carência de atraso. O padrão da rede vale para todas as unidades; a unidade só precisa de configuração própria quando for diferente."
            : "Multa, juros e carência de atraso que valem para a sua unidade. Quem define é a Franqueadora."}
        </p>
      </div>

      <FinanceSettingsForm
        network={network}
        overrides={overrides}
        clinics={visibleClinics}
        canEdit={isNetworkAdmin}
        showNetwork={isNetworkAdmin}
      />

      {activeClinicId && (
        <AlertSettingsForm
          clinicId={activeClinicId}
          clinicName={session.activeClinic?.name ?? "unidade"}
          canEdit={canPostFinance(session, activeClinicId)}
          initial={{
            enabled: cfg?.alerts_enabled ?? true,
            budgetPercent: Number(cfg?.alert_budget_percent ?? 90),
            cashDays: Number(cfg?.alert_cash_days ?? 15),
            breakevenDays: Number(cfg?.alert_breakeven_days ?? 7),
            overdueCents: Number(cfg?.alert_overdue_cents ?? 500000),
          }}
        />
      )}
    </div>
  );
}
