import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { ehVendaNova } from "@/lib/venda-direta-meios";
import { confirmacaoAMaoRecusada } from "@/lib/venda-direta-caixa";

/**
 * 4029 (relato do dono, 27/11/2026): "pagamento confirmado" marcado À MÃO
 * concluía a venda direta sem dinheiro nenhum — na unidade que cobra pelo
 * Asaas, quem confirma é o Asaas. Aqui o servidor recusa essa marca; vale para
 * o caixa e para a tela antiga (Comercial → Venda direta), que usam a mesma ação.
 *
 * Devolve a mensagem da recusa, ou nulo quando a marca à mão é legítima (venda
 * antiga, venda sem valor, unidade sem Asaas, meio do balcão, algo já recebido,
 * ou cobrança marcada como paga por fora).
 */
export async function recusaDaConfirmacaoAMao(saleId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: venda } = await admin
    .from("direct_sales")
    .select("clinic_id, final_cents, payment_method, method_rule")
    .eq("id", saleId)
    .maybeSingle();
  if (!venda || !ehVendaNova(venda.method_rule as string | null)) return null;
  const { data: parcelas } = await admin
    .from("payment_installments")
    .select("id, seq, payment_method, paid_amount_cents, status")
    .eq("direct_sale_id", saleId)
    .order("seq");
  const todas = parcelas ?? [];
  const daVez = todas.find((p) => ["em_aberto", "parcial"].includes(p.status as string));
  const ids = todas.map((p) => p.id as string);
  const { data: externas } = ids.length
    ? await admin.from("charges").select("id").in("payment_installment_id", ids).eq("status", "externa").limit(1)
    : { data: [] as { id: string }[] };
  const { data: pronta } = await admin.rpc("central_is_ready", { p_clinic_id: venda.clinic_id as string });
  return confirmacaoAMaoRecusada({
    finalCents: Number(venda.final_cents ?? 0),
    meio: (daVez?.payment_method as string | null) ?? (venda.payment_method as string | null),
    pronta: pronta === true,
    recebidoCents: todas.reduce((s, p) => s + Number(p.paid_amount_cents ?? 0), 0),
    pagaPorFora: (externas ?? []).length > 0,
  });
}
