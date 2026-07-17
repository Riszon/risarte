import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SlaSettingRow, InactivitySettingRow } from "@/lib/sla";
import { SlaEditor } from "./sla-editor";
import { InactivityEditor } from "./inactivity-editor";

export const metadata: Metadata = { title: "Prazos (SLA)" };

export default async function SlaPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: rows }, { data: clinics }, { data: inactivityRows }] =
    await Promise.all([
      supabase
        .from("sla_settings")
        .select("id, clinic_id, sla_key, hours")
        .returns<SlaSettingRow[]>(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("inactivity_settings")
        .select("id, clinic_id, setting_key, value_days")
        .returns<InactivitySettingRow[]>(),
    ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Prazos (SLA)
        </h1>
        <p className="text-sm text-muted-foreground">
          Prazos máximos de cada passo da jornada, em horas. O padrão vale
          para toda a rede; unidades podem ter prazos próprios.
        </p>
      </div>
      <SlaEditor rows={rows ?? []} clinics={clinics ?? []} />

      <div className="pt-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Regras de Ativo/Inativo
        </h2>
        <p className="text-sm text-muted-foreground">
          Prazos (em dias) que definem automaticamente quando um cliente fica
          inativo, por fase.
        </p>
      </div>
      <InactivityEditor rows={inactivityRows ?? []} clinics={clinics ?? []} />
    </div>
  );
}
