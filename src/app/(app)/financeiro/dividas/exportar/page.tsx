import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RelatorioImpresso } from "@/components/relatorio-impresso";
import { carregarExportacao } from "./dados";

export const metadata: Metadata = { title: "Levantamento de Dívidas — exportar" };

/** Levantamento de Dívidas, fase 7: a lista da tela, para ver e salvar em PDF. */
export default async function Pagina(props: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const carga = await carregarExportacao(await props.searchParams);
  if (!carga) redirect("/financeiro");
  if ("falhou" in carga) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Não foi possível ler todas as dívidas agora — o relatório não sai pela metade. Tente de novo; se continuar, avise
          pelo Relatar um problema.
        </p>
        <Link href="/financeiro/dividas?aba=dividas" className="mt-3 inline-block text-sm underline">
          Voltar para o Levantamento de Dívidas
        </Link>
      </div>
    );
  }
  return <RelatorioImpresso relatorio={carga.relatorio} voltarPara="/financeiro/dividas?aba=dividas" />;
}
