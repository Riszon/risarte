import { BadgeCheck, Building2 } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BirthdayNotifier } from "./birthday-notifier";
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

/** Saudação pela hora do dia (fuso de São Paulo) + data por extenso. */
function greetingAndDate(): { greeting: string; dateLabel: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(now)
  );
  const greeting =
    hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const raw = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const dateLabel = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { greeting, dateLabel };
}

/** Iniciais (até 2) para o monograma do usuário. */
function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

type FranchisorRoleRow = {
  role: UserRole;
  unit_scope: UnitScope | null;
  clinics: { type: string } | null;
  role_unit_access: { clinics: { id: string; name: string } | null }[] | null;
};

export default async function HomePage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  // P2: a Recepção da unidade recebe (uma vez por dia) o aviso dos
  // aniversariantes — antecipando fim de semana/feriado. Perf: em vez de
  // bloquear o render da home, o disparo vai para segundo plano
  // (<BirthdayNotifier/>), mantendo o mesmo gate de papel abaixo.
  const homeClinic = session.activeClinic;
  const shouldNotifyBirthdays =
    !!homeClinic &&
    homeClinic.type !== "franchisor" &&
    (session.isAdminMaster ||
      hasRoleInClinic(session, homeClinic.id, [
        "receptionist",
        "unit_manager",
        "clinical_coordinator",
      ]));

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

  const { greeting, dateLabel } = greetingAndDate();
  const firstName = session.fullName.split(" ")[0] || "bem-vindo(a)";

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      {shouldNotifyBirthdays && homeClinic && (
        <BirthdayNotifier clinicId={homeClinic.id} />
      )}

      {/* Boas-vindas */}
      <section className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8">
        <div className="absolute inset-x-0 top-0 h-1 bg-gold" />
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold text-lg font-bold text-primary">
            {initialsOf(session.fullName)}
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-primary-foreground/60">
              {dateLabel}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}, {firstName}!
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-primary-foreground/75">
              {session.activeClinic
                ? `Você está em ${session.activeClinic.name}`
                : "Nenhuma clínica cadastrada ainda."}
              {session.isAdminMaster && (
                <Badge className="bg-gold text-gold-foreground">Admin Master</Badge>
              )}
            </p>
          </div>
        </div>
      </section>

      {franchisorEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              Unidades sob sua responsabilidade
            </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-primary" />
            Suas clínicas e funções
          </CardTitle>
          <CardDescription>
            Use o seletor no menu lateral para trocar de clínica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.isAdminMaster && (
            <p className="mb-3 text-sm text-muted-foreground">
              Como Admin Master, você tem acesso a todas as clínicas da rede.
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
