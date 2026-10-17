import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RelatorioImpresso } from "@/components/relatorio-impresso";
import { carregarRelatorioDeContasPagas } from "../dados";

export const metadata: Metadata = { title: "Relatório de contas pagas" };

/** OC-00110 — a página de impressão das contas pagas, pela data do pagamento. */
export default async function Pagina(props: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const carga = await carregarRelatorioDeContasPagas(await props.searchParams);
  if (!carga) notFound();
  if ("falhou" in carga) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Não foi possível ler todos os pagamentos agora — o relatório não sai
          pela metade. Tente de novo; se continuar, avise pelo Relatar um
          problema.
        </p>
        <Link href="/financeiro/contas-a-pagar" className="mt-3 inline-block text-sm underline">
          Voltar para Contas a pagar
        </Link>
      </div>
    );
  }
  return (
    <RelatorioImpresso
      relatorio={carga.relatorio}
      voltarPara="/financeiro/contas-a-pagar"
    />
  );
}
