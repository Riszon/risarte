import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RelatorioImpresso } from "@/components/relatorio-impresso";
import { carregarRelatorioDeInadimplentes } from "../../relatorio-dados";

export const metadata: Metadata = { title: "Relatório de inadimplentes" };

/**
 * A PÁGINA DE IMPRESSÃO — um documento, não a tela (OC-00009, segunda volta).
 * Os dados vêm do mesmo carregador que a planilha usa.
 */
export default async function Pagina(props: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const carga = await carregarRelatorioDeInadimplentes(await props.searchParams);
  if (!carga) notFound();
  return (
    <RelatorioImpresso
      relatorio={carga.relatorio}
      voltarPara="/financeiro/recebiveis/inadimplentes"
    />
  );
}
