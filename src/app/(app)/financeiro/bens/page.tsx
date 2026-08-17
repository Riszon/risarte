import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canPostFinance, canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { AssetsManager } from "./assets-client";

export const metadata: Metadata = { title: "Bens e depreciação" };

/**
 * FIN6.0 — bens do imobilizado.
 *
 * Comprar um bem não é gastar: ele nasce como ATIVO (6.2.01) e só toca o
 * resultado pela depreciação mensal (5.2.01). É essa conta que faz a DRE dizer
 * a verdade sobre o mês — sem ela, uma cadeira de R$ 30 mil afundaria o mês da
 * compra e deixaria os dez anos seguintes bons demais.
 */
export default async function AssetsPage() {
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

  const [
    { data: assetRows },
    { data: categoryRows },
    { data: supplierRows },
    { data: depRows },
  ] = await Promise.all([
    supabase.rpc("assets_overview", { p_clinic_id: clinicId }),
    supabase
      .from("asset_categories")
      .select("id, clinic_id, name, default_useful_life_months")
      .eq("active", true)
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("name"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("asset_depreciations")
      .select("period_month, amount_cents")
      .eq("clinic_id", clinicId)
      .order("period_month", { ascending: false })
      .limit(400),
  ]);

  // Quanto de depreciação por mês — para o gestor ver o peso mensal fixo que
  // a DRE vai carregar.
  const byMonth = new Map<string, number>();
  for (const d of depRows ?? []) {
    const key = String(d.period_month).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(d.amount_cents ?? 0));
  }
  const months = [...byMonth.entries()]
    .map(([month, cents]) => ({ month, cents }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-primary" />
          Bens e depreciação
        </h1>
        <p className="text-sm text-muted-foreground">
          <strong>Comprar um bem não é gastar.</strong> Uma cadeira de R$ 30 mil
          não afunda o mês em que foi comprada: ela vira R$ 250 por mês durante
          dez anos, que é o que de fato custa usá-la. O bem entra como{" "}
          <strong>ativo</strong> e só toca o resultado pela depreciação — é isso
          que faz a DRE dizer a verdade sobre cada mês.
        </p>
      </div>

      <AssetsManager
        clinicId={clinicId}
        today={today}
        canEdit={canPostFinance(session, clinicId)}
        assets={(
          (assetRows ?? []) as {
            asset_id: string;
            code: string;
            name: string;
            category_name: string | null;
            in_service_date: string;
            cost_cents: number;
            monthly_cents: number;
            accumulated_cents: number;
            book_value_cents: number;
            months_done: number;
            useful_life_months: number;
            status: string;
            disposal_date: string | null;
          }[]
        ).map((a) => ({
          id: a.asset_id,
          code: a.code ?? "",
          name: a.name,
          categoryName: a.category_name ?? "",
          inServiceDate: a.in_service_date,
          costCents: Number(a.cost_cents ?? 0),
          monthlyCents: Number(a.monthly_cents ?? 0),
          accumulatedCents: Number(a.accumulated_cents ?? 0),
          bookValueCents: Number(a.book_value_cents ?? 0),
          monthsDone: Number(a.months_done ?? 0),
          usefulLifeMonths: Number(a.useful_life_months ?? 0),
          status: a.status,
          disposalDate: a.disposal_date ?? "",
        }))}
        categories={(categoryRows ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
          defaultMonths: Number(c.default_useful_life_months ?? 120),
          isNetwork: c.clinic_id === null,
        }))}
        suppliers={(supplierRows ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
        }))}
        depreciationByMonth={months}
      />
    </div>
  );
}
