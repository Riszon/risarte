import { NextResponse } from "next/server";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { empresarialDb } from "@/lib/empresarial/db";
import { reportFileName } from "@/lib/empresarial/filenames";
import { planilhaModeloDeTitulares } from "@/lib/empresarial/modelo-titulares-xlsx";

/**
 * A planilha MODELO de titulares e dependentes, para a empresa preencher
 * (pedido do dono, 13/11/2026). Gerada no servidor, com o nome da empresa;
 * não leva dado pessoal nenhum — por isso não registra exportação.
 *
 * Quem não enxerga a empresa (RLS) recebe 404, como na ficha.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  const db = await empresarialDb();
  const { data: empresa } = await db
    .from("companies")
    .select("id, legal_name, trade_name")
    .eq("id", companyId)
    .maybeSingle<{ id: string; legal_name: string; trade_name: string | null }>();
  if (!empresa) return new NextResponse("Empresa não encontrada.", { status: 404 });

  const nome = empresa.trade_name?.trim() || empresa.legal_name;
  const buffer = await planilhaModeloDeTitulares({
    empresa: nome,
    geradoEm: formatIsoDateBr(todayInBrazil()),
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${reportFileName("modelo-titulares", nome)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
