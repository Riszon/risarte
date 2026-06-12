import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/roles";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function ProfilePage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, email")
    .eq("id", session.userId)
    .single();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">
          Atualize seus dados não-críticos. E-mail de acesso e funções são
          alterados apenas pelo Admin Master.
        </p>
      </div>

      <ProfileForm
        fullName={profile?.full_name ?? ""}
        phone={profile?.phone ?? ""}
        email={profile?.email ?? session.email}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suas funções</CardTitle>
          <CardDescription>
            Definidas pelo Admin Master, por clínica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.isAdminMaster && (
            <Badge className="mr-1 bg-gold text-gold-foreground">
              Admin Master
            </Badge>
          )}
          {session.clinics.map((clinic) =>
            (session.rolesByClinic[clinic.id] ?? []).map((role) => (
              <Badge key={`${clinic.id}-${role}`} variant="secondary" className="mr-1 mb-1">
                {ROLE_LABELS[role]} · {clinic.name}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
