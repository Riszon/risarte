import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Hourglass,
  Layers,
  Percent,
  PhoneCall,
  Stethoscope,
  Store,
  TicketPercent,
  Timer,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { RisarteMark } from "@/components/risarte-logo";
import { AwaitingDialog, type AwaitingItem } from "./awaiting-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";

export const metadata: Metadata = { title: "Dashboard comercial" };

const PERIODS = ["hoje", "semana", "mes", "tudo"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  tudo: "Tudo",
};
function periodStart(p: Period): string | null {
  const now = new Date();
  if (p === "hoje")
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (p === "semana") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (p === "mes") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return null;
}

export default async function DashboardComercialPage(
  props: PageProps<"/comercial/dashboard">
) {
  const session = await getSessionContext();
  const roles = Object.values(session.rolesByClinic).flat();
  const canView =
    session.isAdminMaster ||
    roles.some((r) =>
      [
        "commercial_consultant",
        "commercial_assistant",
        "unit_manager",
        "franchisee",
        "franchisor_staff",
      ].includes(r)
    );
  if (!canView) redirect("/");

  const canSeeAllUnits =
    session.isAdminMaster ||
    roles.some((r) =>
      ["commercial_consultant", "commercial_assistant", "franchisor_staff"].includes(r)
    );
  const activeClinicId = session.activeClinic?.id ?? null;
  const activeIsUnit = session.activeClinic?.type === "franchise_unit";

  const sp = await props.searchParams;
  const unidadeParam = Array.isArray(sp.unidade) ? sp.unidade[0] : sp.unidade;
  const periodParam = Array.isArray(sp.periodo) ? sp.periodo[0] : sp.periodo;
  const period: Period = PERIODS.includes(periodParam as Period)
    ? (periodParam as Period)
    : "mes";

  let clinicFilter: string | null;
  if (!canSeeAllUnits) clinicFilter = activeClinicId;
  else if (unidadeParam === "all") clinicFilter = null;
  else if (unidadeParam) clinicFilter = unidadeParam;
  else clinicFilter = activeIsUnit ? activeClinicId : null;

  const start = periodStart(period);
  await logAudit({
    action: "view",
    entityType: "commercial_dashboard",
    entityId: clinicFilter ?? "all",
    clinicId: clinicFilter ?? undefined,
  });

  const supabase = await createClient();

  let unitOptions: { id: string; name: string }[] = [];
  if (canSeeAllUnits) {
    const { data: units } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name");
    unitOptions = (units ?? []) as { id: string; name: string }[];
  }

  // -- Negociações (oportunidades / vendas / perdas) --------------------------
  let negQuery = supabase
    .from("plan_negotiations")
    .select(
      "client_id, status, final_cents, subtotal_cents, adjustment_cents, payment_method, installments, created_at"
    );
  if (clinicFilter) negQuery = negQuery.eq("clinic_id", clinicFilter);
  if (start) negQuery = negQuery.gte("created_at", start);
  const { data: negRows } = await negQuery;
  const negs = (negRows ?? []) as {
    client_id: string;
    status: string;
    final_cents: number;
    subtotal_cents: number;
    adjustment_cents: number;
    payment_method: string | null;
    installments: number;
    created_at: string;
  }[];

  const accepted = negs.filter((n) => n.status === "aceita");
  const lost = negs.filter((n) => n.status === "perdida").length;
  const totalOpp = negs.length;
  const salesCount = accepted.length;
  const salesTotal = accepted.reduce((s, n) => s + n.final_cents, 0);
  const ticket = salesCount > 0 ? Math.round(salesTotal / salesCount) : 0;
  const conversion = totalOpp > 0 ? (salesCount / totalOpp) * 100 : 0;
  const discountTotal = accepted.reduce(
    (s, n) => s + (n.adjustment_cents < 0 ? -n.adjustment_cents : 0),
    0
  );
  const avgInstallments =
    salesCount > 0
      ? accepted.reduce((s, n) => s + (n.installments || 1), 0) / salesCount
      : 0;

  // Ticket médio DO PARCELAMENTO = valor médio de cada parcela nas vendas
  // parceladas (quanto o cliente paga por mês, em média).
  const installmentSales = accepted.filter((n) => (n.installments || 1) > 1);
  const avgInstallmentTicket =
    installmentSales.length > 0
      ? Math.round(
          installmentSales.reduce(
            (s, n) => s + n.final_cents / (n.installments || 1),
            0
          ) / installmentSales.length
        )
      : 0;

  // Oportunidades AGUARDANDO FECHAMENTO (aceitas ainda não concluídas + em
  // negociação/autorização) — quantidade e valor.
  const awaitingSaleIds = accepted.map((n) => n.client_id);
  const closedClientIds = new Set<string>();
  if (awaitingSaleIds.length > 0) {
    const { data: closedRows } = await supabase
      .from("commercial_sales")
      .select("client_id")
      .not("closed_at", "is", null)
      .in("client_id", awaitingSaleIds);
    for (const r of closedRows ?? [])
      closedClientIds.add(r.client_id as string);
  }
  const openNegs = negs.filter(
    (n) =>
      n.status === "em_negociacao" ||
      n.status === "aguardando_autorizacao" ||
      (n.status === "aceita" && !closedClientIds.has(n.client_id))
  );
  const awaitingCount = openNegs.length;
  const awaitingTotal = openNegs.reduce((s, n) => s + n.final_cents, 0);

  // Detalhe do "aguardando fechamento" (pop-up ao clicar no cartão): quem são
  // os clientes e quanto vale cada um. Respeita o filtro de unidade/período.
  const awaitingItems: AwaitingItem[] = [];
  if (openNegs.length > 0) {
    const ids = [...new Set(openNegs.map((n) => n.client_id))];
    const { data: cliRows } = await supabase
      .from("clients")
      .select(
        "id, full_name, code, clinic:clinics!clients_clinic_id_fkey ( name )"
      )
      .in("id", ids);
    const infoById = new Map<string, { name: string; code: string | null; clinic: string | null }>();
    for (const c of (cliRows ?? []) as {
      id: string;
      full_name: string;
      code: string | null;
      clinic: { name: string } | { name: string }[] | null;
    }[]) {
      const cl = Array.isArray(c.clinic) ? c.clinic[0] : c.clinic;
      infoById.set(c.id, {
        name: c.full_name,
        code: c.code,
        clinic: cl?.name ?? null,
      });
    }
    for (const n of openNegs) {
      const info = infoById.get(n.client_id);
      awaitingItems.push({
        clientId: n.client_id,
        clientName: info?.name ?? "Cliente",
        code: info?.code ?? null,
        clinicName: info?.clinic ?? null,
        status: n.status,
        valueCents: n.final_cents,
      });
    }
    awaitingItems.sort((a, b) => b.valueCents - a.valueCents);
  }

  // Por tipo de pagamento (vendas aceitas).
  const byPayment = new Map<string, { count: number; total: number }>();
  for (const n of accepted) {
    const k = n.payment_method ?? "—";
    const a = byPayment.get(k) ?? { count: 0, total: 0 };
    a.count += 1;
    a.total += n.final_cents;
    byPayment.set(k, a);
  }

  // Por pilar — precisa do pilar do cliente das vendas aceitas.
  const acceptedClientIds = [...new Set(accepted.map((n) => n.client_id))];
  const acceptedClientIdsForCycle = acceptedClientIds;
  const pillarByClient = new Map<string, MethodologyPillar | null>();
  if (acceptedClientIds.length > 0) {
    const { data: cli } = await supabase
      .from("clients")
      .select("id, methodology_pillar")
      .in("id", acceptedClientIds);
    for (const c of cli ?? [])
      pillarByClient.set(
        c.id as string,
        (c.methodology_pillar as MethodologyPillar | null) ?? null
      );
  }
  const byPillar = new Map<string, { count: number; total: number }>();
  for (const n of accepted) {
    const p = pillarByClient.get(n.client_id) ?? null;
    const k = p ?? "sem_pilar";
    const a = byPillar.get(k) ?? { count: 0, total: 0 };
    a.count += 1;
    a.total += n.final_cents;
    byPillar.set(k, a);
  }

  // -- Ciclo de vendas + ticket por tipo de cliente ---------------------------
  // NOVO: da 1ª entrada (Aquisição/Fase 1) até chegar ao Início de Tratamento.
  // RISARTE (recompra): estava na Reavaliação/Acompanhamento (6/7), voltou ao
  // Planejamento (3) e chegou de novo ao Início de Tratamento (5).
  const cycleNewDays: number[] = [];
  const cycleReturnDays: number[] = [];
  const newClientIds = new Set<string>();
  const returningClientIds = new Set<string>();
  if (acceptedClientIdsForCycle.length > 0) {
    const { data: histRows } = await supabase
      .from("journey_phase_history")
      .select("client_id, phase, entered_at")
      .in("client_id", acceptedClientIdsForCycle)
      .order("entered_at");
    const byClient = new Map<string, { phase: string; at: string }[]>();
    for (const h of (histRows ?? []) as {
      client_id: string;
      phase: string;
      entered_at: string;
    }[]) {
      const list = byClient.get(h.client_id) ?? [];
      list.push({ phase: h.phase, at: h.entered_at });
      byClient.set(h.client_id, list);
    }
    const days = (a: string, b: string) =>
      Math.max(
        0,
        Math.round(
          (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
        )
      );
    for (const [clientId, list] of byClient) {
      // Último "treatment_start" alcançado.
      const lastStartIdx = list
        .map((e, i) => ({ e, i }))
        .filter((x) => x.e.phase === "treatment_start")
        .map((x) => x.i)
        .pop();
      if (lastStartIdx == null) continue;
      const startAt = list[lastStartIdx].at;
      // Houve reavaliação/acompanhamento ANTES desse início? → recompra.
      const beforeReturn = list
        .slice(0, lastStartIdx)
        .some((e) => e.phase === "reevaluation" || e.phase === "follow_up");
      if (beforeReturn) {
        // Conta do retorno ao Centro de Planejamento até o início.
        const planIdx = list
          .slice(0, lastStartIdx)
          .map((e, i) => ({ e, i }))
          .filter((x) => x.e.phase === "planning_center")
          .map((x) => x.i)
          .pop();
        if (planIdx != null) {
          cycleReturnDays.push(days(list[planIdx].at, startAt));
          returningClientIds.add(clientId);
        }
      } else {
        // Cliente novo: da primeira fase registrada até o início.
        cycleNewDays.push(days(list[0].at, startAt));
        newClientIds.add(clientId);
      }
    }
  }
  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0;
  const cycleNew = avg(cycleNewDays);
  const cycleReturn = avg(cycleReturnDays);

  const newSales = accepted.filter((n) => newClientIds.has(n.client_id));
  const returnSales = accepted.filter((n) => returningClientIds.has(n.client_id));
  const ticketNew =
    newSales.length > 0
      ? Math.round(newSales.reduce((s, n) => s + n.final_cents, 0) / newSales.length)
      : 0;
  const ticketReturn =
    returnSales.length > 0
      ? Math.round(
          returnSales.reduce((s, n) => s + n.final_cents, 0) / returnSales.length
        )
      : 0;

  // Clientes em follow-up (estado atual, não do período).
  let followQuery = supabase
    .from("commercial_cards")
    .select("stage")
    .in("stage", ["follow_up", "follow_up_clinica"]);
  if (clinicFilter) followQuery = followQuery.eq("clinic_id", clinicFilter);
  const { data: followRows } = await followQuery;
  const inFollowup = (followRows ?? []).length;

  // -- Vendas diretas ---------------------------------------------------------
  let dsQuery = supabase
    .from("direct_sales")
    .select(
      "id, final_cents, status, cancelled, items:direct_sale_items ( description, quantity, final_cents, procedure_id )"
    )
    .neq("cancelled", true);
  if (clinicFilter) dsQuery = dsQuery.eq("clinic_id", clinicFilter);
  if (start) dsQuery = dsQuery.gte("created_at", start);
  const { data: dsRows } = await dsQuery;
  const ds = (dsRows ?? []) as {
    id: string;
    final_cents: number;
    status: string;
    cancelled: boolean;
    items:
      | {
          description: string;
          quantity: number;
          final_cents: number;
          procedure_id: string | null;
        }[]
      | null;
  }[];
  const dsCount = ds.length;
  const dsTotal = ds.reduce((s, d) => s + d.final_cents, 0);
  const dsTicket = dsCount > 0 ? Math.round(dsTotal / dsCount) : 0;
  const dsProcCount = ds.reduce(
    (s, d) => s + (d.items ?? []).reduce((a, i) => a + i.quantity, 0),
    0
  );
  // -- Ranking de procedimentos + vendas por especialidade --------------------
  // Origem: "direta" (venda direta), "comercial" (planos vendidos) ou "todos".
  const origemParam = Array.isArray(sp.origem) ? sp.origem[0] : sp.origem;
  const origem: "todos" | "direta" | "comercial" =
    origemParam === "direta" || origemParam === "comercial"
      ? origemParam
      : "todos";

  // Itens dos PLANOS vendidos (negociações aceitas, itens incluídos).
  type SoldItem = {
    name: string;
    qty: number;
    valueCents: number;
    procedureId: string | null;
  };
  const commercialItems: SoldItem[] = [];
  if (accepted.length > 0) {
    let negItemsQuery = supabase
      .from("plan_negotiations")
      .select(
        "id, status, plan_negotiation_items ( included, item:treatment_plan_option_items ( description, quantity, unit_price_cents, procedure_id ) )"
      )
      .eq("status", "aceita");
    if (clinicFilter) negItemsQuery = negItemsQuery.eq("clinic_id", clinicFilter);
    if (start) negItemsQuery = negItemsQuery.gte("created_at", start);
    const { data: negItemRows } = await negItemsQuery;
    type NegItem = {
      description: string;
      quantity: number;
      unit_price_cents: number;
      procedure_id: string | null;
    };
    for (const n of (negItemRows ?? []) as {
      plan_negotiation_items:
        | { included: boolean; item: NegItem | NegItem[] | null }[]
        | null;
    }[]) {
      for (const ni of n.plan_negotiation_items ?? []) {
        if (!ni.included) continue;
        const it = Array.isArray(ni.item) ? ni.item[0] : ni.item;
        if (!it) continue;
        commercialItems.push({
          name: it.description,
          qty: it.quantity,
          valueCents: (it.unit_price_cents ?? 0) * it.quantity,
          procedureId: it.procedure_id,
        });
      }
    }
  }

  const directItems: SoldItem[] = ds.flatMap((d) =>
    (d.items ?? []).map((i) => ({
      name: i.description,
      qty: i.quantity,
      valueCents: i.final_cents ?? 0,
      procedureId: i.procedure_id ?? null,
    }))
  );

  const rankingSource =
    origem === "direta"
      ? directItems
      : origem === "comercial"
        ? commercialItems
        : [...directItems, ...commercialItems];

  const ranking = new Map<string, { qty: number; total: number }>();
  for (const i of rankingSource) {
    const a = ranking.get(i.name) ?? { qty: 0, total: 0 };
    a.qty += i.qty;
    a.total += i.valueCents;
    ranking.set(i.name, a);
  }
  const rankingTop = [...ranking.entries()].sort(
    (a, b) => b[1].qty - a[1].qty || b[1].total - a[1].total
  );

  // Vendas por ESPECIALIDADE (do catálogo de procedimentos).
  const procIds = [
    ...new Set(
      [...directItems, ...commercialItems]
        .map((i) => i.procedureId)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const specialtyByProc = new Map<string, string>();
  if (procIds.length > 0) {
    const { data: procRows } = await supabase
      .from("procedures")
      .select("id, specialty")
      .in("id", procIds);
    for (const p of procRows ?? [])
      specialtyByProc.set(p.id as string, (p.specialty as string) ?? "Sem especialidade");
  }
  const bySpecialty = new Map<string, { qty: number; total: number }>();
  for (const i of [...directItems, ...commercialItems]) {
    const key = i.procedureId
      ? (specialtyByProc.get(i.procedureId) ?? "Sem especialidade")
      : "Sem especialidade";
    const a = bySpecialty.get(key) ?? { qty: 0, total: 0 };
    a.qty += i.qty;
    a.total += i.valueCents;
    bySpecialty.set(key, a);
  }
  const specialtyTop = [...bySpecialty.entries()].sort(
    (a, b) => b[1].total - a[1].total
  );


  // "Todas" precisa ir explícito como unidade=all (sem isso o padrão volta a
  // ser a unidade ativa e o filtro parecia não funcionar).
  const chipHref = (unidade: string | null, pd: Period) => {
    const p = new URLSearchParams();
    p.set("unidade", unidade ?? "all");
    p.set("periodo", pd);
    return `/comercial/dashboard?${p.toString()}`;
  };
  /** Mantém a unidade escolhida ao trocar só o período. */
  const periodHref = (pd: Period) =>
    chipHref(clinicFilter === null ? null : clinicFilter, pd);
  /** Troca só a origem do ranking, preservando unidade + período. */
  const rankingHref = (o: "todos" | "direta" | "comercial") => {
    const p = new URLSearchParams();
    p.set("unidade", clinicFilter ?? "all");
    p.set("periodo", period);
    p.set("origem", o);
    return `/comercial/dashboard?${p.toString()}`;
  };


  const maxPay = Math.max(1, ...[...byPayment.values()].map((v) => v.total));
  const maxPillar = Math.max(1, ...[...byPillar.values()].map((v) => v.total));
  const maxSpec = Math.max(1, ...specialtyTop.map(([, v]) => v.total));
  const maxRank = Math.max(1, ...rankingTop.map(([, v]) => v.qty));
  const unitLabel =
    clinicFilter === null
      ? "Todas as unidades"
      : (unitOptions.find((u) => u.id === clinicFilter)?.name ??
        session.activeClinic?.name ??
        "Unidade");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* -- Cabeçalho + filtros num painel só ----------------------------- */}
      <div className="relative overflow-hidden rounded-2xl border bg-primary text-primary-foreground">
        <RisarteMark className="pointer-events-none absolute -top-4 -right-6 h-40 text-gold/10" />
        <div className="relative space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary-foreground/60">
                <BarChart3 className="size-3.5" />
                Comercial
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Dashboard
              </h1>
              <p className="mt-0.5 text-sm text-primary-foreground/70">
                {unitLabel} · {PERIOD_LABELS[period]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
                nativeButton={false}
                render={<Link href="/comercial/venda-direta" />}
              >
                <Store className="mr-1 size-3.5" />
                Vendas diretas
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
                nativeButton={false}
                render={<Link href="/comercial" />}
              >
                <ArrowLeft className="mr-1 size-3.5" />
                Funil
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-primary-foreground/15 pt-3 text-xs">
            {canSeeAllUnits && unitOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 text-primary-foreground/60">
                  Unidade
                </span>
                <DarkChip
                  label="Todas"
                  href={chipHref(null, period)}
                  active={clinicFilter === null}
                />
                {unitOptions.map((u) => (
                  <DarkChip
                    key={u.id}
                    label={u.name}
                    href={chipHref(u.id, period)}
                    active={clinicFilter === u.id}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-primary-foreground/60">
                Período
              </span>
              {PERIODS.map((pd) => (
                <DarkChip
                  key={pd}
                  label={PERIOD_LABELS[pd]}
                  href={periodHref(pd)}
                  active={period === pd}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* -- Resultado do período ------------------------------------------ */}
      <section className="space-y-3">
        <SectionTitle
          icon={<Trophy className="size-4" />}
          title="Resultado do período"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            tone="emerald"
            icon={<CheckCircle2 className="size-4" />}
            label="Vendas fechadas"
            value={String(salesCount)}
            hint={`${totalOpp} oportunidade(s) no período`}
          />
          <Kpi
            tone="gold"
            icon={<Wallet className="size-4" />}
            label="Valor total vendido"
            value={formatBRL(salesTotal)}
            hint={`ticket médio ${formatBRL(ticket)}`}
          />
          <Kpi
            tone="sky"
            icon={<Percent className="size-4" />}
            label="Taxa de conversão"
            value={`${conversion.toFixed(0)}%`}
            hint={`${lost} perda(s)`}
            progress={conversion}
          />
          <Kpi
            tone="violet"
            icon={<CreditCard className="size-4" />}
            label="Ticket médio da parcela"
            value={avgInstallmentTicket > 0 ? formatBRL(avgInstallmentTicket) : "—"}
            hint={
              avgInstallments > 0
                ? `parcelamento médio ${avgInstallments.toFixed(1)}×`
                : "sem parcelamento no período"
            }
          />
        </div>
      </section>

      {/* -- Em aberto ------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionTitle icon={<Hourglass className="size-4" />} title="Em aberto" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Clicáveis: abrem a lista dos clientes em aberto (com valores). */}
          <AwaitingDialog
            label="Aguardando fechamento"
            value={String(awaitingCount)}
            hint="negociações sem contrato/pagamento"
            icon="hourglass"
            items={awaitingItems}
            periodLabel={PERIOD_LABELS[period]}
            unitLabel={unitLabel}
          />
          <AwaitingDialog
            label="Valor aguardando"
            value={formatBRL(awaitingTotal)}
            hint="potencial a fechar"
            icon="wallet"
            items={awaitingItems}
            periodLabel={PERIOD_LABELS[period]}
            unitLabel={unitLabel}
          />
          <Kpi
            tone={inFollowup > 0 ? "amber" : "muted"}
            icon={<PhoneCall className="size-4" />}
            label="Em follow-up"
            value={String(inFollowup)}
            hint="clientes em contato ativo"
          />
          <Kpi
            tone="muted"
            icon={<TicketPercent className="size-4" />}
            label="Desconto concedido"
            value={formatBRL(discountTotal)}
            hint="nas vendas fechadas"
          />
        </div>
      </section>

      {/* -- Ciclo de vendas + ticket por tipo de cliente ------------------- */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Timer className="size-4 text-primary" />
              Ciclo de vendas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Tempo médio até o tratamento começar.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <CycleBox
              label="Clientes novos"
              caption="cadastro → início"
              days={cycleNewDays.length > 0 ? cycleNew : null}
              count={cycleNewDays.length}
              tone="sky"
            />
            <CycleBox
              label="Clientes Risarte"
              caption="reavaliação → novo tratamento"
              days={cycleReturnDays.length > 0 ? cycleReturn : null}
              count={cycleReturnDays.length}
              tone="gold"
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Users className="size-4 text-primary" />
              Ticket médio por tipo de cliente
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Quanto vale, em média, cada venda fechada.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <CompareRow
              label="Clientes novos"
              count={newSales.length}
              valueCents={newSales.length > 0 ? ticketNew : null}
              max={Math.max(ticketNew, ticketReturn, 1)}
              tone="sky"
            />
            <CompareRow
              label="Clientes Risarte"
              count={returnSales.length}
              valueCents={returnSales.length > 0 ? ticketReturn : null}
              max={Math.max(ticketNew, ticketReturn, 1)}
              tone="gold"
            />
          </CardContent>
        </Card>
      </section>

      {/* -- Pagamento + pilar ---------------------------------------------- */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <CreditCard className="size-4 text-primary" />
              Por tipo de pagamento
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Como os clientes pagaram no período.
            </p>
          </CardHeader>
          <CardContent>
            {byPayment.size === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2.5">
                {[...byPayment.entries()]
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([k, v]) => (
                    <BarRow
                      key={k}
                      label={
                        k === "—"
                          ? "Não informado"
                          : (PAYMENT_METHOD_LABELS[k as PaymentMethod] ?? k)
                      }
                      count={v.count}
                      valueCents={v.total}
                      pct={(v.total / maxPay) * 100}
                      tone="violet"
                    />
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Layers className="size-4 text-primary" />
              Por pilar da metodologia
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Onde está o valor vendido.
            </p>
          </CardHeader>
          <CardContent>
            {byPillar.size === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2.5">
                {[...byPillar.entries()]
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([k, v]) => (
                    <BarRow
                      key={k}
                      label={
                        k === "sem_pilar"
                          ? "Sem pilar"
                          : PILLAR_LABELS[k as MethodologyPillar]
                      }
                      count={v.count}
                      valueCents={v.total}
                      pct={(v.total / maxPillar) * 100}
                      tone="gold"
                    />
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* -- Vendas diretas -------------------------------------------------- */}
      <section className="space-y-3">
        <SectionTitle
          icon={<Store className="size-4 text-gold" />}
          title="Vendas diretas na unidade"
          action={
            <Link
              href="/comercial/venda-direta"
              className="text-xs text-primary hover:underline"
            >
              ver todas →
            </Link>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            tone="gold"
            icon={<Store className="size-4" />}
            label="Vendas"
            value={String(dsCount)}
          />
          <Kpi
            tone="gold"
            icon={<Wallet className="size-4" />}
            label="Valor total"
            value={formatBRL(dsTotal)}
          />
          <Kpi
            tone="gold"
            icon={<TicketPercent className="size-4" />}
            label="Ticket médio"
            value={formatBRL(dsTicket)}
          />
          <Kpi
            tone="gold"
            icon={<Stethoscope className="size-4" />}
            label="Procedimentos"
            value={String(dsProcCount)}
          />
        </div>
      </section>

      {/* -- Especialidade + ranking ---------------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="gap-0.5">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Stethoscope className="size-4 text-primary" />
              Vendas por especialidade
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Valor vendido e ticket médio de cada área.
            </p>
          </CardHeader>
          <CardContent>
            {specialtyTop.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2.5">
                {specialtyTop.map(([name, v]) => (
                  <BarRow
                    key={name}
                    label={name}
                    count={v.qty}
                    valueCents={v.total}
                    ticketCents={Math.round(v.total / Math.max(1, v.qty))}
                    pct={(v.total / maxSpec) * 100}
                    tone="emerald"
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <div>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Trophy className="size-4 text-gold" />
                Procedimentos mais vendidos
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Quantidade, valor total e ticket médio.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Origem:</span>
              <Chip
                label="Todos"
                href={rankingHref("todos")}
                active={origem === "todos"}
              />
              <Chip
                label="Fluxo comercial"
                href={rankingHref("comercial")}
                active={origem === "comercial"}
              />
              <Chip
                label="Vendas diretas"
                href={rankingHref("direta")}
                active={origem === "direta"}
              />
            </div>
          </CardHeader>
          <CardContent>
            {rankingTop.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2.5">
                {rankingTop.map(([name, v], i) => (
                  <BarRow
                    key={name}
                    rank={i + 1}
                    label={name}
                    count={v.qty}
                    countSuffix="×"
                    valueCents={v.total}
                    ticketCents={Math.round(v.total / Math.max(1, v.qty))}
                    pct={(v.qty / maxRank) * 100}
                    tone="sky"
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças visuais do dashboard
// ---------------------------------------------------------------------------

type Tone = "gold" | "emerald" | "sky" | "violet" | "amber" | "muted";

const TONE_ACCENT: Record<Tone, string> = {
  gold: "bg-gold",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  muted: "bg-muted-foreground/40",
};
const TONE_ICON: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold-foreground",
  emerald: "bg-emerald-500/10 text-emerald-700",
  sky: "bg-sky-500/10 text-sky-700",
  violet: "bg-violet-500/10 text-violet-700",
  amber: "bg-amber-500/15 text-amber-700",
  muted: "bg-muted text-muted-foreground",
};

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

/** Cartão de indicador: ícone colorido, número grande e uma linha de contexto. */
function Kpi({
  tone,
  icon,
  label,
  value,
  hint,
  progress,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  /** 0–100: desenha uma barrinha embaixo (ex.: taxa de conversão). */
  progress?: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
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
      {progress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", TONE_ACCENT[tone])}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Linha com barra proporcional — usada nas listas (pagamento, pilar, ranking). */
function BarRow({
  rank,
  label,
  count,
  countSuffix = "",
  valueCents,
  ticketCents,
  pct,
  tone,
}: {
  rank?: number;
  label: string;
  count: number;
  countSuffix?: string;
  valueCents: number;
  ticketCents?: number;
  pct: number;
  tone: Tone;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {rank != null && (
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                rank <= 3
                  ? "bg-gold/20 text-gold-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {rank}
            </span>
          )}
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count}
            {countSuffix}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatBRL(valueCents)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", TONE_ACCENT[tone])}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          />
        </div>
        {ticketCents != null && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            média {formatBRL(ticketCents)}
          </span>
        )}
      </div>
    </li>
  );
}

/** Caixa do ciclo de vendas (número de dias em destaque). */
function CycleBox({
  label,
  caption,
  days,
  count,
  tone,
}: {
  label: string;
  caption: string;
  days: number | null;
  count: number;
  tone: Tone;
}) {
  return (
    <div className="rounded-xl border p-3">
      <span
        className={cn("mb-2 block h-1 w-8 rounded-full", TONE_ACCENT[tone])}
        aria-hidden
      />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-[11px] text-muted-foreground">{caption}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">
        {days != null ? days : "—"}
        {days != null && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            dias
          </span>
        )}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {count} venda(s) no período
      </p>
    </div>
  );
}

/** Linha comparativa (ticket novo × Risarte) com barra proporcional. */
function CompareRow({
  label,
  count,
  valueCents,
  max,
  tone,
}: {
  label: string;
  count: number;
  valueCents: number | null;
  max: number;
  tone: Tone;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          {label} <span className="text-xs text-muted-foreground">({count})</span>
        </span>
        <span className="font-semibold tabular-nums">
          {valueCents != null ? formatBRL(valueCents) : "—"}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", TONE_ACCENT[tone])}
          style={{
            width: `${valueCents != null ? Math.min(100, Math.max(3, (valueCents / max) * 100)) : 0}%`,
          }}
        />
      </div>
    </div>
  );
}

function Empty() {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">
      Nada no período.
    </p>
  );
}

function Chip({
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
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "hover:bg-muted"
      )}
    >
      {label}
    </Link>
  );
}

/** Chip para o cabeçalho escuro (navy). */
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
