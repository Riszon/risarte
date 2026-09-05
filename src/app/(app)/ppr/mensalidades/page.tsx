import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, HeartPulse, Wallet } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPpr } from "@/lib/ppr/access";
import { canManagePpr, canSellPpr } from "@/lib/ppr/rules";
import {
  PPR_CHARGE_STATUS_LABELS,
  type PprChargeStatus,
} from "@/lib/ppr/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { PprBillingToolbar, PprChargeRow } from "./billing-client";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

export const metadata: Metadata = { title: "Mensalidades do PPR+" };

const TONE: Record<PprChargeStatus, string> = {
  em_aberto: "border-amber-300 bg-amber-50 text-amber-800",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  atrasada: "border-rose-300 bg-rose-50 text-rose-800",
  cancelada: "border-border bg-muted text-muted-foreground",
};

/** Mensalidades do programa: gerar, dar baixa e acompanhar a inadimplência. */
export default async function PprChargesPage(
  props: PageProps<"/ppr/mensalidades">
) {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");
  const clinicId = session.activeClinic?.id ?? null;
  const roles = clinicId ? (session.rolesByClinic[clinicId] ?? []) : [];
  const canSettle =
    session.isAdminMaster ||
    canManagePpr(roles) ||
    canSellPpr(roles, "venda_direta");
  const canManage = canManagePpr(roles, session.isAdminMaster);

  const sp = await props.searchParams;
  const statusParam = Array.isArray(sp.situacao) ? sp.situacao[0] : sp.situacao;
  const status =
    statusParam && statusParam in PPR_CHARGE_STATUS_LABELS
      ? (statusParam as PprChargeStatus)
      : null;

  const supabase = await createClient();
  let query = supabase
    .from("ppr_charges")
    .select(
      "id, reference_month, due_date, amount_cents, status, paid_at, membership:ppr_memberships ( id, status, plan:ppr_plans ( name ), holder:clients!ppr_memberships_holder_client_id_fkey ( id, full_name, code ) )"
    )
    .order("due_date", { ascending: false })
    .limit(300);
  if (clinicId) query = query.eq("clinic_id", clinicId);
  if (status) query = query.eq("status", status);
  const { data: rows, error } = await query;
  if (error) console.error("PprChargesPage failed:", error.message);

  type Row = {
    id: string;
    reference_month: string;
    due_date: string;
    amount_cents: number;
    status: PprChargeStatus;
    paid_at: string | null;
    membership:
      | {
          id: string;
          plan: { name: string } | { name: string }[] | null;
          holder:
            | { id: string; full_name: string; code: string | null }
            | { id: string; full_name: string; code: string | null }[]
            | null;
        }
      | {
          id: string;
          plan: { name: string } | { name: string }[] | null;
          holder:
            | { id: string; full_name: string; code: string | null }
            | { id: string; full_name: string; code: string | null }[]
            | null;
        }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const charges = (rows ?? []) as unknown as Row[];

  const totals = {
    aberto: charges
      .filter((c) => c.status === "em_aberto")
      .reduce((s, c) => s + c.amount_cents, 0),
    atrasado: charges
      .filter((c) => c.status === "atrasada")
      .reduce((s, c) => s + c.amount_cents, 0),
    pago: charges
      .filter((c) => c.status === "paga")
      .reduce((s, c) => s + c.amount_cents, 0),
  };

  const chip = (value: PprChargeStatus | null, label: string) => {
    const p = new URLSearchParams();
    if (value) p.set("situacao", value);
    return (
      <Link
        key={label}
        href={`/ppr/mensalidades${p.toString() ? `?${p.toString()}` : ""}`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Mensalidades</h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic?.name ?? "Rede"} · em aberto{" "}
            {formatBRL(totals.aberto)} · atrasado{" "}
            <strong className="text-rose-700">{formatBRL(totals.atrasado)}</strong>{" "}
            · recebido {formatBRL(totals.pago)}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/ppr" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Programa
        </Button>
      </div>

      {clinicId && (
        <PprBillingToolbar clinicId={clinicId} canManage={canManage} />
      )}

      <div className="flex flex-wrap gap-1.5">
        {chip(null, `Todas (${charges.length})`)}
        {chip("em_aberto", "Em aberto")}
        {chip("atrasada", "Atrasadas")}
        {chip("paga", "Pagas")}
      </div>

      {charges.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma mensalidade por aqui. Use{" "}
            <strong>&quot;Gerar mensalidades do mês&quot;</strong> para criar as
            cobranças das adesões ativas.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {charges.map((c) => {
            const m = one(c.membership);
            const plan = one(m?.plan ?? null);
            const holder = one(m?.holder ?? null);
            const late =
              c.status !== "paga" &&
              new Date(`${c.due_date}T00:00:00`) < new Date();
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {holder?.id ? (
                      <Link
                        href={`/prontuarios/${holder.id}`}
                        className="hover:underline"
                      >
                        {holder.full_name}
                      </Link>
                    ) : (
                      "Cliente"
                    )}
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[10px]",
                        TONE[c.status]
                      )}
                    >
                      {PPR_CHARGE_STATUS_LABELS[c.status]}
                    </span>
                    {late && c.status !== "atrasada" && (
                      <span className="rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-800">
                        vencida
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {plan?.name ?? "PPR+"}
                    {holder?.code && <span className="font-mono">{holder.code}</span>}
                    <span>
                      competência{" "}
                      {new Date(`${c.reference_month}T00:00:00`).toLocaleDateString(
                        "pt-BR",
                        { timeZone: BRAZIL_TIME_ZONE, month: "2-digit", year: "numeric" }
                      )}
                    </span>
                    <span>
                      vence{" "}
                      {new Date(`${c.due_date}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}
                    </span>
                    {c.paid_at && (
                      <span className="text-emerald-700">
                        pago em {new Date(c.paid_at).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatBRL(c.amount_cents)}
                  </span>
                  {canSettle && (
                    <PprChargeRow chargeId={c.id} paid={c.status === "paga"} />
                  )}
                  {m?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/ppr/adesoes/${m.id}`} />}
                    >
                      <Wallet className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
