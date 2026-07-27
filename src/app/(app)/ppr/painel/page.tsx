import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CalendarCheck,
  HeartPulse,
  Sparkles,
  TrendingUp,
  Trophy,
  UserMinus,
  Users,
  Wallet,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { canViewPpr } from "@/lib/ppr/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RisarteMark } from "@/components/risarte-logo";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Painel do PPR+" };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
const monthLabel = (d: Date) => `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

/** Painel do PPR+: crescimento, receita, prevenção e ranking das unidades. */
export default async function PprDashboardPage(
  props: PageProps<"/ppr/painel">
) {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");

  const roles = Object.values(session.rolesByClinic).flat();
  const canSeeNetwork =
    session.isAdminMaster ||
    roles.some((r) => ["franchisor_staff", "franchisee"].includes(r));

  const sp = await props.searchParams;
  const unidadeParam = Array.isArray(sp.unidade) ? sp.unidade[0] : sp.unidade;
  const activeClinicId = session.activeClinic?.id ?? null;
  const activeIsUnit = session.activeClinic?.type === "franchise_unit";
  let clinicFilter: string | null;
  if (!canSeeNetwork) clinicFilter = activeClinicId;
  else if (unidadeParam === "all") clinicFilter = null;
  else if (unidadeParam) clinicFilter = unidadeParam;
  else clinicFilter = activeIsUnit ? activeClinicId : null;

  await logAudit({
    action: "view",
    entityType: "ppr_dashboard",
    entityId: clinicFilter ?? "all",
    clinicId: clinicFilter ?? undefined,
  });

  const supabase = await createClient();

  let unitOptions: { id: string; name: string }[] = [];
  if (canSeeNetwork) {
    const { data: units } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name");
    unitOptions = (units ?? []) as { id: string; name: string }[];
  }

  // -- Adesões ---------------------------------------------------------------
  let memQuery = supabase
    .from("ppr_memberships")
    .select(
      "id, clinic_id, plan_id, status, monthly_cents, created_at, activated_at, cancelled_at, plan:ppr_plans ( name )"
    );
  if (clinicFilter) memQuery = memQuery.eq("clinic_id", clinicFilter);
  const { data: memRows } = await memQuery;
  type Mem = {
    id: string;
    clinic_id: string;
    plan_id: string;
    status: string;
    monthly_cents: number;
    created_at: string;
    activated_at: string | null;
    cancelled_at: string | null;
    plan: { name: string } | { name: string }[] | null;
  };
  const memberships = (memRows ?? []) as unknown as Mem[];
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const active = memberships.filter((m) => m.status === "ativo");
  const suspended = memberships.filter((m) => m.status === "suspenso");
  const waiting = memberships.filter((m) => m.status === "aguardando_ativacao");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newThisMonth = memberships.filter(
    (m) => new Date(m.created_at) >= monthStart
  );
  const cancelledThisMonth = memberships.filter(
    (m) => m.cancelled_at && new Date(m.cancelled_at) >= monthStart
  );

  const mrr = active.reduce((s, m) => s + m.monthly_cents, 0);
  const ticket = active.length > 0 ? Math.round(mrr / active.length) : 0;

  // -- Beneficiários ---------------------------------------------------------
  const liveIds = new Set(
    memberships.filter((m) => m.status !== "cancelado").map((m) => m.id)
  );
  let benQuery = supabase
    .from("ppr_beneficiaries")
    .select("id, membership_id, client_id, role, left_at");
  if (clinicFilter) benQuery = benQuery.eq("clinic_id", clinicFilter);
  const { data: benRows } = await benQuery;
  const beneficiaries = ((benRows ?? []) as {
    id: string;
    membership_id: string;
    client_id: string;
    role: string;
    left_at: string | null;
  }[]).filter((b) => !b.left_at && liveIds.has(b.membership_id));
  const holders = beneficiaries.filter((b) => b.role === "titular").length;
  const dependents = beneficiaries.length - holders;
  const clientIds = [...new Set(beneficiaries.map((b) => b.client_id))];

  // -- Por plano + crescimento ----------------------------------------------
  const byPlan = new Map<string, { name: string; count: number; mrr: number }>();
  for (const m of active) {
    const name = one(m.plan)?.name ?? "Plano";
    const a = byPlan.get(m.plan_id) ?? { name, count: 0, mrr: 0 };
    a.count += 1;
    a.mrr += m.monthly_cents;
    byPlan.set(m.plan_id, a);
  }
  // Quantos deste plano entraram no mês (base da taxa de crescimento).
  const newByPlan = new Map<string, number>();
  for (const m of newThisMonth) {
    newByPlan.set(m.plan_id, (newByPlan.get(m.plan_id) ?? 0) + 1);
  }

  // Crescimento dos últimos 6 meses: adesões criadas e receita acumulada.
  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: monthLabel(d), date: d });
  }
  const growth = months.map((m) => {
    const end = new Date(m.date.getFullYear(), m.date.getMonth() + 1, 1);
    const created = memberships.filter((x) => {
      const d = new Date(x.created_at);
      return d >= m.date && d < end;
    }).length;
    // Vivas no fim daquele mês (não canceladas até lá).
    const alive = memberships.filter((x) => {
      const born = new Date(x.created_at);
      const dead = x.cancelled_at ? new Date(x.cancelled_at) : null;
      return born < end && (!dead || dead >= end);
    });
    return {
      label: m.label,
      created,
      alive: alive.length,
      mrr: alive.reduce((s, x) => s + x.monthly_cents, 0),
    };
  });
  const prevAlive = growth[growth.length - 2]?.alive ?? 0;
  const curAlive = growth[growth.length - 1]?.alive ?? 0;
  const growthRate =
    prevAlive > 0 ? ((curAlive - prevAlive) / prevAlive) * 100 : 0;
  const maxAlive = Math.max(1, ...growth.map((g) => g.alive));
  const maxMrr = Math.max(1, ...growth.map((g) => g.mrr));

  // -- Prevenção (uso do benefício + agenda) ---------------------------------
  let usageQuery = supabase
    .from("ppr_benefit_usages")
    .select("id, client_id, used_at, next_available_at");
  if (clinicFilter) usageQuery = usageQuery.eq("clinic_id", clinicFilter);
  const { data: usageRows } = await usageQuery;
  const usages = ((usageRows ?? []) as {
    id: string;
    client_id: string;
    used_at: string;
    next_available_at: string | null;
  }[]).filter((u) => clientIds.includes(u.client_id));

  const recurring = usages.filter((u) => u.next_available_at);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const fourMonthsAgo = new Date(now);
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 7);
  const monthAhead = new Date(now);
  monthAhead.setMonth(monthAhead.getMonth() + 1);

  const recentUsers = new Set(
    recurring
      .filter((u) => new Date(u.used_at) >= threeMonthsAgo)
      .map((u) => u.client_id)
  );

  // Agenda dos beneficiários (futuros e último atendimento).
  const futureIds = new Set<string>();
  let futureWeek = 0;
  let futureMonth = 0;
  const lastSeen = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: apptRows } = await supabase
      .from("appointments")
      .select("client_id, starts_at, status")
      .in("client_id", clientIds);
    for (const a of (apptRows ?? []) as {
      client_id: string;
      starts_at: string;
      status: string;
    }[]) {
      if (a.status === "cancelled") continue;
      const at = new Date(a.starts_at);
      if (at >= now) {
        futureIds.add(a.client_id);
        if (at <= weekAhead) futureWeek += 1;
        if (at <= monthAhead) futureMonth += 1;
      } else {
        const cur = lastSeen.get(a.client_id);
        if (!cur || new Date(cur) < at) lastSeen.set(a.client_id, a.starts_at);
      }
    }
  }
  const upToDate = clientIds.filter(
    (id) => recentUsers.has(id) || futureIds.has(id)
  ).length;
  const idle = clientIds.filter((id) => {
    if (futureIds.has(id)) return false;
    const last = lastSeen.get(id);
    return !last || new Date(last) < fourMonthsAgo;
  }).length;

  // Projeção: quando o benefício recorrente libera de novo.
  const dueWeek = recurring.filter(
    (u) =>
      u.next_available_at &&
      new Date(u.next_available_at) >= now &&
      new Date(u.next_available_at) <= weekAhead
  ).length;
  const dueMonth = recurring.filter(
    (u) =>
      u.next_available_at &&
      new Date(u.next_available_at) >= now &&
      new Date(u.next_available_at) <= monthAhead
  ).length;

  // -- Ranking das unidades (rede) ------------------------------------------
  type RankRow = {
    clinicId: string;
    name: string;
    active: number;
    beneficiaries: number;
    mrr: number;
    cancelled: number;
    novos: number;
    limpezas: number;
  };
  let ranking: RankRow[] = [];
  if (canSeeNetwork && !clinicFilter) {
    const byClinic = new Map<string, RankRow>();
    const ensure = (id: string): RankRow => {
      const row = byClinic.get(id) ?? {
        clinicId: id,
        name: unitOptions.find((u) => u.id === id)?.name ?? "Unidade",
        active: 0,
        beneficiaries: 0,
        mrr: 0,
        cancelled: 0,
        novos: 0,
        limpezas: 0,
      };
      byClinic.set(id, row);
      return row;
    };
    for (const m of memberships) {
      const row = ensure(m.clinic_id);
      if (m.status === "ativo") {
        row.active += 1;
        row.mrr += m.monthly_cents;
      }
      if (m.cancelled_at && new Date(m.cancelled_at) >= monthStart)
        row.cancelled += 1;
      if (new Date(m.created_at) >= monthStart) row.novos += 1;
    }
    const clinicOfMembership = new Map(memberships.map((m) => [m.id, m.clinic_id]));
    for (const b of beneficiaries) {
      const cid = clinicOfMembership.get(b.membership_id);
      if (cid) ensure(cid).beneficiaries += 1;
    }
    const clinicOfClient = new Map<string, string>();
    for (const b of beneficiaries) {
      const cid = clinicOfMembership.get(b.membership_id);
      if (cid) clinicOfClient.set(b.client_id, cid);
    }
    for (const u of recurring) {
      const cid = clinicOfClient.get(u.client_id);
      if (cid) ensure(cid).limpezas += 1;
    }
    ranking = [...byClinic.values()].sort((a, b) => b.mrr - a.mrr);
  }

  const unitLabel =
    clinicFilter === null
      ? "Todas as unidades"
      : (unitOptions.find((u) => u.id === clinicFilter)?.name ??
        session.activeClinic?.name ??
        "Unidade");
  const chipHref = (unidade: string | null) =>
    `/ppr/painel?unidade=${unidade ?? "all"}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* Cabeçalho --------------------------------------------------------- */}
      <div className="relative overflow-hidden rounded-2xl border bg-primary text-primary-foreground">
        <RisarteMark className="pointer-events-none absolute -top-4 -right-6 h-40 text-gold/10" />
        <div className="relative space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary-foreground/60">
                <BarChart3 className="size-3.5" />
                PPR+
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Painel do programa
              </h1>
              <p className="mt-0.5 text-sm text-primary-foreground/70">
                {unitLabel} · {active.length} plano(s) ativo(s) ·{" "}
                {formatBRL(mrr)}/mês
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              nativeButton={false}
              render={<Link href="/ppr" />}
            >
              <ArrowLeft className="mr-1 size-3.5" />
              Programa
            </Button>
          </div>

          {canSeeNetwork && unitOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-primary-foreground/15 pt-3 text-xs">
              <span className="w-16 shrink-0 text-primary-foreground/60">
                Unidade
              </span>
              <DarkChip
                label="Todas"
                href={chipHref(null)}
                active={clinicFilter === null}
              />
              {unitOptions.map((u) => (
                <DarkChip
                  key={u.id}
                  label={u.name}
                  href={chipHref(u.id)}
                  active={clinicFilter === u.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Números do programa ----------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          tone="emerald"
          icon={<HeartPulse className="size-4" />}
          label="Planos ativos"
          value={String(active.length)}
          hint={`${waiting.length} aguardando ativação · ${suspended.length} suspenso(s)`}
        />
        <Kpi
          tone="sky"
          icon={<Users className="size-4" />}
          label="Beneficiários"
          value={String(beneficiaries.length)}
          hint={`${holders} titular(es) + ${dependents} dependente(s)`}
        />
        <Kpi
          tone="gold"
          icon={<Wallet className="size-4" />}
          label="Receita mensal"
          value={formatBRL(mrr)}
          hint={`ticket médio ${formatBRL(ticket)}`}
        />
        <Kpi
          tone="violet"
          icon={<TrendingUp className="size-4" />}
          label="Crescimento do mês"
          value={`${growthRate >= 0 ? "+" : ""}${growthRate.toFixed(0)}%`}
          hint={`${newThisMonth.length} novo(s) · ${cancelledThisMonth.length} cancelado(s)`}
        />
      </section>

      {/* Crescimento -------------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-0.5">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <TrendingUp className="size-4 text-primary" />
            Crescimento do PPR+
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Planos vivos e receita mensal nos últimos 6 meses.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-6 gap-2">
            {growth.map((g) => (
              <div key={g.label} className="flex flex-col items-center gap-1">
                <div className="flex h-28 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t bg-sky-500"
                    style={{ height: `${(g.alive / maxAlive) * 100}%` }}
                    title={`${g.alive} plano(s)`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-gold"
                    style={{ height: `${(g.mrr / maxMrr) * 100}%` }}
                    title={formatBRL(g.mrr)}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {g.label}
                </span>
                <span className="text-[11px] font-medium tabular-nums">
                  {g.alive}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-sky-500" />
              planos vivos
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-gold" />
              receita do mês
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Por plano + prevenção --------------------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Sparkles className="size-4 text-gold" />
              Por plano
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Quantidade, receita e quantos entraram neste mês.
            </p>
          </CardHeader>
          <CardContent>
            {byPlan.size === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum plano ativo ainda.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {[...byPlan.entries()]
                  .sort((a, b) => b[1].mrr - a[1].mrr)
                  .map(([planId, v]) => {
                    const novos = newByPlan.get(planId) ?? 0;
                    const base = Math.max(1, v.count - novos);
                    return (
                      <li key={planId}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">
                            {v.name}{" "}
                            <span className="text-xs text-muted-foreground">
                              {v.count}
                            </span>
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">
                            {formatBRL(v.mrr)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gold"
                              style={{
                                width: `${Math.max(2, (v.mrr / Math.max(1, mrr)) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {novos > 0
                              ? `+${novos} no mês (+${((novos / base) * 100).toFixed(0)}%)`
                              : "sem novos no mês"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <CalendarCheck className="size-4 text-emerald-600" />
              Prevenção em dia
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              O coração do programa: quem está voltando e quem sumiu.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Line
              label="Em dia com a limpeza"
              hint="usou nos últimos 3 meses ou já tem agendamento"
              value={upToDate}
              total={clientIds.length}
              tone="emerald"
            />
            <Line
              label="Sem usar o plano"
              hint="mais de 4 meses sem agendamento — ligar!"
              value={idle}
              total={clientIds.length}
              tone="rose"
              icon={<UserMinus className="size-3.5" />}
            />
            <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm">
              <Mini label="Limpezas realizadas" value={String(recurring.length)} />
              <Mini
                label="Agendados (7 dias)"
                value={String(futureWeek)}
                hint={`${futureMonth} no próximo mês`}
              />
              <Mini
                label="Liberam em 7 dias"
                value={String(dueWeek)}
                hint="projeção pela frequência do plano"
              />
              <Mini
                label="Liberam em 30 dias"
                value={String(dueMonth)}
                hint="chamar para agendar"
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Ranking das unidades ---------------------------------------------- */}
      {ranking.length > 0 && (
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Trophy className="size-4 text-gold" />
              Ranking das unidades
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              O PPR+ é indicador de sucesso da unidade na rede.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Unidade</th>
                  <th className="py-1.5 text-right font-medium">Receita/mês</th>
                  <th className="py-1.5 text-right font-medium">Planos</th>
                  <th className="py-1.5 text-right font-medium">Beneficiários</th>
                  <th className="py-1.5 text-right font-medium">Novos</th>
                  <th className="py-1.5 text-right font-medium">Cancelados</th>
                  <th className="py-1.5 text-right font-medium">Limpezas</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.clinicId} className="border-b last:border-0">
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                            i < 3
                              ? "bg-gold/20 text-gold-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {i + 1}
                        </span>
                        {r.name}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {formatBRL(r.mrr)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.active}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.beneficiaries}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-700">
                      +{r.novos}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-rose-700">
                      {r.cancelled}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.limpezas}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças visuais
// ---------------------------------------------------------------------------

type Tone = "gold" | "emerald" | "sky" | "violet" | "rose";
const TONE_ACCENT: Record<Tone, string> = {
  gold: "bg-gold",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
};
const TONE_ICON: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold-foreground",
  emerald: "bg-emerald-500/10 text-emerald-700",
  sky: "bg-sky-500/10 text-sky-700",
  violet: "bg-violet-500/10 text-violet-700",
  rose: "bg-rose-500/10 text-rose-700",
};

function Kpi({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
      <span
        className={cn("absolute inset-x-0 top-0 h-1", TONE_ACCENT[tone])}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            TONE_ICON[tone]
          )}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Line({
  label,
  hint,
  value,
  total,
  tone,
  icon,
}: {
  label: string;
  hint: string;
  value: number;
  total: number;
  tone: Tone;
  icon?: React.ReactNode;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="font-semibold tabular-nums">
          {value}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            de {total} ({pct.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", TONE_ACCENT[tone])}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DarkChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-2.5 py-0.5 transition-colors",
        active
          ? "border-gold bg-gold font-medium text-gold-foreground"
          : "border-primary-foreground/25 text-primary-foreground/80 hover:bg-primary-foreground/10"
      )}
    >
      {label}
    </Link>
  );
}
