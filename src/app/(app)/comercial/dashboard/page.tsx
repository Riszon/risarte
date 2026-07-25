import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CreditCard,
  Hourglass,
  Layers,
  Percent,
  Stethoscope,
  Store,
  ThumbsDown,
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
import { DrillCard, type DrillItem } from "./drill-card";
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

const PERIODS = ["hoje", "semana", "mes", "tudo", "custom"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  tudo: "Tudo",
  custom: "Período escolhido",
};
/** Chips do topo (o período específico tem controle próprio). */
const QUICK_PERIODS = ["hoje", "semana", "mes", "tudo"] as const;

function periodStart(p: Period, de?: string): string | null {
  const now = new Date();
  if (p === "custom") return de ? new Date(`${de}T00:00:00`).toISOString() : null;
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
/** Fim do período (só no período escolhido) — inclui o dia inteiro do "até". */
function periodEnd(p: Period, ate?: string): string | null {
  if (p !== "custom" || !ate) return null;
  return new Date(`${ate}T23:59:59.999`).toISOString();
}
function fmtBr(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
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
  const deParam = Array.isArray(sp.de) ? sp.de[0] : sp.de;
  const ateParam = Array.isArray(sp.ate) ? sp.ate[0] : sp.ate;
  const period: Period =
    // "Período escolhido" só vale com as duas datas preenchidas.
    periodParam === "custom" && deParam && ateParam
      ? "custom"
      : PERIODS.includes(periodParam as Period) && periodParam !== "custom"
        ? (periodParam as Period)
        : "mes";

  let clinicFilter: string | null;
  if (!canSeeAllUnits) clinicFilter = activeClinicId;
  else if (unidadeParam === "all") clinicFilter = null;
  else if (unidadeParam) clinicFilter = unidadeParam;
  else clinicFilter = activeIsUnit ? activeClinicId : null;

  const start = periodStart(period, deParam);
  const end = periodEnd(period, ateParam);
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
  if (end) negQuery = negQuery.lte("created_at", end);
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
  // Aguardando fechamento do COMERCIAL (as vendas diretas pendentes entram
  // logo abaixo, depois que a consulta delas roda).
  const awaitingNegCount = openNegs.length;
  const awaitingNegTotal = openNegs.reduce((s, n) => s + n.final_cents, 0);

  // -- Vendas diretas ---------------------------------------------------------
  // Vêm antes dos indicadores porque quase todos são consolidados (comercial +
  // direta): parcela, desconto, cancelados, pagamento e tipo de cliente.
  let dsQuery = supabase
    .from("direct_sales")
    .select(
      "id, client_id, client_name, clinic_id, final_cents, discount_cents, program_discount_cents, installments, payment_method, status, cancelled, contract_signed, payment_confirmed, closed_at, created_at, items:direct_sale_items ( description, quantity, final_cents, procedure_id )"
    )
    .neq("cancelled", true);
  if (clinicFilter) dsQuery = dsQuery.eq("clinic_id", clinicFilter);
  if (start) dsQuery = dsQuery.gte("created_at", start);
  if (end) dsQuery = dsQuery.lte("created_at", end);

  // Canceladas entram pela DATA DO CANCELAMENTO (como o cartão do funil, que
  // usa a data em que foi marcado).
  let dsCancelQuery = supabase
    .from("direct_sales")
    .select(
      "id, client_id, client_name, clinic_id, final_cents, cancelled_at, cancelled_by"
    )
    .eq("cancelled", true);
  if (clinicFilter) dsCancelQuery = dsCancelQuery.eq("clinic_id", clinicFilter);
  if (start) dsCancelQuery = dsCancelQuery.gte("cancelled_at", start);
  if (end) dsCancelQuery = dsCancelQuery.lte("cancelled_at", end);

  const [{ data: dsRows }, { data: dsCancelRows }] = await Promise.all([
    dsQuery,
    dsCancelQuery,
  ]);
  const ds = (dsRows ?? []) as {
    id: string;
    client_id: string | null;
    client_name: string | null;
    clinic_id: string;
    final_cents: number;
    discount_cents: number;
    program_discount_cents: number;
    installments: number;
    payment_method: string | null;
    status: string;
    cancelled: boolean;
    contract_signed: boolean;
    payment_confirmed: boolean;
    closed_at: string | null;
    created_at: string;
    items:
      | {
          description: string;
          quantity: number;
          final_cents: number;
          procedure_id: string | null;
        }[]
      | null;
  }[];
  const dsCancelled = (dsCancelRows ?? []) as {
    id: string;
    client_id: string | null;
    client_name: string | null;
    clinic_id: string;
    final_cents: number;
    cancelled_at: string | null;
    cancelled_by: string | null;
  }[];

  // Venda direta CONCLUÍDA = contrato assinado + pagamento confirmado (regra de
  // ouro). As demais entram no "aguardando fechamento", junto com o comercial.
  const dsClosed = ds.filter((d) => d.closed_at != null);
  const dsPending = ds.filter((d) => d.closed_at == null);
  const dsCount = dsClosed.length;
  const dsTotal = dsClosed.reduce((s, d) => s + d.final_cents, 0);
  const dsTicket = dsCount > 0 ? Math.round(dsTotal / dsCount) : 0;
  const dsProcCount = dsClosed.reduce(
    (s, d) => s + (d.items ?? []).reduce((a, i) => a + i.quantity, 0),
    0
  );
  const dsPendingCount = dsPending.length;
  const dsPendingTotal = dsPending.reduce((s, d) => s + d.final_cents, 0);

  // Ticket médio da PARCELA — só as vendas parceladas (2× ou mais), nas duas
  // origens. O "geral" é a média das parcelas de todas elas juntas.
  type InstRow = { finalCents: number; installments: number };
  const instAvg = (rows: InstRow[]) =>
    rows.length > 0
      ? Math.round(
          rows.reduce((s, r) => s + r.finalCents / r.installments, 0) /
            rows.length
        )
      : 0;
  const comInstRows: InstRow[] = accepted
    .filter((n) => (n.installments || 1) > 1)
    .map((n) => ({ finalCents: n.final_cents, installments: n.installments }));
  const dirInstRows: InstRow[] = dsClosed
    .filter((d) => (d.installments || 1) > 1)
    .map((d) => ({ finalCents: d.final_cents, installments: d.installments }));
  const allInstRows = [...comInstRows, ...dirInstRows];
  const instTicket = {
    geral: instAvg(allInstRows),
    comercial: instAvg(comInstRows),
    direta: instAvg(dirInstRows),
  };
  const avgInstallments =
    allInstRows.length > 0
      ? allInstRows.reduce((s, r) => s + r.installments, 0) / allInstRows.length
      : 0;

  // Descontos concedidos — no comercial é o ajuste negativo da negociação; na
  // venda direta é o desconto manual + o desconto do programa (Empresarial).
  const dsDiscountManual = dsClosed.reduce((s, d) => s + (d.discount_cents ?? 0), 0);
  const dsDiscountProgram = dsClosed.reduce(
    (s, d) => s + (d.program_discount_cents ?? 0),
    0
  );
  const dsDiscountTotal = dsDiscountManual + dsDiscountProgram;

  // -- Listas por trás dos cartões (pop-up ao clicar) -------------------------
  // Follow-up, perdidos e cancelados vêm do cartão do funil; as vendas e o
  // "aguardando fechamento" vêm das negociações. Tudo já filtrado por unidade.
  let followQueryRows = supabase
    .from("commercial_cards")
    .select("client_id, stage, followup_attempts, next_attempt_at")
    .in("stage", ["follow_up", "follow_up_clinica"]);
  if (clinicFilter) followQueryRows = followQueryRows.eq("clinic_id", clinicFilter);

  let closedCardsQuery = supabase
    .from("commercial_cards")
    .select("client_id, stage, outcome_reason, outcome_at, outcome_by")
    .in("stage", ["perdido", "cancelado"]);
  if (clinicFilter) closedCardsQuery = closedCardsQuery.eq("clinic_id", clinicFilter);
  if (start) closedCardsQuery = closedCardsQuery.gte("updated_at", start);
  if (end) closedCardsQuery = closedCardsQuery.lte("updated_at", end);

  const [{ data: followDetailRows }, { data: closedCardRows }] = await Promise.all([
    followQueryRows,
    closedCardsQuery,
  ]);

  type CardRow = {
    client_id: string;
    stage: string;
    outcome_reason?: string | null;
    outcome_at?: string | null;
    outcome_by?: string | null;
    followup_attempts?: number;
    next_attempt_at?: string | null;
  };
  const followDetail = (followDetailRows ?? []) as CardRow[];
  const closedCards = (closedCardRows ?? []) as CardRow[];
  const lostCards = closedCards.filter((c) => c.stage === "perdido");
  const cancelledCards = closedCards.filter((c) => c.stage === "cancelado");

  // Nomes dos clientes e de quem marcou perdido/cancelado (uma busca só).
  const drillClientIds = [
    ...new Set([
      ...openNegs.map((n) => n.client_id),
      ...accepted.map((n) => n.client_id),
      ...followDetail.map((c) => c.client_id),
      ...closedCards.map((c) => c.client_id),
    ]),
  ];
  const clientInfo = new Map<
    string,
    { name: string; code: string | null; clinic: string | null }
  >();
  if (drillClientIds.length > 0) {
    const { data: cliRows } = await supabase
      .from("clients")
      .select(
        "id, full_name, code, clinic:clinics!clients_clinic_id_fkey ( name )"
      )
      .in("id", drillClientIds);
    for (const c of (cliRows ?? []) as {
      id: string;
      full_name: string;
      code: string | null;
      clinic: { name: string } | { name: string }[] | null;
    }[]) {
      const cl = Array.isArray(c.clinic) ? c.clinic[0] : c.clinic;
      clientInfo.set(c.id, {
        name: c.full_name,
        code: c.code,
        clinic: cl?.name ?? null,
      });
    }
  }
  const outcomeAuthorIds = [
    ...new Set(
      [
        ...closedCards.map((c) => c.outcome_by),
        ...dsCancelled.map((d) => d.cancelled_by),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const authorNames = new Map<string, string>();
  if (outcomeAuthorIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", outcomeAuthorIds);
    for (const p of people ?? [])
      authorNames.set(p.id as string, p.full_name as string);
  }

  const base = (clientId: string) => {
    const info = clientInfo.get(clientId);
    return {
      clientId,
      clientName: info?.name ?? "Cliente",
      code: info?.code ?? null,
      clinicName: info?.clinic ?? null,
    };
  };
  const fmtDay = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR") : null;

  const NEG_BADGE: Record<string, { label: string; tone: DrillItem["badgeTone"] }> =
    {
      em_negociacao: { label: "Em negociação", tone: "primary" },
      aguardando_autorizacao: {
        label: "Aguardando autorização",
        tone: "amber",
      },
      aceita: { label: "Aceita — falta assinar/pagar", tone: "emerald" },
    };

  const awaitingNegItems: DrillItem[] = openNegs.map((n) => ({
    ...base(n.client_id),
    badge: NEG_BADGE[n.status]?.label ?? n.status,
    badgeTone: NEG_BADGE[n.status]?.tone ?? "muted",
    valueCents: n.final_cents,
    note: "Fluxo comercial",
  }));

  const soldItemsList: DrillItem[] = accepted
    .map((n) => ({
      ...base(n.client_id),
      badge: closedClientIds.has(n.client_id) ? "Concluída" : "Falta fechar",
      badgeTone: closedClientIds.has(n.client_id)
        ? ("emerald" as const)
        : ("amber" as const),
      valueCents: n.final_cents,
      note:
        n.installments > 1
          ? `${n.installments}× de ${formatBRL(Math.round(n.final_cents / n.installments))}`
          : null,
    }))
    .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));

  const followupItems: DrillItem[] = followDetail.map((c) => ({
    ...base(c.client_id),
    badge: c.stage === "follow_up_clinica" ? "Follow-up na clínica" : "Follow-up",
    badgeTone: c.stage === "follow_up_clinica" ? ("rose" as const) : ("amber" as const),
    note: [
      `${c.followup_attempts ?? 0} tentativa(s)`,
      c.next_attempt_at && c.stage === "follow_up"
        ? `próxima em ${fmtDay(c.next_attempt_at)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const outcomeItem = (c: CardRow): DrillItem => ({
    ...base(c.client_id),
    badge: fmtDay(c.outcome_at) ?? null,
    badgeTone: "muted" as const,
    note: [
      c.outcome_reason ?? "Sem motivo registrado",
      c.outcome_by ? `por ${authorNames.get(c.outcome_by) ?? "—"}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const lostItems: DrillItem[] = lostCards.map(outcomeItem);
  // Cancelados = funil comercial + vendas diretas canceladas (consolidado).
  const cancelledComItems: DrillItem[] = cancelledCards.map(outcomeItem);
  const cancelledDirectItems: DrillItem[] = dsCancelled.map((d) => ({
    clientId: d.client_id ?? "",
    clientName: d.client_name ?? "Cliente avulso",
    code: null,
    clinicName: unitOptions.find((u) => u.id === d.clinic_id)?.name ?? null,
    badge: "Venda direta",
    badgeTone: "rose" as const,
    valueCents: d.final_cents,
    note: [
      fmtDay(d.cancelled_at) ?? "sem data",
      d.cancelled_by ? `por ${authorNames.get(d.cancelled_by) ?? "—"}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  const cancelledItems: DrillItem[] = [
    ...cancelledComItems,
    ...cancelledDirectItems,
  ];

  // Por tipo de pagamento — consolidado: vendas aceitas do comercial + vendas
  // diretas concluídas, mantendo a quebra por origem em cada forma.
  type PayAgg = {
    count: number;
    total: number;
    comCount: number;
    comTotal: number;
    dirCount: number;
    dirTotal: number;
  };
  const byPayment = new Map<string, PayAgg>();
  const payAgg = (k: string): PayAgg => {
    const a =
      byPayment.get(k) ??
      { count: 0, total: 0, comCount: 0, comTotal: 0, dirCount: 0, dirTotal: 0 };
    byPayment.set(k, a);
    return a;
  };
  for (const n of accepted) {
    const a = payAgg(n.payment_method ?? "—");
    a.count += 1;
    a.total += n.final_cents;
    a.comCount += 1;
    a.comTotal += n.final_cents;
  }
  for (const d of dsClosed) {
    const a = payAgg(d.payment_method ?? "—");
    a.count += 1;
    a.total += d.final_cents;
    a.dirCount += 1;
    a.dirTotal += d.final_cents;
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

  // Venda direta: a regra do dono é pela FASE ATUAL do cliente —
  // Fase 1 (Aquisição) ou Fase 2 (Conversão Clínica) = cliente NOVO;
  // qualquer outra fase = cliente Risarte (já é da casa).
  const dsClientIds = [
    ...new Set(
      dsClosed.map((d) => d.client_id).filter((x): x is string => Boolean(x))
    ),
  ];
  const phaseByClient = new Map<string, string>();
  if (dsClientIds.length > 0) {
    const { data: phaseRows } = await supabase
      .from("clients")
      .select("id, journey_phase")
      .in("id", dsClientIds);
    for (const c of phaseRows ?? [])
      phaseByClient.set(c.id as string, c.journey_phase as string);
  }
  const NEW_PHASES = new Set(["acquisition", "clinical_conversion"]);
  // Venda sem cliente cadastrado (avulsa) conta como cliente novo.
  const dsIsNew = (d: { client_id: string | null }) =>
    !d.client_id || NEW_PHASES.has(phaseByClient.get(d.client_id) ?? "acquisition");
  const dsNewSales = dsClosed.filter(dsIsNew);
  const dsReturnSales = dsClosed.filter((d) => !dsIsNew(d));

  const ticketOf = (rows: { final_cents: number }[]) =>
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.final_cents, 0) / rows.length)
      : 0;
  const ticketNew = ticketOf(newSales);
  const ticketReturn = ticketOf(returnSales);
  const ticketNewDirect = ticketOf(dsNewSales);
  const ticketReturnDirect = ticketOf(dsReturnSales);
  const ticketNewAll = ticketOf([...newSales, ...dsNewSales]);
  const ticketReturnAll = ticketOf([...returnSales, ...dsReturnSales]);

  // Clientes em follow-up (estado atual, não do período).
  let followQuery = supabase
    .from("commercial_cards")
    .select("stage")
    .in("stage", ["follow_up", "follow_up_clinica"]);
  if (clinicFilter) followQuery = followQuery.eq("clinic_id", clinicFilter);
  const { data: followRows } = await followQuery;
  const inFollowup = (followRows ?? []).length;

  // -- TOTAL GERAL (comercial + venda direta) --------------------------------
  const grandCount = salesCount + dsCount;
  const grandTotal = salesTotal + dsTotal;
  const grandTicket = grandCount > 0 ? Math.round(grandTotal / grandCount) : 0;
  const pct = (part: number, whole: number) =>
    whole > 0 ? (part / whole) * 100 : 0;
  const share = {
    comercialValue: pct(salesTotal, grandTotal),
    comercialCount: pct(salesCount, grandCount),
    diretaValue: pct(dsTotal, grandTotal),
    diretaCount: pct(dsCount, grandCount),
  };

  // -- Aguardando fechamento: COMERCIAL + VENDAS DIRETAS ----------------------
  const dsAwaitingItems: DrillItem[] = dsPending.map((d) => ({
    clientId: d.client_id ?? "",
    clientName: d.client_name ?? "Cliente avulso",
    code: null,
    clinicName:
      unitOptions.find((u) => u.id === d.clinic_id)?.name ??
      (clinicFilter ? null : null),
    badge: "Venda direta",
    badgeTone: "rose" as const,
    valueCents: d.final_cents,
    note: [
      d.contract_signed ? "contrato assinado" : "falta contrato",
      d.payment_confirmed ? "pago" : "falta pagamento",
    ].join(" · "),
  }));
  const awaitingItems: DrillItem[] = [...awaitingNegItems, ...dsAwaitingItems]
    .filter((i) => i.clientId !== "")
    .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));
  const awaitingCount = awaitingNegCount + dsPendingCount;
  const awaitingTotal = awaitingNegTotal + dsPendingTotal;

  // Lista das vendas diretas concluídas (drill do cartão).
  const dsSoldItems: DrillItem[] = dsClosed
    .map((d) => ({
      clientId: d.client_id ?? "",
      clientName: d.client_name ?? "Cliente avulso",
      code: null,
      clinicName: unitOptions.find((u) => u.id === d.clinic_id)?.name ?? null,
      badge: "Venda direta",
      badgeTone: "rose" as const,
      valueCents: d.final_cents,
      note: `${(d.items ?? []).reduce((a, i) => a + i.quantity, 0)} procedimento(s)`,
    }))
    .filter((i) => i.clientId !== "")
    .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));
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
    if (end) negItemsQuery = negItemsQuery.lte("created_at", end);
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
    if (pd === "custom") {
      if (deParam) p.set("de", deParam);
      if (ateParam) p.set("ate", ateParam);
    }
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
    if (period === "custom") {
      if (deParam) p.set("de", deParam);
      if (ateParam) p.set("ate", ateParam);
    }
    p.set("origem", o);
    return `/comercial/dashboard?${p.toString()}`;
  };
  const periodDescription =
    period === "custom" && deParam && ateParam
      ? `${fmtBr(deParam)} a ${fmtBr(ateParam)}`
      : PERIOD_LABELS[period];


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
                {unitLabel} · {periodDescription}
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
                action="/comercial/dashboard"
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
            icon={<Trophy className="size-4" />}
            label="TOTAL GERAL de vendas"
            value={String(grandCount)}
            hint={`comercial ${salesCount} + direta ${dsCount}`}
          />
          <Kpi
            tone="gold"
            icon={<Wallet className="size-4" />}
            label="TOTAL GERAL em R$"
            value={formatBRL(grandTotal)}
            hint={`ticket médio geral ${formatBRL(grandTicket)}`}
          />
          <Kpi
            tone="sky"
            icon={<Percent className="size-4" />}
            label="Taxa de conversão"
            value={`${conversion.toFixed(0)}%`}
            hint={`${lost} perda(s)`}
            progress={conversion}
          />
          <SplitKpi
            tone="violet"
            icon={<CreditCard className="size-4" />}
            label="Ticket médio da parcela"
            value={instTicket.geral > 0 ? formatBRL(instTicket.geral) : "—"}
            hint={
              allInstRows.length > 0
                ? `${allInstRows.length} venda(s) parcelada(s) · média ${avgInstallments.toFixed(1)}×`
                : "sem parcelamento no período"
            }
            parts={[
              {
                label: "Comercial",
                dot: "bg-sky-500",
                value: comInstRows.length > 0 ? formatBRL(instTicket.comercial) : "—",
                sub: `${comInstRows.length} parcelada(s)`,
              },
              {
                label: "Venda direta",
                dot: "bg-gold",
                value: dirInstRows.length > 0 ? formatBRL(instTicket.direta) : "—",
                sub: `${dirInstRows.length} parcelada(s)`,
              },
            ]}
          />
        </div>
      </section>

      {/* -- Em aberto ------------------------------------------------------ */}
      <section className="space-y-3">
        <SectionTitle icon={<Hourglass className="size-4" />} title="Em aberto" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Clicáveis: abrem a lista dos clientes (com valores). */}
          <DrillCard
            tone="amber"
            icon="hourglass"
            label="Aguardando fechamento"
            value={String(awaitingCount)}
            hint="negociações sem contrato/pagamento"
            items={awaitingItems}
            dialogTitle="Aguardando fechamento"
            scopeLabel={`${unitLabel} · ${periodDescription}`}
          />
          <DrillCard
            tone="amber"
            icon="wallet"
            label="Valor aguardando"
            value={formatBRL(awaitingTotal)}
            hint="potencial a fechar"
            items={awaitingItems}
            dialogTitle="Aguardando fechamento"
            scopeLabel={`${unitLabel} · ${periodDescription}`}
          />
          <DrillCard
            tone="amber"
            icon="phone"
            label="Em follow-up"
            value={String(inFollowup)}
            hint="clientes em contato ativo"
            items={followupItems}
            dialogTitle="Clientes em follow-up"
            scopeLabel={unitLabel}
            emptyValueLabel="Clientes em follow-up"
          />
          <SplitKpi
            tone="muted"
            icon={<TicketPercent className="size-4" />}
            label="Desconto concedido"
            value={formatBRL(discountTotal + dsDiscountTotal)}
            hint="nas vendas fechadas"
            parts={[
              {
                label: "Comercial",
                dot: "bg-sky-500",
                value: formatBRL(discountTotal),
                sub: "negociação",
              },
              {
                label: "Venda direta",
                dot: "bg-gold",
                value: formatBRL(dsDiscountTotal),
                sub:
                  dsDiscountProgram > 0
                    ? `programa ${formatBRL(dsDiscountProgram)}`
                    : "manual",
              },
            ]}
          />
        </div>
      </section>

      {/* -- Perdas e cancelamentos ---------------------------------------- */}
      <section className="space-y-3">
        <SectionTitle
          icon={<ThumbsDown className="size-4" />}
          title="Perdas e cancelamentos"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <DrillCard
            tone="rose"
            icon="lost"
            label="Perdidos"
            value={String(lostItems.length)}
            hint="clientes que não fecharam"
            items={lostItems}
            dialogTitle="Clientes perdidos"
            scopeLabel={`${unitLabel} · ${periodDescription}`}
            emptyValueLabel="Total de perdidos"
          />
          <DrillCard
            tone="muted"
            icon="cancelled"
            label="Cancelados"
            value={String(cancelledItems.length)}
            hint={`comercial ${cancelledComItems.length} + direta ${cancelledDirectItems.length}`}
            items={cancelledItems}
            dialogTitle="Clientes cancelados"
            scopeLabel={`${unitLabel} · ${periodDescription}`}
            emptyValueLabel="Total de cancelados"
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
              Quanto vale, em média, cada venda fechada (comercial + direta).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <CompareRow
              label="Clientes novos"
              count={newSales.length + dsNewSales.length}
              valueCents={
                newSales.length + dsNewSales.length > 0 ? ticketNewAll : null
              }
              max={Math.max(ticketNewAll, ticketReturnAll, 1)}
              tone="sky"
              split={[
                {
                  label: "comercial",
                  dot: "bg-sky-500",
                  count: newSales.length,
                  valueCents: newSales.length > 0 ? ticketNew : null,
                },
                {
                  label: "direta",
                  dot: "bg-gold",
                  count: dsNewSales.length,
                  valueCents: dsNewSales.length > 0 ? ticketNewDirect : null,
                },
              ]}
            />
            <CompareRow
              label="Clientes Risarte"
              count={returnSales.length + dsReturnSales.length}
              valueCents={
                returnSales.length + dsReturnSales.length > 0
                  ? ticketReturnAll
                  : null
              }
              max={Math.max(ticketNewAll, ticketReturnAll, 1)}
              tone="gold"
              split={[
                {
                  label: "comercial",
                  dot: "bg-sky-500",
                  count: returnSales.length,
                  valueCents: returnSales.length > 0 ? ticketReturn : null,
                },
                {
                  label: "direta",
                  dot: "bg-gold",
                  count: dsReturnSales.length,
                  valueCents:
                    dsReturnSales.length > 0 ? ticketReturnDirect : null,
                },
              ]}
            />
            <p className="border-t pt-2 text-[11px] text-muted-foreground">
              Na venda direta, o cliente é <strong>novo</strong> quando está na
              Fase 1 (Aquisição) ou Fase 2 (Conversão Clínica); nas demais fases
              já é <strong>cliente Risarte</strong>.
            </p>
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
              Comercial + venda direta, com a quebra por origem.
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
                      split={[
                        {
                          label: "comercial",
                          dot: "bg-sky-500",
                          count: v.comCount,
                          valueCents: v.comTotal,
                        },
                        {
                          label: "direta",
                          dot: "bg-gold",
                          count: v.dirCount,
                          valueCents: v.dirTotal,
                        },
                      ]}
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

      {/* -- Composição das vendas: comercial × direta ----------------------- */}
      <section className="space-y-3">
        <SectionTitle
          icon={<Layers className="size-4" />}
          title="Composição das vendas"
          action={
            <Link
              href="/comercial/venda-direta"
              className="text-xs text-primary hover:underline"
            >
              ver vendas diretas →
            </Link>
          }
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            {/* Barra única mostrando a divisão do faturamento. */}
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-sky-500"
                  style={{ width: `${share.comercialValue}%` }}
                  title={`Comercial ${share.comercialValue.toFixed(0)}%`}
                />
                <div
                  className="bg-gold"
                  style={{ width: `${share.diretaValue}%` }}
                  title={`Venda direta ${share.diretaValue.toFixed(0)}%`}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-sky-500" />
                  Fluxo comercial (consultor)
                  <span className="size-2 rounded-full bg-gold" />
                  Venda direta (clínica)
                </span>
                <span>
                  Total geral: <strong>{formatBRL(grandTotal)}</strong> ·{" "}
                  <strong>{grandCount}</strong> venda(s)
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1.5 font-medium">Origem</th>
                    <th className="py-1.5 text-right font-medium">Qtd.</th>
                    <th className="py-1.5 text-right font-medium">% qtd.</th>
                    <th className="py-1.5 text-right font-medium">Valor</th>
                    <th className="py-1.5 text-right font-medium">% valor</th>
                    <th className="py-1.5 text-right font-medium">Ticket médio</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-sky-500" />
                        Fluxo comercial
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{salesCount}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {share.comercialCount.toFixed(0)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(salesTotal)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {share.comercialValue.toFixed(0)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(ticket)}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-gold" />
                        Venda direta
                        <span className="text-xs text-muted-foreground">
                          ({dsProcCount} proc.)
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{dsCount}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {share.diretaCount.toFixed(0)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(dsTotal)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {share.diretaValue.toFixed(0)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(dsTicket)}
                    </td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-1.5">TOTAL GERAL</td>
                    <td className="py-1.5 text-right tabular-nums">{grandCount}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      100%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(grandTotal)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      100%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(grandTicket)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Ver quem comprou em cada origem. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <DrillCard
                tone="sky"
                icon="check"
                label="Vendas do fluxo comercial"
                value={String(salesCount)}
                hint={`${formatBRL(salesTotal)} · ${share.comercialValue.toFixed(0)}% do total`}
                items={soldItemsList}
                dialogTitle="Vendas do fluxo comercial"
                scopeLabel={`${unitLabel} · ${periodDescription}`}
              />
              <DrillCard
                tone="gold"
                icon="check"
                label="Vendas diretas concluídas"
                value={String(dsCount)}
                hint={`${formatBRL(dsTotal)} · ${share.diretaValue.toFixed(0)}% do total`}
                items={dsSoldItems}
                dialogTitle="Vendas diretas concluídas"
                scopeLabel={`${unitLabel} · ${periodDescription}`}
              />
            </div>

            <p className="border-t pt-2 text-xs text-muted-foreground">
              Venda direta conta como realizada quando o{" "}
              <strong>contrato está assinado e o pagamento confirmado</strong>; as
              pendentes aparecem em &quot;Aguardando fechamento&quot;
              {dsPendingCount > 0 && (
                <>
                  {" "}
                  (<strong>{dsPendingCount}</strong> agora,{" "}
                  {formatBRL(dsPendingTotal)})
                </>
              )}
              .
            </p>
          </CardContent>
        </Card>
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

/** Quebra por origem (comercial × venda direta) usada nas linhas e cartões. */
type OriginSplit = {
  label: string;
  dot: string;
  count: number;
  valueCents?: number | null;
};

/**
 * Cartão de indicador com o número GERAL em destaque e, embaixo, quanto vem do
 * fluxo comercial e quanto vem da venda direta.
 */
function SplitKpi({
  tone,
  icon,
  label,
  value,
  hint,
  parts,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  parts: { label: string; dot: string; value: string; sub?: string }[];
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
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
        {parts.map((p) => (
          <div key={p.label} className="min-w-0">
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", p.dot)} aria-hidden />
              {p.label}
            </p>
            <p className="truncate text-sm font-medium tabular-nums">{p.value}</p>
            {p.sub && (
              <p className="truncate text-[10px] text-muted-foreground">{p.sub}</p>
            )}
          </div>
        ))}
      </div>
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
  split,
}: {
  rank?: number;
  label: string;
  count: number;
  countSuffix?: string;
  valueCents: number;
  ticketCents?: number;
  pct: number;
  tone: Tone;
  /** Quebra comercial × direta mostrada abaixo da barra. */
  split?: OriginSplit[];
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
      {split && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {split.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
              {s.label} {s.count} ·{" "}
              <span className="tabular-nums">{formatBRL(s.valueCents ?? 0)}</span>
            </span>
          ))}
        </p>
      )}
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
  split,
}: {
  label: string;
  count: number;
  valueCents: number | null;
  max: number;
  tone: Tone;
  /** Quebra comercial × direta mostrada abaixo da barra. */
  split?: OriginSplit[];
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
      {split && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {split.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
              {s.label} ({s.count}) ·{" "}
              <span className="tabular-nums">
                {s.valueCents != null ? formatBRL(s.valueCents) : "—"}
              </span>
            </span>
          ))}
        </p>
      )}
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
