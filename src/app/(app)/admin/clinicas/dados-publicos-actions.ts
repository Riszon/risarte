"use server";

// Dados públicos e áreas atendidas da unidade (0368 — Rita, Fase 0A.4).
// O que a Rita poderá dizer a um paciente sobre a unidade.

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validarDadosPublicos, type DadosPublicosEntrada } from "@/lib/unidade-publica";

export type Resultado = { ok: boolean; error?: string };

export async function salvarDadosPublicos(
  clinicId: string,
  entrada: DadosPublicosEntrada
): Promise<Resultado> {
  const session = await requireAdminMaster();
  const conferido = validarDadosPublicos(entrada);
  if (!conferido.ok) return { ok: false, error: conferido.erro };
  const v = conferido.valores;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinic_public_info")
    .upsert(
      {
        clinic_id: clinicId,
        public_name: v.publicName,
        landmark: v.landmark,
        maps_url: v.mapsUrl,
        parking: v.parking,
        accessibility: v.accessibility,
        whatsapp_e164: v.whatsappE164,
        min_child_age: v.minChildAge,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      },
      { onConflict: "clinic_id" }
    )
    .select("clinic_id");
  if (error) {
    console.error("salvarDadosPublicos:", error.code);
    return { ok: false, error: "Não foi possível salvar os dados públicos." };
  }
  if ((data ?? []).length !== 1) return { ok: false, error: "Os dados não foram gravados." };
  revalidatePath("/admin/clinicas");
  return { ok: true };
}

export async function adicionarArea(
  clinicId: string,
  entrada: { state: string; city: string; neighborhood: string }
): Promise<Resultado> {
  await requireAdminMaster();
  const uf = entrada.state.trim().toUpperCase();
  const cidade = entrada.city.trim();
  const bairro = entrada.neighborhood.trim() || null;
  if (!/^[A-Z]{2}$/.test(uf)) return { ok: false, error: "Estado: use a sigla (ex.: PR)." };
  if (cidade.length < 2 || cidade.length > 80) return { ok: false, error: "Informe a cidade." };
  if (bairro && (bairro.length < 2 || bairro.length > 80)) return { ok: false, error: "Bairro inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic_service_areas")
    .insert({ clinic_id: clinicId, state: uf, city: cidade, neighborhood: bairro });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Essa área já está na lista." };
    console.error("adicionarArea:", error.code);
    return { ok: false, error: "Não foi possível acrescentar a área." };
  }
  revalidatePath("/admin/clinicas");
  return { ok: true };
}

export async function removerArea(id: string): Promise<Resultado> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { data, error } = await supabase.from("clinic_service_areas").delete().eq("id", id).select("id");
  if (error || (data ?? []).length !== 1) {
    if (error) console.error("removerArea:", error.code);
    return { ok: false, error: "Não foi possível remover a área." };
  }
  revalidatePath("/admin/clinicas");
  return { ok: true };
}
