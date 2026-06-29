import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyUnitBirthdays } from "./prontuarios/actions";
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
  type UnitScope,
  type UserRole,
} from "@/lib/roles";

type FranchisorRoleRow = {
  role: UserRole;
  unit_scope: UnitScope | null;
  clinics: { type: string } | null;
  role_unit_access: { clinics: { id: string; name: string } | null }[] | null;
};

export default async function HomePage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  // P2: ao abrir o sistema, a Recepção da unidade recebe (uma vez por dia) o
  // aviso dos aniversariantes — antecipando fim de semana/feriado.
  const homeClinic = session.activeClinic;
  if (
    homeClinic &&
    homeClinic.type !== "franchisor" &&
    (session.isAdminMaster ||
      hasRoleInClinic(session, homeClinic.id, [
        "receptionist",
        "unit_manager",
        "clinical_coordinator",
      ]))
  ) {
    await notifyUnitBirthdays(homeClinic.id);
  }

  // For franchisor-role users: which units are under their responsibility?
  const { data: franchisorRoles } = await supabase
    .from("user_clinic_roles")
    .select(
      "role, unit_scope, clinics!inner ( type ), role_unit_access ( clinics ( id, name ) )"
    )
    .eq("user_id", session.userId)
    .returns<FranchisorRoleRow[]>();

  const franchisorEntries = (franchisorRoles ?? []).filter(
    (r) => r.clinics?.type === "franchisor"
  );

  let allUnits: { id: string; name: string }[] = [];
  if (franchisorEntries.some((r) => r.unit_scope === "all")) {
    const { data } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name");
    allUnits = data ?? [];
  }

  function unitsFor(entry: FranchisorRoleRow): {
    scope: UnitScope;
    units: { id: string; name: string }[];
  } {
    const scope = entry.unit_scope ?? "all";
    if (scope === "all") return { scope, units: allUnits };
    if (scope === "none") return { scope, units: [] };
    const units = (entry.role_unit_access ?? [])
      .map((a) => a.clinics)
      .filter((c): c is { id: string; name: string } => Boolean(c));
    return { scope, units };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {session.fullName.split(" ")[0] || "bem-vindo(a)"}!
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic
            ? `Você está trabalhando em: ${session.activeClinic.name}`
            : "Nenhuma clínica cadastrada ainda."}
        </p>
      </div>

      {franchisorEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Unidades sob sua responsabilidade</CardTitle>
            <CardDescription>
              Unidades franqueadas que você atende, por função.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {franchisorEntries.map((entry) => {
              const { scope, units } = unitsFor(entry);
              return (
                <div key={entry.role} className="rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {ROLE_LABELS[entry.role]}
                  </p>
                  {scope === "none" ? (
                    <p className="text-xs text-muted-foreground">
                      Sem unidades atribuídas.
                    </p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {scope === "all" && (
                        <Badge className="bg-gold text-gold-foreground">
                          Todas as unidades
                        </Badge>
                      )}
                      {units.map((u) => (
                        <Badge key={u.id} variant="secondary">
                          {u.name}
                        </Badge>
                      ))}
                      {units.length === 0 && scope === "specific" && (
                        <p className="text-xs text-muted-foreground">
                          Nenhuma unidade selecionada.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Suas clínicas e funções</CardTitle>
          <CardDescription>
            Use o seletor no menu lateral para trocar de clínica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.isAdminMaster && (
            <p className="mb-3 text-sm text-muted-foreground">
              Você é{" "}
              <Badge className="bg-gold text-gold-foreground">Admin Master</Badge>{" "}
              e tem acesso a todas as clínicas da rede.
            </p>
          )}
          {session.clinics.length > 0 ? (
            <ul className="space-y-2">
              {session.clinics.map((clinic) => (
                <li
                  key={clinic.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{clinic.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CLINIC_TYPE_LABELS[clinic.type]}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(session.rolesByClinic[clinic.id] ?? []).map((role) => (
                      <Badge key={role} variant="secondary">
                        {ROLE_LABELS[role]}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !session.isAdminMaster && (
              <p className="text-sm text-muted-foreground">
                Nenhuma função atribuída ainda. Fale com o administrador.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
