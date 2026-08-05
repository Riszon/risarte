import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import type { AcquirerRate, CardModality } from "@/lib/finance/acquirers";
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
  const { data: acquirerRows } = await supabase
    .from("card_acquirers")
    .select("id, name, is_default, notes, active")
    .eq("clinic_id", clinicId)
    .order("name");

  const ids = (acquirerRows ?? []).map((a) => a.id as string);
  const { data: rateRows } = ids.length
    ? await supabase
        .from("acquirer_rates")
        .select(
          "id, acquirer_id, modality, min_installments, max_installments, fee_percent, fixed_fee_cents, settlement_days, settlement_business_days, free_monthly_count, valid_from, valid_to"
        )
        .in("acquirer_id", ids)
        .order("valid_from", { ascending: false })
    : { data: [] };

  const acquirers: AcquirerRow[] = (acquirerRows ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    isDefault: Boolean(a.is_default),
    notes: (a.notes as string | null) ?? null,
    active: Boolean(a.active),
  }));

  const rates: AcquirerRate[] = (rateRows ?? []).map((r) => ({
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
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
  }));

  const canEdit =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("finance_franchisor")
    ) ||
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
        today={new Date().toISOString().slice(0, 10)}
        canEdit={canEdit}
      />
    </div>
  );
}
