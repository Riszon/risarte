"use server";

// Ligar e desligar a Rita (0A.2 no banco; a tela é da 0A.7a). O banco decide
// de verdade (`rita.set_enabled`): ligar só o Admin Master, com a rede ligada e
// o portão completo; desligar o Admin ou o Gerente da unidade. O banco grava o
// registro (`rita.actions`) e os avisos sozinho.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  mensagemDoInterruptor,
  podeDesligarRita,
  podeLigarRita,
  podeVerRita,
} from "@/lib/rita-tela";

export type Resultado = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `clinicId` nulo = a rede inteira (só o Admin Master). */
export async function ligarDesligarRita(
  clinicId: string | null,
  ligar: boolean,
  motivo: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!podeVerRita(session)) return { ok: false, error: "Você não tem permissão para esta ação." };
  if (clinicId !== null && !UUID.test(clinicId)) return { ok: false, error: "Unidade inválida." };

  if (ligar || clinicId === null) {
    if (!podeLigarRita(session)) {
      return { ok: false, error: "Só o Admin Master liga a Rita ou mexe na rede." };
    }
  } else if (!podeDesligarRita(session, clinicId)) {
    return { ok: false, error: "Só o Admin Master ou o Gerente da unidade desligam a Rita." };
  }

  const texto = motivo.trim().slice(0, 300);
  if (!ligar && texto.length < 3) {
    return { ok: false, error: "Diga em poucas palavras por que está desligando." };
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("rita").rpc("set_enabled", {
    p_clinic: clinicId,
    p_enabled: ligar,
    p_reason: ligar ? null : texto,
  });
  if (error) return { ok: false, error: mensagemDoInterruptor(error) };

  await logAudit({
    action: "update",
    entityType: "rita_settings",
    entityId: clinicId ?? "rede",
    clinicId: clinicId ?? undefined,
    details: { ligar },
  });
  revalidatePath("/rita");
  if (clinicId) revalidatePath(`/rita/${clinicId}`);
  return { ok: true };
}
