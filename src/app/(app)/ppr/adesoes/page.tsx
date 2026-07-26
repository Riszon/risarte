import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, HeartPulse, Users } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPpr } from "@/lib/ppr/access";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Adesões do PPR+" };

const STATUS_TONE: Record<PprStatus, string> = {
  aguardando_ativacao: "border-amber-300 bg-amber-50 text-amber-800",
  ativo: "border-emerald-300 bg-emerald-50 text-emerald-800",
  suspenso: "border-rose-300 bg-rose-50 text-rose-800",
  cancelado: "border-border bg-muted text-muted-foreground",
};

export default async function PprMembershipsPage(
  props: PageProps<"/ppr/adesoes">
) {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");

  const sp = await props.searchParams;
  const statusParam = Array.isArray(sp.situacao) ? sp.situacao[0] : sp.situacao;
  const status =
    statusParam && statusParam in PPR_STATUS_LABELS
      ? (statusParam as PprStatus)
      : null;

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();
  let query = supabase
    .from("ppr_memberships")
    .select(
      "id, status, monthly_cents, created_at, activated_at, contract_signed, first_payment_confirmed, plan:ppr_plans ( name ), holder:clients!ppr_memberships_holder_client_id_fkey ( full_name, code ), clinic:clinics!ppr_memberships_clinic_id_fkey ( name ), beneficiaries:ppr_beneficiaries ( id, left_at )"
    )
    .order("created_at", { ascending: false });
  if (clinicId) query = query.eq("clinic_id", clinicId);
  if (status) query = query.eq("status", status);
  const { data: rows } = await query;

  type Row = {
    id: string;
    status: PprStatus;
    monthly_cents: number;
    created_at: string;
    activated_at: string | null;
    contract_signed: boolean;
    first_payment_confirmed: boolean;
    plan: { name: string } | { name: string }[] | null;
    holder:
      | { full_name: string; code: string | null }
      | { full_name: string; code: string | null }[]
      | null;
    clinic: { name: string } | { name: string }[] | null;
    beneficiaries: { id: string; left_at: string | null }[] | null;
  };
  const memberships = (rows ?? []) as Row[];
  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  const counts = {
    total: memberships.length,
    ativo: memberships.filter((m) => m.status === "ativo").length,
    aguardando: memberships.filter((m) => m.status === "aguardando_ativacao").length,
    suspenso: memberships.filter((m) => m.status === "suspenso").length,
  };
  const monthlyTotal = memberships
    .filter((m) => m.status === "ativo")
    .reduce((s, m) => s + m.monthly_cents, 0);

  const chip = (value: PprStatus | null, label: string) => {
    const p = new URLSearchParams();
    if (value) p.set("situacao", value);
    const href = `/ppr/adesoes${p.toString() ? `?${p.toString()}` : ""}`;
    return (
      <Link
        key={label}
        href={href}
        className={cn(
          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
          status === value
            ? "border-primary bg-primary/10 font-medium text-primary"
            : "hover:bg-muted"
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <HeartPulse className="size-3.5" />
            PPR+
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Adesões</h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic?.name ?? "Rede"} · {counts.ativo} ativo(s) ·{" "}
            {formatBRL(monthlyTotal)}/mês
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/ppr" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Sobre o programa
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chip(null, `Todas (${counts.total})`)}
        {chip("ativo", `Ativas (${counts.ativo})`)}
        {chip("aguardando_ativacao", `Aguardando ativação (${counts.aguardando})`)}
        {chip("suspenso", `Suspensas (${counts.suspenso})`)}
        {chip("cancelado", "Canceladas")}
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma adesão por aqui. Use o botão{" "}
            <strong>&quot;Oferecer PPR+&quot;</strong> no prontuário do cliente ou
            no cockpit do consultor.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => {
            const plan = one(m.plan);
            const holder = one(m.holder);
            const clinic = one(m.clinic);
            const active = (m.beneficiaries ?? []).filter((b) => !b.left_at).length;
            return (
              <li key={m.id}>
                <Link
                  href={`/ppr/adesoes/${m.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {holder?.full_name ?? "Cliente"}
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px]",
                          STATUS_TONE[m.status]
                        )}
                      >
                        {PPR_STATUS_LABELS[m.status]}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {plan?.name ?? "Plano"}
                      {holder?.code && <span className="font-mono">{holder.code}</span>}
                      {!session.activeClinic && clinic?.name && (
                        <span>{clinic.name}</span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <Users className="size-3" />
                        {active}
                      </span>
                      {m.status === "aguardando_ativacao" && (
                        <span className="text-amber-700">
                          {m.contract_signed ? "contrato ok" : "falta contrato"} ·{" "}
                          {m.first_payment_confirmed ? "pago" : "falta pagamento"}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                    {formatBRL(m.monthly_cents)}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      /mês
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
