import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * FALHA DO PÓS-ASSINATURA VIRA AVISO (AP155, revisão de 11/11/2026).
 *
 * Antes estas falhas ficavam só num evento dentro do pacote (ou só no log):
 * o contrato assinado sem a venda fechada, o selo do Empresarial não marcado,
 * o PDF assinado que nunca baixou, o documento que ficou aberto na ZapSign
 * depois de um envio que falhou, e a rotina diária que parou de rodar.
 *
 * Aviso nasce pela porta do banco (0316): a conta inteira mora em
 * `public.signature_failure_notices()` (0396) — quais falhas avisam, quem
 * recebe (Admin Master + quem enviou) e o "uma vez por falha". A rotina de
 * hora em hora só chama.
 */
export async function avisarFalhas(admin: SupabaseClient, stats: { erros: string[] }) {
  const { error } = await admin.rpc("signature_failure_notices");
  if (error) stats.erros.push(`avisos: ${error.message}`);
}
