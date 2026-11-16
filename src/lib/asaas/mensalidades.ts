import "server-only";

/**
 * 4018 (19.32) — as mensalidades no Asaas, do lado do servidor, para qualquer
 * origem registrada (`charge_source_types`): antes de mudar uma mensalidade que
 * tem cobrança viva (cancelar a adesão, encerrar o caso, cancelar a mensalidade),
 * a cobrança é cancelada no Asaas pelo caminho da 4015 (boleto já pago para tudo).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelarBoletosDoSistema } from "@/lib/asaas/boletos-da-operacao";

export async function cancelarCobrancasDasMensalidades(args: {
  tipo: string;
  ids: string[];
  actorId: string;
  motivo: string;
}): Promise<{ ok: true; cancelados: number } | { ok: false; error: string }> {
  if (!args.ids.length) return { ok: true, cancelados: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("charges")
    .select("id")
    .eq("source_type", args.tipo)
    .in("source_id", args.ids)
    .in("status", ["emitindo", "emitida", "vencida", "erro_emissao"]);
  if (error) return { ok: false, error: "Não foi possível ler as cobranças das mensalidades." };
  const ids = (data ?? []).map((x) => x.id as string);
  if (!ids.length) return { ok: true, cancelados: 0 };
  const r = await cancelarBoletosDoSistema(ids, args.actorId, args.motivo);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, cancelados: r.cancelados };
}

/** A mensagem da trava da mensalidade (19.32.2 item 6). */
export const MENSAGEM_DA_TRAVA_DA_MENSALIDADE =
  "Esta mensalidade tem cobrança viva no Asaas. Espere o aviso do pagamento, ou cancele a cobrança antes de mudar ou dar baixa à mão.";
