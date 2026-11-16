"use server";

/** 4018 (19.32.5): a chave "Mensalidades pelo Asaas a partir de…" da unidade. */
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PreviaDasMensalidades = {
  ppr_entram: number;
  ppr_esperam: number;
  orto_entram: number;
  orto_esperam: number;
  com_contato: number;
  ligada_desde: string | null;
};

export async function lerPreviaDasMensalidades(clinicId: string, aPartirDe: string) {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_switch_preview", { p_clinic_id: clinicId, p_from: aPartirDe || null });
  if (error || !data) return { ok: false as const, error: error?.message.includes("NOT_ALLOWED") ? "Só o Gerente da unidade ou o Admin Master liga as mensalidades." : "Não foi possível ler." };
  return { ok: true as const, previa: data as PreviaDasMensalidades };
}

export async function ligarMensalidades(clinicId: string, aPartirDe: string | null, avisei: boolean) {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fees_switch_set", { p_clinic_id: clinicId, p_from: aPartirDe, p_warned: avisei });
  if (error) {
    const m = error.message;
    if (m.includes("WARNING_REQUIRED")) return { ok: false as const, error: "Marque \"Avisei os clientes\" antes de ligar." };
    if (m.includes("DATE_IN_PAST")) return { ok: false as const, error: "A data não pode ser no passado." };
    if (m.includes("NOT_ALLOWED")) return { ok: false as const, error: "Só o Gerente da unidade ou o Admin Master liga as mensalidades." };
    console.error("fees_switch_set failed:", m);
    return { ok: false as const, error: "Não foi possível salvar." };
  }
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true as const };
}
