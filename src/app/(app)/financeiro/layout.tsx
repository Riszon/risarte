import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
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

  // ⚠️ O GRUPO "REDE" SÓ APARECE PARA QUEM PODE ENTRAR NELE. Mostrá-lo ao
  // gerente e deixar a tela recusar depois seria ensinar que a barra mente —
  // e o gerente nunca vê financeiro de outra unidade (regra do módulo).
  // A barreira de verdade continua sendo a RLS e a guarda de cada tela; isto
  // aqui é só não oferecer o que vai ser negado.
  const veRede =
    session.activeClinic?.type === "franchisor" &&
    (session.isAdminMaster || isFinanceFranchisor(session));

  return (
    <div>
      <FinanceNav veRede={veRede} />
      {children}
    </div>
  );
}
