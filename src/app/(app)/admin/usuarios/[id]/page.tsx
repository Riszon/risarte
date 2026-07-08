import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClinicType, UnitScope, UserRole } from "@/lib/roles";
import { UserEditor } from "./user-editor";

export const metadata: Metadata = { title: "Editar usuário" };

type RoleRow = {
  id: string;
  clinic_id: string;
  role: UserRole;
  unit_scope: UnitScope | null;
  clinics: { name: string; type: ClinicType } | null;
  role_unit_access: { clinic_id: string }[] | null;
};

export default async function EditUserPage(
  props: PageProps<"/admin/usuarios/[id]">
) {
  const session = await requireAdminMaster();
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: profile }, { data: roles }, { data: clinics }, { data: staffLinks }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, is_admin_master, is_active")
        .eq("id", id)
        .single(),
      supabase
        .from("user_clinic_roles")
        .select(
          "id, clinic_id, role, unit_scope, clinics ( name, type ), role_unit_access ( clinic_id )"
        )
        .eq("user_id", id)
        .returns<RoleRow[]>(),
      supabase
        .from("clinics")
        .select("id, name, type")
        .eq("is_active", true)
        .order("name"),
      // H4.1 Lote 2b: cadastro(s) de RH vinculado(s) a este login.
      supabase
        .from("staff_members")
        .select("id, code, full_name, is_active, clinics ( name )")
        .eq("user_id", id)
        .returns<
          {
            id: string;
            code: string | null;
            full_name: string;
            is_active: boolean;
            clinics: { name: string } | null;
          }[]
        >(),
    ]);

  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.full_name || profile.email}
        </h1>
        <p className="text-sm text-muted-foreground">{profile.email}</p>
        {(staffLinks ?? []).map((s) => (
          <p key={s.id} className="text-sm">
            Risartano vinculado:{" "}
            <Link
              href={{
                pathname: "/risartanos",
                query: s.code ? { busca: s.code } : undefined,
              }}
              className="font-mono font-medium text-gold underline-offset-2 hover:underline"
            >
              {s.code ?? "RH"}
            </Link>{" "}
            · {s.clinics?.name ?? "—"}
            {!s.is_active && (
              <span className="ml-1 font-medium text-destructive">
                (colaborador inativo — avalie desativar o acesso)
              </span>
            )}
          </p>
        ))}
        {(staffLinks ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Sem cadastro de RH vinculado (Risartanos).
          </p>
        )}
      </div>
      <UserEditor
        profile={profile}
        roles={(roles ?? []).map((r) => ({
          id: r.id,
          clinicId: r.clinic_id,
          role: r.role,
          clinicName: r.clinics?.name ?? "—",
          clinicType: r.clinics?.type ?? "franchise_unit",
          unitScope: r.unit_scope,
          unitIds: (r.role_unit_access ?? []).map((u) => u.clinic_id),
        }))}
        clinics={clinics ?? []}
        isSelf={session.userId === profile.id}
      />
    </div>
  );
}
