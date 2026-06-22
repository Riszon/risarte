"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { timeToMinutes } from "@/lib/agenda-settings";

export type AgendaSettingsResult = { ok: boolean; error?: string };

export async function saveAgendaSettings(
  clinicId: string | null,
  input: {
    openTime: string;
    closeTime: string;
    weekdays: number[];
    chairs: number;
  }
): Promise<AgendaSettingsResult> {
  await requireAdminMaster();

  if (!/^\d{2}:\d{2}$/.test(input.openTime) || !/^\d{2}:\d{2}$/.test(input.closeTime)) {
    return { ok: false, error: "Horário inválido." };
  }
  if (timeToMinutes(input.openTime) >= timeToMinutes(input.closeTime)) {
    return { ok: false, error: "O horário de abertura deve ser antes do fechamento." };
  }
  const weekdays = [...new Set(input.weekdays)].filter((d) => d >= 0 && d <= 6);
  if (weekdays.length === 0) {
    return { ok: false, error: "Escolha ao menos um dia de atendimento." };
  }
  const chairs = Math.max(1, Math.min(20, Math.floor(input.chairs || 1)));

  const supabase = await createClient();
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
    console.error("saveAgendaSettings failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_settings",
    entityId: clinicId ?? "network",
    clinicId: clinicId ?? undefined,
  });
  revalidatePath("/admin/agenda");
  revalidatePath("/agenda");
  return { ok: true };
}
