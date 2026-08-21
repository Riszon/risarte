import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import {
  buildConsolidated,
  networkTotals,
  type ConsolidatedLine,
  type ConsolidationScope,
  type UnitSummary,
} from "@/lib/finance/consolidation";
import { ConsolidatedView } from "./consolidated-client";

export const metadata: Metadata = { title: "Consolidado" };

/** Primeiro e último dia do mês de uma data ISO. */
function monthRange(iso: string): { from: string; to: string } {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${iso.slice(0, 7)}-01`,
    to: `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`,
  };
}

/**
 * FIN8.2 — consolidação.
 *
 * Só a Franqueadora entra: gerente e franqueado continuam vendo a própria
 * unidade, e o consolidado mostra o número de todas.
 */
export default async function ConsolidatedPage(
  props: PageProps<"/financeiro/consolidado">
) {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) redirect("/financeiro/dre");

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const defaults = monthRange(todayInBrazil());
  const from = pick("de") ?? defaults.from;
  const to = pick("ate") ?? defaults.to;
  const scope: ConsolidationScope = pick("vista") === "rede" ? "rede" : "grupo";

  const supabase = await createClient();
  const [{ data: dreRows }, { data: unitRows }, { data: clinicRows }] =
    await Promise.all([
      supabase.rpc("consolidated_dre", {
        p_from: from,
        p_to: to,
        p_scope: scope,
      }),
      supabase.rpc("network_units_summary", { p_from: from, p_to: to }),
      supabase
        .from("clinics")
        .select("id, name, type, ownership")
        .eq("is_active", true)
        .order("name"),
    ]);

  const lines: ConsolidatedLine[] = (
    (dreRows ?? []) as {
      account_code: string;
      account_name: string;
      block: string;
      amount_cents: number;
      eliminated_cents: number;
    }[]
  ).map((r) => ({
    accountCode: r.account_code,
    accountName: r.account_name,
    block: r.block,
    amountCents: Number(r.amount_cents ?? 0),
    eliminatedCents: Number(r.eliminated_cents ?? 0),
  }));

  const units: UnitSummary[] = (
    (unitRows ?? []) as {
      clinic_id: string;
      clinic_name: string;
      ownership: string;
      gross_revenue_cents: number;
      net_revenue_cents: number;
      result_cents: number;
    }[]
  ).map((u) => ({
    clinicId: u.clinic_id,
    clinicName: u.clinic_name,
    ownership: u.ownership === "own" ? "own" : "franchised",
    grossRevenueCents: Number(u.gross_revenue_cents ?? 0),
    netRevenueCents: Number(u.net_revenue_cents ?? 0),
    resultCents: Number(u.result_cents ?? 0),
  }));

  const clinics = (
    (clinicRows ?? []) as {
      id: string;
      name: string;
      type: string;
      ownership: string;
    }[]
  )
    .filter((c) => c.type !== "franchisor")
    .map((c) => ({
      id: c.id,
      name: c.name,
      ownership: c.ownership === "own" ? ("own" as const) : ("franchised" as const),
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Building2 className="size-6 text-primary" />
          Consolidado
        </h1>
        <p className="text-sm text-muted-foreground">
          <strong>Resultado do Grupo</strong> é a franqueadora mais as unidades
          próprias — o resultado de quem é dono do negócio.{" "}
          <strong>Faturamento da Rede</strong> são todas as unidades lado a lado,
          só para comparar. Os dois não se somam: a franqueadora ganha o royalty
          da franqueada, não a receita da cadeira dela.
        </p>
      </div>

      <ConsolidatedView
        from={from}
        to={to}
        scope={scope}
        consolidated={buildConsolidated(lines)}
        units={units}
        totals={networkTotals(units)}
        clinics={clinics}
      />
    </div>
  );
}
