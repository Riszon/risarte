import { NextResponse } from "next/server";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { carregarRelatorioDeInadimplentes } from "../../relatorio-dados";

/**
 * A PLANILHA — gerada no SERVIDOR (OC-00009, segunda volta).
 *
 * O ExcelJS é grande; no navegador ele entraria no pacote de TODA tela para
 * atender um botão que quase ninguém clica. Aqui ele roda sob demanda, e a
 * leitura do banco continua passando pela RLS da pessoa que pediu.
 */
export async function GET(request: Request) {
  const carga = await carregarRelatorioDeInadimplentes(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!carga) {
    return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  }

  const buffer = await planilhaDoRelatorio(carga.relatorio);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${carga.relatorio.nomeDoArquivo}.xlsx"`,
      // Relatório é retrato de um instante: guardar em cache entregaria
      // números velhos a quem clicasse de novo.
      "cache-control": "no-store",
    },
  });
}
