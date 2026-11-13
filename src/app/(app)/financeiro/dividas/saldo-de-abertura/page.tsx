import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { RelatorioImpresso } from "@/components/relatorio-impresso";
import { formatCnpj } from "@/lib/masks";
import { carregarSaldoDeAbertura } from "./dados";

export const metadata: Metadata = { title: "Saldo de abertura do passivo" };

/**
 * Levantamento de Dívidas, fase 3 (0406): o saldo de abertura do passivo de
 * um CNPJ, para o contador. Sem `?clinica=`, a página pede o devedor.
 */
export default async function Pagina(props: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const params = await props.searchParams;
  const carga = await carregarSaldoDeAbertura(params);
  if (!carga) redirect("/financeiro");

  if ("falhou" in carga) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Não foi possível ler todas as dívidas agora — o relatório não sai pela metade. Tente de novo; se continuar,
          avise pelo Relatar um problema.
        </p>
        <Link href="/financeiro/dividas" className="mt-3 inline-block text-sm underline">
          Voltar para o Levantamento de Dívidas
        </Link>
      </div>
    );
  }

  if ("escolher" in carga) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saldo de abertura do passivo</h1>
          <p className="text-sm text-muted-foreground">
            As dívidas de origem A (anteriores à implantação do riSZon) de um CNPJ, por credor, categoria e conta — para
            conferir com o contador. Escolha o devedor:
          </p>
        </div>
        <ul className="divide-y rounded-lg border">
          {carga.escolher.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {d.nome}
                {d.cnpj && <span className="ml-2 text-muted-foreground">{formatCnpj(d.cnpj)}</span>}
              </span>
              <Link href={`/financeiro/dividas/saldo-de-abertura?clinica=${d.id}`} className="underline">
                Ver e salvar em PDF
              </Link>
              {/* <a>, não <Link>: o Next pré-carregaria a planilha sem ninguém pedir. */}
              <a href={`/financeiro/dividas/saldo-de-abertura/planilha?clinica=${d.id}`} className="inline-flex items-center gap-1 underline">
                <FileSpreadsheet className="size-4" /> Planilha
              </a>
            </li>
          ))}
        </ul>
        <Link href="/financeiro/dividas" className="inline-block text-sm underline">
          Voltar para o Levantamento de Dívidas
        </Link>
      </div>
    );
  }

  return <RelatorioImpresso relatorio={carga.relatorio} voltarPara="/financeiro/dividas/saldo-de-abertura" />;
}
