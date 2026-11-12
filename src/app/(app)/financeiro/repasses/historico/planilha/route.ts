import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { formatBrDateTime, todayInBrazil } from "@/lib/dates";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { periodoDoEndereco, relatorioDoHistorico } from "@/lib/finance/payout-visoes";
import { carregarHistorico } from "@/lib/finance/payout-visoes-db";

/** Repasse, Etapa 5 (0401) — a planilha do histórico da unidade (V6). */
export async function GET(request: Request) {
  const session = await getSessionContext();
  const clinic = session.activeClinic;
  if (!canViewFinance(session) || !clinic) {
    return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  }
  const url = new URL(request.url);
  const { de, ate } = periodoDoEndereco(
    url.searchParams.get("de") ?? undefined,
    url.searchParams.get("ate") ?? undefined,
    todayInBrazil()
  );
  const supabase = await createClient();
  const lido = await carregarHistorico(supabase, clinic.id, de, ate);
  if (!lido.ok) {
    return new NextResponse(
      "Não foi possível ler o histórico agora — a planilha não sai pela metade. Tente de novo.",
      { status: 503 }
    );
  }
  const relatorio = relatorioDoHistorico({
    unidade: clinic.name,
    de,
    ate,
    rows: lido.dados,
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
