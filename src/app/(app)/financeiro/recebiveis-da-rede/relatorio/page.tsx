import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RelatorioImpresso } from "@/components/relatorio-impresso";
import { carregarRelatorioDaRede } from "../../recebiveis/relatorio-dados";

export const metadata: Metadata = { title: "Relatório de recebíveis da rede" };

/**
 * A PÁGINA DE IMPRESSÃO — um documento, não a tela (OC-00009, segunda volta).
 * Os dados vêm do mesmo carregador que a planilha usa.
 */
export default async function Pagina() {
  const carga = await carregarRelatorioDaRede();
  if (!carga) notFound();
  return (
    <RelatorioImpresso
      relatorio={carga.relatorio}
      voltarPara="/financeiro/recebiveis-da-rede"
    />
  );
}
