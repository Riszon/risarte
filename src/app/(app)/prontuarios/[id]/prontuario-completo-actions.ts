"use server";

// OD6 (J3): registrar a geração do prontuário completo. Quem pode (o Admin
// Master e o Gerente da unidade) e o motivo, o banco confere (0315); aqui só
// se chama, traduz o recado e deixa o rastro na auditoria.

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { MotivoDoProntuario } from "@/lib/prontuario/linha-do-tempo";

export async function gerarProntuarioCompleto(input: {
  clientId: string;
  motivo: MotivoDoProntuario;
  nota: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_record_export", {
    p_client: input.clientId,
    p_reason: input.motivo,
    p_note: input.nota.trim() || null,
  });
  if (error || !data) {
    const mapa: [string, string][] = [
      ["NOT_ALLOWED", "O prontuário completo é gerado pelo Admin Master ou pelo Gerente da unidade."],
      ["EXPORT_NOTE_REQUIRED", "Em \"Outro\", escreva o motivo (mínimo de 5 letras)."],
      ["EXPORT_REASON_INVALID", "Escolha o motivo."],
      ["CLIENT_NOT_FOUND", "Cliente não encontrado. Atualize a tela."],
    ];
    const recado = error ? mapa.find(([k]) => error.message.includes(k))?.[1] : undefined;
    if (!recado) console.error("gerarProntuarioCompleto failed:", error?.message);
    return { ok: false, error: recado ?? "Não foi possível gerar o prontuário agora." };
  }
  // LGPD: só ids e o código do motivo — nunca o texto livre (pode ter dado pessoal).
  await logAudit({
    action: "export",
    entityType: "clinical_record_export",
    entityId: data as string,
    details: { client_id: input.clientId, motivo: input.motivo },
  });
  return { ok: true, id: data as string };
}
