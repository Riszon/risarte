import { NextResponse } from "next/server";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { carregarRelatorioDeContasPagas } from "../dados";

/** OC-00110 — a planilha das contas pagas, montada no servidor (como a dos Recebíveis). */
export async function GET(request: Request) {
  const carga = await carregarRelatorioDeContasPagas(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!carga) {
    return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  }
  if ("falhou" in carga) {
    return new NextResponse(
      "Não foi possível ler todos os pagamentos agora — a planilha não sai pela metade. Tente de novo.",
      { status: 503 }
    );
  }

  const buffer = await planilhaDoRelatorio(carga.relatorio);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${carga.relatorio.nomeDoArquivo}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
