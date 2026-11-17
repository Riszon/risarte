"use server";

// O abandono de tratamento (0423). Quem pode o quê é o banco; aqui só se
// traduz a recusa.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  recusaDoAbandono,
  type CanalDaTentativa,
  type CanalDosRiscos,
  type DecisaoDoGerente,
} from "@/lib/abandono";

export type Resultado = { ok: boolean; error?: string; etapa?: string };

function falha(fn: string, message: string): Resultado {
  if (!/[A-Z_]{6,}/.test(message)) console.error(fn + ": falhou");
  return { ok: false, error: recusaDoAbandono(message) };
}

export async function registrarTentativaDeAbandono(
  clientId: string,
  abandonoId: string,
  entrada: { canal: CanalDaTentativa; falou: boolean; resumo: string; encaminhar: boolean }
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_abandonment_attempt", {
    p_id: abandonoId,
    p_channel: entrada.canal,
    p_reached: entrada.falou,
    p_summary: entrada.resumo.trim() || null,
    p_escalate: entrada.falou && entrada.encaminhar,
  });
  if (error) return falha("register_abandonment_attempt", error.message);
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true, etapa: typeof data === "string" ? data : undefined };
}

export async function registrarAbandono(
  clientId: string,
  abandonoId: string,
  entrada: { riscos: string; canal: CanalDosRiscos; informadoEm: string }
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_treatment_abandonment", {
    p_id: abandonoId,
    p_risks: entrada.riscos.trim(),
    p_channel: entrada.canal,
    p_informed_on: entrada.informadoEm,
  });
  if (error) return falha("register_treatment_abandonment", error.message);
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

export async function decidirAbandono(
  clientId: string,
  abandonoId: string,
  entrada: { decisao: DecisaoDoGerente; retorno: string | null; observacao: string }
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_treatment_abandonment", {
    p_id: abandonoId,
    p_decision: entrada.decisao,
    p_return_date: entrada.decisao === "fase7" ? entrada.retorno || null : null,
    p_note: entrada.observacao.trim() || null,
  });
  if (error) return falha("decide_treatment_abandonment", error.message);
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/jornada");
  return { ok: true };
}

export async function iniciarContatoPelaLista(clientId: string): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_treatment_abandonment", { p_client_id: clientId });
  if (error) return falha("start_treatment_abandonment", error.message);
  revalidatePath("/jornada/sem-proximo-passo");
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
