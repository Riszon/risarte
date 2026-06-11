"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { SLA_KEYS, type SlaKey } from "@/lib/sla";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Saves SLA hours. clinicId = null saves the network default;
 * for a clinic, an empty field removes the override (falls back to default).
 */
export async function saveSlaSettings(
  clinicId: string | null,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();
  const supabase = await createClient();

  const toUpsert: { clinic_id: string | null; sla_key: SlaKey; hours: number }[] =
    [];
  const toDelete: SlaKey[] = [];

  for (const key of SLA_KEYS) {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") {
      if (clinicId === null) {
        return {
          ok: false,
          error: "Os prazos padrão da rede não podem ficar em branco.",
        };
      }
      toDelete.push(key);
      continue;
    }
    const hours = Number(raw);
    if (!Number.isInteger(hours) || hours <= 0) {
      return { ok: false, error: "Informe horas válidas (número inteiro maior que zero)." };
    }
    toUpsert.push({ clinic_id: clinicId, sla_key: key, hours });
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("sla_settings")
      .upsert(toUpsert, { onConflict: "clinic_id,sla_key" });
    if (error) {
      console.error("saveSlaSettings upsert failed:", error.message);
      return { ok: false, error: "Não foi possível salvar os prazos." };
    }
  }

  if (clinicId !== null && toDelete.length > 0) {
    const { error } = await supabase
      .from("sla_settings")
      .delete()
      .eq("clinic_id", clinicId)
      .in("sla_key", toDelete);
    if (error) {
      console.error("saveSlaSettings delete failed:", error.message);
      return { ok: false, error: "Não foi possível salvar os prazos." };
    }
  }

  await logAudit({
    action: "update",
    entityType: "sla_settings",
    clinicId: clinicId ?? undefined,
    details: { scope: clinicId ? "clinic" : "network" },
  });
  revalidatePath("/admin/sla");
  return { ok: true };
}
