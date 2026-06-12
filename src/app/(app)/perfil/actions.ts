"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/masks";

export type ActionResult = { ok: boolean; error?: string };

/** Users may update their own NON-critical data (name, phone). */
export async function updateOwnProfile(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) return { ok: false, error: "Informe o nome completo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: phone ? formatPhone(phone) : null })
    .eq("id", session.userId);

  if (error) {
    console.error("updateOwnProfile failed:", error.message);
    return { ok: false, error: "Não foi possível salvar seus dados." };
  }

  revalidatePath("/perfil");
  revalidatePath("/", "layout");
  return { ok: true };
}
