import { getSessionContext } from "@/lib/auth";
import { planilhaDoRelatorio } from "@/lib/signatures/relatorio";
import { montarRelatorio, nomeDoArquivo } from "@/lib/signatures/relatorio-pedido";

/** O relatório das assinaturas em planilha Excel (ZS7), com os filtros da URL do painel. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSessionContext();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const r = await montarRelatorio(session, sp, "planilha");
  if (!r.ok) return new Response(r.erro, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const buf = await planilhaDoRelatorio(r.dados);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(r.dados, "xlsx")}"`,
      "Cache-Control": "no-store",
    },
  });
}
