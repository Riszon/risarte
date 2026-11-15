"use server";

/**
 * 4017 (19.28) — as ações do termo de renegociação, na ficha:
 * enviar o termo pela ZapSign, confirmar as cobranças externas canceladas no
 * painel do Asaas, cancelar o acordo que ainda não vale e anexar o termo
 * assinado (a exceção: Gerente ou Admin Master).
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { enviarTermoDeRenegociacao } from "@/lib/renegociacao/termo";
import { aplicarRenegociacaoAssinada } from "@/lib/asaas/renegociacao";

type Resultado = { ok: true } | { ok: false; error: string };

export async function enviarTermo(input: { clientId: string; renegotiationId: string }) {
  const session = await getSessionContext();
  const r = await enviarTermoDeRenegociacao(session, input.renegotiationId);
  revalidatePath(`/prontuarios/${input.clientId}`);
  return r;
}

export async function confirmarCobrancasExternas(input: { clientId: string; renegotiationId: string; chargeIds: string[] }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("renegotiation_confirm_external", { p_id: input.renegotiationId, p_charge_ids: input.chargeIds });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: "Só o Gerente da unidade ou o Admin Master confirma o cancelamento no painel do Asaas." };
    if (error.message.includes("NOT_PENDING")) return { ok: false, error: "Esta renegociação não está mais esperando." };
    console.error("renegotiation_confirm_external failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a confirmação." };
  }
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}

export async function cancelarRenegociacaoPendente(input: { clientId: string; renegotiationId: string; motivo: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("renegotiation_cancel_pending", { p_id: input.renegotiationId, p_reason: input.motivo });
  if (error) {
    if (error.message.includes("REASON_REQUIRED")) return { ok: false, error: "Escreva o motivo." };
    if (error.message.includes("NOT_PENDING")) return { ok: false, error: "Esta renegociação não está mais esperando." };
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: "Quem cancela é quem negociou, o Gerente, o Financeiro da Franqueadora ou o Admin Master." };
    console.error("renegotiation_cancel_pending failed:", error.message);
    return { ok: false, error: "Não foi possível cancelar." };
  }
  // O termo na ZapSign é cancelado pela rotina (ou já, se der).
  const { rotinaDasRenegociacoes } = await import("@/lib/asaas/renegociacao");
  await rotinaDasRenegociacoes().catch(() => null);
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}

/** A exceção (19.28.9, 2a): o termo impresso, assinado, anexado pelo Gerente ou pelo Admin Master. */
export async function anexarTermoAssinado(form: FormData): Promise<Resultado & { cobrancas?: number }> {
  const session = await getSessionContext();
  const clientId = String(form.get("clientId") ?? "");
  const renegotiationId = String(form.get("renegotiationId") ?? "");
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, error: "Anexe o termo assinado (PDF ou foto)." };
  if (arquivo.size > 10 * 1024 * 1024) return { ok: false, error: "O arquivo pode ter até 10 MB." };
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(arquivo.type)) return { ok: false, error: "Anexe um PDF ou uma foto (PNG, JPG ou WEBP)." };
  const supabase = await createClient();
  const { data: r } = await supabase.from("payment_renegotiations").select("clinic_id, status").eq("id", renegotiationId).maybeSingle();
  if (!r) return { ok: false, error: "Renegociação não encontrada." };
  if (r.status !== "aguardando_assinatura") return { ok: false, error: "Esta renegociação não está aguardando assinatura." };
  const ext = arquivo.type === "application/pdf" ? "pdf" : arquivo.type.split("/")[1];
  const path = `${r.clinic_id}/${renegotiationId}/${randomUUID()}.${ext}`;
  const up = await supabase.storage.from("renegociacoes").upload(path, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) return { ok: false, error: "Só o Gerente da unidade ou o Admin Master anexa o termo assinado." };
  const { error } = await supabase.rpc("renegotiation_attach_signed", { p_id: renegotiationId, p_path: path });
  if (error) {
    if (error.message.includes("EXTERNAL_NOT_CONFIRMED")) return { ok: false, error: "Há cobrança emitida fora do riSZon: confirme que cancelou no painel do Asaas antes." };
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: "Só o Gerente da unidade ou o Admin Master anexa o termo assinado." };
    console.error("renegotiation_attach_signed failed:", error.message);
    return { ok: false, error: "Não foi possível anexar o termo." };
  }
  const a = await aplicarRenegociacaoAssinada(renegotiationId, "termo_anexado", session.userId);
  await logAudit({ action: "update", entityType: "payment_renegotiation", entityId: renegotiationId, details: { what: "termo_anexado" } });
  revalidatePath(`/prontuarios/${clientId}`);
  if (!a.ok) return { ok: false, error: a.error };
  return { ok: true, cobrancas: a.cobrancas };
}

/** Antes de enviar: quantos boletos serão cancelados na assinatura e as cobranças externas. */
export async function lerEnvioDoTermo(input: { renegotiationId: string }) {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renegotiation_send_check", { p_id: input.renegotiationId });
  if (error || !data) return { ok: false as const, error: "Não foi possível ler a renegociação." };
  return {
    ok: true as const,
    ...(data as {
      status: string;
      prazo: string | null;
      vencido: boolean;
      boletos_vivos: number;
      externas: { charge_id: string; seq: number; vencimento: string; valor: number; nota: string | null }[];
    }),
  };
}
