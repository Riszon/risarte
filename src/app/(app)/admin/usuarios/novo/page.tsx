import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewUserForm } from "./new-user-form";

export const metadata: Metadata = { title: "Novo usuário" };

export default async function NewUserPage() {
  await requireAdminMaster();
  const supabase = await createClient();
  const { data: clinics } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo usuário</h1>
        <p className="text-sm text-muted-foreground">
          Crie o acesso e defina as funções por clínica. Informe a senha
          provisória ao colaborador por um canal seguro.
        </p>
      </div>
      <NewUserForm clinics={clinics ?? []} />
    </div>
  );
}
