import { redirect } from "next/navigation";

/** /financeiro entra pela Configuração (as abas levam ao resto). */
export default function FinanceIndexPage() {
  redirect("/financeiro/configuracao");
}
