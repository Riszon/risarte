"use server";

// Os campos da assistente virtual no procedimento (0369 — Rita, Fase 0A.5;
// decisão 39): o ROL (a Rita pode oferecer), o papel (avaliação de quem é
// novo, consulta de quem já é cliente, urgência) e o nome para o paciente.
// Só o Admin Master — o banco confere de novo (`procedures_rita_guard`).

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PAPEIS_DA_RITA, type PapelDaRita } from "@/lib/rita-procedimento";

export type Resultado = { ok: boolean; error?: string };

export async function salvarRitaDoProcedimento(
  procedureId: string,
  entrada: { canOffer: boolean; role: PapelDaRita | null; patientName: string }
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master decide o que a assistente virtual oferece." };
  }
  if (entrada.role !== null && !PAPEIS_DA_RITA.includes(entrada.role)) {
    return { ok: false, error: "Papel inválido." };
  }
  const nome = entrada.patientName.trim();
  if (nome && (nome.length < 2 || nome.length > 120)) {
    return { ok: false, error: "O nome para o paciente deve ter entre 2 e 120 caracteres." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedures")
    .update({ rita_can_offer: entrada.canOffer, rita_role: entrada.role, patient_name: nome || null })
    .eq("id", procedureId)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Já existe outro procedimento com esse papel (só pode haver um de cada avaliação)." };
    }
    if (error.message?.includes("RITA_FIELDS_ADMIN_ONLY")) {
      return { ok: false, error: "Só o Admin Master decide o que a assistente virtual oferece." };
    }
    console.error("salvarRitaDoProcedimento:", error.code);
    return { ok: false, error: "Não foi possível salvar." };
  }
  if ((data ?? []).length !== 1) return { ok: false, error: "Nada foi gravado (sem permissão)." };
  revalidatePath("/procedimentos");
  return { ok: true };
}
