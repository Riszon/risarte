import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";
import { ContactRulesEditor } from "./contact-rules-editor";

export const metadata: Metadata = { title: "Chat — Contatos" };

export default async function ChatContactsPage() {
  const session = await getSessionContext();
  if (!session.isAdminMaster) redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_contact_rules")
    .select("franchisor_role, unit_role, allowed")
    .returns<
      { franchisor_role: UserRole; unit_role: UserRole; allowed: boolean }[]
    >();

  const rules: Record<string, boolean> = {};
  for (const r of data ?? []) {
    rules[`${r.franchisor_role}|${r.unit_role}`] = r.allowed;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Chat — quem conversa com quem
        </h1>
        <p className="text-sm text-muted-foreground">
          Marque quais funções da <b>franqueadora</b> podem trocar mensagens
          diretas com quais funções da <b>unidade</b>. Conversas dentro da mesma
          unidade valem sempre; o Admin conversa com todos. Tudo liberado por
          padrão.
        </p>
      </div>
      <ContactRulesEditor rules={rules} />
    </div>
  );
}
