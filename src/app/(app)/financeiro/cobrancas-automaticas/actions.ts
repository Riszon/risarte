"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";

/**
 * 4012 (spec 19.10 item 5): "RODAR AGORA" — a mesma rotina do cron, chamada
 * pelo Admin Master, com auditoria e a rodada gravada (origem "rodar_agora").
 */
export async function rodarAgora(): Promise<{ ok: boolean; error?: string; criadas?: number; falhas?: number; puladas?: number; motivo?: string | null }> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master roda a criação agora." };
  const r = await criarCobrancasAutomaticas({ origem: "rodar_agora", ator: session.userId });
  await logAudit({ action: "create", entityType: "auto_charge_run", entityId: "rodar_agora", details: { criadas: r.criadas, falhas: r.falhas, puladas: r.puladas, motivo: r.motivo } });
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true, criadas: r.criadas, falhas: r.falhas, puladas: r.puladas, motivo: r.motivo };
}

export async function salvarConfiguracao(p: {
  windowDays?: number;
  appBaseUrl?: string;
  watchEnabled?: boolean;
  units?: { clinic_id: string; enabled: boolean }[];
}): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("auto_charge_settings_set", {
    p: {
      ...(p.windowDays !== undefined ? { window_days: p.windowDays } : {}),
      ...(p.appBaseUrl !== undefined ? { app_base_url: p.appBaseUrl } : {}),
      ...(p.watchEnabled !== undefined ? { watch_enabled: p.watchEnabled } : {}),
      ...(p.units ? { units: p.units } : {}),
    },
  });
  if (error) {
    if (error.message.includes("WINDOW_NOT_ABOVE_REMINDER"))
      return { ok: false, error: "O prazo precisa ser maior que o 1º lembrete da régua (senão chegam dois avisos no mesmo dia)." };
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: "Só o Admin Master configura." };
    if (/app_base_url/.test(error.message)) return { ok: false, error: "O endereço precisa ser https://dominio, sem barra no fim." };
    console.error("auto_charge_settings_set failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true };
}
