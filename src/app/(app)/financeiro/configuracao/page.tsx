import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { podeVerAba, rotaDaRede, rotaDaUnidade } from "@/lib/central/central";

/**
 * ASA1 (entrega 1): a Configuração financeira virou a aba **Financeiro** da
 * Central de Configuração (D19). Este endereço continua existindo para os
 * menus e favoritos antigos: quem configura a rede cai na rede; o Gerente e o
 * Franqueado, na própria unidade.
 */
export default async function FinanceSettingsPage() {
  const session = await getSessionContext();
  if (podeVerAba(session, "financeiro", "rede")) redirect(rotaDaRede("financeiro"));
  const unidade = session.activeClinic?.id ?? null;
  if (unidade && podeVerAba(session, "financeiro", "unidade", unidade)) {
    redirect(rotaDaUnidade(unidade, "financeiro"));
  }
  redirect("/");
}
