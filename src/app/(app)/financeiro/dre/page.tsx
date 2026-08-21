import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { buildDre, previousPeriod, type DreLine } from "@/lib/finance/dre";
import { DreView } from "./dre-client";

export const metadata: Metadata = { title: "DRE" };

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
 * FIN6.1 — a DRE.
 *
 * Competência (decisão do dono): liquidado + em aberto. A venda de março
 * aparece em março mesmo que o cliente pague em junho — é o que separa esta
 * tela do fluxo de caixa, que vem na 6.2.
 */
export default async function DrePage(props: PageProps<"/financeiro/dre">) {
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
  const defaults = monthRange(today);
  const from = pick("de") ?? defaults.from;
  const to = pick("ate") ?? defaults.to;
  const costCenterId = pick("centro") ?? "";

  const previous = previousPeriod(from, to);
  const supabase = await createClient();

  const [
    { data: currentRows },
    { data: previousRows },
    { data: centerRows },
    { data: closedData },
  ] = await Promise.all([
      supabase.rpc("dre_lines", {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
        p_cost_center_id: costCenterId || null,
      }),
      supabase.rpc("dre_lines", {
        p_clinic_id: clinicId,
        p_from: previous.from,
        p_to: previous.to,
        p_cost_center_id: costCenterId || null,
      }),
      supabase
        .from("cost_centers")
        .select("id, name, clinic_id")
        .eq("active", true)
        .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
        .order("code"),
      // FIN7.4: o mês do INÍCIO do período. Se ele está fechado, estes números
      // não mudam mais — e vale dizer isso na tela.
      supabase.rpc("is_period_closed", {
        p_clinic_id: clinicId,
        p_date: from,
      }),
    ]);

  const toLines = (rows: unknown): DreLine[] =>
    (
      (rows ?? []) as {
        account_code: string;
        account_name: string;
        block: string;
        amount_cents: number;
      }[]
    ).map((r) => ({
      accountCode: r.account_code,
      accountName: r.account_name,
      block: r.block,
      amountCents: Number(r.amount_cents ?? 0),
    }));

  const dre = buildDre(toLines(currentRows));
  const dreBefore = buildDre(toLines(previousRows));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 className="size-6 text-primary" />
          DRE — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          O resultado por <strong>competência</strong>: cada valor aparece no mês
          em que o fato aconteceu, não no mês em que o dinheiro entrou. A venda
          de março aparece em março mesmo que o cliente pague em junho — por isso
          esta tela responde <em>&quot;o mês deu lucro?&quot;</em>, e o fluxo de
          caixa responde <em>&quot;tenho dinheiro?&quot;</em>. São perguntas
          diferentes.
        </p>
      </div>

      <DreView
        from={from}
        to={to}
        previousFrom={previous.from}
        previousTo={previous.to}
        costCenterId={costCenterId}
        costCenters={(centerRows ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        dre={dre}
        previousDre={dreBefore}
        clinicId={clinicId}
        periodClosed={closedData === true}
      />
    </div>
  );
}
