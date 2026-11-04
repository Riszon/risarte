"use server";

import { aceitarConvite } from "@/lib/indica/publico";

/**
 * O indicado aceita o contato (LGPD) e responde se quem o indicou pode ser
 * avisado das etapas dele. O banco grava o aceite, o IP e a autorização.
 */
export async function aceitar(token: string, avisarIndicador = false): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  return aceitarConvite(token, avisarIndicador === true);
}
