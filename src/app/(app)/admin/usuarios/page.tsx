import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

export const metadata: Metadata = { title: "Risartanos" };

type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  is_admin_master: boolean;
  is_active: boolean;
};

type RoleRow = {
  user_id: string;
  role: UserRole;
  clinics: { name: string } | null;
};

export default async function UsersPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, is_admin_master, is_active")
      .order("full_name")
      .returns<ProfileRow[]>(),
    supabase
      .from("user_clinic_roles")
      .select("user_id, role, clinics ( name )")
      .returns<RoleRow[]>(),
  ]);

  const rolesByUser = new Map<string, RoleRow[]>();
  for (const row of roles ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row);
    rolesByUser.set(row.user_id, list);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Risartanos</h1>
          <p className="text-sm text-muted-foreground">
            Os colaboradores da rede e suas funções por clínica.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/admin/usuarios/novo" />}>
          Novo usuário
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Funções</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(profiles ?? []).map((profile) => {
              const userRoles = rolesByUser.get(profile.id) ?? [];
              return (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">
                    {profile.full_name || "—"}
                  </TableCell>
                  <TableCell>{profile.email ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {profile.is_admin_master && (
                        <Badge className="bg-gold text-gold-foreground">
                          Admin Master
                        </Badge>
                      )}
                      {userRoles.map((r, i) => (
                        <Badge key={i} variant="secondary">
                          {ROLE_LABELS[r.role]}
                          {r.clinics ? ` · ${r.clinics.name}` : ""}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {profile.is_active ? (
                      <Badge variant="secondary">Ativo</Badge>
                    ) : (
                      <Badge variant="destructive">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/usuarios/${profile.id}`} />}
                    >
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
