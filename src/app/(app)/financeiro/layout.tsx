import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewFinance } from "@/lib/finance/access";
import { FinanceNav } from "./finance-nav";

/**
 * FIN0 — casca do módulo Financeiro. A navegação entre as telas fica aqui: sem
 * ela, as páginas existiam mas não havia como chegar nelas (o menu lateral só
 * aponta para a entrada do módulo).
 */
export default async function FinanceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  return (
    <div>
      <FinanceNav />
      {children}
    </div>
  );
}
