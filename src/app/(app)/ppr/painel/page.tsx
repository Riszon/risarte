import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CalendarCheck,
  ChevronRight,
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
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import { growthPercent } from "@/lib/ppr/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RisarteMark } from "@/components/risarte-logo";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { PprDrill, type PprDrillItem } from "./ppr-drill";

export const metadata: Metadata = { title: "Painel do PPR+" };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
const monthLabel = (d: Date) => `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString("pt-BR");
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Valor curto para caber em cima da barra: "R$ 1,2 mil". */
function shortBRL(cents: number): string {
  const v = cents / 100;
  if (v >= 1000)
    return `R$ ${(v / 1000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

// -- Filtro de período (mesmo padrão do Dashboard do Comercial) -------------
const PERIODS = ["hoje", "semana", "mes", "trimestre", "tudo", "custom"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  trimestre: "Últimos 3 meses",
  tudo: "Tudo",
  custom: "Período escolhido",
};
const QUICK_PERIODS = ["hoje", "semana", "mes", "trimestre", "tudo"] as const;

function periodStart(p: Period, de?: string): Date | null {
  const now = new Date();
  if (p === "custom") return de ? new Date(`${de}T00:00:00`) : null;
  if (p === "hoje") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "semana") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (p === "mes") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (p === "trimestre") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }
  return null;
}
/** Fim do período (só no período escolhido) — inclui o dia inteiro do "até". */
function periodEnd(p: Period, ate?: string): Date | null {
  if (p !== "custom" || !ate) return null;
  return new Date(`${ate}T23:59:59.999`);
}
function fmtBr(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const STATUS_TONE: Record<PprStatus, PprDrillItem["badgeTone"]> = {
  ativo: "emerald",
  aguardando_ativacao: "amber",
  suspenso: "rose",
  cancelado: "muted",
};
const STATUS_ORDER: Record<string, number> = {
  ativo: 0,
  aguardando_ativacao: 1,
  suspenso: 2,
  cancelado: 3,
};

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
  const periodParam = Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo;
  const deParam = Array.isArray(sp.de) ? sp.de[0] : sp.de;
  const ateParam = Array.isArray(sp.ate) ? sp.ate[0] : sp.ate;
  const period: Period =
    // "Período escolhido" só vale com as duas datas preenchidas.
    periodParam === "custom" && deParam && ateParam
      ? "custom"
      : PERIODS.includes(periodParam as Period) && periodParam !== "custom"
        ? (periodParam as Period)
        : "mes";
  const startMs = periodStart(period, deParam)?.getTime() ?? null;
  const endMs = periodEnd(period, ateParam)?.getTime() ?? null;
  /** A data caiu dentro do período escolhido? */
  const inPeriod = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return (startMs === null || t >= startMs) && (endMs === null || t <= endMs);
  };
  const periodDescription =
    period === "custom" && deParam && ateParam
      ? `${fmtBr(deParam)} a ${fmtBr(ateParam)}`
      : PERIOD_LABELS[period];

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
      "id, clinic_id, plan_id, status, monthly_cents, created_at, activated_at, cancelled_at, holder_client_id, plan:ppr_plans ( name ), holder:clients!ppr_memberships_holder_client_id_fkey ( id, full_name, code ), clinic:clinics!ppr_memberships_clinic_id_fkey ( name )"
    );
  if (clinicFilter) memQuery = memQuery.eq("clinic_id", clinicFilter);
  const { data: memRows } = await memQuery;
  type Named = { name: string };
  type Person = { id: string; full_name: string; code: string | null };
  type Mem = {
    id: string;
    clinic_id: string;
    plan_id: string;
    status: string;
    monthly_cents: number;
    created_at: string;
    activated_at: string | null;
    cancelled_at: string | null;
    holder_client_id: string;
    plan: Named | Named[] | null;
    holder: Person | Person[] | null;
    clinic: Named | Named[] | null;
  };
  const memberships = (memRows ?? []) as unknown as Mem[];
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const planNameOf = (m: Mem) => one(m.plan)?.name ?? "PPR+";
  const holderOf = (m: Mem) => one(m.holder);
  const clinicNameOf = (m: Mem) => one(m.clinic)?.name ?? "";

  const active = memberships.filter((m) => m.status === "ativo");
  const suspended = memberships.filter((m) => m.status === "suspenso");
  const waiting = memberships.filter((m) => m.status === "aguardando_ativacao");
  const now = new Date();
  // Movimento do PERÍODO escolhido (os cartões de estoque continuam sendo "hoje").
  const newInPeriod = memberships.filter((m) => inPeriod(m.created_at));
  const cancelledInPeriod = memberships.filter((m) => inPeriod(m.cancelled_at));

  const mrr = active.reduce((s, m) => s + m.monthly_cents, 0);
  const ticket = active.length > 0 ? Math.round(mrr / active.length) : 0;

  // Saldo do período: entrou − saiu, em planos e em dinheiro.
  const aliveNow = memberships.filter((m) => m.status !== "cancelado").length;
  const baseAtStart =
    startMs === null
      ? 0
      : memberships.filter((m) => {
          const born = new Date(m.created_at).getTime();
          const dead = m.cancelled_at ? new Date(m.cancelled_at).getTime() : null;
          return born < startMs && (dead === null || dead >= startMs);
        }).length;
  const netPlans = newInPeriod.length - cancelledInPeriod.length;
  const mrrIn = newInPeriod.reduce((s, m) => s + m.monthly_cents, 0);
  const mrrOut = cancelledInPeriod.reduce((s, m) => s + m.monthly_cents, 0);
  const periodPercent = growthPercent(baseAtStart, baseAtStart + netPlans);

  // -- Beneficiários ---------------------------------------------------------
  const liveIds = new Set(
    memberships.filter((m) => m.status !== "cancelado").map((m) => m.id)
  );
  let benQuery = supabase
    .from("ppr_beneficiaries")
    .select(
      "id, membership_id, client_id, role, relationship, joined_at, left_at, client:clients!ppr_beneficiaries_client_id_fkey ( id, full_name, code ), clinic:clinics!ppr_beneficiaries_clinic_id_fkey ( name )"
    );
  if (clinicFilter) benQuery = benQuery.eq("clinic_id", clinicFilter);
  const { data: benRows } = await benQuery;
  type Ben = {
    id: string;
    membership_id: string;
    client_id: string;
    role: string;
    relationship: string | null;
    joined_at: string | null;
    left_at: string | null;
    client: Person | Person[] | null;
    clinic: Named | Named[] | null;
  };
  const beneficiaries = ((benRows ?? []) as unknown as Ben[]).filter(
    (b) => !b.left_at && liveIds.has(b.membership_id)
  );
  const holders = beneficiaries.filter((b) => b.role === "titular").length;
  const dependents = beneficiaries.length - holders;
  const clientIds = [...new Set(beneficiaries.map((b) => b.client_id))];

  const memById = new Map(memberships.map((m) => [m.id, m]));
  const clientName = new Map<string, string>();
  for (const m of memberships) {
    const h = holderOf(m);
    if (h) clientName.set(h.id, h.full_name);
  }
  for (const b of beneficiaries) {
    const c = one(b.client);
    if (c) clientName.set(c.id, c.full_name);
  }
  const nameOf = (id: string) => clientName.get(id) ?? "Cliente";
  /** "Plano Ouro · Cambé" para a linha do beneficiário. */
  const benScope = (b: Ben) => {
    const m = memById.get(b.membership_id);
    const unit = one(b.clinic)?.name ?? (m ? clinicNameOf(m) : "");
    return [m ? planNameOf(m) : "PPR+", unit].filter(Boolean).join(" · ");
  };

  // -- Por plano + crescimento ----------------------------------------------
  const byPlan = new Map<string, { name: string; count: number; mrr: number }>();
  for (const m of active) {
    const name = planNameOf(m);
    const a = byPlan.get(m.plan_id) ?? { name, count: 0, mrr: 0 };
    a.count += 1;
    a.mrr += m.monthly_cents;
    byPlan.set(m.plan_id, a);
  }
  // Quantos deste plano entraram no período (base da taxa de crescimento).
  const newByPlan = new Map<string, number>();
  for (const m of newInPeriod) {
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
  /** Limpezas feitas DENTRO do período escolhido (o resto é regra fixa). */
  const usagesInPeriod = recurring.filter((u) => inPeriod(u.used_at));
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
  /** Última limpeza registrada de cada beneficiário. */
  const lastUsage = new Map<string, string>();
  for (const u of recurring) {
    const cur = lastUsage.get(u.client_id);
    if (!cur || new Date(cur) < new Date(u.used_at))
      lastUsage.set(u.client_id, u.used_at);
  }

  // Agenda dos beneficiários (futuros e último atendimento).
  const futureIds = new Set<string>();
  const nextAppt = new Map<string, string>();
  const weekAppts: { id: string; client_id: string; starts_at: string }[] = [];
  let futureWeek = 0;
  let futureMonth = 0;
  const lastSeen = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: apptRows } = await supabase
      .from("appointments")
      .select("id, client_id, starts_at, status")
      .in("client_id", clientIds);
    for (const a of (apptRows ?? []) as {
      id: string;
      client_id: string;
      starts_at: string;
      status: string;
    }[]) {
      if (a.status === "cancelled") continue;
      const at = new Date(a.starts_at);
      if (at >= now) {
        futureIds.add(a.client_id);
        const cur = nextAppt.get(a.client_id);
        if (!cur || new Date(cur) > at) nextAppt.set(a.client_id, a.starts_at);
        if (at <= weekAhead) {
          futureWeek += 1;
          weekAppts.push({
            id: a.id,
            client_id: a.client_id,
            starts_at: a.starts_at,
          });
        }
        if (at <= monthAhead) futureMonth += 1;
      } else {
        const cur = lastSeen.get(a.client_id);
        if (!cur || new Date(cur) < at) lastSeen.set(a.client_id, a.starts_at);
      }
    }
  }
  weekAppts.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const upToDateIds = clientIds.filter(
    (id) => recentUsers.has(id) || futureIds.has(id)
  );
  const idleIds = clientIds.filter((id) => {
    if (futureIds.has(id)) return false;
    const last = lastSeen.get(id);
    return !last || new Date(last) < fourMonthsAgo;
  });
  const upToDate = upToDateIds.length;
  const idle = idleIds.length;

  // Projeção: quando o benefício recorrente libera de novo.
  const dueUntil = (limit: Date) =>
    recurring
      .filter(
        (u) =>
          u.next_available_at &&
          new Date(u.next_available_at) >= now &&
          new Date(u.next_available_at) <= limit
      )
      .sort((a, b) =>
        (a.next_available_at ?? "").localeCompare(b.next_available_at ?? "")
      );
  const dueWeekList = dueUntil(weekAhead);
  const dueMonthList = dueUntil(monthAhead);

  // -- Listas dos pop-ups ----------------------------------------------------
  const benByClient = new Map<string, Ben>();
  for (const b of beneficiaries) benByClient.set(b.client_id, b);
  const clientScope = (id: string) => {
    const b = benByClient.get(id);
    return b ? benScope(b) : "PPR+";
  };
  const clientHref = (id: string) => `/prontuarios/${id}`;
  const scope =
    clinicFilter === null
      ? "Todas as unidades"
      : (unitOptions.find((u) => u.id === clinicFilter)?.name ??
        session.activeClinic?.name ??
        "Unidade");

  const memItem = (m: Mem, note?: string | null): PprDrillItem => ({
    key: m.id,
    href: `/ppr/adesoes/${m.id}`,
    title: holderOf(m)?.full_name ?? "Titular",
    subtitle: [planNameOf(m), clinicNameOf(m)].filter(Boolean).join(" · "),
    badge: PPR_STATUS_LABELS[m.status as PprStatus] ?? m.status,
    badgeTone: STATUS_TONE[m.status as PprStatus] ?? "muted",
    value: `${formatBRL(m.monthly_cents)}/mês`,
    note: note ?? null,
    group: m.status,
  });

  const liveMemberships = memberships
    .filter((m) => m.status !== "cancelado")
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        b.created_at.localeCompare(a.created_at)
    );
  const plansItems = liveMemberships.map((m) =>
    memItem(
      m,
      m.activated_at
        ? `Ativo desde ${fmtDate(m.activated_at)}`
        : `Adesão em ${fmtDate(m.created_at)}`
    )
  );

  const beneficiaryItems: PprDrillItem[] = [...beneficiaries]
    .sort((a, b) =>
      (one(a.client)?.full_name ?? "").localeCompare(
        one(b.client)?.full_name ?? ""
      )
    )
    .map((b) => ({
      key: b.id,
      href: clientHref(b.client_id),
      title: one(b.client)?.full_name ?? "Cliente",
      subtitle: benScope(b),
      badge:
        b.role === "titular" ? "Titular" : (b.relationship ?? "Dependente"),
      badgeTone: b.role === "titular" ? "primary" : "muted",
      note: b.joined_at ? `No PPR+ desde ${fmtDate(b.joined_at)}` : null,
      group: b.role === "titular" ? "titular" : "dependente",
    }));

  const revenueItems = [...active]
    .sort((a, b) => b.monthly_cents - a.monthly_cents)
    .map((m) => memItem(m));

  const movementItems: PprDrillItem[] = [
    ...newInPeriod.map((m) => ({
      ...memItem(m, `Entrou em ${fmtDate(m.created_at)}`),
      key: `novo-${m.id}`,
      badge: "Entrou",
      badgeTone: "emerald" as const,
      group: "entrou",
    })),
    ...cancelledInPeriod.map((m) => ({
      ...memItem(m, `Cancelado em ${fmtDate(m.cancelled_at ?? m.created_at)}`),
      key: `cancelado-${m.id}`,
      badge: "Saiu",
      badgeTone: "rose" as const,
      group: "saiu",
    })),
  ];

  const clientItem = (
    id: string,
    note: string | null,
    badge?: { label: string; tone: PprDrillItem["badgeTone"] }
  ): PprDrillItem => ({
    key: id,
    href: clientHref(id),
    title: nameOf(id),
    subtitle: clientScope(id),
    badge: badge?.label ?? null,
    badgeTone: badge?.tone,
    note,
  });

  const upToDateItems = upToDateIds.map((id) => {
    const appt = nextAppt.get(id);
    const last = lastUsage.get(id);
    return clientItem(
      id,
      appt
        ? `Agendado para ${fmtDateTime(appt)}`
        : last
          ? `Última limpeza em ${fmtDate(last)}`
          : null,
      appt
        ? { label: "Agendado", tone: "emerald" }
        : { label: "Em dia", tone: "emerald" }
    );
  });

  const idleItems = idleIds
    .map((id) => ({ id, last: lastSeen.get(id) ?? null }))
    .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? ""))
    .map(({ id, last }) =>
      clientItem(
        id,
        last ? `Último atendimento em ${fmtDate(last)}` : "Nunca compareceu",
        { label: "Ligar", tone: "rose" }
      )
    );

  const usageItems: PprDrillItem[] = [...usagesInPeriod]
    .sort((a, b) => b.used_at.localeCompare(a.used_at))
    .map((u) => ({
      key: u.id,
      href: clientHref(u.client_id),
      title: nameOf(u.client_id),
      subtitle: clientScope(u.client_id),
      note: u.next_available_at
        ? `Libera de novo em ${fmtDate(u.next_available_at)}`
        : null,
      value: fmtDate(u.used_at),
    }));

  const apptItems: PprDrillItem[] = weekAppts.map((a) => ({
    key: a.id,
    href: clientHref(a.client_id),
    title: nameOf(a.client_id),
    subtitle: clientScope(a.client_id),
    value: fmtDateTime(a.starts_at),
  }));

  const dueItems = (list: typeof recurring): PprDrillItem[] =>
    list.map((u) => ({
      key: `due-${u.id}`,
      href: clientHref(u.client_id),
      title: nameOf(u.client_id),
      subtitle: clientScope(u.client_id),
      note: `Última limpeza em ${fmtDate(u.used_at)}`,
      value: u.next_available_at ? fmtDate(u.next_available_at) : null,
      badge: nextAppt.has(u.client_id) ? "Já agendado" : "Chamar",
      badgeTone: nextAppt.has(u.client_id) ? "emerald" : "amber",
    }));

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
      if (inPeriod(m.cancelled_at)) row.cancelled += 1;
      if (inPeriod(m.created_at)) row.novos += 1;
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
    for (const u of usagesInPeriod) {
      const cid = clinicOfClient.get(u.client_id);
      if (cid) ensure(cid).limpezas += 1;
    }
    ranking = [...byClinic.values()].sort((a, b) => b.mrr - a.mrr);
  }

  const unitLabel = scope;
  /** Troca unidade OU período preservando o resto do filtro. */
  const filterHref = (unidade: string | null, pd: Period) => {
    const p = new URLSearchParams();
    p.set("unidade", unidade ?? "all");
    p.set("periodo", pd);
    if (pd === "custom") {
      if (deParam) p.set("de", deParam);
      if (ateParam) p.set("ate", ateParam);
    }
    return `/ppr/painel?${p.toString()}`;
  };
  const chipHref = (unidade: string | null) => filterHref(unidade, period);
  const periodHref = (pd: Period) => filterHref(clinicFilter, pd);

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
                {unitLabel} · {periodDescription} · {active.length} plano(s)
                ativo(s) · {formatBRL(mrr)}/mês
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

          <div className="space-y-2 border-t border-primary-foreground/15 pt-3 text-xs">
            {canSeeNetwork && unitOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
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
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-primary-foreground/60">
                Período
              </span>
              {QUICK_PERIODS.map((pd) => (
                <DarkChip
                  key={pd}
                  label={PERIOD_LABELS[pd]}
                  href={periodHref(pd)}
                  active={period === pd}
                />
              ))}
              {/* Período específico (de/até) — aplica ao enviar. */}
              <form
                method="get"
                action="/ppr/painel"
                className="flex flex-wrap items-center gap-1.5"
              >
                <input type="hidden" name="unidade" value={clinicFilter ?? "all"} />
                <input type="hidden" name="periodo" value="custom" />
                <input
                  type="date"
                  name="de"
                  defaultValue={deParam ?? ""}
                  aria-label="Data inicial"
                  className={cn(
                    "h-7 rounded-full border bg-transparent px-2 text-xs",
                    period === "custom"
                      ? "border-gold text-primary-foreground"
                      : "border-primary-foreground/25 text-primary-foreground/80"
                  )}
                />
                <span className="text-primary-foreground/50">a</span>
                <input
                  type="date"
                  name="ate"
                  defaultValue={ateParam ?? ""}
                  aria-label="Data final"
                  className={cn(
                    "h-7 rounded-full border bg-transparent px-2 text-xs",
                    period === "custom"
                      ? "border-gold text-primary-foreground"
                      : "border-primary-foreground/25 text-primary-foreground/80"
                  )}
                />
                <button
                  type="submit"
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 transition-colors",
                    period === "custom"
                      ? "border-gold bg-gold font-medium text-gold-foreground"
                      : "border-primary-foreground/25 text-primary-foreground/80 hover:bg-primary-foreground/10"
                  )}
                >
                  Aplicar
                </button>
              </form>
            </div>
            <p className="text-primary-foreground/50">
              O período vale para o <strong>movimento</strong> (entradas,
              saídas e limpezas). Planos, beneficiários e receita mostram
              sempre a situação de <strong>hoje</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Números do programa ----------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PprDrill
          className="h-full"
          items={plansItems}
          dialogTitle="Planos do PPR+"
          scopeLabel={unitLabel}
          dialogHint="Adesões vivas (ativas, aguardando ativação e suspensas). Clique para abrir a adesão."
          footerLabel="Receita mensal dos ativos"
          footerValue={formatBRL(mrr)}
          filters={[
            { key: "ativo", label: "Ativos" },
            { key: "aguardando_ativacao", label: "Aguardando" },
            { key: "suspenso", label: "Suspensos" },
          ]}
        >
          <Kpi
            tone="emerald"
            icon={<HeartPulse className="size-4" />}
            label="Planos ativos"
            value={String(active.length)}
            hint={`${waiting.length} aguardando ativação · ${suspended.length} suspenso(s)`}
            drill={plansItems.length > 0}
          />
        </PprDrill>

        <PprDrill
          className="h-full"
          items={beneficiaryItems}
          dialogTitle="Beneficiários do PPR+"
          scopeLabel={unitLabel}
          dialogHint="Titulares e dependentes com plano vivo. Clique para abrir o prontuário."
          footerLabel="Titulares + dependentes"
          footerValue={`${holders} + ${dependents}`}
          filters={[
            { key: "titular", label: "Titulares" },
            { key: "dependente", label: "Dependentes" },
          ]}
        >
          <Kpi
            tone="sky"
            icon={<Users className="size-4" />}
            label="Beneficiários"
            value={String(beneficiaries.length)}
            hint={`${holders} titular(es) + ${dependents} dependente(s)`}
            drill={beneficiaryItems.length > 0}
          />
        </PprDrill>

        <PprDrill
          className="h-full"
          items={revenueItems}
          dialogTitle="Receita mensal do PPR+"
          scopeLabel={unitLabel}
          dialogHint="Mensalidade de cada adesão ativa, da maior para a menor."
          footerLabel="Total por mês"
          footerValue={formatBRL(mrr)}
        >
          <Kpi
            tone="gold"
            icon={<Wallet className="size-4" />}
            label="Receita mensal"
            value={formatBRL(mrr)}
            hint={`ticket médio ${formatBRL(ticket)}`}
            drill={revenueItems.length > 0}
          />
        </PprDrill>

        <PprDrill
          className="h-full"
          items={movementItems}
          dialogTitle={`Movimento — ${periodDescription.toLowerCase()}`}
          scopeLabel={unitLabel}
          dialogHint="Quem entrou e quem saiu do programa no período escolhido."
          footerLabel="Receita que entrou / saiu"
          footerValue={`+${formatBRL(mrrIn)} / −${formatBRL(mrrOut)}`}
          filters={[
            { key: "entrou", label: "Entraram" },
            { key: "saiu", label: "Saíram" },
          ]}
        >
          <Kpi
            tone={netPlans > 0 ? "emerald" : netPlans < 0 ? "rose" : "violet"}
            icon={<TrendingUp className="size-4" />}
            label="Saldo do período"
            value={`${netPlans > 0 ? "+" : ""}${netPlans} plano(s)`}
            hint={`${newInPeriod.length} entrou/entraram · ${cancelledInPeriod.length} saiu/saíram`}
            foot={
              startMs === null
                ? `${aliveNow} plano(s) vivo(s) hoje · ${formatBRL(mrrIn)} entraram por mês`
                : periodPercent !== null
                  ? `${baseAtStart} → ${baseAtStart + netPlans} planos (${periodPercent > 0 ? "+" : ""}${periodPercent.toFixed(0)}%)`
                  : `${baseAtStart} → ${baseAtStart + netPlans} planos · base pequena para calcular %`
            }
            drill={movementItems.length > 0}
          />
        </PprDrill>
      </section>

      {/* Crescimento — dois gráficos separados (quantidade × dinheiro) ------ */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <TrendingUp className="size-4 text-sky-600" />
              Planos vivos por mês
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Quantidade de adesões vivas no fim de cada mês (histórico fixo dos
              últimos 6 meses, não segue o filtro de período).
            </p>
          </CardHeader>
          <CardContent>
            <Bars
              tone="sky"
              unit="plano(s)"
              data={growth.map((g) => ({
                label: g.label,
                value: g.alive,
                display: String(g.alive),
                sub: g.created > 0 ? `+${g.created}` : null,
              }))}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              O número embaixo em verde é quanto entrou naquele mês.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Wallet className="size-4 text-gold" />
              Receita mensal por mês
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Quanto o programa gera por mês, em reais (últimos 6 meses).
            </p>
          </CardHeader>
          <CardContent>
            <Bars
              tone="gold"
              unit="por mês"
              data={growth.map((g) => ({
                label: g.label,
                value: g.mrr,
                display: shortBRL(g.mrr),
                title: formatBRL(g.mrr),
              }))}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Valor arredondado em cima da barra; passe o mouse para ver o
              valor exato.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Por plano + prevenção --------------------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Sparkles className="size-4 text-gold" />
              Por plano
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Quantidade, receita e quantos entraram no período. Clique para ver
              a lista.
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
                    // % só quando a base do plano justifica (senão vira "+100%").
                    const planPercent = growthPercent(v.count - novos, v.count);
                    const items = active
                      .filter((m) => m.plan_id === planId)
                      .sort((a, b) =>
                        (holderOf(a)?.full_name ?? "").localeCompare(
                          holderOf(b)?.full_name ?? ""
                        )
                      )
                      .map((m) =>
                        memItem(
                          m,
                          m.activated_at
                            ? `Ativo desde ${fmtDate(m.activated_at)}`
                            : null
                        )
                      );
                    return (
                      <li key={planId}>
                        <PprDrill
                          items={items}
                          dialogTitle={v.name}
                          scopeLabel={unitLabel}
                          dialogHint="Adesões ativas neste plano."
                          footerLabel="Receita do plano"
                          footerValue={formatBRL(v.mrr)}
                          className="p-1"
                        >
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
                                ? `+${novos} no período${
                                    planPercent !== null
                                      ? ` (+${planPercent.toFixed(0)}%)`
                                      : ""
                                  }`
                                : "sem entradas no período"}
                            </span>
                          </div>
                        </PprDrill>
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
              O coração do programa: quem está voltando e quem sumiu. Clique em
              cada número para ver os nomes. Só as <strong>limpezas
              realizadas</strong> seguem o filtro de período; o resto é situação
              de hoje.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <PprDrill
              items={upToDateItems}
              dialogTitle="Em dia com a limpeza"
              scopeLabel={unitLabel}
              dialogHint="Usou o benefício nos últimos 3 meses ou já tem agendamento marcado."
              footerLabel="Beneficiários"
              footerValue={`${upToDate} de ${clientIds.length}`}
              className="p-1"
            >
              <Line
                label="Em dia com a limpeza"
                hint="usou nos últimos 3 meses ou já tem agendamento"
                value={upToDate}
                total={clientIds.length}
                tone="emerald"
                drill={upToDateItems.length > 0}
              />
            </PprDrill>

            <PprDrill
              items={idleItems}
              dialogTitle="Sem usar o plano"
              scopeLabel={unitLabel}
              dialogHint="Mais de 4 meses sem atendimento e sem agendamento futuro — fila de ligação."
              footerLabel="Beneficiários"
              footerValue={`${idle} de ${clientIds.length}`}
              className="p-1"
            >
              <Line
                label="Sem usar o plano"
                hint="mais de 4 meses sem agendamento — ligar!"
                value={idle}
                total={clientIds.length}
                tone="rose"
                icon={<UserMinus className="size-3.5" />}
                drill={idleItems.length > 0}
              />
            </PprDrill>

            <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm">
              <PprDrill
                items={usageItems}
                dialogTitle="Limpezas realizadas"
                scopeLabel={`${unitLabel} · ${periodDescription}`}
                dialogHint="Benefícios com frequência (limpeza) usados no período escolhido."
                footerLabel="No período"
                footerValue={String(usagesInPeriod.length)}
              >
                <Mini
                  label="Limpezas realizadas"
                  value={String(usagesInPeriod.length)}
                  hint={`${recurring.length} desde o começo`}
                  drill={usageItems.length > 0}
                />
              </PprDrill>

              <PprDrill
                items={apptItems}
                dialogTitle="Agendados nos próximos 7 dias"
                scopeLabel={unitLabel}
                dialogHint={`${futureMonth} agendamento(s) no próximo mês.`}
                footerLabel="Nos 7 dias"
                footerValue={String(futureWeek)}
              >
                <Mini
                  label="Agendados (7 dias)"
                  value={String(futureWeek)}
                  hint={`${futureMonth} no próximo mês`}
                  drill={apptItems.length > 0}
                />
              </PprDrill>

              <PprDrill
                items={dueItems(dueWeekList)}
                dialogTitle="Liberam nos próximos 7 dias"
                scopeLabel={unitLabel}
                dialogHint="Pela frequência do plano, o benefício volta a valer nesta data."
                footerLabel="Total"
                footerValue={String(dueWeekList.length)}
              >
                <Mini
                  label="Liberam em 7 dias"
                  value={String(dueWeekList.length)}
                  hint="projeção pela frequência do plano"
                  drill={dueWeekList.length > 0}
                />
              </PprDrill>

              <PprDrill
                items={dueItems(dueMonthList)}
                dialogTitle="Liberam nos próximos 30 dias"
                scopeLabel={unitLabel}
                dialogHint="Chamar para agendar antes que o cliente esqueça."
                footerLabel="Total"
                footerValue={String(dueMonthList.length)}
              >
                <Mini
                  label="Liberam em 30 dias"
                  value={String(dueMonthList.length)}
                  hint="chamar para agendar"
                  drill={dueMonthList.length > 0}
                />
              </PprDrill>
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
                        <Link
                          href={chipHref(r.clinicId)}
                          className="hover:underline"
                        >
                          {r.name}
                        </Link>
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

/** Selo "ver lista ›" que indica que o cartão abre um pop-up. */
function DrillHint() {
  return (
    <span className="inline-flex items-center font-medium text-primary">
      · ver lista <ChevronRight className="size-3" />
    </span>
  );
}

function Kpi({
  tone,
  icon,
  label,
  value,
  hint,
  foot,
  drill,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  /** Linha extra no rodapé do cartão (comparação, base, contexto). */
  foot?: string;
  drill?: boolean;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
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
      {(hint || drill) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {hint}
          {drill && <DrillHint />}
        </p>
      )}
      {foot && (
        <p className="mt-2 border-t pt-2 text-[11px] tabular-nums text-muted-foreground">
          {foot}
        </p>
      )}
    </div>
  );
}

