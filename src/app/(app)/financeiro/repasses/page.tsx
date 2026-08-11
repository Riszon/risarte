import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canPostFinance, canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { PayoutManager } from "./payout-manager";

export default async function PayoutsPage(
  props: PageProps<"/financeiro/repasses">
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

  const supabase = await createClient();
  const today = todayInBrazil();

  // Mês de competência (padrão: o atual).
  const mesParam = (await props.searchParams).mes;
  const mes = Array.isArray(mesParam) ? mesParam[0] : mesParam;
  const month = mes ?? today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextStart = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

  const [
    { data: levelRows },
    { data: rateRows },
    { data: payoutRows },
    { data: closingRow },
    { data: procedureRows },
  ] = await Promise.all([
    supabase
      .from("career_levels")
      .select("id, clinic_id, name, sort_order, active, description, req_months_min, req_monthly_production_cents, req_results, req_education, req_other")
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("sort_order"),
    supabase
      .from("provider_payout_rates")
      .select(
        "id, clinic_id, procedure_id, level_id, provider_id, amount_cents, valid_from, valid_to"
      )
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("valid_from", { ascending: false }),
    supabase
      .from("provider_payouts")
      .select(
        "id, provider_id, procedure_name, accrual_date, amount_cents, closing_id"
      )
      .eq("clinic_id", clinicId)
      .gte("accrual_date", monthStart)
      .lt("accrual_date", nextStart)
      .order("accrual_date"),
    supabase
      .from("payout_closings")
      .select("id, period_month, bonus_percent, fixed_cents, bonus_cents, total_cents, status, closed_at")
      .eq("clinic_id", clinicId)
      .eq("period_month", monthStart)
      .maybeSingle(),
    supabase
      .from("procedures")
      .select("id, name")
      // A coluna é `is_active` (0036), não `active` — o mesmo engano derrubou
      // a 0210 no SQL Editor.
      .eq("is_active", true)
      .order("name")
      .limit(500),
  ]);

  // 0212 — o comparativo procedimento × nível. Usa a MESMA função dos quatro
  // degraus que a apuração usa; se mostrasse outra conta, o quadro mentiria.
  const { data: matrixRows } = await supabase.rpc("payout_matrix", {
    p_clinic_id: clinicId,
    p_date: null,
  });
  const matrix: Record<
    string,
    Record<string, { amountCents: number; source: string }>
  > = {};
  for (const r of (matrixRows ?? []) as {
    procedure_id: string;
    level_id: string;
    amount_cents: number;
    source: string;
  }[]) {
    (matrix[r.procedure_id] ??= {})[r.level_id] = {
      amountCents: Number(r.amount_cents ?? 0),
      source: r.source,
    };
  }

  // Dentistas da unidade + o nível de carreira de cada um.
  const { data: staffRows } = await supabase
    .from("user_clinic_roles")
    .select(
      "user_id, career_level_id, role, profiles!user_clinic_roles_user_id_fkey ( full_name )"
    )
    .eq("clinic_id", clinicId)
    .in("role", ["dentist", "clinical_coordinator", "planner_dentist"]);

  const providers = (staffRows ?? []).map((s) => {
    const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    return {
      id: s.user_id as string,
      name: (p?.full_name as string) ?? "—",
      levelId: (s.career_level_id as string | null) ?? null,
    };
  });
  const nameById = new Map(providers.map((p) => [p.id, p.name]));

  const lines = (payoutRows ?? []).map((r) => ({
    id: r.id as string,
    providerId: r.provider_id as string,
    providerName: nameById.get(r.provider_id as string) ?? "—",
    procedureName: (r.procedure_name as string) ?? "—",
    accrualDate: r.accrual_date as string,
    amountCents: Number(r.amount_cents ?? 0),
    closed: r.closing_id !== null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <HandCoins className="size-6 text-primary" />
          Repasses aos dentistas
        </h1>
        <p className="text-sm text-muted-foreground">
          O repasse é <strong>valor fixo por procedimento</strong>, definido por
          nível do plano de carreira. Como é fixo, desconto dado na negociação{" "}
          <strong>não reduz o repasse</strong> — ele sai inteiro da margem da
          clínica. A apuração nasce quando o procedimento é concluído e usa a
          tabela vigente <strong>naquela data</strong>: reajustar depois não
          reescreve o que já foi produzido.
        </p>
      </div>

      <PayoutManager
        clinicId={clinicId}
        month={month}
        today={today}
        canEdit={canPostFinance(session, clinicId)}
        levels={(levelRows ?? []).map((l) => ({
          id: l.id as string,
          clinicId: (l.clinic_id as string | null) ?? null,
          name: l.name as string,
          sortOrder: Number(l.sort_order ?? 0),
          active: Boolean(l.active),
          description: (l.description as string | null) ?? "",
          reqMonthsMin: (l.req_months_min as number | null) ?? null,
          reqMonthlyProductionCents:
            (l.req_monthly_production_cents as number | null) ?? null,
          reqResults: (l.req_results as string | null) ?? "",
          reqEducation: (l.req_education as string | null) ?? "",
          reqOther: (l.req_other as string | null) ?? "",
        }))}
        rates={(rateRows ?? []).map((r) => ({
          id: r.id as string,
          procedureId: r.procedure_id as string,
          levelId: (r.level_id as string | null) ?? null,
          providerId: (r.provider_id as string | null) ?? null,
          amountCents: Number(r.amount_cents),
          validFrom: r.valid_from as string,
          validTo: (r.valid_to as string | null) ?? null,
        }))}
        procedures={(procedureRows ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
        }))}
        providers={providers}
        lines={lines}
        matrix={matrix}
        closing={
          closingRow
            ? {
                bonusPercent: Number(closingRow.bonus_percent ?? 0),
                fixedCents: Number(closingRow.fixed_cents ?? 0),
                bonusCents: Number(closingRow.bonus_cents ?? 0),
                totalCents: Number(closingRow.total_cents ?? 0),
                status: closingRow.status as string,
              }
            : null
        }
      />
    </div>
  );
}
