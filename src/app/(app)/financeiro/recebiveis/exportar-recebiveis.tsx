"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileName, printAs } from "@/lib/print";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";

/** O mínimo que a exportação precisa de cada cobrança. */
export type LinhaParaExportar = {
  cliente: string;
  dataEfetiva: string;
  balanceCents: number;
  updatedBalanceCents: number;
  isLate: boolean;
  daysLate: number;
};

/**
 * EXPORTAR OS RECEBÍVEIS (OC-00009, pedido do Admin Master).
 *
 * A outra metade do pedido: além dos inadimplentes, "outro [botão] para os
 * recebíveis". Aqui a linha é por COBRANÇA — é a visão de conferência.
 */
export function ExportarRecebiveis({
  linhas,
  unidade,
  periodo,
  abertoCents,
  vencidoCents,
  taxaPercent,
  limitePercent,
}: {
  linhas: LinhaParaExportar[];
  unidade: string;
  periodo: string;
  abertoCents: number;
  vencidoCents: number;
  taxaPercent: number | null;
  limitePercent: number | null;
}) {
  const [isPending, startTransition] = useTransition();
  const nome = fileName("risarte", "recebiveis", unidade);

  function baixarPlanilha() {
    startTransition(async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();

        const aoa: (string | number)[][] = [
          ["RELATÓRIO DE RECEBÍVEIS"],
          ["Unidade", unidade],
          ["Período", periodo],
          ["Gerado em", formatBrDateTime(new Date())],
          [
            "Taxa de inadimplência",
            taxaPercent === null ? "sem base para calcular" : `${taxaPercent}%`,
          ],
          [
            "Limite definido pela rede",
            limitePercent === null ? "não definido" : `${limitePercent}%`,
          ],
          [
            "Situação",
            taxaPercent === null
              ? "Nada a receber — não há taxa para comparar."
              : limitePercent === null
                ? "A rede não definiu limite de inadimplência."
                : taxaPercent > limitePercent
                  ? `ACIMA do limite de ${limitePercent}% definido pela rede.`
                  : `Dentro do limite de ${limitePercent}% definido pela rede.`,
          ],
          [],
          [
            "Paciente",
            "Vencimento",
            "Falta — principal (R$)",
            "Com multa e juros (R$)",
            "Situação",
            "Dias em atraso",
          ],
        ];

        for (const l of linhas) {
          aoa.push([
            l.cliente,
            formatBrDate(`${l.dataEfetiva}T12:00:00`),
            l.balanceCents / 100,
            // ⚠️ Em dia NÃO repete o principal nesta coluna: sugeriria que já
            // há encargo correndo. Fica vazio, como na tela.
            l.isLate ? l.updatedBalanceCents / 100 : "",
            l.isLate ? "Vencida" : "Em dia",
            l.isLate ? l.daysLate : 0,
          ]);
        }

        aoa.push(
          [],
          ["TOTAL — principal em aberto", "", abertoCents / 100],
          ["TOTAL — vencido (só principal)", "", vencidoCents / 100],
          [`${linhas.length} cobrança(s)`]
        );

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [
          { wch: 34 },
          { wch: 14 },
          { wch: 20 },
          { wch: 20 },
          { wch: 12 },
          { wch: 14 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Recebíveis");
        XLSX.writeFile(wb, `${nome}.xlsx`);
        toast.success("Planilha baixada.");
      } catch (e) {
        console.error("exportar recebíveis:", e);
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
        disabled={linhas.length === 0}
      >
        <Printer className="mr-1 size-4" />
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={baixarPlanilha}
        disabled={isPending || linhas.length === 0}
      >
        <FileSpreadsheet className="mr-1 size-4" />
        Planilha
      </Button>
    </div>
  );
}
