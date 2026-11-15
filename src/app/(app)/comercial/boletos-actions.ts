"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { contagemConfirmada } from "@/lib/contagem";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { cancelarBoletosDoSistema, textoDaConfirmacao } from "@/lib/asaas/boletos-da-operacao";

/**
 * ASA4, 1B (4015; spec 19.25 e 19.26): a FORMA 2, "Todos os boletos agora".
 * Quem escolhe a forma e cuida da lista é conferido pelo banco (`_boleto_mode_can`):
 * quem fechou a venda, o Gerente da unidade, o Financeiro da Franqueadora e o
 * Admin Master.
 */

type Venda = { negotiationId?: string | null; directSaleId?: string | null };
type Resultado = { ok: true; link?: string; criados?: number; cancelados?: number } | { ok: false; error: string; precisaConfirmar?: number };

const ERROS: Record<string, string> = {
  NOT_ALLOWED: "Só quem fechou a venda, o Gerente da unidade, o Financeiro da Franqueadora ou o Admin Master.",
  UNIT_NOT_ON: "A forma 2 vale só para a unidade ligada em Cobranças automáticas.",
  NO_BOLETO: "Esta venda não tem parcela em boleto.",
  NOT_FORMA_2: "A lista de boletos é só da forma 2, \"Todos os boletos agora\".",
};
const mensagem = (m: string) => Object.entries(ERROS).find(([k]) => m.includes(k))?.[1] ?? "Não foi possível concluir. Tente de novo.";
const ondeDaVenda = (v: Venda) => (v.negotiationId ? { col: "negotiation_id", id: v.negotiationId } : { col: "direct_sale_id", id: v.directSaleId! });

/** Escolhe (ou troca) a forma. De 2 para 1, cancela com confirmação só os boletos que vencem fora do prazo (1a). */
export async function escolherForma(input: Venda & { forma: "mensal" | "todos"; confirmar?: boolean }): Promise<Resultado> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const admin = createAdminClient();
  const onde = ondeDaVenda(input);
  if (input.forma === "mensal") {
    // Quantos sairiam (para a confirmação), pela mesma regra do banco.
    const { data: prazo } = await admin.rpc("_auto_charge_window");
    const limite = new Date(Date.now() + Number(prazo ?? 15) * 86400000).toISOString().slice(0, 10);
    const { data: ids } = await admin.from("payment_installments").select("id").eq(onde.col, onde.id);
    const contagem = await admin
      .from("charges")
      .select("id", { count: "exact", head: true })
      .eq("via_carne", true)
      .in("status", ["emitida", "vencida"])
      .gt("due_date", limite)
      .in("payment_installment_id", (ids ?? []).map((x) => x.id as string));
    const n = contagemConfirmada(contagem);
    // Sem conseguir contar, não troca (nunca cancela boleto sem a confirmação).
    if (n === null) return { ok: false, error: "Não foi possível contar os boletos agora. Tente de novo." };
    if (n > 0 && !input.confirmar) return { ok: false, error: textoDaConfirmacao(n), precisaConfirmar: n };
  }
  const { data, error } = await supabase.rpc("sale_boleto_mode_set", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_mode: input.forma,
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  const r = data as { a_cancelar: string[]; old: string };
  let cancelados = 0;
  if (r.a_cancelar?.length) {
    const c = await cancelarBoletosDoSistema(r.a_cancelar, session.userId, "troca de forma (um boleto por mês)");
    cancelados = c.cancelados;
    if (!c.ok) return { ok: false, error: `${c.error} (${c.cancelados} cancelado(s) antes de parar).` };
  }
  let criados = 0;
  if (input.forma === "todos") {
    const res = await criarCobrancasAutomaticas({ origem: "gatilho", negotiationId: input.negotiationId ?? null, directSaleId: input.directSaleId ?? null });
    criados = res.criadas;
  }
  revalidatePath("/comercial", "layout");
  return { ok: true, criados, cancelados };
}

async function origem(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Gera o link da lista (o anterior para na hora). O código aparece UMA vez: o banco guarda só o resumo. */
export async function gerarLinkDaLista(input: Venda): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.rpc("boleto_list_issue", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_token_hash: hash,
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath("/comercial", "layout");
  return { ok: true, link: `${await origem()}/boletos/${token}` };
}

export async function revogarLista(input: Venda): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("boleto_list_revoke", { p_negotiation_id: input.negotiationId ?? null, p_direct_sale_id: input.directSaleId ?? null });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath("/comercial", "layout");
  return { ok: true };
}

/** O envio da lista conta como envio de cada boleto dela (os alertas de 1 e 2 dias úteis). */
export async function registrarEnvioDaLista(input: Venda & { canal: "lista_copiada" | "lista_whatsapp" }): Promise<{ ok: boolean }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("boleto_list_sent", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_channel: input.canal,
  });
  if (error) console.error("boleto_list_sent failed:", error.message);
  return { ok: !error };
}

/**
 * A OPERAÇÃO INTERROMPIDA (19.27): o boleto foi cancelado e a mudança não entrou.
 * "Reemitir" recria os boletos das parcelas que continuam em aberto (pela rotina,
 * que respeita a forma e o prazo); "Concluída" fecha a pendência (com a nota).
 */
export async function reemitirDaOperacao(id: string): Promise<Resultado> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: f } = await supabase.from("boleto_op_failures").select("clinic_id, negotiation_id, direct_sale_id, installment_ids").eq("id", id).maybeSingle();
  if (!f) return { ok: false, error: "Pendência não encontrada." };
  const res = await criarCobrancasAutomaticas({
    origem: "rodar_agora",
    ator: session.userId,
    clinicId: f.clinic_id as string,
    negotiationId: (f.negotiation_id as string | null) ?? null,
    directSaleId: (f.direct_sale_id as string | null) ?? null,
  });
  await logAudit({ action: "update", entityType: "boleto_op_failure", entityId: id, clinicId: f.clinic_id as string, details: { reemitir: true, criadas: res.criadas, falhas: res.falhas } });
  if (res.falhas === 0) await supabase.rpc("boleto_op_failure_resolve", { p_id: id, p_resolution: `boletos reemitidos (${res.criadas})` });
  revalidatePath("/financeiro/cobrancas-automaticas");
  return res.falhas === 0 ? { ok: true, criados: res.criadas } : { ok: false, error: `Reemissão com erro: ${res.erros.join(" | ").slice(0, 200)}` };
}

export async function concluirOperacao(input: { id: string; nota: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("boleto_op_failure_resolve", { p_id: input.id, p_resolution: input.nota });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true };
}
