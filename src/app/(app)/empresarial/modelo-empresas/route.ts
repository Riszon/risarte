import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { isProgramManager } from "@/lib/empresarial/access";
import { listasDaPlanilhaDeEmpresas } from "@/lib/empresarial/importacao-empresas-servidor";
import { planilhaModeloDeEmpresas } from "@/lib/empresarial/modelo-empresas-xlsx";
import { createClient } from "@/lib/supabase/server";

/**
 * A planilha MODELO de empresas (migração; pedido do dono, 16/11/2026). Só o
 * gestor do programa importa empresas, então só ele baixa o modelo. Não leva
 * dado pessoal (as listas são as unidades e os nomes dos consultores).
 */
export async function GET() {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }
  const supabase = await createClient();
  const listas = await listasDaPlanilhaDeEmpresas(supabase);
  if (!listas) {
    return new NextResponse("Não foi possível ler as unidades e os consultores. Tente de novo.", { status: 503 });
  }
  const buffer = await planilhaModeloDeEmpresas({
    geradoEm: formatIsoDateBr(todayInBrazil()),
    unidades: listas.unidades.map((u) => u.nome),
    consultores: listas.consultores.map((c) => c.nome),
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="modelo-empresas-risarte-empresarial.xlsx"',
      "cache-control": "no-store",
    },
  });
}
