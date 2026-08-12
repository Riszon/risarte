import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Calculator, ChevronLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PricingSimulator } from "./pricing-simulator-client";

export const metadata: Metadata = { title: "Precificação" };

/**
 * 0211 — o precificador. Mora em Procedimentos porque o preço nasce do
 * procedimento, e quem simula é quem conhece a clínica por dentro: tempo de
 * cadeira, material, laboratório.
 *
 * 0212 — ganhou o repasse POR NÍVEL (o mesmo procedimento custa mais caro na
 * mão do sênior), a sugestão automática da taxa média e os dois ajustes em
 * massa, que vieram do catálogo: mexer em preço sem ver a margem é o que esta
 * tela existe para impedir.
 */
export default async function PricingPage() {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((r) =>
    r.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) redirect("/procedimentos");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  const [
    { data: procRows },
    { data: settingsRow },
    { data: costRows },
    { data: levelRows },
    { data: matrixRows },
    { data: feeRow },
  ] = await Promise.all([
    supabase
      .from("procedures")
      .select("id, name, specialty, pillar, default_price_cents, estimated_minutes")
      .eq("is_active", true)
      .order("specialty", { nullsFirst: true })
      .order("name")
      .limit(1000),
    supabase.rpc("cost_settings_for", { p_clinic: clinicId }),
    // 0216: material CALCULADO, não guardado. Guardar o resultado foi o que
    // deixou uma unidade com R$ 11,69 e outra com R$ 220,00 quando o valor real
    // era outro — cache de número derivado envelhece em silêncio.
    supabase.rpc("material_costs_for_clinic", { p_clinic_id: clinicId }),
    supabase
      .from("career_levels")
      .select("id, name, clinic_id, sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.rpc("payout_matrix", { p_clinic_id: clinicId, p_date: null }),
    supabase.rpc("suggested_avg_acquirer_fee", {
      p_clinic_id: clinicId,
      p_days: 90,
    }),
  ]);

  const settings = Array.isArray(settingsRow) ? settingsRow[0] : settingsRow;
  const suggestedFee = Array.isArray(feeRow) ? feeRow[0] : feeRow;

  const costByProcedure = new Map<
    string,
    {
      materialsCents: number;
      labCents: number;
      fromKit: boolean;
      kitCount: number;
      itemsWithoutCost: number;
    }
  >();
  for (const c of (costRows ?? []) as {
    procedure_id: string;
    materials_cents: number;
    lab_cents: number;
    from_kit: boolean;
    kit_count: number;
    items_without_cost: number;
  }[]) {
    costByProcedure.set(c.procedure_id, {
      materialsCents: Number(c.materials_cents ?? 0),
      labCents: Number(c.lab_cents ?? 0),
      fromKit: Boolean(c.from_kit),
      kitCount: Number(c.kit_count ?? 0),
      itemsWithoutCost: Number(c.items_without_cost ?? 0),
    });
  }

  // A observação continua sendo do cadastro (texto de quem conhece a clínica).
  const { data: noteRows } = await supabase
    .from("procedure_costs")
    .select("procedure_id, clinic_id, notes");
  const noteByProcedure = new Map<string, string>();
  for (const n of noteRows ?? []) {
    const isUnit = n.clinic_id === clinicId;
    if (n.clinic_id === null || isUnit) {
      if (isUnit || !noteByProcedure.has(n.procedure_id as string)) {
        noteByProcedure.set(
          n.procedure_id as string,
          (n.notes as string | null) ?? ""
        );
      }
    }
  }

  const levels = (levelRows ?? [])
    .filter((l) => l.clinic_id === null || l.clinic_id === clinicId)
    .map((l) => ({ id: l.id as string, name: l.name as string }));

  // Repasse por nível (os quatro degraus da 0210/0212), numa chamada só.
  const payoutByProcedure: Record<
    string,
    Record<string, { amountCents: number; source: string }>
  > = {};
  for (const r of (matrixRows ?? []) as {
    procedure_id: string;
    level_id: string;
    amount_cents: number;
    source: string;
  }[]) {
    (payoutByProcedure[r.procedure_id] ??= {})[r.level_id] = {
      amountCents: Number(r.amount_cents ?? 0),
      source: r.source,
    };
  }

  // Repasse "sem nível" — o degrau do cadastro do procedimento, que é o que
  // vale quando o nível não tem valor próprio.
  const fallbackPayout: Record<string, number> = {};
  for (const p of procRows ?? []) {
    const byLevel = payoutByProcedure[p.id as string] ?? {};
    const fromCatalog = Object.values(byLevel).find(
      (v) => v.source !== "nivel"
    );
    fallbackPayout[p.id as string] = fromCatalog?.amountCents ?? 0;
  }

  const specialties = [
    ...new Set((procRows ?? []).map((p) => p.specialty).filter(Boolean)),
  ] as string[];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <Link
          href="/procedimentos"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-3.5" />
          Voltar aos procedimentos
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Calculator className="size-6 text-primary" />
          Precificação
        </h1>
        <p className="text-sm text-muted-foreground">
          Quanto cada procedimento <strong>custa</strong> e por quanto ele
          deveria ser vendido. O preço sugerido não é &quot;custo + margem&quot;:
          imposto e taxa incidem sobre o preço, então somá-los ao custo antes de
          saber o preço subestima os dois — e a margem real sai bem menor que a
          pretendida.
        </p>
      </div>

      <PricingSimulator
        clinicId={clinicId}
        clinicName={session.activeClinic?.name ?? null}
        canManageCatalog={session.isAdminMaster || isPlanner}
        specialties={specialties}
        settings={{
          chairCostPerHourCents: Number(
            settings?.chair_cost_per_hour_cents ?? 0
          ),
          taxPercent: Number(settings?.tax_percent ?? 0),
          avgAcquirerFeePercent: Number(settings?.avg_acquirer_fee_percent ?? 0),
          targetMarginPercent: Number(settings?.target_margin_percent ?? 0),
        }}
        suggestedFee={
          suggestedFee
            ? {
                percent: Number(suggestedFee.fee_percent ?? 0),
                feeCents: Number(suggestedFee.fee_cents ?? 0),
                receivedCents: Number(suggestedFee.received_cents ?? 0),
                fromDate: String(suggestedFee.from_date ?? ""),
              }
            : null
        }
        levels={levels}
        procedures={(procRows ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          specialty: (p.specialty as string | null) ?? null,
          priceCents: Number(p.default_price_cents ?? 0),
          minutes: Number(p.estimated_minutes ?? 0),
          payoutCents: fallbackPayout[p.id as string] ?? 0,
          payoutByLevel: payoutByProcedure[p.id as string] ?? {},
          materialsCents: costByProcedure.get(p.id as string)?.materialsCents ?? 0,
          labCents: costByProcedure.get(p.id as string)?.labCents ?? 0,
          notes: noteByProcedure.get(p.id as string) ?? "",
          fromKit: costByProcedure.get(p.id as string)?.fromKit ?? false,
          kitCount: costByProcedure.get(p.id as string)?.kitCount ?? 0,
          itemsWithoutCost:
            costByProcedure.get(p.id as string)?.itemsWithoutCost ?? 0,
        }))}
      />
    </div>
  );
}
