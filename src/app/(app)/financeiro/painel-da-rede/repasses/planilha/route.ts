import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { formatBrDateTime, todayInBrazil } from "@/lib/dates";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { periodoDoEndereco, relatorioDaRede } from "@/lib/finance/payout-visoes";
import { carregarRepasseDaRede } from "@/lib/finance/payout-visoes-db";

/** Repasse, Etapa 5 (0401) — a planilha do repasse da rede (só a Franqueadora). */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  }
  const url = new URL(request.url);
  const { de, ate } = periodoDoEndereco(
    url.searchParams.get("de") ?? undefined,
    url.searchParams.get("ate") ?? undefined,
    todayInBrazil()
  );
  const supabase = await createClient();
  const lido = await carregarRepasseDaRede(supabase, de, ate);
  if (!lido.ok) {
    return new NextResponse(
      "Não foi possível ler o repasse da rede agora — a planilha não sai pela metade. Tente de novo.",
      { status: 503 }
    );
  }
  const relatorio = relatorioDaRede({
    de,
    ate,
    unidades: lido.dados,
    geradoPor: session.fullName,
    geradoEm: formatBrDateTime(new Date().toISOString()),
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
