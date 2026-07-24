import "server-only";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadClientProgram } from "@/lib/empresarial/benefits";
import { applyBenefit } from "@/lib/empresarial/pricing";
import {
  resolveCommercialRule,
  type CommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import {
  canLaunchDirectSaleProcedure,
  type DirectSaleFlags,
} from "@/lib/direct-sale";
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
