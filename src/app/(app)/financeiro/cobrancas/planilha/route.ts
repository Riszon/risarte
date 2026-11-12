import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { podeVerPainelDeCobrancas } from "@/lib/finance/selo-atraso";
import {
  argumentosDaLista,
  lerFiltros,
  relatorioDasCobrancas,
  type LinhaEmitida,
} from "@/lib/finance/painel-cobrancas";

/**
 * ASA2 (4006) — A PLANILHA DAS COBRANÇAS EMITIDAS (spec 17.2).
 *
 * A leitura passa por `gateway_charges_list` com `p_export = true`: o BANCO
 * grava na auditoria quem baixou, quando e com quais filtros, na mesma
 * operação que entrega as linhas. Sem o registro, não há planilha.
 */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!podeVerPainelDeCobrancas(session)) {
    return new NextResponse("Sem permissão para esta planilha.", { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const filtros = lerFiltros(sp);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gateway_charges_list", argumentosDaLista(filtros, true));
  if (error) {
    return new NextResponse(
      error.message.includes("NOT_ALLOWED") ? "Sem permissão para esta planilha." : "Não foi possível gerar a planilha.",
      { status: error.message.includes("NOT_ALLOWED") ? 403 : 500 }
    );
  }
  let nomeDaUnidade: string | null = null;
  if (filtros.unidade) {
    const { data: c } = await supabase.from("clinics").select("name").eq("id", filtros.unidade).maybeSingle();
    nomeDaUnidade = (c?.name as string | undefined) ?? null;
  }
  const agora = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
  const relatorio = relatorioDasCobrancas({
    linhas: (data ?? []) as LinhaEmitida[],
    filtros,
    nomeDaUnidade,
    geradoPor: session.fullName,
    agora,
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
