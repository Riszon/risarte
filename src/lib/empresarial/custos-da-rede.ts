import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CustoDoProcedimento } from "./margem-do-beneficio";

/**
 * O CUSTO DE CADA PROCEDIMENTO NA MÉDIA DA REDE (OC-00083, I2).
 *
 * Pedido do dono: ver a margem de cada procedimento na tela de benefícios,
 * "baseado na média da rede". As quatro contas já existem no precificador —
 * aqui elas são pedidas com escopo NULO, que é como o resto do sistema diz
 * "padrão da rede".
 *
 * ⚠️ NADA É INVENTADO. Repasse sem cadastro e material sem kit devolvem zero,
 * e zero de custo faria a margem parecer 100%. Por isso cada procedimento
 * carrega `temRepasse` e `temMaterial`: a tela precisa poder dizer que o
 * número é um teto otimista, em vez de mostrá-lo como verdade.
 */
export async function custosDaRede(): Promise<Map<string, CustoDoProcedimento>> {
  const supabase = await createClient();

  const [{ data: procs }, { data: settings }, { data: materiais }, { data: matriz }] =
    await Promise.all([
      supabase
        .from("procedures")
        .select("id, default_price_cents")
        .eq("is_active", true)
        .returns<{ id: string; default_price_cents: number | null }[]>(),
      supabase.rpc("cost_settings_for", { p_clinic: null }),
      supabase.rpc("material_costs_for_clinic", { p_clinic_id: null }),
      supabase.rpc("payout_matrix", { p_clinic_id: null, p_date: null }),
    ]);

  const conf = (Array.isArray(settings) ? settings[0] : settings) as
    | { avg_acquirer_fee_percent: number | null }
    | null;
  const taxaPercent = Number(conf?.avg_acquirer_fee_percent ?? 0);

  const material = new Map<string, { cents: number; tem: boolean }>();
  for (const m of (materiais ?? []) as {
    procedure_id: string;
    materials_cents: number;
    lab_cents: number;
    from_kit: boolean;
  }[]) {
    const cents = Number(m.materials_cents ?? 0) + Number(m.lab_cents ?? 0);
    material.set(m.procedure_id, { cents, tem: cents > 0 });
  }

  // ⚠️ O REPASSE VARIA POR NÍVEL do plano de carreira, e a tela de benefícios
  // não pergunta o nível. Usa-se a MAIOR das linhas: entre errar para mais e
  // errar para menos no custo, errar para mais é o lado seguro — ele mostra a
  // margem mais apertada, e não a mais folgada.
  const repasse = new Map<string, number>();
  for (const r of (matriz ?? []) as {
    procedure_id: string;
    amount_cents: number;
  }[]) {
    const atual = repasse.get(r.procedure_id) ?? 0;
    repasse.set(r.procedure_id, Math.max(atual, Number(r.amount_cents ?? 0)));
  }

  const mapa = new Map<string, CustoDoProcedimento>();
  for (const p of procs ?? []) {
    const mat = material.get(p.id);
    const rep = repasse.get(p.id) ?? 0;
    mapa.set(p.id, {
      precoCents: Number(p.default_price_cents ?? 0),
      repasseCents: rep,
      materialCents: mat?.cents ?? 0,
      taxaPercent,
      temRepasse: rep > 0,
      temMaterial: Boolean(mat?.tem),
    });
  }
  return mapa;
}
