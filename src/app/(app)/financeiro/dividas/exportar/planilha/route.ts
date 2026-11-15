import { NextResponse } from "next/server";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { logAudit } from "@/lib/audit";
import { carregarExportacao } from "../dados";

/** Levantamento de Dívidas, fase 7: a planilha da lista (o mesmo modelo do PDF). */
export async function GET(request: Request) {
  const carga = await carregarExportacao(Object.fromEntries(new URL(request.url).searchParams));
  if (!carga) return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  if ("falhou" in carga) {
    return new NextResponse("Não foi possível ler todas as dívidas agora — a planilha não sai pela metade. Tente de novo.", {
      status: 503,
    });
  }
  const buffer = await planilhaDoRelatorio(carga.relatorio);
  await logAudit({ action: "export", entityType: "debt_export", details: { linhas: carga.relatorio.linhas.length } });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${carga.relatorio.nomeDoArquivo}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
