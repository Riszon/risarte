"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleWithScopeForClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { lerComplemento } from "@/lib/complemento-comercial";

export type PresentationSaveResult = { ok: boolean; error?: string };

/** Salva a mesa de apresentação do Consultor (COM2): links, resumo, notas. */
export async function saveCommercialPresentation(
  clientId: string,
  input: {
    meetLink: string;
    recordingUrl: string;
    summary: string;
    notes: string;
  },
  /** AP64 (0357, C1): a apresentação PRÓPRIA do plano complementar. */
  complementoId: string | null = null
): Promise<PresentationSaveResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, clinic_id")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };

  const allowed =
    session.isAdminMaster ||
    (await hasRoleWithScopeForClinic(session, client.clinic_id, [
      "commercial_consultant",
    ]));
  if (!allowed) {
    return { ok: false, error: "Apenas o Consultor Comercial pode editar." };
  }

  const clean = (s: string) => s.trim() || null;

  // AP64 (C1): no modo complemento, a apresentação é a do plano complementar.
  const complemento = await lerComplemento(supabase, clientId, complementoId);
  if (complementoId && !complemento) {
    return { ok: false, error: "Plano complementar não encontrado para este cliente." };
  }
  if (complemento) {
    if (!clean(input.summary)) {
      const { data: aceitaC } = await supabase
        .from("plan_negotiations")
        .select("id")
        .eq("plan_id", complemento.id)
        .eq("status", "aceita")
        .limit(1)
        .maybeSingle();
      if (aceitaC) {
        return {
          ok: false,
          error: "O cliente já aceitou o complemento: o resumo não pode ficar vazio. Corrija o texto em vez de apagar.",
        };
      }
    }
    const { error: erroC } = await supabase.from("plan_complement_presentations").upsert(
      {
        plan_id: complemento.id,
        client_id: clientId,
        clinic_id: client.clinic_id,
        consultant_id: session.userId,
        meet_link: clean(input.meetLink),
        recording_url: clean(input.recordingUrl),
        summary: clean(input.summary),
        notes: clean(input.notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_id" }
    );
    if (erroC) {
      console.error("saveCommercialPresentation (complemento) failed:", erroC.message);
      return { ok: false, error: "Não foi possível salvar a apresentação do complemento." };
    }
    await logAudit({
      action: "update",
      entityType: "plan_complement_presentation",
      entityId: complemento.id,
      clinicId: client.clinic_id,
    });
    revalidatePath(`/comercial/${clientId}`);
    return { ok: true };
  }

  // OC-00158 (0348): depois do aceite, o resumo é o registro do que o cliente
  // aceitou e vai no contrato — pode ser corrigido, nunca apagado.
  if (!clean(input.summary)) {
    const { data: aceita } = await supabase
      .from("plan_negotiations")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "aceita")
      .limit(1)
      .maybeSingle();
    if (aceita) {
      return {
        ok: false,
        error: "O cliente já aceitou: o resumo da apresentação não pode ficar vazio. Corrija o texto em vez de apagar.",
      };
    }
  }
  const { error } = await supabase.from("commercial_presentations").upsert(
    {
      client_id: clientId,
      clinic_id: client.clinic_id,
      consultant_id: session.userId,
      meet_link: clean(input.meetLink),
      recording_url: clean(input.recordingUrl),
      summary: clean(input.summary),
      notes: clean(input.notes),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );
  if (error) {
    console.error("saveCommercialPresentation failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a apresentação." };
  }

  await logAudit({
    action: "update",
    entityType: "commercial_presentation",
    entityId: clientId,
    clinicId: client.clinic_id,
  });
  revalidatePath(`/comercial/${clientId}`);
  return { ok: true };
}
