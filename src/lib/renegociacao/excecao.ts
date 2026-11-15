import "server-only";

/**
 * 4017a (19.30) — o cancelamento da venda com a exceção autorizada: as parcelas
 * do acordo em aberto entram no cancelamento dos boletos (o caminho da 4015) e
 * o cartão parcelado do acordo AINDA NÃO APROVADO é cancelado inteiro no Asaas
 * antes (19.30.7). O aprovado não tem parcela em aberto: já é pago no acerto.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelarParcelamentoNoAsaas } from "@/lib/asaas/parcelamento";

export async function prepararParcelasDoAcordo(args: {
  negotiationId: string | null;
  directSaleId: string | null;
  actorId: string;
}): Promise<{ ok: true; installmentIds: string[] } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: acordos, error } = await admin.rpc("_sale_agreements", {
    p_negotiation_id: args.negotiationId,
    p_direct_sale_id: args.directSaleId,
  });
  if (error) return { ok: false, error: "Não foi possível ler os acordos da venda." };
  const abertas = ((acordos ?? []) as { abertas: string[] | null }[]).flatMap((a) => a.abertas ?? []);
  if (!abertas.length) return { ok: true, installmentIds: [] };

  // O cartão parcelado do acordo ainda não aprovado: cancela o parcelamento inteiro.
  const { data: blocos } = await admin
    .from("charges")
    .select("id, installment_block, asaas_installment_id, gateway_account_id, status")
    .in("payment_installment_id", abertas)
    .not("installment_block", "is", null)
    .in("status", ["emitindo", "emitida", "vencida", "erro_emissao"]);
  const porBloco = new Map<string, { accountId: string | null; asaasInstallmentId: string | null; chargeIds: string[] }>();
  for (const b of blocos ?? []) {
    const k = b.installment_block as string;
    const atual = porBloco.get(k) ?? { accountId: (b.gateway_account_id as string | null) ?? null, asaasInstallmentId: (b.asaas_installment_id as string | null) ?? null, chargeIds: [] };
    atual.chargeIds.push(b.id as string);
    atual.asaasInstallmentId = atual.asaasInstallmentId ?? ((b.asaas_installment_id as string | null) ?? null);
    porBloco.set(k, atual);
  }
  for (const [blockId, b] of porBloco) {
    const r = await cancelarParcelamentoNoAsaas({ blockId, ...b, actorId: args.actorId, reason: "cancelamento da venda com acordo (exceção autorizada)" });
    if (!r.ok) return { ok: false, error: `O cartão parcelado do acordo não foi cancelado no Asaas, então nada foi mudado. ${r.error}` };
  }
  return { ok: true, installmentIds: abertas };
}
