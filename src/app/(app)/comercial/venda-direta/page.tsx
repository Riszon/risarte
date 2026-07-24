import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  resolveCommercialRule,
  type CommercialRule,
  type CommercialRuleRow,
  type PaymentMethod,
} from "@/lib/commercial";
import { directSaleStatusOf } from "@/lib/direct-sale";
import {
  VendaDiretaClient,
  type DirectSaleRow,
} from "./venda-direta-client";

export const metadata: Metadata = { title: "Vendas diretas" };

const CLOSE_ROLES = ["receptionist", "unit_manager", "sdr"] as const;

const PERIODS = ["hoje", "semana", "mes", "tudo"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  tudo: "Tudo",
};

function periodStart(period: Period): string | null {
  const now = new Date();
  if (period === "hoje") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (period === "semana") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (period === "mes") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return null;
}

export default async function VendasDiretasPage(
  props: PageProps<"/comercial/venda-direta">
) {
  const session = await getSessionContext();
  const roles = Object.values(session.rolesByClinic).flat();
  const canView =
    session.isAdminMaster ||
    roles.some((r) =>
      [
        "receptionist",
        "sdr",
        "clinical_coordinator",
        "unit_manager",
        "franchisee",
        "commercial_consultant",
        "commercial_assistant",
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
  if (!canSeeAllUnits) {
    clinicFilter = activeClinicId;
  } else if (unidadeParam === "all") {
    clinicFilter = null;
  } else if (unidadeParam) {
    clinicFilter = unidadeParam;
  } else {
    clinicFilter = activeIsUnit ? activeClinicId : null;
  }

  await logAudit({
    action: "view",
    entityType: "direct_sale_page",
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

  // Vendas diretas (v2) com os itens. RLS já limita ao escopo do usuário.
  let salesQuery = supabase
    .from("direct_sales")
    .select(
      "id, clinic_id, client_id, client_name, subtotal_cents, discount_cents, surcharge_cents, final_cents, installments, payment_method, contract_signed, contract_signed_by, payment_issued, payment_issued_by, payment_confirmed, payment_confirmed_by, cancelled, status, attendance_done_before, created_by, created_at, closed_at, clinic:clinics!direct_sales_clinic_id_fkey ( name ), items:direct_sale_items ( id, description, quantity, unit_price_cents, program_discount_cents, final_cents )"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (clinicFilter) salesQuery = salesQuery.eq("clinic_id", clinicFilter);
  const start = periodStart(period);
  if (start) salesQuery = salesQuery.gte("created_at", start);
  const { data: saleRows } = await salesQuery;

  const rows = (saleRows ?? []) as SaleQueryRow[];

  // Nomes das pessoas envolvidas.
  const personIds = [
    ...new Set(
      rows
        .flatMap((s) => [
          s.created_by,
          s.contract_signed_by,
          s.payment_issued_by,
          s.payment_confirmed_by,
        ])
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const names = new Map<string, string>();
  if (personIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", personIds);
    for (const p of people ?? []) names.set(p.id, p.full_name as string);
  }

  // Regra comercial por unidade (limita o fechamento).
  const { data: ruleRows } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent, max_installments, allowed_methods")
    .returns<CommercialRuleRow[]>();
  const ruleFor = (clinicId: string): CommercialRule =>
    resolveCommercialRule(ruleRows ?? [], clinicId);

  const sales: DirectSaleRow[] = rows.map((s) => {
    const clinicName =
      (Array.isArray(s.clinic) ? s.clinic[0] : s.clinic)?.name ?? null;
    const status = s.cancelled
      ? "cancelada"
      : directSaleStatusOf({
          contractSigned: s.contract_signed,
          paymentIssued: s.payment_issued,
          paymentConfirmed: s.payment_confirmed,
        });
    const canClose =
      session.isAdminMaster ||
      hasRoleInClinic(session, s.clinic_id, [...CLOSE_ROLES]);
    const isManager =
      session.isAdminMaster ||
      hasRoleInClinic(session, s.clinic_id, ["unit_manager"]);
    return {
      id: s.id,
      clinicId: s.clinic_id,
      clinicName,
      clientId: s.client_id,
      clientName: s.client_name,
      subtotalCents: s.subtotal_cents,
      discountCents: s.discount_cents,
      surchargeCents: s.surcharge_cents,
      finalCents: s.final_cents,
      installments: s.installments,
      paymentMethod: (s.payment_method as PaymentMethod | null) ?? null,
      contractSigned: s.contract_signed,
      paymentIssued: s.payment_issued,
      paymentConfirmed: s.payment_confirmed,
      cancelled: s.cancelled,
      status,
      attendanceDoneBefore: s.attendance_done_before,
      createdByName: s.created_by ? (names.get(s.created_by) ?? null) : null,
      createdAt: s.created_at,
      items: (s.items ?? []).map((i) => ({
        description: i.description,
        quantity: i.quantity,
        finalCents: i.final_cents,
      })),
      rule: ruleFor(s.clinic_id),
      canClose,
      isManager,
    };
  });

  // Exceções (atendeu antes de vender) para gestão corrigir o fluxo.
  const isManagement =
    session.isAdminMaster ||
    roles.some((r) => ["unit_manager", "franchisee", "franchisor_staff"].includes(r));

  const chipHref = (unidade: string | null) => {
    const p = new URLSearchParams();
    if (unidade) p.set("unidade", unidade);
    p.set("periodo", period);
    return `/comercial/venda-direta?${p.toString()}`;
  };
  const periodHref = (pd: Period) => {
    const p = new URLSearchParams();
    if (unidadeParam) p.set("unidade", unidadeParam);
    p.set("periodo", pd);
    return `/comercial/venda-direta?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Store className="size-6 text-gold" />
            Vendas diretas
          </h1>
          <p className="text-sm text-muted-foreground">
            Vendas feitas direto na clínica. O lançamento é no prontuário do
            cliente (botão &quot;Venda Direta&quot;); aqui a recepção/gerente
            define o pagamento e faz o fechamento.
          </p>
        </div>
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

      {/* Filtros: unidade + período. */}
      <div className="space-y-2 text-xs">
        {canSeeAllUnits && unitOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Unidade:</span>
            <Chip label="Todas" href={chipHref(null)} active={clinicFilter === null} />
            {unitOptions.map((u) => (
              <Chip
                key={u.id}
                label={u.name}
                href={chipHref(u.id)}
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

      <VendaDiretaClient sales={sales} showExceptions={isManagement} />
    </div>
  );
}

type SaleQueryRow = {
  id: string;
  clinic_id: string;
  client_id: string | null;
  client_name: string | null;
  subtotal_cents: number;
  discount_cents: number;
  surcharge_cents: number;
  final_cents: number;
  installments: number;
  payment_method: string | null;
  contract_signed: boolean;
  contract_signed_by: string | null;
  payment_issued: boolean;
  payment_issued_by: string | null;
  payment_confirmed: boolean;
  payment_confirmed_by: string | null;
  cancelled: boolean;
  status: string;
  attendance_done_before: boolean;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  clinic: { name: string } | { name: string }[] | null;
  items:
    | {
        id: string;
        description: string;
        quantity: number;
        unit_price_cents: number;
        program_discount_cents: number;
        final_cents: number;
      }[]
    | null;
};

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
