import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeVerDividas } from "@/lib/finance/dividas-acesso";
import { montarPlanilhaModelo } from "@/lib/finance/dividas-planilha-modelo";

/**
 * A PLANILHA-MODELO da importação (0407; refeita em 15/11/2026): o desenho
 * mora em `montarPlanilhaModelo` (com régua). Aqui só as listas da rede.
 * Sem nenhuma dívida dentro.
 */
export async function GET() {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) return new NextResponse("Sem permissão.", { status: 403 });
  const supabase = await createClient();
  const [cl, ca, na] = await Promise.all([
    supabase.from("clinics").select("name, cnpj, is_active").order("name"),
    supabase.from("debt_categories").select("name, parent_id, active, sort_order").is("parent_id", null).eq("active", true).order("sort_order"),
    supabase.from("debt_natures").select("label, active, sort_order").eq("active", true).order("sort_order"),
  ]);

  const buffer = await montarPlanilhaModelo({
    devedores: ((cl.data ?? []) as { name: string; is_active: boolean }[]).filter((c) => c.is_active !== false).map((c) => c.name),
    categorias: ((ca.data ?? []) as { name: string }[]).map((c) => c.name),
    naturezas: ((na.data ?? []) as { label: string }[]).map((n) => n.label),
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="planilha-modelo-dividas.xlsx"',
      "cache-control": "no-store",
    },
  });
}
