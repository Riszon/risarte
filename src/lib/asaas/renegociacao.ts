import "server-only";

/**
 * 4017 (19.28) — A RENEGOCIAÇÃO ASSINADA, do lado do servidor.
 *
 *  - `aplicarRenegociacaoAssinada`: o termo foi assinado (webhook da ZapSign) ou
 *    o PDF assinado foi anexado (exceção). Cancela no Asaas os boletos vivos das
 *    parcelas antigas (o mesmo caminho da 4015, com a operação interrompida se
 *    falhar no meio), aplica no banco e cria as cobranças das novas pela regra da
 *    entrega 1 (a forma do acordo).
 *  - `reagirAoTermo`: o que a ZapSign avisou sobre um pacote de renegociação.
 *  - `rotinaDasRenegociacoes`: expira o termo vencido e cancela na ZapSign os
 *    termos de acordos que acabaram sem assinatura (expirado, pago antes,
 *    cancelado por quem negociou).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { comBoletosCancelados } from "@/lib/asaas/boletos-da-operacao";
import { ZapsignError, isZapsignFake, refuseDocument, refuseDocumentFake } from "@/lib/zapsign";

export type AplicacaoDoAcordo = { ok: true; cobrancas: number } | { ok: false; error: string };

export async function aplicarRenegociacaoAssinada(renegotiationId: string, via: "zapsign" | "termo_anexado", actorId: string | null): Promise<AplicacaoDoAcordo> {
  const admin = createAdminClient();
  const { data: r } = await admin
    .from("payment_renegotiations")
    .select("id, status, applied_at, source_installment_ids, created_by")
    .eq("id", renegotiationId)
    .maybeSingle();
  if (!r) return { ok: false, error: "Renegociação não encontrada." };
  if (r.applied_at) return { ok: true, cobrancas: 0 }; // aviso repetido
  const ator = actorId ?? (r.created_by as string | null);
  if (!ator) return { ok: false, error: "A renegociação não tem quem negociou." };

  // A confirmação da tela já foi dada no envio do termo ("serão cancelados N boletos").
  const op = await comBoletosCancelados<unknown>({
    operacao: "renegociação",
    motivo: "renegociação assinada",
    installmentIds: (r.source_installment_ids as string[]) ?? [],
    actorId: ator,
    confirmar: true,
    tentar: async () => {
      const x = await admin.rpc("renegotiation_apply_signed", { p_id: renegotiationId, p_via: via, p_actor: actorId });
      return { error: x.error };
    },
  });
  if (!op.ok) return { ok: false, error: op.error };

  const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
  const c = await criarCobrancasAutomaticas({ origem: "gatilho", renegotiationId, ator: actorId });
  return { ok: true, cobrancas: c.criadas };
}

/** O webhook da ZapSign, para o pacote de um termo de renegociação. Nunca derruba o 200. */
export async function reagirAoTermo(packageId: string, status: string | undefined, newlySigned: boolean): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: pkg } = await admin.from("signature_packages").select("origin_type, origin_id").eq("id", packageId).maybeSingle();
    if (pkg?.origin_type !== "payment_renegotiation" || !pkg.origin_id) return;
    if (newlySigned) {
      const r = await aplicarRenegociacaoAssinada(pkg.origin_id as string, "zapsign", null);
      if (!r.ok) {
        console.error("renegotiation apply on signature failed:", r.error);
        await avisarAssinadoSemAplicar(pkg.origin_id as string, r.error);
      }
      return;
    }
    if (status === "refused" || status === "cancelled" || status === "expired") {
      const { error } = await admin.rpc("renegotiation_signature_status", { p_package_id: packageId, p_status: status });
      if (error) console.error("renegotiation signature status failed:", error.message);
    }
  } catch (e) {
    console.error("renegotiation webhook reaction failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * O termo foi assinado, mas o acordo não entrou (já tinha expirado, foi pago
 * antes, ou a operação parou no meio): o pior caso (19.28.2 item 7), avisado
 * com essas palavras a quem negociou e aos Gerentes.
 */
async function avisarAssinadoSemAplicar(renegotiationId: string, erro: string): Promise<void> {
  const admin = createAdminClient();
  const { data: r } = await admin.from("payment_renegotiations").select("clinic_id, client_id, created_by, status").eq("id", renegotiationId).maybeSingle();
  if (!r) return;
  const { data: gerentes } = await admin.from("user_clinic_roles").select("user_id").eq("clinic_id", r.clinic_id).eq("role", "unit_manager");
  const usuarios = [...new Set([...(gerentes ?? []).map((g) => g.user_id as string), r.created_by as string].filter(Boolean))];
  const motivo = /NOT_PENDING/.test(erro)
    ? "O acordo já não valia (expirou, foi cancelado ou o cliente pagou uma parcela antes)."
    : /SOURCE_CHANGED/.test(erro)
      ? "Uma das parcelas antigas mudou antes da assinatura (foi paga ou cancelada)."
      : "A operação parou no meio; veja Financeiro › Cobranças automáticas.";
  await admin.rpc("_notify_users", {
    p_kind: "renegociacao_assinada_sem_aplicar",
    p_key: renegotiationId,
    p_users: usuarios,
    p_clinic_id: r.clinic_id,
    p_title: "Termo de renegociação assinado e NÃO aplicado",
    p_body: `${motivo} Fale com o cliente e refaça o acordo.`,
    p_link: `/prontuarios/${r.client_id}`,
  });
}

/** A rotina diária (rota da régua): expira e cancela na ZapSign o que ficou para trás. */
export async function rotinaDasRenegociacoes(): Promise<{ expiradas: number; termosCancelados: number; aplicadas: number }> {
  const admin = createAdminClient();
  const { data: n, error } = await admin.rpc("renegotiation_expire_run");
  if (error && !/does not exist|schema cache/i.test(error.message)) console.error("renegotiation expire failed:", error.message);
  let termosCancelados = 0;
  const { data: pendentes } = await admin.rpc("_renegotiations_zapsign_to_cancel");
  for (const p of (pendentes ?? []) as { renegotiation_id: string; package_id: string }[]) {
    const { data: pkg } = await admin.from("signature_packages").select("status, zapsign_doc_token").eq("id", p.package_id).maybeSingle();
    if (pkg && ["draft", "sent", "partially_signed"].includes(pkg.status as string)) {
      try {
        if (pkg.zapsign_doc_token) {
          if (isZapsignFake()) await refuseDocumentFake();
          else await refuseDocument({ doc_token: pkg.zapsign_doc_token as string, rejected_reason: "Cancelado no riSZon: o acordo de renegociação não vale mais", notify_signer: false });
        }
      } catch (e) {
        if (!(e instanceof ZapsignError && e.code === "document_already_signed")) {
          console.error("renegotiation term cancel failed:", e instanceof ZapsignError ? e.logMessage : String(e));
          continue;
        }
      }
      await admin.rpc("_signature_cancel_package_system", { p_id: p.package_id, p_reason: "o acordo de renegociação não vale mais" });
    }
    await admin.rpc("_renegotiation_zapsign_cancelled", { p_id: p.renegotiation_id });
    termosCancelados += 1;
  }
  // O termo assinado cujo aviso foi reprocessado pela rotina das Assinaturas
  // (ela não dispara efeitos): aplica aqui.
  const { data: assinados } = await admin
    .from("payment_renegotiations")
    .select("id, signature_package_id")
    .eq("status", "aguardando_assinatura")
    .not("signature_package_id", "is", null);
  let aplicadas = 0;
  for (const a of assinados ?? []) {
    const { data: pkg } = await admin.from("signature_packages").select("status").eq("id", a.signature_package_id as string).maybeSingle();
    if (pkg?.status !== "signed") continue;
    const r = await aplicarRenegociacaoAssinada(a.id as string, "zapsign", null);
    if (r.ok) aplicadas += 1;
    else await avisarAssinadoSemAplicar(a.id as string, r.error);
  }
  return { expiradas: Number(n ?? 0), termosCancelados, aplicadas };
}
