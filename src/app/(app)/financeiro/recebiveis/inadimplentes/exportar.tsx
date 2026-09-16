"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileName, printAs } from "@/lib/print";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import {
  COLLECTION_OUTCOME_LABELS,
  situacaoDaMargem,
  type Inadimplente,
} from "@/lib/finance/collection";

/**
 * EXPORTAR A LISTA DE COBRANÇA (OC-00009, pedido do Admin Master).
 *
 * ⚠️ PDF É A IMPRESSÃO DO NAVEGADOR — o mesmo caminho das outras telas do
 * sistema. O que a pessoa vê é o que sai: os controles somem (`print:hidden`) e
 * o cabeçalho do relatório aparece (`hidden print:block`). Uma segunda
 * montagem só para o papel divergiria da tela na primeira mudança.
 *
 * ⚠️ NA PLANILHA O DINHEIRO VAI COMO NÚMERO, não como texto "R$ 1.234,56".
 * Texto não soma: quem exportasse para conferir o total teria de redigitar
 * tudo, e a planilha existe justamente para somar.
 */
export function ExportarCobranca({
  fila,
  unidade,
  periodo,
  totalCents,
  taxaPercent,
  limitePercent,
}: {
  fila: Inadimplente[];
  unidade: string;
  periodo: string;
  totalCents: number;
  taxaPercent: number | null;
  limitePercent: number | null;
}) {
  const [isPending, startTransition] = useTransition();

  const nome = fileName("risarte", "inadimplentes", unidade);

  function baixarPlanilha() {
    startTransition(async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();

        const cabecalho: (string | number)[][] = [
          ["RELATÓRIO DE INADIMPLENTES"],
          ["Unidade", unidade],
          ["Período", periodo],
          ["Gerado em", formatBrDateTime(new Date())],
          [
            "Taxa de inadimplência",
            // Régua vazia grita: sem nada a receber não existe taxa, e "0%"
            // se leria como "está ótimo".
            taxaPercent === null ? "sem base para calcular" : `${taxaPercent}%`,
          ],
          [
            "Limite definido pela rede",
            limitePercent === null ? "não definido" : `${limitePercent}%`,
          ],
          ["Situação", situacaoDaMargem(taxaPercent, limitePercent)],
          [],
          [
            "Paciente",
            "Telefone",
            "Valor devedor (R$)",
            "Cobranças vencidas",
            "Atraso mais antigo (dias)",
            "A vencer (R$)",
            "Último contato",
            "Quando",
            "Quem",
            "Prometeu pagar em",
            "Observação",
            "Tentativas",
          ],
        ];

        for (const p of fila) {
          cabecalho.push([
            p.cliente,
            // Sem telefone é a informação, não um vazio a esconder.
            p.telefone ?? "SEM TELEFONE NO CADASTRO",
            p.vencidoCents / 100,
            p.quantidadeVencida,
            p.diasDoMaisAntigo,
            p.aVencerCents / 100,
            p.ultimoContato
              ? COLLECTION_OUTCOME_LABELS[p.ultimoContato.outcome]
              : "nunca contatado",
            p.ultimoContato ? formatBrDateTime(p.ultimoContato.contactedAt) : "",
            p.ultimoContato?.authorName ?? "",
            p.ultimoContato?.promisedDate
              ? formatBrDate(`${p.ultimoContato.promisedDate}T12:00:00`)
              : "",
            p.ultimoContato?.note ?? "",
            p.totalDeContatos,
          ]);
        }

        cabecalho.push(
          [],
          ["TOTAL", "", totalCents / 100, "", "", "", "", "", "", "", "", ""],
          [`${fila.length} pessoa(s) a cobrar`]
        );

        const ws = XLSX.utils.aoa_to_sheet(cabecalho);
        ws["!cols"] = [
          { wch: 34 },
          { wch: 18 },
          { wch: 16 },
          { wch: 10 },
          { wch: 12 },
          { wch: 14 },
          { wch: 24 },
          { wch: 18 },
          { wch: 18 },
          { wch: 16 },
          { wch: 40 },
          { wch: 10 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Inadimplentes");
        XLSX.writeFile(wb, `${nome}.xlsx`);
        toast.success("Planilha baixada.");
      } catch (e) {
        console.error("exportar inadimplentes:", e);
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
        disabled={fila.length === 0}
      >
        <Printer className="mr-1 size-4" />
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={baixarPlanilha}
        disabled={isPending || fila.length === 0}
      >
        <FileSpreadsheet className="mr-1 size-4" />
        Planilha
      </Button>
    </div>
  );
}
