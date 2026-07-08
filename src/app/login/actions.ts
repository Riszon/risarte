"use server";

import { logAudit } from "@/lib/audit";

/**
 * H4.1 Lote 3: registra a entrada no sistema na trilha de auditoria. Chamada
 * pelo formulário de login logo após o sign-in. Best-effort — nunca quebra o
 * login (logAudit engole erros). A clínica ativa ainda não está resolvida aqui,
 * então o evento fica sem unidade (é um acesso, não uma ação de unidade).
 */
export async function recordLogin(): Promise<void> {
  await logAudit({ action: "login", entityType: "session" });
}
