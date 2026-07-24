import "server-only";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadClientProgram } from "@/lib/empresarial/benefits";
import { applyBenefit } from "@/lib/empresarial/pricing";
import {
  resolveCommercialRule,
  type CommercialRule,
  type CommercialRuleRow,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  canLaunchDirectSaleProcedure,
  directSaleStatusOf,
  type DirectSaleFlags,
} from "@/lib/direct-sale";
import type { DirectSaleRow } from "../../comercial/venda-direta/direct-sale-item";
import type { UserRole } from "@/lib/roles";

/** Um procedimento que ESTE usuário pode lançar, já com o benefício aplicado. */
export type SellableProcedure = {
  id: string;
  name: string;
  /** Preço cheio da unidade (com o ajuste da unidade, se houver). */
  unitPriceCents: number;
  /** Quanto o programa desconta neste procedimento (0 = sem benefício). */
  programDiscountCents: number;
  /** Motivo de o benefício estar indisponível (carência/limite), se houver. */
  benefitBlockedReason: string | null;
};

export type ChartAppointment = {
  id: string;
  startsAt: string;
  type: string;
  status: string;
  providerName: string | null;
  /** Já passou do horário = o atendimento provavelmente já aconteceu. */
  isPast: boolean;
};

export type DirectSaleContext = {
  canLaunch: boolean;
  canClose: boolean;
  isManager: boolean;
  procedures: SellableProcedure[];
  appointments: ChartAppointment[];
  rule: CommercialRule;
  programActive: boolean;
  programName: string | null;
};

/**
 * Contexto do pop-up de VENDA DIRETA no prontuário (docs/COMERCIAL.md §7.6):
 * só os procedimentos que ESTE usuário pode lançar, com o desconto do programa
 * já calculado, os atendimentos do cliente para vincular, e a regra comercial
 * da unidade (limita desconto/parcelas/meios no fechamento).
 */
export async function loadDirectSaleContext(
  clientId: string,
  clinicId: string
): Promise<DirectSaleContext> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const roles = (session.rolesByClinic[clinicId] ?? []) as UserRole[];

  const isManager =
    session.isAdminMaster || hasRoleInClinic(session, clinicId, ["unit_manager"]);
  // Quem FECHA: recepção, gerente ou SDR (a SDR é revalidada item a item).
  const canClose =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["receptionist", "unit_manager", "sdr"]);

  const [{ data: procRows }, { data: unitPrices }, { data: ruleRows }, program] =
    await Promise.all([
      supabase
        .from("procedures")
        .select(
          "id, name, default_price_cents, direct_sale, direct_sale_reception, direct_sale_sdr"
        )
        .eq("direct_sale", true)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("clinic_procedure_prices")
        .select("procedure_id, price_cents")
        .eq("clinic_id", clinicId),
      supabase
        .from("commercial_rules")
        .select("clinic_id, max_discount_percent, max_installments, allowed_methods")
        .returns<CommercialRuleRow[]>(),
      loadClientProgram(clientId),
    ]);

  const priceByProcedure = new Map<string, number>();
  for (const p of unitPrices ?? []) {
    priceByProcedure.set(p.procedure_id as string, p.price_cents as number);
  }

  const procedures: SellableProcedure[] = [];
  for (const p of (procRows ?? []) as {
    id: string;
    name: string;
    default_price_cents: number;
    direct_sale: boolean | null;
    direct_sale_reception: boolean | null;
    direct_sale_sdr: boolean | null;
  }[]) {
    const flags: DirectSaleFlags = {
      directSale: Boolean(p.direct_sale),
      reception: Boolean(p.direct_sale_reception),
      sdr: Boolean(p.direct_sale_sdr),
    };
    if (!canLaunchDirectSaleProcedure(roles, session.isAdminMaster, flags)) {
      continue;
    }
    const unitPriceCents =
      priceByProcedure.get(p.id) ?? p.default_price_cents ?? 0;
    const benefit = program.byProcedure[p.id];
    const applied =
      benefit && benefit.available
        ? applyBenefit(
            { benefitType: benefit.benefitType, benefitValue: benefit.benefitValue },
            unitPriceCents
          )
        : { chargedCents: unitPriceCents, savedCents: 0 };
    procedures.push({
      id: p.id,
      name: p.name,
      unitPriceCents,
      programDiscountCents: applied.savedCents,
      benefitBlockedReason:
        benefit && !benefit.available ? benefit.blockedReason : null,
    });
  }

  // Atendimentos do cliente para VINCULAR (obrigatório — decisão §7.8).
  // Cancelados/faltas são descartados no JS (evita comparar o enum com um
  // rótulo inválido, que derrubaria a query e deixaria a lista vazia).
  const { data: apptRows, error: apptError } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, type, status, provider:profiles!appointments_provider_user_id_fkey ( full_name )"
    )
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false })
    .limit(50);
  if (apptError) {
    console.error("loadDirectSaleContext appointments failed:", apptError.message);
  }

  const now = Date.now();
  const appointments: ChartAppointment[] = (
    (apptRows ?? []) as {
      id: string;
      starts_at: string;
      type: string;
      status: string;
      provider: { full_name: string } | { full_name: string }[] | null;
    }[]
  )
    .filter((a) => a.status !== "cancelled" && a.status !== "no_show")
    .map((a) => {
    const prov = Array.isArray(a.provider) ? a.provider[0] : a.provider;
    return {
      id: a.id,
      startsAt: a.starts_at,
      type: a.type,
      status: a.status,
      providerName: prov?.full_name ?? null,
      isPast: new Date(a.starts_at).getTime() < now,
    };
  });

  return {
    canLaunch: procedures.length > 0,
    canClose,
    isManager,
    procedures,
    appointments,
    rule: resolveCommercialRule(ruleRows ?? [], clinicId),
    programActive: program.active,
    programName: program.companyName,
  };
}

