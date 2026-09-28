"use server";

import { aceitarConvite } from "@/lib/indica/publico";

/** O indicado aceita o contato (LGPD). O banco grava o aceite e o IP. */
export async function aceitar(token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  return aceitarConvite(token);
}
