import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ROLE_LABELS,
  CLINIC_TYPE_LABELS,
  type UserRole,
  type ClinicType,
} from "@/lib/roles";
import { LogoutButton } from "./logout-button";

type ClinicRoleRow = {
  role: UserRole;
  clinics: {
    id: string;
    name: string;
    type: ClinicType;
  } | null;
};

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: clinicRoles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, is_admin_master")
      .eq("id", user.id)
      .single(),
    supabase
      .from("user_clinic_roles")
      .select("role, clinics ( id, name, type )")
      .eq("user_id", user.id)
      .returns<ClinicRoleRow[]>(),
  ]);

  return (
    <main className="flex-1 bg-background">
      <header className="border-b bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">Risarte Odontologia</h1>
            <p className="text-xs text-sidebar-foreground/70">
              {profile?.full_name ?? user.email}
              {profile?.is_admin_master && " · Admin Master"}
            </p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Bem-vindo(a)!</CardTitle>
            <CardDescription>
              A fundação do sistema está pronta: login, segurança e papéis por
              clínica. Os módulos da jornada do cliente chegam nas próximas
              etapas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <h2 className="mb-3 text-sm font-medium text-foreground">
              Suas clínicas e papéis
            </h2>
            {clinicRoles && clinicRoles.length > 0 ? (
              <ul className="space-y-2">
                {clinicRoles.map((entry) => (
                  <li
                    key={`${entry.clinics?.id}-${entry.role}`}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {entry.clinics?.name ?? "Clínica"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.clinics
                          ? CLINIC_TYPE_LABELS[entry.clinics.type]
                          : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{ROLE_LABELS[entry.role]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {profile?.is_admin_master
                  ? "Você é Admin Master e tem acesso a todas as clínicas."
                  : "Nenhum papel atribuído ainda. Fale com o administrador."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