/**
 * Gráfico de barras de UMA grandeza só (nunca misturar quantidade com valor),
 * com o número escrito em cima da barra.
 */
function Bars({
  data,
  tone,
  unit,
}: {
  data: {
    label: string;
    value: number;
    display: string;
    sub?: string | null;
    title?: string;
  }[];
  tone: Tone;
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="grid grid-cols-6 gap-2">
      {data.map((d) => (
        <div key={d.label} className="flex flex-col items-center gap-1">
          <span className="text-[11px] font-semibold tabular-nums">
            {d.display}
          </span>
          <div className="flex h-24 w-full items-end justify-center">
            <div
              className={cn("w-7 rounded-t", TONE_ACCENT[tone])}
              style={{
                height: d.value > 0 ? `${Math.max(4, (d.value / max) * 100)}%` : "2px",
              }}
              title={`${d.title ?? d.display} ${unit}`}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{d.label}</span>
          {d.sub && (
            <span className="text-[10px] font-medium tabular-nums text-emerald-700">
              {d.sub}
            </span>
          )}
        </div>
      ))}
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
  drill,
}: {
  label: string;
  hint: string;
  value: number;
  total: number;
  tone: Tone;
  icon?: React.ReactNode;
  drill?: boolean;
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
      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        {hint}
        {drill && <DrillHint />}
      </p>
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
  drill,
}: {
  label: string;
  value: string;
  hint?: string;
  drill?: boolean;
}) {
  return (
    <div className="h-full rounded-lg border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {(hint || drill) && (
        <p className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {hint}
          {drill && <DrillHint />}
        </p>
      )}
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
