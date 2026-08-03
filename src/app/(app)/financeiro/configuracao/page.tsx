import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";
import { FinanceSettingsForm, type SettingsRow } from "./settings-form";

/**
 * FIN0 — configuração financeira em CASCATA: o padrão da rede vale para todas
 * as unidades; cada unidade pode sobrescrever. A tela deixa explícito o que é
 * herdado e o que foi sobrescrito (pedido do dono).
 */
export default async function FinanceSettingsPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const supabase = await createClient();
  const [{ data: settings }, { data: clinics }] = await Promise.all([
    supabase
      .from("finance_settings")
      .select(
        "clinic_id, late_fee_percent, monthly_interest_percent, grace_days, rounding_mode"
      )
      .returns<SettingsRow[]>(),
    supabase
      .from("clinics")
      .select("id, name, type, ownership")
      .eq("is_active", true)
      .order("name"),
  ]);

  const network =
    (settings ?? []).find((s) => s.clinic_id === null) ?? {
      clinic_id: null,
      late_fee_percent: 2,
      monthly_interest_percent: 1,
      grace_days: 0,
      rounding_mode: "half_up" as const,
    };
  const overrides = (settings ?? []).filter((s) => s.clinic_id !== null);

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
    </div>
  );
}
