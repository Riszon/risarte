"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";
const ACOES = ["aprovar", "entregar", "recusar", "cancelar"] as const;
type AcaoResgate = (typeof ACOES)[number];

export async function mudarResgate(
  resgateId: string,
  acao: AcaoResgate,
  motivo: string | null
): Promise<Resultado<{ status: string; voucher: string | null }>> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!ACOES.includes(acao)) return { ok: false, error: "Ação inválida." };
  const db = await indicaDb();
  const { data, error } = await db.rpc("mudar_resgate", {
    p_resgate_id: resgateId,
    p_acao: acao,
    p_motivo: motivo?.trim() || null,
  });
  if (error) {
    console.error("mudar_resgate:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const { data: r } = await db
    .from("resgates")
    .select("codigo_voucher")
    .eq("id", resgateId)
    .single<{ codigo_voucher: string | null }>();
  revalidatePath("/indica-mais-risos", "layout");
  return { ok: true, status: data as string, voucher: r?.codigo_voucher ?? null };
}

export type NegociacaoDoCliente = {
  id: string;
  codigo: string | null;
  status: string;
  criadaEm: string;
};

/** As negociações do cliente, para marcar onde o voucher foi aplicado. */
export async function negociacoesDoCliente(clienteId: string): Promise<NegociacaoDoCliente[]> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("plan_negotiations")
    .select("id, code, status, created_at")
    .eq("client_id", clienteId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<{ id: string; code: string | null; status: string; created_at: string }[]>();
  return (data ?? []).map((n) => ({ id: n.id, codigo: n.code, status: n.status, criadaEm: n.created_at }));
}

export async function usarVoucher(
  codigo: string,
  negociacaoId: string
): Promise<Resultado<{ valorCentavos: number }>> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { data, error } = await db.rpc("usar_voucher", {
    p_codigo: codigo.trim().toUpperCase(),
    p_negociacao_id: negociacaoId,
  });
  if (error) {
    console.error("usar_voucher:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath("/indica-mais-risos", "layout");
  return { ok: true, valorCentavos: Number(data ?? 0) };
}
