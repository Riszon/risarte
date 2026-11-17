"use server";

// O fim do tratamento (0416): responder a pergunta, registrar o contato e
// achar a pergunta que acabou de nascer no Atendimento. Quem pode o quê é o
// banco (`answer_treatment_closure`, `register_closure_contact`); aqui só se
// traduz a recusa.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  recusaDoFechamento,
  type CanalDoContato,
  type DesfechoDoContato,
  type EscopoDoFechamento,
  type RespostaDoFechamento,
} from "@/lib/fim-do-tratamento";

export type Resultado = { ok: boolean; error?: string };

export async function responderFechamento(
  clientId: string,
  closureId: string,
  resposta: RespostaDoFechamento
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_treatment_closure", {
    p_id: closureId,
    p_answer: resposta,
  });
  if (error) {
    if (!/[A-Z_]{6,}/.test(error.message)) console.error("answer_treatment_closure:", error.code);
    return { ok: false, error: recusaDoFechamento(error.message) };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/atendimento");
  return { ok: true };
}

export async function registrarContato(
  clientId: string,
  closureId: string,
  entrada: {
    canal: CanalDoContato;
    falou: boolean;
    resumo: string;
    desfecho: DesfechoDoContato | null;
    retorno: string | null;
  }
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_closure_contact", {
    p_id: closureId,
    p_channel: entrada.canal,
    p_reached: entrada.falou,
    p_summary: entrada.resumo.trim() || null,
    p_outcome: entrada.desfecho,
    p_return_date: entrada.retorno || null,
  });
  if (error) {
    if (!/[A-Z_]{6,}/.test(error.message)) console.error("register_closure_contact:", error.code);
    return { ok: false, error: recusaDoFechamento(error.message) };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

export type PerguntaPendente = {
  id: string;
  scope: EscopoDoFechamento;
  clientId: string;
  clientName: string;
  treatmentEnd: boolean;
};

/**
 * A pergunta que nasceu ao concluir o atendimento e é DESTA pessoa responder.
 * Sem a 0416 no banco a tabela não existe: devolve nada e o Atendimento segue
 * como antes.
 */
export async function perguntaPendenteDoAtendimento(
  clientId: string
): Promise<PerguntaPendente | null> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("treatment_closures")
    .select("id, scope, client_id, treatment_end, clients ( full_name )")
    .eq("client_id", clientId)
    .eq("status", "pergunta")
    .eq("asked_user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<
      {
        id: string;
        scope: EscopoDoFechamento;
        client_id: string;
        treatment_end: boolean;
        clients: { full_name: string } | { full_name: string }[] | null;
      }[]
    >();
  if (error || !data || data.length === 0) return null;
  const r = data[0];
  const cli = Array.isArray(r.clients) ? r.clients[0] : r.clients;
  return {
    id: r.id,
    scope: r.scope,
    clientId: r.client_id,
    clientName: cli?.full_name ?? "Cliente",
    treatmentEnd: r.treatment_end,
  };
}
