import { NextResponse } from "next/server";
import { planilhaDoRelatorio } from "@/lib/finance/relatorio-xlsx";
import { carregarSaldoDeAbertura } from "../dados";

/** Levantamento de Dívidas (0406): a planilha do saldo de abertura de um CNPJ. */
export async function GET(request: Request) {
  const carga = await carregarSaldoDeAbertura(Object.fromEntries(new URL(request.url).searchParams));
  if (!carga) return new NextResponse("Sem permissão para este relatório.", { status: 403 });
  if ("falhou" in carga) {
    return new NextResponse("Não foi possível ler todas as dívidas agora — a planilha não sai pela metade. Tente de novo.", {
      status: 503,
    });
  }
  if ("escolher" in carga) return new NextResponse("Escolha o devedor (CNPJ).", { status: 400 });

  const buffer = await planilhaDoRelatorio(carga.relatorio);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${carga.relatorio.nomeDoArquivo}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
