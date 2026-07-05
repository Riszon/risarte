"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { timeToMinutes } from "@/lib/agenda-settings";

export type AgendaConfigResult = { ok: boolean; error?: string };

/**
 * Agenda config (hours, weekdays, rooms, coordinator room) can be edited by the
 * unit's Gerente de Unidade or by an Admin Master. Returns the session when
 * allowed, otherwise an error. RLS enforces the same rule at the database.
 */
async function requireAgendaManager(
  clinicId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (hasRoleInClinic(session, clinicId, ["unit_manager"])) return { ok: true };
  return {
    ok: false,
    error: "Apenas a Gerente da unidade (ou o Admin) pode configurar a agenda.",
  };
}

/** Saves working hours and open weekdays for a unit. Keeps `chairs` in sync with
 * the number of active rooms (legacy capacity fallback). */
export async function saveAgendaHours(
  clinicId: string,
  input: { openTime: string; closeTime: string; weekdays: number[] }
): Promise<AgendaConfigResult> {
  if (!clinicId) return { ok: false, error: "Unidade inválida." };
  const guard = await requireAgendaManager(clinicId);
  if (!guard.ok) return guard;

  if (
    !/^\d{2}:\d{2}$/.test(input.openTime) ||
    !/^\d{2}:\d{2}$/.test(input.closeTime)
  ) {
    return { ok: false, error: "Horário inválido." };
  }
  if (timeToMinutes(input.openTime) >= timeToMinutes(input.closeTime)) {
    return {
      ok: false,
      error: "O horário de abertura deve ser antes do fechamento.",
    };
  }
  const weekdays = [...new Set(input.weekdays)].filter((d) => d >= 0 && d <= 6);
  if (weekdays.length === 0) {
    return { ok: false, error: "Escolha ao menos um dia de atendimento." };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("clinic_rooms")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("is_active", true);
  const chairs = Math.max(1, count ?? 1);

  const { error } = await supabase.from("clinic_agenda_settings").upsert(
    {
      clinic_id: clinicId,
      open_time: input.openTime,
      close_time: input.closeTime,
      weekdays,
      chairs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
  if (error) {
    console.error("saveAgendaHours failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_settings",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/agenda/configuracao");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function addRoom(
  clinicId: string,
  name: string
): Promise<AgendaConfigResult> {
  if (!clinicId) return { ok: false, error: "Unidade inválida." };
  const guard = await requireAgendaManager(clinicId);
  if (!guard.ok) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Informe o nome da sala." };
  if (trimmed.length > 60) {
    return { ok: false, error: "Nome muito longo (máx. 60 caracteres)." };
  }

  const supabase = await createClient();

  // H1.10: a Gerente não cria salas acima do teto definido pelo Admin.
  const [{ data: clinic }, { count }] = await Promise.all([
    supabase.from("clinics").select("max_rooms").eq("id", clinicId).maybeSingle(),
    supabase
      .from("clinic_rooms")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
  ]);
  const maxRooms = clinic?.max_rooms ?? 0;
  if (maxRooms > 0 && (count ?? 0) >= maxRooms) {
    return {
      ok: false,
      error: `Esta unidade permite no máximo ${maxRooms} sala(s) (definido pelo Admin no cadastro da clínica).`,
    };
  }

  const { data: last } = await supabase
    .from("clinic_rooms")
    .select("sort_order")
    .eq("clinic_id", clinicId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? 0) + 1;

  const { error } = await supabase
    .from("clinic_rooms")
    .insert({ clinic_id: clinicId, name: trimmed, sort_order: nextOrder });
  if (error) {
    console.error("addRoom failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar a sala." };
  }
  await logAudit({
    action: "create",
    entityType: "clinic_room",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/agenda/configuracao");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function renameRoom(
  roomId: string,
  name: string
): Promise<AgendaConfigResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Informe o nome da sala." };
  if (trimmed.length > 60) {
    return { ok: false, error: "Nome muito longo (máx. 60 caracteres)." };
  }

  const supabase = await createClient();
  const { data: room } = await supabase
    .from("clinic_rooms")
    .select("clinic_id")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "Sala não encontrada." };
  const guard = await requireAgendaManager(room.clinic_id);
  if (!guard.ok) return guard;

  const { error } = await supabase
    .from("clinic_rooms")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) {
    console.error("renameRoom failed:", error.message);
    return { ok: false, error: "Não foi possível renomear a sala." };
  }
  await logAudit({
    action: "update",
    entityType: "clinic_room",
    entityId: roomId,
    clinicId: room.clinic_id,
  });
  revalidatePath("/agenda/configuracao");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function setRoomActive(
  roomId: string,
  active: boolean
): Promise<AgendaConfigResult> {
  const supabase = await createClient();
  const { data: room } = await supabase
    .from("clinic_rooms")
    .select("clinic_id")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "Sala não encontrada." };
  const guard = await requireAgendaManager(room.clinic_id);
  if (!guard.ok) return guard;

  // Don't allow turning off the last active room (the unit needs ≥1 chair).
  if (!active) {
    const { count } = await supabase
      .from("clinic_rooms")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", room.clinic_id)
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error: "A unidade precisa de ao menos uma sala ativa.",
      };
    }
  }

  const { error } = await supabase
    .from("clinic_rooms")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) {
    console.error("setRoomActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a sala." };
  }
  await logAudit({
    action: "update",
    entityType: "clinic_room",
    entityId: roomId,
    clinicId: room.clinic_id,
  });
  revalidatePath("/agenda/configuracao");
  revalidatePath("/agenda");
  return { ok: true };
}

/** Sets which room the Clinical Coordinator uses (or clears it). */
export async function setCoordinatorRoom(
  clinicId: string,
  roomId: string | null
): Promise<AgendaConfigResult> {
  if (!clinicId) return { ok: false, error: "Unidade inválida." };
  const guard = await requireAgendaManager(clinicId);
  if (!guard.ok) return guard;

  const supabase = await createClient();
  if (roomId) {
    const { data: room } = await supabase
      .from("clinic_rooms")
      .select("id")
      .eq("id", roomId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!room) return { ok: false, error: "Sala inválida para esta unidade." };
  }

  // Ensure the unit has a settings row, then set the coordinator room.
  const { error } = await supabase.from("clinic_agenda_settings").upsert(
    { clinic_id: clinicId, coordinator_room_id: roomId },
    { onConflict: "clinic_id" }
  );
  if (error) {
    console.error("setCoordinatorRoom failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a sala do Coordenador." };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_settings",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/agenda/configuracao");
  revalidatePath("/agenda");
  return { ok: true };
}
