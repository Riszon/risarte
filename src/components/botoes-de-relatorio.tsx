import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * OS DOIS BOTÕES DE RELATÓRIO (OC-00009, segunda volta).
 *
 * ⚠️ SÃO LINKS, NÃO BOTÕES DE JAVASCRIPT — e isso resolveu o problema que o
 * dono relatou. Antes, "PDF" mandava imprimir a própria tela: saía com a barra
 * do Financeiro, os quadros e os filtros dentro, *"parecendo um print"*. Agora
 * ele abre uma PÁGINA DE RELATÓRIO, feita para o papel.
 *
 * O mesmo vale para a planilha: em vez de montar o arquivo no navegador, o
 * link chama uma rota que a monta no servidor, com formatação de verdade.
 *
 * Como os dois carregam os filtros na própria URL, o relatório é sempre o que
 * está na tela — não há estado a sincronizar.
 */
export function BotoesDeRelatorio({
  base,
  filtros,
  desabilitado = false,
}: {
  /** Ex.: "/financeiro/recebiveis/inadimplentes" */
  base: string;
  /** Os filtros ativos na tela, que viajam para o relatório. */
  filtros?: Record<string, string | null | undefined>;
  /** Sem nenhuma linha não há relatório a gerar. */
  desabilitado?: boolean;
}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros ?? {})) {
    if (v) query.set(k, v);
  }
  const sufixo = query.toString() ? `?${query.toString()}` : "";

  if (desabilitado) {
    return (
      <p className="text-xs text-muted-foreground print:hidden">
        Sem registros para gerar relatório.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        nativeButton={false}
        render={<Link href={`${base}/relatorio${sufixo}`} />}
      >
        <FileText className="mr-1 size-4" />
        Relatório (PDF)
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        nativeButton={false}
        // `a` comum, não `Link`: é um download, e o roteador do Next tentaria
        // navegar para ele como se fosse uma página.
        render={<a href={`${base}/planilha${sufixo}`} />}
      >
        <FileSpreadsheet className="mr-1 size-4" />
        Planilha
      </Button>
    </div>
  );
}
