"use server";

// OD2 — as ações do diagnóstico por dente (0310). Quem pode o quê quem decide
// é o BANCO (as funções da 0310 conferem a função de quem chama); aqui só se
// chama, traduz o recado e atualiza as telas que mostram o odontograma.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Denticao } from "@/lib/odontograma/desenho";
import {
  denticaoParaOBanco,
  mensagemDoDiagnostico,
  type ItemDoDiagnostico,
} from "@/lib/odontograma/diagnostico";

export type ResultadoDoOdontograma = { ok: true; quantos?: number } | { ok: false; error: string };

export type DecisaoDoPlanner = {
  id: string;
  decision: "accept" | "reject" | "adjust";
  reason?: string;
  faces?: string[];
  condition?: string;
};

export type RetiradaDoDiagnostico = { action: "remove"; removes: string; note?: string };

function revalidar(clientId: string) {
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath(`/avaliacao/${clientId}`);
  revalidatePath(`/planejamento/${clientId}`);
  revalidatePath("/planejamento");
}

function falha(contexto: string, mensagem: string): ResultadoDoOdontograma {
  const traduzida = mensagemDoDiagnostico(mensagem);
  if (!traduzida) console.error(`${contexto} falhou:`, mensagem);
  return { ok: false, error: traduzida ?? "Não foi possível gravar no odontograma. Nada foi alterado." };
}

/** Coordenador: sugere marcas na rodada aberta da unidade. */
export async function sugerirNoOdontograma(
  clientId: string,
  clinicId: string,
  itens: (ItemDoDiagnostico | RetiradaDoDiagnostico)[]
): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_tooth_findings", {
    p_client: clientId,
    p_clinic: clinicId,
    p_items: itens,
  });
  if (error) return falha("suggest_tooth_findings", error.message);
  revalidar(clientId);
  return { ok: true, quantos: (data as number | null) ?? itens.length };
}

/** OD5 (H3): quem atende sugere durante o tratamento, preso à SESSÃO (sem
 *  rodada). O banco confere que é o profissional daquele atendimento (0314). */
export async function sugerirNaSessao(
  clientId: string,
  sessaoId: string,
  itens: ItemDoDiagnostico[]
): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_session_findings", {
    p_session: sessaoId,
    p_items: itens,
  });
  if (error) return falha("suggest_session_findings", error.message);
  revalidar(clientId);
  return { ok: true, quantos: (data as number | null) ?? itens.length };
}

/** Quem sugeriu desfaz a própria sugestão (enquanto ninguém decidiu). */
export async function desfazerSugestao(clientId: string, findingId: string): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_tooth_finding", { p_id: findingId });
  if (error) return falha("withdraw_tooth_finding", error.message);
  revalidar(clientId);
  return { ok: true };
}

/** Planner: aceita, ajusta ou rejeita sugestões (tudo ou nada). */
export async function decidirSugestoes(
  clientId: string,
  decisoes: DecisaoDoPlanner[]
): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_tooth_findings", { p_items: decisoes });
  if (error) return falha("decide_tooth_findings", error.message);
  revalidar(clientId);
  return { ok: true, quantos: (data as number | null) ?? decisoes.length };
}

/** Planner: marca direto (nasce definido). Rodada finalizada = adendo, com motivo. */
export async function marcarNoOdontograma(
  clientId: string,
  itens: (ItemDoDiagnostico | RetiradaDoDiagnostico)[],
  motivoDoAdendo?: string
): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("define_tooth_findings", {
    p_client: clientId,
    p_items: itens,
    p_addendum_reason: motivoDoAdendo?.trim() || null,
  });
  if (error) return falha("define_tooth_findings", error.message);
  revalidar(clientId);
  return { ok: true, quantos: (data as number | null) ?? itens.length };
}

/** Planner: finaliza o diagnóstico da rodada (tranca a rodada inteira, E1). */
export async function finalizarDiagnostico(
  clientId: string,
  evaluationId: string
): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_tooth_diagnosis", { p_evaluation: evaluationId });
  if (error) return falha("finalize_tooth_diagnosis", error.message);
  revalidar(clientId);
  return { ok: true };
}

/** Coordenador ou Planner: guarda a dentição do paciente. */
export async function guardarDenticao(clientId: string, denticao: Denticao): Promise<ResultadoDoOdontograma> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_client_dentition", {
    p_client: clientId,
    p_dentition: denticaoParaOBanco(denticao),
  });
  if (error) return falha("set_client_dentition", error.message);
  revalidar(clientId);
  return { ok: true };
}
