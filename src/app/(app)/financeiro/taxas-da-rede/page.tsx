import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { TaxasDaRedeConteudo } from "./conteudo";

export const metadata: Metadata = { title: "Taxas da rede" };

/**
 * FIN8.1 — as taxas que a rede cobra das unidades.
 *
 * ASA3 (4008, D19): para quem configura a rede, a tela virou a aba **Taxas da
 * franquia** da Central de Configuração — o menu antigo leva para lá. Quem só
 * vê a própria unidade (Gerente, Franqueado) continua aqui.
 */
export default async function NetworkFeesPage(
  props: PageProps<"/financeiro/taxas-da-rede">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const params = await props.searchParams;
  // 4009 (U9): a tela antiga saiu — Gerente e Franqueado vão para a aba da unidade.
  if (!canConfigureFinanceNetwork(session) && session.activeClinic?.id && session.activeClinic.type !== "franchisor") {
    redirect(`/central/unidades/${session.activeClinic.id}/taxas`);
  }
  if (canConfigureFinanceNetwork(session)) {
    const q = new URLSearchParams();
    for (const k of ["ano", "mes", "unidade"]) {
      const v = params[k];
      const s = Array.isArray(v) ? v[0] : v;
      if (s) q.set(k, s);
    }
    redirect(`/central/rede/taxas${q.size ? `?${q}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <CabecalhoDeModulo
        chapeu="Rede Risarte"
        icone={Network}
        titulo="Taxas da rede"
        descricao="O que a Franqueadora cobra das unidades."
      />
      <TaxasDaRedeConteudo session={session} params={params} basePath="/financeiro/taxas-da-rede" />
    </div>
  );
}
