"use server";

// O fim do tratamento (0418): responder a pergunta, registrar o contato e
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
  type HorarioComCoordenador,
  type NivelDeQualidade,
  type RespostaDoFechamento,
} from "@/lib/fim-do-tratamento";

export type Resultado = { ok: boolean; error?: string };

export async function responderFechamento(
  clientId: string,
  closureId: string,
  resposta: RespostaDoFechamento,
  /** 0422 (F2): as considerações para o Coordenador (Sim e Não sei: obrigatórias). */
  consideracoes: string = "",
  /** 0422 (F4): o horário com o Coordenador está longe — manter ou antecipar. */
  escolha: "manter" | "antecipar" | null = null
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_treatment_closure", {
    p_id: closureId,
    p_answer: resposta,
    p_notes: consideracoes.trim() || undefined,
    p_far_choice: escolha ?? undefined,
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
    /** 0421 (D18): a satisfação do cliente (0 a 10) e se tem queixa. */
    satisfacao: number | null;
    queixa: boolean | null;
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
    p_satisfaction: entrada.falou ? entrada.satisfacao : null,
    p_complaint: entrada.falou ? entrada.queixa : null,
  });
  if (error) {
    if (!/[A-Z_]{6,}/.test(error.message)) console.error("register_closure_contact:", error.code);
    return { ok: false, error: recusaDoFechamento(error.message) };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/**
 * 0421: a reavaliação de um fechamento sem itens de plano (ortodontia, venda
 * direta) — um nível só. Plano se avalia por procedimento, no cockpit.
 */
export async function registrarReavaliacao(
  clientId: string,
  closureId: string,
  nivel: NivelDeQualidade,
  observacao: string
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_closure_quality", {
    p_id: closureId,
    p_level: nivel,
    p_note: observacao.trim() || null,
  });
  if (error) {
    if (!/[A-Z_]{6,}/.test(error.message)) console.error("register_closure_quality:", error.code);
    return { ok: false, error: recusaDoFechamento(error.message) };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/**
 * 0422 (F5): o Coordenador pede uma reavaliação antes do horário distante que
 * já estava marcado com ele. A Recepção recebe o aviso com prioridade.
 */
export async function pedirReavaliacaoMaisProxima(
  clientId: string,
  closureId: string
): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_sooner_reevaluation", { p_id: closureId });
  if (error) {
    if (!/[A-Z_]{6,}/.test(error.message)) console.error("request_sooner_reevaluation:", error.code);
    if (error.message.includes("ALREADY_ACTED"))
      return { ok: false, error: "A reavaliação mais próxima já foi pedida, ou o horário já passou." };
    return { ok: false, error: recusaDoFechamento(error.message) };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/** 0422 (F1): o próximo horário do cliente com o Coordenador Clínico. */
export async function horarioComCoordenador(
  clientId: string
): Promise<HorarioComCoordenador | null> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("closure_coordinator_slot", { p_client_id: clientId });
  if (error || !data) return null;
  const r = (Array.isArray(data) ? data[0] : data) as { starts_at: string; dias: number } | undefined;
  return r ? { startsAt: r.starts_at, dias: r.dias } : null;
}

export type PerguntaPendente = {
  id: string;
  scope: EscopoDoFechamento;
  /** 0422: tudo o que terminou e entra nesta decisão. */
  escopos: EscopoDoFechamento[];
  clientId: string;
  clientName: string;
  treatmentEnd: boolean;
  /** 0422 (F1): o horário com o Coordenador que já existe, se houver. */
  horario: HorarioComCoordenador | null;
};

/**
 * A pergunta que nasceu ao concluir o atendimento e é DESTA pessoa responder.
 * Sem a 0418 no banco a tabela não existe: devolve nada e o Atendimento segue
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
    .is("grouped_into", null)
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
  const { data: seguidores } = await supabase
    .from("treatment_closures")
    .select("scope")
    .eq("grouped_into", r.id)
    .order("created_at")
    .returns<{ scope: EscopoDoFechamento }[]>();
  return {
    id: r.id,
    scope: r.scope,
    escopos: [r.scope, ...(seguidores ?? []).map((x) => x.scope)],
    horario: await horarioComCoordenador(clientId),
    clientId: r.client_id,
    clientName: cli?.full_name ?? "Cliente",
    treatmentEnd: r.treatment_end,
  };
}
