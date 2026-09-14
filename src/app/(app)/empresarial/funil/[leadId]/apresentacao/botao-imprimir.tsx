"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printAs, reportFileName } from "@/lib/empresarial/filenames";

/**
 * "Salvar em PDF" é a impressão do navegador — o mesmo caminho das outras telas
 * do sistema. `printAs` troca o título da página antes de imprimir, porque é o
 * título que o navegador sugere como nome do arquivo.
 */
export function BotaoImprimir({ companyName }: { companyName: string }) {
  return (
    <Button
      size="sm"
      onClick={() => printAs(reportFileName("apresentacao", companyName))}
    >
      <Printer className="mr-1 size-4" />
      Salvar em PDF
    </Button>
  );
}
