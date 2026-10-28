import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { minutosDoItem, type CustosDaMargem } from "./custos-da-margem";
import { carregarHoraClinica } from "./hora-clinica-db";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Lê os custos da margem da venda com as MESMAS fontes da Precificação:
 * `cost_settings_for` (imposto, taxa média), a HORA CLÍNICA calculada
 * (`carregarHoraClinica`, 0330 — a mesma da Precificação) e
 * `material_costs_for_clinic` (material e laboratório por procedimento), mais
 * os minutos do cadastro para o item sem minutos planejados.
 *
 * Leitura que falha devolve NULO — a tela diz "não consegui ler os custos" em
 * vez de mostrar uma margem maior do que é.
 */
export async function carregarCustosDaMargem(
  supabase: Supabase,
  clinicId: string,
  itens: { itemId: string; procedureId: string | null; quantidade: number; minutosPlanejados: number | null }[]
): Promise<CustosDaMargem | null> {
  const procIds = [...new Set(itens.map((i) => i.procedureId).filter((x): x is string => Boolean(x)))];
  const [{ data: settingsRow, error: e1 }, { data: costRows, error: e2 }, { data: procRows, error: e3 }, hora] =
    await Promise.all([
      supabase.rpc("cost_settings_for", { p_clinic: clinicId }),
      supabase.rpc("material_costs_for_clinic", { p_clinic_id: clinicId }),
      procIds.length > 0
        ? supabase.from("procedures").select("id, estimated_minutes").in("id", procIds)
        : Promise.resolve({ data: [], error: null }),
      carregarHoraClinica(supabase, clinicId, { hoje: todayInBrazil() }),
    ]);
  if (e1 || e2 || e3) {
    console.error("carregarCustosDaMargem failed:", (e1 ?? e2 ?? e3)?.message);
    return null;
  }
  const s = (Array.isArray(settingsRow) ? settingsRow[0] : settingsRow) as
    | { tax_percent: number; avg_acquirer_fee_percent: number }
    | null
    | undefined;
  const minutosDoCadastro = new Map(
    ((procRows ?? []) as { id: string; estimated_minutes: number | null }[]).map((p) => [p.id, p.estimated_minutes])
  );
  const materialPorProcedimento: CustosDaMargem["materialPorProcedimento"] = {};
  for (const c of (costRows ?? []) as { procedure_id: string; materials_cents: number; lab_cents: number }[]) {
    materialPorProcedimento[c.procedure_id] = {
      materialCents: Number(c.materials_cents ?? 0),
      labCents: Number(c.lab_cents ?? 0),
    };
  }
  const porItem: CustosDaMargem["porItem"] = {};
  for (const i of itens) {
    porItem[i.itemId] = {
      procedureId: i.procedureId,
      quantidade: i.quantidade,
      minutos: minutosDoItem(
        i.minutosPlanejados,
        i.procedureId ? (minutosDoCadastro.get(i.procedureId) ?? null) : null,
        i.quantidade
      ),
    };
  }
  return {
    // A hora clínica calculada; sem dados, o valor provisório (HC3).
    horaDeCadeiraCents: hora.efetivaCents,
    proportionalPercent: Number(s?.tax_percent ?? 0) + Number(s?.avg_acquirer_fee_percent ?? 0),
    porItem,
    materialPorProcedimento,
  };
}
