import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import {
  breakevenDay,
  buildBreakeven,
  daysInPeriod,
  type BreakevenLine,
} from "@/lib/finance/breakeven";
import { buildBridge, type BridgeRow } from "@/lib/finance/bridge";
import { BreakevenView } from "./breakeven-client";

export const metadata: Metadata = { title: "Ponto de equilíbrio" };

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
 * FIN6.3 — ponto de equilíbrio e a ponte lucro × caixa.
 *
 * Duas perguntas que fecham o Financeiro: "quanto preciso faturar para não dar
 * prejuízo?" e "deu lucro, então por que o caixa caiu?". A segunda é a que
 * reconcilia as duas telas anteriores — e por isso mora ao lado da primeira.
 */
export default async function BreakevenPage(
  props: PageProps<"/financeiro/ponto-de-equilibrio">
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

  const defaults = monthRange(todayInBrazil());
  const from = pick("de") ?? defaults.from;
  const to = pick("ate") ?? defaults.to;
  const costCenterId = pick("centro") ?? "";

  const supabase = await createClient();
  const [{ data: lineRows }, { data: bridgeRows }, { data: centerRows }] =
    await Promise.all([
      supabase.rpc("breakeven_lines", {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
        p_cost_center_id: costCenterId || null,
      }),
      supabase.rpc("profit_cash_bridge", {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
      }),
      supabase
        .from("cost_centers")
        .select("id, name, clinic_id")
        .eq("active", true)
        .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
        .order("code"),
    ]);

  const lines: BreakevenLine[] = (
    (lineRows ?? []) as {
      account_code: string;
      account_name: string;
      role: string;
      amount_cents: number;
    }[]
  ).map((r) => ({
    accountCode: r.account_code,
    accountName: r.account_name,
    role: r.role as BreakevenLine["role"],
    amountCents: Number(r.amount_cents ?? 0),
  }));

  const bridge = buildBridge(
    (
      (bridgeRows ?? []) as {
        side: string;
        account_code: string | null;
        account_name: string | null;
        source_type: string | null;
        amount_cents: number;
      }[]
    ).map<BridgeRow>((r) => ({
      side: r.side as BridgeRow["side"],
      accountCode: r.account_code ?? "",
      accountName: r.account_name ?? "",
      sourceType: r.source_type ?? "",
      amountCents: Number(r.amount_cents ?? 0),
    }))
  );

  const breakeven = buildBreakeven(lines);
  const days = daysInPeriod(from, to);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Target className="size-6 text-primary" />
          Ponto de equilíbrio — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Quanto a unidade precisa faturar para <strong>não dar prejuízo</strong>{" "}
          — e, logo abaixo, por que o lucro do mês não é o mesmo que o dinheiro
          que sobrou. A conta depende de separar custo que acompanha o
          faturamento de custo que existe com a cadeira vazia; essa separação
          fica no <strong>Plano de contas</strong>, e é sua para corrigir.
        </p>
      </div>

      <BreakevenView
        from={from}
        to={to}
        days={days}
        costCenterId={costCenterId}
        costCenters={(centerRows ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        breakeven={breakeven}
        turnDay={breakevenDay({
          receitaLiquidaCents: breakeven.receitaLiquidaCents,
          pontoEquilibrioCents: breakeven.pontoEquilibrioCents,
          days,
        })}
        bridge={bridge}
      />
    </div>
  );
}
