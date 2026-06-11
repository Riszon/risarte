import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";
import { UserEditor } from "./user-editor";

export const metadata: Metadata = { title: "Editar usuário" };

type RoleRow = {
  id: string;
  clinic_id: string;
  role: UserRole;
  clinics: { name: string } | null;
};

export default async function EditUserPage(
  props: PageProps<"/admin/usuarios/[id]">
) {
  const session = await requireAdminMaster();
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: profile }, { data: roles }, { data: clinics }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, is_admin_master, is_active")
        .eq("id", id)
        .single(),
      supabase
        .from("user_clinic_roles")
        .select("id, clinic_id, role, clinics ( name )")
        .eq("user_id", id)
        .returns<RoleRow[]>(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.full_name || profile.email}
        </h1>
        <p className="text-sm text-muted-foreground">{profile.email}</p>
      </div>
      <UserEditor
        profile={profile}
        roles={(roles ?? []).map((r) => ({
          id: r.id,
          clinicId: r.clinic_id,
          role: r.role,
          clinicName: r.clinics?.name ?? "—",
        }))}
        clinics={clinics ?? []}
        isSelf={session.userId === profile.id}
      />
    </div>
  );
}
