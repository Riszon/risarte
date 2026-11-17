"use server";

// O cancelamento pelo caminho do fim (0426). Quem pode o quê é o banco; aqui
// só se traduz a recusa.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  recusaDoCancelamento,
  type CanalDosRiscosDoCancelamento,
  type DestinoDoCancelamento,
} from "@/lib/fim-do-cancelamento";

export type Resultado = { ok: boolean; error?: string };

/** Antes de efetivar: o destino pela regra única (D10, D12). */
export async function prepararEfetivacao(input: {
  id: string;
  destino: DestinoDoCancelamento | null;
  retorno: string | null;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("prepare_cancellation_apply", {
    p_id: input.id,
    p_destination: input.destino,
    p_return_date: input.destino === "follow_up" ? input.retorno || null : null,
  });
  if (error) {
    const msg = recusaDoCancelamento(error.message);
    if (!msg) console.error("prepare_cancellation_apply: falhou");
    return { ok: false, error: msg ?? "Não foi possível preparar a efetivação." };
  }
  return { ok: true };
}

/** D25: o Coordenador registra os riscos informados ao cliente. */
export async function registrarRiscosDoCancelamento(input: {
  id: string;
  clientId: string;
  riscos: string;
  canal: CanalDosRiscosDoCancelamento;
  informadoEm: string;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_cancellation_risks", {
    p_id: input.id,
    p_risks: input.riscos.trim(),
    p_channel: input.canal,
    p_informed_on: input.informadoEm,
  });
  if (error) {
    const msg = recusaDoCancelamento(error.message);
    if (!msg) console.error("register_cancellation_risks: falhou");
    return { ok: false, error: msg ?? "Não foi possível registrar os riscos." };
  }
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}
