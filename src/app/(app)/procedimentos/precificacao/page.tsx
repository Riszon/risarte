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
 */
export default async function PricingPage() {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((r) =>
    r.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) redirect("/procedimentos");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  const [{ data: procRows }, { data: settingsRow }, { data: costRows }] =
    await Promise.all([
      supabase
        .from("procedures")
        .select("id, name, specialty, default_price_cents, estimated_minutes")
        .eq("is_active", true)
        .order("specialty", { nullsFirst: true })
        .order("name")
        .limit(1000),
      supabase.rpc("cost_settings_for", { p_clinic: clinicId }),
      supabase
        .from("procedure_costs")
        .select("procedure_id, clinic_id, materials_cents, lab_cents, notes"),
    ]);

  const settings = Array.isArray(settingsRow) ? settingsRow[0] : settingsRow;

  // Custo da unidade vence o da rede (mesma cascata do resto do sistema).
  const costByProcedure = new Map<
    string,
    { materialsCents: number; labCents: number; notes: string }
  >();
  for (const c of costRows ?? []) {
    const key = c.procedure_id as string;
    const isUnit = c.clinic_id === clinicId;
    if (!costByProcedure.has(key) || isUnit) {
      if (c.clinic_id === null || isUnit) {
        costByProcedure.set(key, {
          materialsCents: Number(c.materials_cents ?? 0),
          labCents: Number(c.lab_cents ?? 0),
          notes: (c.notes as string | null) ?? "",
        });
      }
    }
  }

  // O repasse de cada procedimento vem dos quatro degraus da 0210.
  const payoutByProcedure: Record<string, number> = {};
  if (clinicId) {
    for (const p of procRows ?? []) {
      const { data } = await supabase.rpc("payout_rate_for", {
        p_procedure_id: p.id,
        p_provider_id: null,
        p_clinic_id: clinicId,
      });
      const row = Array.isArray(data) ? data[0] : data;
      payoutByProcedure[p.id as string] = Number(row?.amount_cents ?? 0);
    }
  }

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
        settings={{
          chairCostPerHourCents: Number(
            settings?.chair_cost_per_hour_cents ?? 0
          ),
          taxPercent: Number(settings?.tax_percent ?? 0),
          avgAcquirerFeePercent: Number(settings?.avg_acquirer_fee_percent ?? 0),
          targetMarginPercent: Number(settings?.target_margin_percent ?? 0),
        }}
        procedures={(procRows ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          specialty: (p.specialty as string | null) ?? null,
          priceCents: Number(p.default_price_cents ?? 0),
          minutes: Number(p.estimated_minutes ?? 0),
          payoutCents: payoutByProcedure[p.id as string] ?? 0,
          materialsCents: costByProcedure.get(p.id as string)?.materialsCents ?? 0,
          labCents: costByProcedure.get(p.id as string)?.labCents ?? 0,
          notes: costByProcedure.get(p.id as string)?.notes ?? "",
        }))}
      />
    </div>
  );
}
