import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BarChart3, Store } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
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
      "id, final_cents, status, cancelled, items:direct_sale_items ( description, quantity, procedure_id )"
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
      | { description: string; quantity: number; procedure_id: string | null }[]
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
  type SoldItem = { name: string; qty: number; procedureId: string | null };
  const commercialItems: SoldItem[] = [];
  if (accepted.length > 0) {
    let negItemsQuery = supabase
      .from("plan_negotiations")
      .select(
        "id, status, plan_negotiation_items ( included, item:treatment_plan_option_items ( description, quantity, procedure_id ) )"
      )
      .eq("status", "aceita");
    if (clinicFilter) negItemsQuery = negItemsQuery.eq("clinic_id", clinicFilter);
    if (start) negItemsQuery = negItemsQuery.gte("created_at", start);
    const { data: negItemRows } = await negItemsQuery;
    for (const n of (negItemRows ?? []) as {
      plan_negotiation_items:
        | {
            included: boolean;
            item:
              | { description: string; quantity: number; procedure_id: string | null }
              | { description: string; quantity: number; procedure_id: string | null }[]
              | null;
          }[]
        | null;
    }[]) {
      for (const ni of n.plan_negotiation_items ?? []) {
        if (!ni.included) continue;
        const it = Array.isArray(ni.item) ? ni.item[0] : ni.item;
        if (!it) continue;
        commercialItems.push({
          name: it.description,
          qty: it.quantity,
          procedureId: it.procedure_id,
        });
      }
    }
  }

  const directItems: SoldItem[] = ds.flatMap((d) =>
    (d.items ?? []).map((i) => ({
      name: i.description,
      qty: i.quantity,
      procedureId: i.procedure_id ?? null,
    }))
  );

  const rankingSource =
    origem === "direta"
      ? directItems
      : origem === "comercial"
        ? commercialItems
        : [...directItems, ...commercialItems];

  const ranking = new Map<string, number>();
  for (const i of rankingSource)
    ranking.set(i.name, (ranking.get(i.name) ?? 0) + i.qty);
  const rankingTop = [...ranking.entries()].sort((a, b) => b[1] - a[1]);

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
  const bySpecialty = new Map<string, number>();
  for (const i of [...directItems, ...commercialItems]) {
    const key = i.procedureId
      ? (specialtyByProc.get(i.procedureId) ?? "Sem especialidade")
      : "Sem especialidade";
    bySpecialty.set(key, (bySpecialty.get(key) ?? 0) + i.qty);
  }
  const specialtyTop = [...bySpecialty.entries()].sort((a, b) => b[1] - a[1]);


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

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BarChart3 className="size-6 text-gold" />
            Dashboard comercial
          </h1>
          <p className="text-sm text-muted-foreground">
            Conversão, ticket médio, descontos, formas de pagamento, por pilar e
            as vendas diretas — consolidado e por unidade.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/comercial/venda-direta" />}
          >
            <Store className="mr-1 size-3.5" />
            Vendas diretas
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/comercial" />}
          >
            <ArrowLeft className="mr-1 size-3.5" />
            Funil
          </Button>
        </div>
      </div>

      {/* Filtros. */}
      <div className="space-y-2 text-xs">
        {canSeeAllUnits && unitOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Unidade:</span>
            <Chip label="Todas" href={chipHref(null, period)} active={clinicFilter === null} />
            {unitOptions.map((u) => (
              <Chip
                key={u.id}
                label={u.name}
                href={chipHref(u.id, period)}
                active={clinicFilter === u.id}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Período:</span>
          {PERIODS.map((pd) => (
            <Chip
              key={pd}
              label={PERIOD_LABELS[pd]}
              href={periodHref(pd)}
              active={period === pd}
            />
          ))}
        </div>
      </div>

      {/* Indicadores principais. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Vendas (fechadas)" value={String(salesCount)} />
        <Stat label="Valor total" value={formatBRL(salesTotal)} />
        <Stat label="Ticket médio" value={formatBRL(ticket)} />
        <Stat label="Taxa de conversão" value={`${conversion.toFixed(0)}%`} />
        <Stat label="Oportunidades" value={String(totalOpp)} />
        <Stat label="Perdas" value={String(lost)} />
        <Stat label="Em follow-up" value={String(inFollowup)} amber={inFollowup > 0} />
        <Stat
          label="Parcelamento médio"
          value={avgInstallments > 0 ? `${avgInstallments.toFixed(1)}×` : "—"}
        />
      </div>

      {/* Aguardando fechamento + ticket do parcelamento + ciclo de vendas. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Aguardando fechamento"
          value={String(awaitingCount)}
          amber={awaitingCount > 0}
        />
        <Stat
          label="Valor aguardando"
          value={formatBRL(awaitingTotal)}
          amber={awaitingCount > 0}
        />
        <Stat
          label="Ticket médio da parcela"
          value={avgInstallmentTicket > 0 ? formatBRL(avgInstallmentTicket) : "—"}
        />
        <Stat
          label="Desconto concedido"
          value={formatBRL(discountTotal)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo de vendas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>
                Clientes novos{" "}
                <span className="text-xs text-muted-foreground">
                  (cadastro → início do tratamento)
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {cycleNewDays.length > 0 ? `${cycleNew} dias` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>
                Clientes Risarte{" "}
                <span className="text-xs text-muted-foreground">
                  (reavaliação → novo tratamento)
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {cycleReturnDays.length > 0 ? `${cycleReturn} dias` : "—"}
              </span>
            </div>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              Média de dias das vendas fechadas no período ({cycleNewDays.length}{" "}
              novo(s) · {cycleReturnDays.length} Risarte).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ticket médio por tipo de cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>
                Clientes novos{" "}
                <span className="text-xs text-muted-foreground">
                  ({newSales.length})
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {newSales.length > 0 ? formatBRL(ticketNew) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>
                Clientes Risarte{" "}
                <span className="text-xs text-muted-foreground">
                  ({returnSales.length})
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {returnSales.length > 0 ? formatBRL(ticketReturn) : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Por tipo de pagamento. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por tipo de pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            {byPayment.size === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1 text-sm">
                {[...byPayment.entries()]
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span>
                        {k === "—"
                          ? "Não informado"
                          : PAYMENT_METHOD_LABELS[k as PaymentMethod] ?? k}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({v.count})
                        </span>
                      </span>
                      <span className="tabular-nums">{formatBRL(v.total)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              Desconto total concedido:{" "}
              <strong>{formatBRL(discountTotal)}</strong>
            </p>
          </CardContent>
        </Card>

        {/* Por pilar. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por pilar da metodologia</CardTitle>
          </CardHeader>
          <CardContent>
            {byPillar.size === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1 text-sm">
                {[...byPillar.entries()]
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span>
                        {k === "sem_pilar"
                          ? "Sem pilar"
                          : PILLAR_LABELS[k as MethodologyPillar]}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({v.count})
                        </span>
                      </span>
                      <span className="tabular-nums">{formatBRL(v.total)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vendas diretas. */}
      <Card className="border-gold/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Store className="size-4 text-gold" />
            Vendas diretas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Vendas" value={String(dsCount)} />
            <Stat label="Valor total" value={formatBRL(dsTotal)} />
            <Stat label="Ticket médio" value={formatBRL(dsTicket)} />
            <Stat label="Procedimentos" value={String(dsProcCount)} />
          </div>
        </CardContent>
      </Card>

      {/* Vendas por especialidade. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendas por especialidade</CardTitle>
        </CardHeader>
        <CardContent>
          {specialtyTop.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1 text-sm">
              {specialtyTop.map(([name, qty]) => (
                <li key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="tabular-nums">
                    {qty} procedimento{qty > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Ranking de procedimentos mais vendidos (com filtro de origem). */}
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">
            Procedimentos mais vendidos
          </CardTitle>
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
            <ul className="space-y-0.5 text-sm">
              {rankingTop.map(([name, qty], i) => (
                <li key={name} className="flex justify-between">
                  <span>
                    <span className="mr-1 text-xs text-muted-foreground">
                      {i + 1}.
                    </span>
                    {name}
                  </span>
                  <span className="tabular-nums">{qty}×</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  amber,
}: {
  label: string;
  value: string;
  amber?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        amber && "border-amber-300 bg-amber-50"
      )}
    >
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Empty() {
  return (
    <p className="py-2 text-center text-sm text-muted-foreground">
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
        "rounded-full border px-2 py-0.5 transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
      )}
    >
      {label}
    </Link>
  );
}
