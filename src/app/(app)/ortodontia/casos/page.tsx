import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ListChecks, UserPlus } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageOrtho, canViewOrtho, canViewOrthoDashboard, orthoRestrictedToOwn } from "@/lib/ortodontia/access";
import { resolveOrthoScope } from "@/lib/ortodontia/escopo";
import { groupByCase, loadCases, loadMaintenancesFor } from "@/lib/ortodontia/db";
import { TIMELINESS_LABELS, attendance, caseTimeliness, nextMaintenance, progressPercent, type MaintenanceLike } from "@/lib/ortodontia/regras";
import { ORTHO_KIND_LABELS, ORTHO_STATUS_LABELS, ORTHO_STATUSES, type OrthoStatus } from "@/lib/ortodontia/constants";
import { ORTHO_STATUS_TONE } from "@/components/ortodontia/ortho-client-card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { atendeABusca } from "@/lib/busca";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ortodontia — Casos" };

/** A lista dos casos, com busca e filtros. O dentista "puro" vê só os seus. */
export default async function OrtoCasosPage(props: PageProps<"/ortodontia/casos">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");

  const sp = await props.searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const scope = resolveOrthoScope(session, pick("unidade"));
  const situacao = pick("situacao");
  const status = (ORTHO_STATUSES as readonly string[]).includes(situacao ?? "") ? (situacao as OrthoStatus) : null;
  const busca = (pick("busca") ?? "").trim();
  const soMeus = orthoRestrictedToOwn(session, scope.clinicId);
  const today = todayInBrazil();

  const supabase = await createClient();
  const casesRead = await loadCases(supabase, {
    clinicIds: scope.clinicIds,
    statuses: status ? [status] : undefined,
    orthodontistId: soMeus ? session.userId : null,
  });
  const todos = casesRead.ok ? casesRead.linhas : [];
  const cases = busca
    ? todos.filter((c) => atendeABusca(`${c.client?.full_name ?? ""} ${c.client?.code ?? ""} ${c.code} ${c.orthodontist?.full_name ?? ""}`, busca))
    : todos;
  const maintRead = await loadMaintenancesFor(supabase, cases.map((c) => c.id));
  const maintByCase = groupByCase(maintRead.ok ? maintRead.linhas : []);

  const unitOptions = scope.canSeeNetwork
    ? session.clinics.filter((c) => c.type === "franchise_unit").map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={ListChecks}
        titulo="Casos ortodônticos"
        descricao={`${cases.length} caso${cases.length === 1 ? "" : "s"} em ${scope.label}${status ? ` · ${ORTHO_STATUS_LABELS[status]}` : ""}.`}
        voltar={canViewOrthoDashboard(session) ? { href: "/ortodontia", rotulo: "Painel" } : { href: "/ortodontia/atencao", rotulo: "Atenção" }}
      >
        {canManageOrtho(session, scope.clinicId) && (
          <Button size="sm" nativeButton={false} render={<Link href="/ortodontia/casos/novo" />}>
            <UserPlus className="mr-1 size-3.5" /> Novo caso
          </Button>
        )}
      </CabecalhoDeModulo>

      <FilterForm className="flex flex-wrap items-center gap-2 text-sm">
        <Input name="busca" defaultValue={busca} placeholder="Buscar paciente, código ou ortodontista… (Enter)" className="h-9 w-72" />
        {scope.canSeeNetwork && (
          <select name="unidade" defaultValue={pick("unidade") ?? (scope.clinicId ?? "all")} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="all">Rede toda</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        <select name="situacao" defaultValue={status ?? ""} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Todas as situações</option>
          {ORTHO_STATUSES.map((s) => (
            <option key={s} value={s}>{ORTHO_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </FilterForm>

      {!casesRead.ok && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Não foi possível ler os casos agora. Se o banco ainda não recebeu a migração 0329, este módulo aparece vazio.
        </p>
      )}
      {casesRead.ok && cases.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhum caso{busca ? " com esta busca" : ""}{status ? ` em "${ORTHO_STATUS_LABELS[status]}"` : ""}.
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {cases.map((c) => {
          const ms: MaintenanceLike[] = (maintByCase.get(c.id) ?? []).map((m) => ({
            status: m.status,
            planned_date: m.planned_date,
            done_at: m.done_at,
            appointment_date: m.appointment?.starts_at ? m.appointment.starts_at.slice(0, 10) : null,
          }));
          const next = nextMaintenance(ms, today);
          const a = attendance(ms, c.maintenance_interval_days);
          const { done, missed } = a;
          const t = caseTimeliness(c, today);
          const pct = progressPercent(c, today);
          return (
            <li key={c.id}>
              <Link href={`/ortodontia/casos/${c.id}`} className="block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.client?.full_name ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">{c.code}</span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ORTHO_STATUS_TONE[c.status])}>{ORTHO_STATUS_LABELS[c.status]}</span>
                        {(t === "atrasado" || t === "finalizado_atrasado") && (
                          <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">{TIMELINESS_LABELS[t]}</span>
                        )}
                        {scope.clinicIds === null && c.clinic && <span className="text-xs text-muted-foreground">· {c.clinic.name}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ORTHO_KIND_LABELS[c.treatment_kind]}
                        {c.orthodontist ? ` · ${c.orthodontist.full_name}` : ""}
                        {c.start_date ? ` · início ${formatIsoDateBr(c.start_date)}` : ""}
                        {c.status === "em_tratamento" && c.planned_end_date ? ` · término previsto ${formatIsoDateBr(c.planned_end_date)}${c.extension_days > 0 ? ` (+${c.extension_days} dias pelas faltas)` : ""}` : ""}
                        {c.retainer_delivered_at ? ` · contenções entregues ${formatIsoDateBr(c.retainer_delivered_at)}` : ""}
                        {c.status === "em_tratamento" && c.monthly_fee_cents > 0 ? ` · ${formatBRL(c.monthly_fee_cents)}/mês` : ""}
                      </p>
                      {pct !== null && c.status === "em_tratamento" && (
                        <div className="mt-1.5 h-1.5 w-full max-w-md rounded bg-muted" title={`${pct}% do prazo previsto`}>
                          <div className={cn("h-1.5 rounded", t === "atrasado" ? "bg-rose-500" : "bg-primary/70")} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {done} realizada{done === 1 ? "" : "s"}
                        {missed > 0 && <span className="text-rose-700"> · {missed} falta{missed === 1 ? "" : "s"}</span>}
                        {a.ratePercent !== null && <span className={a.ratePercent < 80 ? " text-amber-700" : undefined}> · {a.ratePercent}%</span>}
                      </span>
                      <span>{next ? `próx. ${formatIsoDateBr((next.appointment_date ?? next.planned_date ?? "").slice(0, 10))}` : "—"}</span>
                      <ChevronRight className="size-4" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
