import { getSessionContext } from "@/lib/auth";
import { pdfDoRelatorio } from "@/lib/signatures/relatorio";
import { montarRelatorio, nomeDoArquivo } from "@/lib/signatures/relatorio-pedido";

/** O relatório das assinaturas em PDF (ZS7), com os filtros da URL do painel. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSessionContext();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const r = await montarRelatorio(session, sp, "pdf");
  if (!r.ok) return new Response(r.erro, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const bytes = await pdfDoRelatorio(r.dados);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(r.dados, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  });
}
