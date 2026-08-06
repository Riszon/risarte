import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";
import {
  acquirerAppliesTo,
  type AcquirerRate,
  type AcquirerScope,
  type CardModality,
  type FeeChargeMoment,
} from "@/lib/finance/acquirers";
import { AcquirerManager, type AcquirerRow } from "./acquirer-manager";

/** FIN4b — adquirentes: taxa do cartão e quando o dinheiro cai de verdade. */
export default async function AcquirersPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const canManageNetwork = canConfigureFinanceNetwork(session);

  // Sem filtro por unidade: a RLS já limita o que este usuário enxerga, e o
  // cadastro pode ser da rede (clinic_id nulo).
  const { data: acquirerRows } = await supabase
    .from("card_acquirers")
    .select("id, clinic_id, scope, name, is_default, notes, active")
    .order("name");

  const allIds = (acquirerRows ?? []).map((a) => a.id as string);

  const [{ data: linkRows }, { data: rateRows }, { data: usageRows }] =
    await Promise.all([
      allIds.length
        ? supabase
            .from("card_acquirer_clinics")
            .select("acquirer_id, clinic_id")
            .in("acquirer_id", allIds)
        : Promise.resolve({ data: [] as { acquirer_id: string; clinic_id: string }[] }),
      allIds.length
        ? supabase
            .from("acquirer_rates")
            .select(
              "id, acquirer_id, modality, min_installments, max_installments, fee_percent, fixed_fee_cents, settlement_days, settlement_business_days, free_monthly_count, fee_charged_on, valid_from, valid_to"
            )
            .in("acquirer_id", allIds)
            .order("valid_from", { ascending: false })
        : Promise.resolve({ data: [] }),
      allIds.length
        ? supabase.rpc("acquirer_rates_usage", { p_acquirer_ids: allIds })
        : Promise.resolve({ data: [] }),
    ]);

  const clinicsByAcquirer = new Map<string, string[]>();
  for (const l of linkRows ?? []) {
    const key = l.acquirer_id as string;
    clinicsByAcquirer.set(key, [
      ...(clinicsByAcquirer.get(key) ?? []),
      l.clinic_id as string,
    ]);
  }

  const all: AcquirerRow[] = (acquirerRows ?? []).map((a) => ({
    id: a.id as string,
    clinicId: (a.clinic_id as string | null) ?? null,
    scope: (a.scope as AcquirerScope) ?? "unidade",
    clinicIds: clinicsByAcquirer.get(a.id as string) ?? [],
    name: a.name as string,
    isDefault: Boolean(a.is_default),
    notes: (a.notes as string | null) ?? null,
    active: Boolean(a.active),
  }));

  // A tela mostra o que atende ESTA unidade. A Franqueadora vê também os
  // cadastros da rede que apontam para outras unidades — é ela quem os mantém.
  const acquirers = all.filter(
    (a) =>
      acquirerAppliesTo(a, clinicId) ||
      (canManageNetwork && a.clinicId === null)
  );
  const visibleIds = new Set(acquirers.map((a) => a.id));

  const rates: AcquirerRate[] = (rateRows ?? [])
    .filter((r) => visibleIds.has(r.acquirer_id as string))
    .map((r) => ({
      id: r.id as string,
      acquirerId: r.acquirer_id as string,
      modality: r.modality as CardModality,
      minInstallments: Number(r.min_installments),
      maxInstallments: Number(r.max_installments),
      feePercent: Number(r.fee_percent),
      fixedFeeCents: Number(r.fixed_fee_cents ?? 0),
      settlementDays: Number(r.settlement_days),
      settlementBusinessDays: Boolean(r.settlement_business_days),
      freeMonthlyCount:
        r.free_monthly_count === null ? null : Number(r.free_monthly_count),
      feeChargedOn: (r.fee_charged_on as FeeChargeMoment) ?? "pagamento",
      validFrom: r.valid_from as string,
      validTo: (r.valid_to as string | null) ?? null,
    }));

  const usageByRate: Record<string, number> = {};
  for (const u of (usageRows ?? []) as { rate_id: string; uses: number }[]) {
    usageByRate[u.rate_id] = Number(u.uses ?? 0);
  }

  // Unidades para o caso "unidades específicas".
  const { data: clinicRows } = canManageNetwork
    ? await supabase.from("clinics").select("id, name").order("name")
    : { data: [] };
  const clinics = (clinicRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  const canEdit =
    session.isAdminMaster ||
    canManageNetwork ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CreditCard className="size-6 text-primary" />
          Adquirentes
        </h1>
        <p className="text-sm text-muted-foreground">
          A maquininha desconta a taxa e paga depois. Sem esta tabela, o sistema
          acha que recebeu o valor cheio no dia da venda — e a projeção de caixa
          nasce errada. A taxa é despesa da <strong>sua unidade</strong>: é o
          que dá motivo para negociar com a adquirente e para puxar o cliente
          para o PIX.
        </p>
      </div>

      <AcquirerManager
        clinicId={clinicId}
        acquirers={acquirers}
        rates={rates}
        usageByRate={usageByRate}
        clinics={clinics}
        today={new Date().toISOString().slice(0, 10)}
        canEdit={canEdit}
        canManageNetwork={canManageNetwork}
      />
    </div>
  );
}
