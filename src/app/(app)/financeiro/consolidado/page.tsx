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
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";

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
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <CabecalhoDeModulo
        chapeu="Rede Risarte"
        icone={Building2}
        titulo="Consolidado"
        descricao="O resultado de quem é dono do negócio, e o faturamento da rede inteira lado a lado."
      />

      {/* ⚠️ ESTA EXPLICAÇÃO NÃO É DECORAÇÃO, E POR ISSO SAIU DE BAIXO DO TÍTULO.
          Ela era um parágrafo corrido de cinco linhas em letra cinza — o formato
          que ninguém lê. Mas o que ela diz é a regra que impede o erro mais caro
          desta tela: somar os dois números. Em duas colunas, com o nome de cada
          visão em destaque, ela vira consulta rápida em vez de muralha. */}
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Resultado do Grupo
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A franqueadora mais as unidades <strong>próprias</strong> — o
            resultado de quem é dono do negócio.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Faturamento da Rede
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Todas as unidades lado a lado, <strong>só para comparar</strong>.
          </p>
        </div>
        <p className="border-t pt-3 text-sm text-muted-foreground sm:col-span-2">
          <strong className="text-foreground">Os dois não se somam.</strong> A
          franqueadora ganha o royalty da franqueada, não a receita da cadeira
          dela.
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
