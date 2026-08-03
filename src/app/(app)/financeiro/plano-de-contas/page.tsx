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

  const accounts: ChartAccount[] = sortAccounts(
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="size-6 text-primary" />
          Plano de contas
        </h1>
        <p className="text-sm text-muted-foreground">
          Estrutura gerencial única da rede. A coluna{" "}
          <strong>fixo × variável</strong> é o que permite calcular o ponto de
          equilíbrio da unidade; o <strong>código fiscal</strong> fica em branco
          até o contador validar o de-para.
        </p>
      </div>

      <ChartOfAccountsTable
        accounts={accounts}
        canEdit={canConfigureFinanceNetwork(session)}
      />
    </div>
  );
}
