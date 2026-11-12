"use server";

// As ações da aba Cobrança e comunicação (ASA2, entrega 3; 4007).
//
// O BANCO decide de verdade: as portas `gateway_regua_*` conferem quem pode
// (Admin Master e Financeiro da Franqueadora editam; só o Admin declara o termo)
// e põem os pagadores na fila. Nenhuma ação daqui fala com o Asaas: a rotina
// de 10 em 10 minutos aplica.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AVISOS_DA_REGUA, type AvisoDaRegua } from "@/lib/asaas/regua";
import { podeEditarRegua } from "@/lib/central/central";

export type ResultadoDaRegua = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: "Só o Admin Master e o Financeiro da Franqueadora mexem na régua.",
  RULES_INVALID: "A régua precisa ter os 8 avisos.",
  gateway_notification_rules_offset_check: "Um dos prazos não é aceito pelo Asaas.",
  NOTE_REQUIRED: "Escreva onde está o termo atualizado (ao menos uma frase curta).",
  PRIVACY_NOT_DECLARED: "Falta o Admin Master declarar o termo de privacidade.",
  CLINIC_INVALID: "Unidade não encontrada.",
};

function mensagem(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGENS)) if (m.includes(codigo)) return texto;
  return "Não foi possível gravar. Tente de novo.";
}

/** Grava a régua inteira da rede. */
export async function salvarRegua(regua: AvisoDaRegua[]): Promise<ResultadoDaRegua> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: MENSAGENS.NOT_ALLOWED };
  const slots = new Set(AVISOS_DA_REGUA.map((a) => a.slot));
  if (!Array.isArray(regua) || regua.length !== 8 || regua.some((r) => !slots.has(r.slot))) {
    return { ok: false, error: MENSAGENS.RULES_INVALID };
  }
  const p_rules = regua.map((r) => ({
    slot: r.slot,
    scheduleOffset: r.scheduleOffset == null ? null : Number(r.scheduleOffset),
    email: !!r.email,
    sms: !!r.sms,
    whatsapp: !!r.whatsapp,
    phoneCall: !!r.phoneCall,
  }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_regua_save", { p_rules });
  if (error) return { ok: false, error: mensagem(error) };
  revalidatePath("/central", "layout");
  return { ok: true };
}

/** A declaração do termo de privacidade (só o Admin Master, uma vez). */
export async function declararTermo(nota: string): Promise<ResultadoDaRegua> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master declara o termo." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_regua_declare_privacy", { p_note: String(nota ?? "").slice(0, 500) });
  if (error) return { ok: false, error: mensagem(error) };
  revalidatePath("/central", "layout");
  return { ok: true };
}

/** Liga ou desliga a régua de uma unidade. */
export async function ligarReguaDaUnidade(clinicId: string, ligar: boolean): Promise<ResultadoDaRegua> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: MENSAGENS.NOT_ALLOWED };
  if (!UUID.test(clinicId)) return { ok: false, error: MENSAGENS.CLINIC_INVALID };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_regua_unit_set", { p_clinic_id: clinicId, p_enabled: !!ligar });
  if (error) return { ok: false, error: mensagem(error) };
  revalidatePath("/central", "layout");
  return { ok: true };
}
