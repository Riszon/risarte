import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageOrtho, canSettleOrtho, canViewOrtho, canViewOrthoDashboard } from "@/lib/ortodontia/access";
import { resolveOrthoScope } from "@/lib/ortodontia/escopo";
import { loadCases, loadChargesByClinic } from "@/lib/ortodontia/db";
import { chargeStatusToday } from "@/lib/ortodontia/regras";
import {
  ORTHO_CHARGE_STATUS_LABELS,
  ORTHO_CHARGE_STATUSES,
  ORTHO_PAYMENT_METHOD_LABELS,
  type OrthoChargeStatus,
  type OrthoPaymentMethod,
} from "@/lib/ortodontia/constants";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr, formatIsoMonthBr, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { OrthoBillingToolbar, OrthoChargeRow } from "./billing-client";

export const metadata: Metadata = { title: "Ortodontia — Mensalidades" };

const CHARGE_TONE: Record<OrthoChargeStatus, string> = {
  em_aberto: "border-amber-300 bg-amber-50 text-amber-800",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  atrasada: "border-rose-300 bg-rose-50 text-rose-800",
  cancelada: "border-border bg-muted text-muted-foreground",
};

/**
 * As mensalidades da ortodontia: gerar o mês, dar baixa, marcar as atrasadas.
 * Só quem tem `acao.ortodontia.financeiro` (decisão O2: a Recepção também).
 */
export default async function OrtoMensalidadesPage(props: PageProps<"/ortodontia/mensalidades">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  const sp = await props.searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const scope = resolveOrthoScope(session, pick("unidade"));
  if (!canSettleOrtho(session, scope.clinicId)) redirect("/ortodontia/atencao");

  const situacao = pick("situacao");
  const status = (ORTHO_CHARGE_STATUSES as readonly string[]).includes(situacao ?? "") ? (situacao as OrthoChargeStatus) : null;
  const today = todayInBrazil();
  const canManage = canManageOrtho(session, scope.clinicId);

  const supabase = await createClient();
  const [chargesRead, casesRead] = await Promise.all([
    loadChargesByClinic(supabase, scope.clinicIds, status),
    loadCases(supabase, { clinicIds: scope.clinicIds }),
  ]);
  const charges = chargesRead.ok ? chargesRead.linhas : [];
  const caseById = new Map((casesRead.ok ? casesRead.linhas : []).map((c) => [c.id, c]));

  const abertas = charges.filter((c) => chargeStatusToday(c, today) === "em_aberto");
  const atrasadas = charges.filter((c) => chargeStatusToday(c, today) === "atrasada");
  const pagasMes = charges.filter((c) => c.status === "paga" && c.paid_at && c.paid_at.slice(0, 7) === today.slice(0, 7));
  const soma = (xs: typeof charges) => xs.reduce((s, c) => s + c.amount_cents, 0);

  const unitOptions = scope.canSeeNetwork
    ? session.clinics.filter((c) => c.type === "franchise_unit").map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={Wallet}
        titulo="Mensalidades"
        descricao="A mensalidade do tratamento ortodôntico é devida mesmo sem comparecer à manutenção. Cada uma entra na DRE em “Ortodontia — mensalidades” (1.1.04)."
        voltar={canViewOrthoDashboard(session) ? { href: "/ortodontia", rotulo: "Painel" } : { href: "/ortodontia/atencao", rotulo: "Atenção" }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Recebido este mês</p><p className="text-2xl font-semibold tabular-nums">{formatBRL(soma(pagasMes))}</p><p className="text-[11px] text-muted-foreground">{pagasMes.length} mensalidade{pagasMes.length === 1 ? "" : "s"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em aberto (a vencer)</p><p className="text-2xl font-semibold tabular-nums">{formatBRL(soma(abertas))}</p><p className="text-[11px] text-muted-foreground">{abertas.length}</p></CardContent></Card>
        <Card className={atrasadas.length ? "border-rose-300" : undefined}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Atrasadas</p><p className="text-2xl font-semibold tabular-nums">{formatBRL(soma(atrasadas))}</p><p className="text-[11px] text-muted-foreground">{atrasadas.length}</p></CardContent></Card>
      </div>

      {scope.clinicId ? (
        <OrthoBillingToolbar clinicId={scope.clinicId} canManage={canManage} />
      ) : (
        <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          Escolha uma unidade no filtro para gerar as mensalidades do mês.
        </p>
      )}

      <FilterForm className="flex flex-wrap items-center gap-2 text-sm">
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
          {ORTHO_CHARGE_STATUSES.map((s) => (
            <option key={s} value={s}>{ORTHO_CHARGE_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </FilterForm>

      {!chargesRead.ok && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Não foi possível ler as mensalidades agora.</p>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">Competência</th>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {charges.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nenhuma mensalidade{status ? ` em "${ORTHO_CHARGE_STATUS_LABELS[status]}"` : ""}. Gere o mês acima.</td></tr>
              )}
              {charges.map((ch) => {
                const c = caseById.get(ch.case_id);
                const s = chargeStatusToday(ch, today);
                return (
                  <tr key={ch.id} className="border-b align-middle">
                    <td className="px-3 py-2">
                      {c ? <Link href={`/ortodontia/casos/${c.id}`} className="font-medium hover:underline">{c.client?.full_name ?? "—"}</Link> : "—"}
                      {scope.clinicIds === null && c?.clinic && <span className="block text-[11px] text-muted-foreground">{c.clinic.name}</span>}
                    </td>
                    <td className="px-3 py-2">{formatIsoMonthBr(ch.reference_month)}</td>
                    <td className="px-3 py-2">{formatIsoDateBr(ch.due_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(ch.amount_cents)}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", CHARGE_TONE[s])}>{ORTHO_CHARGE_STATUS_LABELS[s]}</span>
                      {ch.status === "paga" && ch.payment_method && (
                        <span className="ml-1 text-[11px] text-muted-foreground">{ORTHO_PAYMENT_METHOD_LABELS[ch.payment_method as OrthoPaymentMethod] ?? ch.payment_method}</span>
                      )}
                      {ch.status === "paga" && ch.paid_at && <span className="ml-1 text-[11px] text-muted-foreground">em {formatIsoDateBr(ch.paid_at.slice(0, 10))}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {ch.status !== "cancelada" && <OrthoChargeRow chargeId={ch.id} paid={ch.status === "paga"} canCancel={canManage} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
