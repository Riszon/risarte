import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canConfigureFinanceNetwork,
  canPostFinance,
  canViewFinance,
} from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import type { ChecklistItem, MonthStatus } from "@/lib/finance/closing";
import { ClosingView } from "./closing-client";

export const metadata: Metadata = { title: "Fechamento" };

/**
 * FIN7.4 — fechamento de competência.
 *
 * Depois que alguém conferiu janeiro e disse "janeiro está fechado", o resultado
 * de janeiro não pode mudar sozinho na semana seguinte. A UNIDADE fecha (é ela
 * que sabe se terminou de lançar); a FRANQUEADORA reabre, com justificativa —
 * trava que quem está travado destrava sozinho vira lembrete, não controle.
 */
export default async function ClosingPage(
  props: PageProps<"/financeiro/fechamento">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const today = todayInBrazil();
  const year = Number(pick("ano") ?? today.slice(0, 4));
  // O mês em foco começa no ANTERIOR ao atual: é o que está pronto para fechar.
  const currentMonth = Number(today.slice(5, 7));
  const defaultMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const month = Number(pick("mes") ?? defaultMonth);

  const supabase = await createClient();
  const [{ data: monthRows }, { data: checkRows }] = await Promise.all([
    supabase.rpc("fiscal_year_status", {
      p_clinic_id: clinicId,
      p_year: year,
    }),
    supabase.rpc("fiscal_period_checklist", {
      p_clinic_id: clinicId,
      p_year: year,
      p_month: month,
    }),
  ]);

  const months: MonthStatus[] = (
    (monthRows ?? []) as {
      month: number;
      status: string;
      closed_at: string | null;
      closed_by_name: string | null;
      reopened_at: string | null;
      reopen_reason: string | null;
      entries: number;
    }[]
  ).map((m) => ({
    month: Number(m.month),
    status: m.status === "closed" ? "closed" : "open",
    closedAt: m.closed_at,
    closedByName: m.closed_by_name,
    reopenedAt: m.reopened_at,
    reopenReason: m.reopen_reason,
    entries: Number(m.entries ?? 0),
  }));

  const checklist: ChecklistItem[] = (
    (checkRows ?? []) as {
      key: string;
      label: string;
      items: number;
      amount_cents: number;
      severity: string;
    }[]
  ).map((c) => ({
    key: c.key,
    label: c.label,
    items: Number(c.items ?? 0),
    amountCents: Number(c.amount_cents ?? 0),
    severity: c.severity === "alta" ? "alta" : "media",
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Lock className="size-6 text-primary" />
          Fechamento — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Fechar um mês faz o sistema <strong>recusar lançamento novo de
          competência</strong> nele: depois de conferido, o resultado não muda
          mais sozinho. Pagamentos e recebimentos continuam livres — pagar hoje
          uma conta de janeiro não altera o resultado de janeiro.
        </p>
      </div>

      <ClosingView
        clinicId={clinicId}
        year={year}
        month={month}
        today={today}
        months={months}
        checklist={checklist}
        canClose={canPostFinance(session, clinicId)}
        canReopen={canConfigureFinanceNetwork(session)}
      />
    </div>
  );
}
