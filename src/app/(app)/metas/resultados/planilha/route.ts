import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { relatorioDeResultados } from "@/lib/metas/resultados";
import { carregarResultados } from "../dados";

/**
 * M5: a planilha dos resultados das metas — gerada no servidor, sob demanda,
 * com o mesmo gerador do Financeiro e a MESMA carga da tela (mesmo filtro).
 * Exportar é ação registrada; a tela chama por link comum, nunca `<Link>`.
 */
export async function GET(request: Request) {
  const c = await carregarResultados(Object.fromEntries(new URL(request.url).searchParams));
  if (c.erro) return new NextResponse(c.erro, { status: 503 });

  const relatorio = relatorioDeResultados(c.resultados, {
    de: c.de,
    ate: c.ate,
    deBr: formatIsoDateBr(c.de),
    ateBr: formatIsoDateBr(c.ate),
    unidade: c.nomeDaUnidade,
    geradoPor: c.geradoPor,
    geradoEm: formatBrDateTime(new Date()),
  });

  await logAudit({
    action: "export",
    entityType: "goal_results_report",
    clinicId: c.unidade || undefined,
    details: { de: c.de, ate: c.ate, metas: c.resultados.resumo.metas },
  });

  const buffer = await planilhaDoRelatorio(relatorio);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${relatorio.nomeDoArquivo}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
