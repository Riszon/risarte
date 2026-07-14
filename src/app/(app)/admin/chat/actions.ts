"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { UserRole } from "@/lib/roles";

export type ActionResult = { ok: boolean; error?: string };

/** Define se uma função da franqueadora pode conversar (DM) com uma função da
 * unidade (e vice-versa). Só o Admin Master. */
export async function setChatContactRule(input: {
  franchisorRole: UserRole;
  unitRole: UserRole;
  allowed: boolean;
}): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Apenas o Admin Master configura os contatos." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("chat_contact_rules").upsert(
    {
      franchisor_role: input.franchisorRole,
      unit_role: input.unitRole,
      allowed: input.allowed,
    },
    { onConflict: "franchisor_role,unit_role" }
  );
  if (error) {
    console.error("setChatContactRule failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a regra." };
  }
  await logAudit({
    action: "update",
    entityType: "chat_contact_rule",
    entityId: `${input.franchisorRole}:${input.unitRole}`,
  });
  return { ok: true };
}
