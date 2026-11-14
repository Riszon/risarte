import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import {
  ehParte,
  lerFiltros,
  podeVerRepassesDaFranquia,
  relatorioDaParte,
  type Repasses,
} from "@/lib/finance/repasses-franquia";

/**
 * ASA3 (4010) — A PLANILHA DOS REPASSES DA FRANQUIA (spec 18.8, P6).
 *
 * A leitura passa por `franchise_payouts_read` com `p_export` = a parte
 * baixada: o BANCO grava na auditoria quem baixou, quando, qual parte e com
 * quais filtros, na mesma operação que entrega os números. Sem o registro, não
 * há planilha.
 */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!podeVerRepassesDaFranquia(session)) {
    return new NextResponse("Sem permissão para esta planilha.", { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const parte = sp.parte;
  if (!ehParte(parte)) return new NextResponse("Parte inválida.", { status: 400 });
  const filtros = lerFiltros(sp, todayInBrazil());
  const daRede = session.isAdminMaster || Object.values(session.rolesByClinic).flat().includes("finance_franchisor");
  const unidade = daRede ? filtros.unidade : (session.activeClinic?.id ?? null);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("franchise_payouts_read", {
    p_from: filtros.de,
    p_to: filtros.ate,
    p_clinic_id: unidade,
    p_export: parte,
  });
  if (error || !data) {
    const negado = !!error?.message.includes("NOT_ALLOWED");
    return new NextResponse(negado ? "Sem permissão para esta planilha." : "Não foi possível gerar a planilha.", {
      status: negado ? 403 : 500,
    });
  }
  const dados = data as Repasses;
  const agora = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);
  const relatorio = relatorioDaParte({
    parte,
    dados,
    filtros,
    nomeDaUnidade: unidade ? (dados.unidades[unidade] ?? null) : null,
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
