import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CreditCard,
  FileSignature,
  HeartPulse,
  History,
  Printer,
  User,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPpr } from "@/lib/ppr/access";
import {
  PPR_RECURRING_METHOD_LABELS,
  PPR_STATUS_LABELS,
  type PprRecurringMethod,
  type PprStatus,
} from "@/lib/ppr/constants";
import { canManagePpr, canSellPpr } from "@/lib/ppr/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  PprBeneficiaryClinicSelect,
  PprMembershipActions,
} from "./membership-actions";

export const metadata: Metadata = { title: "Adesão do PPR+" };

const STATUS_TONE: Record<PprStatus, string> = {
  aguardando_ativacao: "border-amber-300 bg-amber-50 text-amber-800",
  ativo: "border-emerald-300 bg-emerald-50 text-emerald-800",
  suspenso: "border-rose-300 bg-rose-50 text-rose-800",
  cancelado: "border-border bg-muted text-muted-foreground",
};

export default async function PprMembershipPage(
  props: PageProps<"/ppr/adesoes/[id]">
) {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");
  const { id } = await props.params;

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ppr_memberships")
    .select(
      "id, clinic_id, status, monthly_cents, extra_dependents, payment_method, billing_day, contract_signed, contract_signed_at, first_payment_confirmed, first_payment_at, activated_at, cancelled_at, cancel_reason, sale_origin, created_at, notes, plan:ppr_plans ( id, name, description, allows_dependents, included_dependents, allows_extra_dependents, extra_dependent_cents, max_dependents ), clinic:clinics!ppr_memberships_clinic_id_fkey ( name ), seller:profiles!ppr_memberships_sold_by_fkey ( full_name )"
    )
    .eq("id", id)
    .maybeSingle();
  if (!m) notFound();

  const [{ data: benRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("ppr_beneficiaries")
      .select(
        "id, role, relationship, card_code, is_extra, left_at, clinic_id, client:clients!ppr_beneficiaries_client_id_fkey ( id, full_name, code, birth_date ), clinic:clinics!ppr_beneficiaries_clinic_id_fkey ( name )"
      )
      .eq("membership_id", id)
      .order("role"),
    supabase
      .from("ppr_events")
      .select(
        "id, event_type, description, created_at, author:profiles!ppr_events_created_by_fkey ( full_name )"
      )
      .eq("membership_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  type PlanEmbed = {
    id: string;
    name: string;
    description: string | null;
    allows_dependents: boolean;
    included_dependents: number;
    allows_extra_dependents: boolean;
    extra_dependent_cents: number;
    max_dependents: number | null;
  };
  const plan = one(m.plan as unknown as PlanEmbed | PlanEmbed[] | null);
  const clinic = one(
    m.clinic as unknown as { name: string } | { name: string }[] | null
  );
  const seller = one(
    m.seller as unknown as { full_name: string } | { full_name: string }[] | null
  );
  const status = m.status as PprStatus;

  type ClientEmbed = {
    id: string;
    full_name: string;
    code: string | null;
    birth_date: string | null;
  };
  type BenRow = {
    id: string;
    role: string;
    relationship: string | null;
    card_code: string | null;
    is_extra: boolean;
    left_at: string | null;
    clinic_id: string;
    client: ClientEmbed | ClientEmbed[] | null;
    clinic: { name: string } | { name: string }[] | null;
  };
  const beneficiaries = (benRows ?? []) as unknown as BenRow[];

  // Unidades da rede — o dependente pode pertencer a outra unidade (PPR5).
  const { data: unitRows } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");
  const units = (unitRows ?? []) as { id: string; name: string }[];
  const holder = beneficiaries.find((b) => b.role === "titular");
  const dependents = beneficiaries.filter(
    (b) => b.role === "dependente" && !b.left_at
  );
  const formerDependents = beneficiaries.filter(
    (b) => b.role === "dependente" && b.left_at
  );

  const roles = session.rolesByClinic[m.clinic_id as string] ?? [];
  const canEdit =
    session.isAdminMaster ||
    canSellPpr(roles, "venda_direta") ||
    canSellPpr(roles, "comercial") ||
    canManagePpr(roles);
  const canManage = canManagePpr(roles, session.isAdminMaster);

  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR") : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      {/* Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <HeartPulse className="size-3.5" />
            PPR+ · adesão
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {one(holder?.client)?.full_name ?? "Cliente"}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-normal",
                STATUS_TONE[status]
              )}
            >
              {PPR_STATUS_LABELS[status]}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {plan?.name} · {formatBRL(m.monthly_cents as number)}/mês ·{" "}
            {clinic?.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/ppr/adesoes/${id}/contrato`} target="_blank" />}
          >
            <Printer className="mr-1 size-3.5" />
            Contrato de adesão
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/ppr/adesoes" />}
          >
            <ArrowLeft className="mr-1 size-3.5" />
            Adesões
          </Button>
        </div>
      </div>

      {/* Regra de ouro ---------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Ativação do plano</CardTitle>
          <p className="text-sm text-muted-foreground">
            O plano só fica ativo com <strong>contrato assinado</strong> e{" "}
            <strong>primeira mensalidade confirmada</strong>. A carência começa a
            contar da ativação.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <StepBox
              icon={<FileSignature className="size-4" />}
              label="Contrato de adesão"
              done={m.contract_signed as boolean}
              at={day(m.contract_signed_at as string | null)}
            />
            <StepBox
              icon={<CreditCard className="size-4" />}
              label="1ª mensalidade"
              done={m.first_payment_confirmed as boolean}
              at={day(m.first_payment_at as string | null)}
            />
          </div>

          <PprMembershipActions
            membershipId={id}
            status={status}
            contractSigned={m.contract_signed as boolean}
            paymentConfirmed={m.first_payment_confirmed as boolean}
            canEdit={canEdit}
            canManage={canManage}
            allowsDependents={plan?.allows_dependents ?? false}
            dependentCount={dependents.length}
            maxDependents={
              plan?.allows_dependents
                ? plan.allows_extra_dependents
                  ? plan.max_dependents
                  : plan.included_dependents
                : 0
            }
            units={units}
            clinicId={m.clinic_id as string}
          />

          <dl className="grid gap-x-6 gap-y-1 border-t pt-3 text-xs sm:grid-cols-2">
            <Info label="Pagamento">
              {m.payment_method
                ? PPR_RECURRING_METHOD_LABELS[
                    m.payment_method as PprRecurringMethod
                  ]
                : "—"}
              {m.billing_day ? ` · dia ${m.billing_day}` : ""}
            </Info>
            <Info label="Vendido por">
              {seller?.full_name ?? "—"} ·{" "}
              {m.sale_origin === "comercial" ? "fluxo comercial" : "venda direta"}
            </Info>
            <Info label="Adesão em">{day(m.created_at as string)}</Info>
            <Info label="Ativado em">
              {day(m.activated_at as string | null) ?? "—"}
            </Info>
            {m.cancelled_at && (
              <Info label="Cancelado em">
                {day(m.cancelled_at as string)} — {m.cancel_reason as string}
              </Info>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Beneficiários ---------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Beneficiários</CardTitle>
          <p className="text-sm text-muted-foreground">
            Titular e dependentes — cada um com prontuário próprio.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...(holder ? [holder] : []), ...dependents].map((b) => {
            const c = one(b.client);
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <User className="size-3.5 text-muted-foreground" />
                    {c?.full_name ?? "Cliente"}
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {b.role === "titular" ? "titular" : (b.relationship ?? "dependente")}
                    </span>
                    {b.is_extra && (
                      <span className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold-foreground">
                        extra
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {c?.code && <span className="font-mono">{c.code}</span>}
                    {b.card_code && <span>Cartão {b.card_code}</span>}
                    <span>
                      Unidade: {one(b.clinic)?.name ?? "—"}
                    </span>
                  </p>
                  {b.role === "dependente" && canEdit && (
                    <div className="mt-1.5">
                      <PprBeneficiaryClinicSelect
                        beneficiaryId={b.id}
                        clinicId={b.clinic_id}
                        units={units}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link href={`/ppr/cartao/${b.id}`} target="_blank" />
                    }
                  >
                    <CreditCard className="mr-1 size-3.5" />
                    Cartão
                  </Button>
                  {c?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/prontuarios/${c.id}`} />}
                    >
                      Prontuário
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {formerDependents.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Saíram do plano:{" "}
              {formerDependents
                .map((b) => one(b.client)?.full_name ?? "—")
                .join(", ")}
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* Histórico -------------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <History className="size-4" />
            Histórico do plano
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {(eventRows ?? []).map((e) => {
              const author = one(
                e.author as unknown as
                  | { full_name: string }
                  | { full_name: string }[]
                  | null
              );
              return (
                <li key={e.id as string} className="flex flex-wrap gap-x-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {new Date(e.created_at as string).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  <span>{e.description as string}</span>
                  {author && (
                    <span className="text-xs text-muted-foreground">
                      — {author.full_name}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function StepBox({
  icon,
  label,
  done,
  at,
}: {
  icon: React.ReactNode;
  label: string;
  done: boolean;
  at: string | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border p-3",
        done ? "border-emerald-300 bg-emerald-50/50" : "border-dashed"
      )}
    >
      <span
        className={cn(
          "grid size-8 place-items-center rounded-lg",
          done ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {done ? `Confirmado${at ? ` em ${at}` : ""}` : "Pendente"}
        </p>
      </div>
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd>{children}</dd>
    </div>
  );
}
