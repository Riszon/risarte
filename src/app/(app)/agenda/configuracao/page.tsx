import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  resolveAgendaSettings,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { mapRoom, sortRooms, type RoomRow } from "@/lib/rooms";
import { AgendaConfigEditor } from "./agenda-config-editor";

export const metadata: Metadata = { title: "Configurar agenda" };

export default async function AgendaConfigPage() {
  const session = await getSessionContext();
  const clinic = session.activeClinic;

  // Config is per unit; the network default stays on /admin/agenda.
  if (!clinic || clinic.type === "franchisor") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Configurar agenda
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral para configurar a agenda dela.
        </p>
      </div>
    );
  }

  const canConfig = hasRoleInClinic(session, clinic.id, ["unit_manager"]);
  if (!canConfig) redirect("/agenda");

  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [
    { data: settingRows },
    { data: roomRows },
    { data: coordRow },
    { data: staffRows },
    { data: openDayRows },
  ] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select("clinic_id, open_time, close_time, weekdays, chairs")
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("clinic_rooms")
      .select("id, clinic_id, name, sort_order, is_active")
      .eq("clinic_id", clinic.id)
      .returns<RoomRow[]>(),
    supabase
      .from("clinic_agenda_settings")
      .select("coordinator_room_id")
      .eq("clinic_id", clinic.id)
      .maybeSingle(),
    supabase
      .from("user_clinic_roles")
      .select("user_id, profiles ( full_name )")
      .eq("clinic_id", clinic.id)
      .returns<{ user_id: string; profiles: { full_name: string } | null }[]>(),
    supabase
      .from("agenda_open_days")
      .select("id, date, note, agenda_open_day_staff ( user_id )")
      .eq("clinic_id", clinic.id)
      .gte("date", todayIso)
      .order("date")
      .returns<
        {
          id: string;
          date: string;
          note: string | null;
          agenda_open_day_staff: { user_id: string }[] | null;
        }[]
      >(),
  ]);

  const values = resolveAgendaSettings(settingRows ?? [], clinic.id);
  const rooms = sortRooms((roomRows ?? []).map(mapRoom));
  const coordinatorRoomId =
    (coordRow as { coordinator_room_id: string | null } | null)
      ?.coordinator_room_id ?? null;

  const staffMap = new Map<string, string>();
  for (const r of staffRows ?? []) {
    if (!staffMap.has(r.user_id)) {
      staffMap.set(r.user_id, r.profiles?.full_name ?? "—");
    }
  }
  const staff = [...staffMap.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openDays = (openDayRows ?? []).map((d) => ({
    id: d.id,
    date: d.date,
    note: d.note,
    staffIds: (d.agenda_open_day_staff ?? []).map((s) => s.user_id),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Configurar agenda
          </h1>
          <p className="text-sm text-muted-foreground">
            {clinic.name} — horário de atendimento, dias, salas e a sala do
            Coordenador Clínico.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/agenda" />}
        >
          Voltar à agenda
        </Button>
      </div>

      <AgendaConfigEditor
        clinicId={clinic.id}
        hours={{
          openTime: values.openTime,
          closeTime: values.closeTime,
          weekdays: values.weekdays,
        }}
        rooms={rooms}
        coordinatorRoomId={coordinatorRoomId}
        staff={staff}
        openDays={openDays}
      />
    </div>
  );
}