/** Procedimento avulso (venda direta) no prontuário: em aberto ou concluído. */
export type DirectSaleSession = {
  id: string;
  procedureName: string;
  state: "open" | "scheduled" | "done";
  doneAt: string | null;
  executorName: string | null;
  appointmentAt: string | null;
};

/**
 * Vendas diretas DESTE cliente (para fechar no próprio prontuário) + os
 * procedimentos avulsos (sessões sem plano) com o estado (aberto/concluído).
 */
export async function loadClientDirectSales(
  clientId: string,
  clinicId: string
): Promise<{ sales: DirectSaleRow[]; sessions: DirectSaleSession[] }> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const [{ data: saleRows }, { data: sessRows }, { data: ruleRows }] =
    await Promise.all([
      supabase
        .from("direct_sales")
        .select(
          "id, clinic_id, client_id, client_name, subtotal_cents, discount_cents, surcharge_cents, final_cents, installments, payment_method, contract_signed, contract_signed_by, payment_issued, payment_confirmed, cancelled, status, attendance_done_before, created_by, created_at, closed_at, items:direct_sale_items ( id, description, quantity, final_cents )"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("treatment_sessions")
        .select(
          "id, procedure_name, status, done_at, executed_by, appointment:appointments!treatment_sessions_appointment_id_fkey ( starts_at, status )"
        )
        .eq("client_id", clientId)
        .is("plan_id", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("commercial_rules")
        .select("clinic_id, max_discount_percent, max_installments, allowed_methods")
        .returns<CommercialRuleRow[]>(),
    ]);

  const canClose =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["receptionist", "unit_manager", "sdr"]);
  const isManager =
    session.isAdminMaster || hasRoleInClinic(session, clinicId, ["unit_manager"]);
  const rule = resolveCommercialRule(ruleRows ?? [], clinicId);

  const idsForNames = [
    ...new Set(
      (saleRows ?? [])
        .map((s) => s.created_by as string | null)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const names = new Map<string, string>();
  if (idsForNames.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", idsForNames);
    for (const p of people ?? []) names.set(p.id, p.full_name as string);
  }

  const sales: DirectSaleRow[] = (saleRows ?? []).map((s) => ({
    id: s.id as string,
    clinicId: s.clinic_id as string,
    clinicName: null,
    clientId: s.client_id as string | null,
    clientName: s.client_name as string | null,
    subtotalCents: s.subtotal_cents as number,
    discountCents: s.discount_cents as number,
    surchargeCents: s.surcharge_cents as number,
    finalCents: s.final_cents as number,
    installments: s.installments as number,
    paymentMethod: (s.payment_method as PaymentMethod | null) ?? null,
    contractSigned: s.contract_signed as boolean,
    paymentIssued: s.payment_issued as boolean,
    paymentConfirmed: s.payment_confirmed as boolean,
    cancelled: s.cancelled as boolean,
    status: s.cancelled
      ? "cancelada"
      : directSaleStatusOf({
          contractSigned: s.contract_signed as boolean,
          paymentIssued: s.payment_issued as boolean,
          paymentConfirmed: s.payment_confirmed as boolean,
        }),
    attendanceDoneBefore: s.attendance_done_before as boolean,
    createdByName: s.created_by
      ? (names.get(s.created_by as string) ?? null)
      : null,
    createdAt: s.created_at as string,
    items: (
      (s.items ?? []) as {
        description: string;
        quantity: number;
        final_cents: number;
      }[]
    ).map((i) => ({
      description: i.description,
      quantity: i.quantity,
      finalCents: i.final_cents,
    })),
    rule,
    canClose,
    isManager,
  }));

  const sessions: DirectSaleSession[] = (
    (sessRows ?? []) as {
      id: string;
      procedure_name: string;
      status: "pending" | "scheduled" | "done";
      done_at: string | null;
      executed_by: string | null;
      appointment:
        | { starts_at: string; status: string }
        | { starts_at: string; status: string }[]
        | null;
    }[]
  ).map((r) => {
    const ap = Array.isArray(r.appointment) ? r.appointment[0] : r.appointment;
    const isScheduled =
      ap != null && (ap.status === "scheduled" || ap.status === "confirmed");
    return {
      id: r.id,
      procedureName: r.procedure_name,
      state: r.status === "done" ? "done" : isScheduled ? "scheduled" : "open",
      doneAt: r.done_at,
      executorName: null,
      appointmentAt: ap?.starts_at ?? null,
    };
  });

  return { sales, sessions };
}
