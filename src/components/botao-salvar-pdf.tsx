"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printAs } from "@/lib/print";

/**
 * O único elemento de TELA na página de relatório — e ele sai na impressão
 * (`data-moldura`, no bloco `@media print` do globals.css).
 *
 * `printAs` troca o título da página antes de imprimir: é o título que o
 * navegador sugere como nome do arquivo em "Salvar como PDF".
 */
export function BotaoSalvarPdf({
  nomeDoArquivo,
  voltarPara,
}: {
  nomeDoArquivo: string;
  voltarPara: string;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href={voltarPara} />}
      >
        <ArrowLeft className="mr-1 size-4" />
        Voltar
      </Button>
      <Button size="sm" onClick={() => printAs(nomeDoArquivo)}>
        <Printer className="mr-1 size-4" />
        Salvar em PDF
      </Button>
      <span className="text-xs text-muted-foreground">
        Na janela que abrir, escolha <strong>Salvar como PDF</strong> em
        &ldquo;Destino&rdquo;.
      </span>
    </>
  );
}
