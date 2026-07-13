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
import { NetworkLunchEditor } from "./network-lunch-editor";

export const metadata: Metadata = { title: "Configurar agenda" };

export default async function AgendaConfigPage() {
  const session = await getSessionContext();
  const clinic = session.activeClinic;

  if (!clinic) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Configurar agenda
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma clínica no menu lateral.
        </p>
      </div>
    );
  }

  // H4.8 Bloco 2: na franqueadora, define o ALMOÇO PADRÃO DA REDE (cascata).
  if (clinic.type === "franchisor") {
    const canManageNetwork =
      session.isAdminMaster ||
      hasRoleInClinic(session, clinic.id, ["unit_manager", "franchisee"]);
    if (!canManageNetwork) redirect("/agenda");

    const supabase = await createClient();
    const { data: netRows } = await supabase
      .from("clinic_agenda_settings")
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
      )
      .is("clinic_id", null)
      .returns<AgendaSettingRow[]>();
    const net = resolveAgendaSettings(netRows ?? [], null);

    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Padrão da rede
            </h1>
            <p className="text-sm text-muted-foreground">
              Configurações que valem para todas as unidades por padrão (cada
              unidade pode personalizar a sua).
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

        <NetworkLunchEditor
          lunch={{
            enabled: net.lunchEnabled,
            start: net.lunchStart,
            end: net.lunchEnd,
          }}
        />
      </div>
    );
  }

  const canConfig = hasRoleInClinic(session, clinic.id, ["unit_manager"]);
  if (!canConfig) redirect("/agenda");

  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const historyFrom = new Date();
  historyFrom.setDate(historyFrom.getDate() - 180);
  const historyFromIso = historyFrom.toISOString().slice(0, 10);
  const [
    { data: settingRows },
    { data: roomRows },
    { data: coordRow },
    { data: staffRows },
    { data: openDayRows },
    { data: clinicMeta },
  ] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end, waiting_alert_minutes"
      )
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("clinic_rooms")
      .select("id, clinic_id, name, sort_order, is_active, deleted_at")
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
      .select(
        "id, date, start_time, end_time, note, created_at, creator:profiles!agenda_open_days_created_by_fkey ( full_name ), agenda_open_day_staff ( user_id )"
      )
      .eq("clinic_id", clinic.id)
      .gte("date", historyFromIso)
      .order("date")
      .returns<
        {
          id: string;
          date: string;
          start_time: string;
          end_time: string;
          note: string | null;
          created_at: string;
          creator: { full_name: string } | null;
          agenda_open_day_staff: { user_id: string }[] | null;
        }[]
      >(),
    supabase
      .from("clinics")
      .select("max_rooms")
      .eq("id", clinic.id)
      .maybeSingle(),
  ]);

  const values = resolveAgendaSettings(settingRows ?? [], clinic.id);
  // H4.8: padrão da rede (linha clinic_id NULL) — para mostrar o que é herdado.
  const networkDefault = resolveAgendaSettings(settingRows ?? [], null);
  const rooms = sortRooms((roomRows ?? []).map(mapRoom));
  const maxRooms =
    (clinicMeta as { max_rooms: number | null } | null)?.max_rooms ?? 4;
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
    startTime: (d.start_time ?? "08:00").slice(0, 5),
    endTime: (d.end_time ?? "18:00").slice(0, 5),
    note: d.note,
    createdAt: d.created_at,
    createdByName: d.creator?.full_name ?? null,
    staffIds: (d.agenda_open_day_staff ?? []).map((s) => s.user_id),
    isPast: d.date < todayIso,
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
        isAdmin={session.isAdminMaster}
        hours={{
          openTime: values.openTime,
          closeTime: values.closeTime,
          weekdays: values.weekdays,
          waitingAlertMinutes: values.waitingAlertMinutes,
        }}
        rooms={rooms}
        maxRooms={maxRooms}
        coordinatorRoomId={coordinatorRoomId}
        staff={staff}
        openDays={openDays}
        lunch={{
          enabled: values.lunchEnabled,
          start: values.lunchStart,
          end: values.lunchEnd,
        }}
        networkLunch={{
          enabled: networkDefault.lunchEnabled,
          start: networkDefault.lunchStart,
          end: networkDefault.lunchEnd,
        }}
      />
    </div>
  );
}
