import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";
import { sortAccounts, type ChartAccount } from "@/lib/finance/accounts";
import { ChartOfAccountsTable } from "./accounts-table";

type Row = {
  code: string;
  name: string;
  parent_code: string | null;
  kind: "revenue" | "expense";
  nature: ChartAccount["nature"];
  cost_behavior: ChartAccount["costBehavior"];
  scope: ChartAccount["scope"];
  is_analytic: boolean;
  fiscal_account_code: string | null;
  active: boolean;
};

/**
 * FIN0 — plano de contas gerencial, único da rede. A classificação
 * fixo × variável é o que permite calcular ponto de equilíbrio (9.20/9.21)
 * quando chegarmos no FIN6/FIN7 — por isso ela nasce aqui, não depois.
 */
export default async function ChartOfAccountsPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("chart_of_accounts")
    .select(
      "code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic, fiscal_account_code, active"
    )
    .returns<Row[]>();

  const isNetworkAdmin = canConfigureFinanceNetwork(session);
  const isFranchisorClinic = session.activeClinic?.type === "franchisor";

  const all: ChartAccount[] = sortAccounts(
    (rows ?? []).map((r) => ({
      code: r.code,
      name: r.name,
      parentCode: r.parent_code,
      kind: r.kind,
      nature: r.nature,
      costBehavior: r.cost_behavior,
      scope: r.scope,
      isAnalytic: r.is_analytic,
      fiscalAccountCode: r.fiscal_account_code,
      active: r.active,
    }))
  );

  // A unidade vê só o que vale para ela (unidade + ambas) — mostrar contas da
  // franqueadora só geraria dúvida (decisão do dono, 31/07/2026). Como o filtro
  // pode deixar um grupo sem filhos, os grupos vazios também saem.
  const scoped = isNetworkAdmin
    ? all
    : all.filter((a) => {
        const mine = isFranchisorClinic ? "franchisor" : "unit";
        return a.scope === "both" || a.scope === mine;
      });
  const accounts = scoped.filter(
    (a) => a.isAnalytic || scoped.some((x) => x.parentCode === a.code)
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="size-6 text-primary" />
          Plano de contas
        </h1>
        <p className="text-sm text-muted-foreground">
          {isNetworkAdmin
            ? "Estrutura gerencial única da rede. A coluna fixo × variável é o que permite calcular o ponto de equilíbrio; o código fiscal fica em branco até o contador validar o de-para."
            : "Contas que valem para a sua unidade. A estrutura é definida pela Franqueadora e é igual para toda a rede — é o que permite comparar resultados."}
        </p>
      </div>

      <ChartOfAccountsTable
        accounts={accounts}
        canEdit={isNetworkAdmin}
        showScope={isNetworkAdmin}
      />
    </div>
  );
}
