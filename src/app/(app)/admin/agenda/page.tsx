import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAgendaSettings,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { AgendaSettingsEditor } from "./agenda-settings-editor";

export const metadata: Metadata = { title: "Configuração da Agenda" };

export default async function AgendaConfigPage(
  props: PageProps<"/admin/agenda">
) {
  await requireAdminMaster();
  const sp = await props.searchParams;
  const scope = typeof sp.unidade === "string" ? sp.unidade : "";

  const supabase = await createClient();
  const [{ data: rows }, { data: units }] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select("clinic_id, open_time, close_time, weekdays, chairs")
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name"),
  ]);

  const allRows = rows ?? [];
  const scopeRow = scope
    ? allRows.find((r) => r.clinic_id === scope)
    : allRows.find((r) => r.clinic_id === null);
  const hasOverride = Boolean(scope) && Boolean(scopeRow);
  // When a unit has no override yet, show the inherited (network) values.
  const values = resolveAgendaSettings(allRows, scope || null);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Configuração da Agenda
        </h1>
        <p className="text-sm text-muted-foreground">
          Horário de funcionamento, dias de atendimento e nº de cadeiras. O
          padrão da rede vale para todas as unidades; cada unidade pode ter o
          seu. A agenda passa a respeitar essas regras (exceto Urgência/Emergência).
        </p>
      </div>
      <AgendaSettingsEditor
        scope={scope}
        units={units ?? []}
        values={values}
        hasOverride={hasOverride}
      />
    </div>
  );
}
