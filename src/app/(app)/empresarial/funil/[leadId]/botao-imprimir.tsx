"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printAs, reportFileName } from "@/lib/empresarial/filenames";

/**
 * "Salvar em PDF" é a impressão do navegador — o mesmo caminho das outras telas
 * do sistema. `printAs` troca o título da página antes de imprimir, porque é o
 * título que o navegador sugere como nome do arquivo.
 *
 * ⚠️ SUBIU UM NÍVEL (23/09/2026) quando a proposta virou documento: ele morava
 * dentro de `apresentacao/` e a proposta precisava do mesmo botão. Copiar
 * quinze linhas é como as duas cópias passam a divergir — o nome do arquivo de
 * uma mudaria e o da outra não.
 */
export function BotaoImprimir({
  tipo,
  companyName,
  rotulo = "Salvar em PDF",
}: {
  /** Entra no nome do arquivo: `risarte-empresarial_<tipo>_<empresa>_<data>`. */
  tipo: "apresentacao" | "proposta";
  companyName: string;
  rotulo?: string;
}) {
  return (
    <Button size="sm" onClick={() => printAs(reportFileName(tipo, companyName))}>
      <Printer className="mr-1 size-4" />
      {rotulo}
    </Button>
  );
}
