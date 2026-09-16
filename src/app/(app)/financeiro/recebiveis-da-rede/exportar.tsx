"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileName, printAs } from "@/lib/print";
import { formatBrDateTime } from "@/lib/dates";

export type UnidadeParaExportar = {
  nome: string;
  ownership: "own" | "franchised";
  abertoCents: number;
  vencidoCents: number;
  vencidoQuantidade: number;
  taxaPercent: number | null;
  limitePercent: number | null;
};

/**
 * EXPORTAR OS RECEBÍVEIS DA REDE (OC-00009, pedido do Admin Master:
 * *"pela franqueadora deve ter a possibilidade de gerar um relatório da rede
 * toda e/ou as unidades individuais"*).
 *
 * A rede toda é este relatório. A unidade individual é a mesma aba de
 * Inadimplentes, com o seletor de unidade — e é lá que estão os nomes e os
 * telefones. Duplicar o detalhe aqui criaria duas listas da mesma coisa.
 */
export function ExportarRede({
  unidades,
  totalAbertoCents,
  totalVencidoCents,
  taxaDaRede,
  acimaDoLimite,
}: {
  unidades: UnidadeParaExportar[];
  totalAbertoCents: number;
  totalVencidoCents: number;
  taxaDaRede: number | null;
  acimaDoLimite: number;
}) {
  const [isPending, startTransition] = useTransition();
  const nome = fileName("risarte", "recebiveis-da-rede");

  function baixarPlanilha() {
    startTransition(async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();

        const aoa: (string | number)[][] = [
          ["RELATÓRIO DE RECEBÍVEIS DA REDE"],
          ["Gerado em", formatBrDateTime(new Date())],
          [
            "Inadimplência da rede",
            // ⚠️ É a soma dividida pela soma, NUNCA a média das taxas: na
            // média, uma unidade pequena com tudo vencido pesaria igual à
            // maior da rede.
            taxaDaRede === null ? "sem base para calcular" : `${taxaDaRede}%`,
          ],
          ["Unidades acima do próprio limite", acimaDoLimite],
          [],
          [
            "Unidade",
            "Tipo",
            "A receber (R$)",
            "Vencido (R$)",
            "Cobranças vencidas",
            "Taxa (%)",
            "Limite (%)",
            "Situação",
          ],
        ];

        for (const u of unidades) {
          aoa.push([
            u.nome,
            u.ownership === "own" ? "Própria" : "Franqueada",
            u.abertoCents / 100,
            u.vencidoCents / 100,
            u.vencidoQuantidade,
            // Régua vazia grita: sem nada a receber não existe taxa, e um "0"
            // aqui seria lido como "em dia".
            u.taxaPercent ?? "sem base",
            u.limitePercent ?? "não definido",
            situacaoDaUnidade(u),
          ]);
        }

        aoa.push(
          [],
          ["TOTAL DA REDE", "", totalAbertoCents / 100, totalVencidoCents / 100],
          [`${unidades.length} unidade(s)`]
        );

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [
          { wch: 28 },
          { wch: 12 },
          { wch: 16 },
          { wch: 16 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 40 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Rede");
        XLSX.writeFile(wb, `${nome}.xlsx`);
        toast.success("Planilha baixada.");
      } catch (e) {
        console.error("exportar rede:", e);
        toast.error("Não foi possível gerar a planilha.");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => printAs(nome)}
        disabled={unidades.length === 0}
      >
        <Printer className="mr-1 size-4" />
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={baixarPlanilha}
        disabled={isPending || unidades.length === 0}
      >
        <FileSpreadsheet className="mr-1 size-4" />
        Planilha
      </Button>
    </div>
  );
}

/** "Dentro do limite", nunca "saudável" — o número é decisão da rede. */
function situacaoDaUnidade(u: UnidadeParaExportar): string {
  if (u.taxaPercent === null) return "Nada a receber — sem taxa para comparar.";
  if (u.limitePercent === null) return "Sem limite definido.";
  return u.taxaPercent > u.limitePercent
    ? `ACIMA do limite de ${u.limitePercent}%`
    : `Dentro do limite de ${u.limitePercent}%`;
}
