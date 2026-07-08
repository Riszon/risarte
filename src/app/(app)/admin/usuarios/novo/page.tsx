import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewUserForm, type InitialStaff } from "./new-user-form";

export const metadata: Metadata = { title: "Novo usuário" };

export default async function NewUserPage(
  props: PageProps<"/admin/usuarios/novo">
) {
  await requireAdminMaster();
  const supabase = await createClient();
  const searchParams = await props.searchParams;

  const { data: clinics } = await supabase
    .from("clinics")
    .select("id, name, type")
    .eq("is_active", true)
    .order("name");

  // H4.1 Lote 2b: "Criar acesso" a partir de um Risartano — pré-preenche nome e
  // e-mail e vincula o login ao cadastro de RH ao salvar.
  let initialStaff: InitialStaff | null = null;
  const staffId =
    typeof searchParams.risartano === "string" ? searchParams.risartano : "";
  if (staffId) {
    const { data: staff } = await supabase
      .from("staff_members")
      .select("id, code, full_name, email, user_id, clinics ( name )")
      .eq("id", staffId)
      .maybeSingle<{
        id: string;
        code: string | null;
        full_name: string;
        email: string | null;
        user_id: string | null;
        clinics: { name: string } | null;
      }>();
    if (staff && !staff.user_id) {
      initialStaff = {
        id: staff.id,
        code: staff.code,
        fullName: staff.full_name,
        email: staff.email,
        clinicName: staff.clinics?.name ?? null,
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo usuário</h1>
        <p className="text-sm text-muted-foreground">
          Crie o acesso e defina as funções por clínica. Informe a senha
          provisória ao colaborador por um canal seguro.
        </p>
      </div>
      <NewUserForm clinics={clinics ?? []} initialStaff={initialStaff} />
    </div>
  );
}
