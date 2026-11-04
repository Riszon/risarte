import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// AP64, passo 2 (0357): o COMERCIAL do plano complementar. O cliente fica na
// Fase 5; o Consultor apresenta, negocia e fecha o complemento no cockpit, no
// "modo complemento" (`/comercial/[clientId]?complemento=<plano>`). A
// apresentação do complemento é PRÓPRIA (C1): `plan_complement_presentations`.
// Decisões C1–C4 em docs/comercial/AP63-AP64-PLANO.md §6.

export type ComplementoComercial = {
  id: string;
  numero: number | null;
  status: string;
  /** O plano vendido que o complemento acrescenta. */
  vendidoId: string;
};

/** O plano é um complemento DESTE cliente? Devolve-o; senão, nulo. */
export async function lerComplemento(
  supabase: SupabaseClient,
  clientId: string,
  planId: string | null | undefined
): Promise<ComplementoComercial | null> {
  if (!planId) return null;
  const { data, error } = await supabase
    .from("treatment_plans")
    .select("id, client_id, status, complement_of_plan_id, complement_no")
    .eq("id", planId)
    .maybeSingle<{
      id: string;
      client_id: string;
      status: string;
      complement_of_plan_id: string | null;
      complement_no: number | null;
    }>();
  if (error || !data || data.client_id !== clientId || !data.complement_of_plan_id) return null;
  return {
    id: data.id,
    numero: data.complement_no,
    status: data.status,
    vendidoId: data.complement_of_plan_id,
  };
}

export type ApresentacaoLida = {
  meet_link: string | null;
  recording_url: string | null;
  summary: string | null;
  notes: string | null;
  consultant_id: string | null;
};

/**
 * A apresentação certa: a do complemento quando o plano é complemento; senão a
 * do cliente (a da venda original). Uma regra só para cockpit, negociação e
 * contrato — o resumo vai no contrato (C2).
 */
export async function lerApresentacao(
  supabase: SupabaseClient,
  clientId: string,
  complementoId: string | null
): Promise<ApresentacaoLida | null> {
  const cols = "meet_link, recording_url, summary, notes, consultant_id";
  const { data } = complementoId
    ? await supabase
        .from("plan_complement_presentations")
        .select(cols)
        .eq("plan_id", complementoId)
        .maybeSingle<ApresentacaoLida>()
    : await supabase
        .from("commercial_presentations")
        .select(cols)
        .eq("client_id", clientId)
        .maybeSingle<ApresentacaoLida>();
  return data ?? null;
}

/** O plano da negociação é complemento? (para o contrato escolher o resumo) */
export async function complementoDaNegociacao(
  supabase: SupabaseClient,
  planId: string | null | undefined
): Promise<string | null> {
  if (!planId) return null;
  const { data } = await supabase
    .from("treatment_plans")
    .select("complement_of_plan_id")
    .eq("id", planId)
    .maybeSingle<{ complement_of_plan_id: string | null }>();
  return data?.complement_of_plan_id ? planId : null;
}

export const URL_DO_COMPLEMENTO = (clientId: string, planId: string, aba?: string) =>
  `/comercial/${clientId}?complemento=${planId}${aba ? `&aba=${aba}` : ""}`;
