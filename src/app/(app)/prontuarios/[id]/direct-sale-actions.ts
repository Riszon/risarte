"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadClientProgram } from "@/lib/empresarial/benefits";
import { applyBenefit } from "@/lib/empresarial/pricing";
import { canLaunchDirectSaleProcedure } from "@/lib/direct-sale";
import type { UserRole } from "@/lib/roles";

export type DirectSaleActionResult = { ok: boolean; error?: string };

function mapError(m: string): string {
  if (m.includes("NOT_ALLOWED"))
    return "Você não tem permissão para lançar venda direta nesta unidade.";
  if (m.includes("APPOINTMENT_REQUIRED"))
    return "Vincule o atendimento: toda venda direta precisa de um agendamento.";
  if (m.includes("APPOINTMENT_INVALID"))
    return "O atendimento escolhido não é deste cliente.";
  if (m.includes("ITEMS_REQUIRED")) return "Lance ao menos um procedimento.";
  if (m.includes("SURCHARGE_MANAGER_ONLY"))
    return "Só o Gerente da unidade pode aplicar acréscimo no valor.";
  if (m.includes("ALREADY_CLOSED"))
    return "Venda já concluída — não é possível alterar.";
  if (m.includes("CLIENT_NOT_FOUND")) return "Cliente não encontrado.";
  return "Não foi possível concluir a ação.";
}

/**
 * Lança a venda direta a partir do prontuário (§7.6). Os preços e o desconto do
 * programa são RECALCULADOS aqui no servidor — o navegador nunca define valor.
 */
export async function createDirectSaleFromChart(
  clientId: string,
  input: {
    appointmentId: string;
    attendanceDoneBefore: boolean;
    items: { procedureId: string; quantity: number }[];
    notes: string;
  }
): Promise<DirectSaleActionResult & { saleId?: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, clinic_id")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  const clinicId = client.clinic_id as string;
  const roles = (session.rolesByClinic[clinicId] ?? []) as UserRole[];

  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, clinicId, [
      "receptionist",
      "sdr",
      "clinical_coordinator",
      "unit_manager",
    ])
  ) {
    return { ok: false, error: "Sem permissão para lançar venda direta." };
  }
  if (!input.appointmentId) {
    return {
      ok: false,
      error: "Vincule o atendimento: toda venda direta precisa de um agendamento.",
    };
  }
  const wanted = input.items.filter((i) => i.procedureId && i.quantity > 0);
  if (wanted.length === 0) {
    return { ok: false, error: "Lance ao menos um procedimento." };
  }

  // Recalcula do banco: preço da unidade + flags de autorização + benefício.
  const ids = [...new Set(wanted.map((i) => i.procedureId))];
  const [{ data: procRows }, { data: unitPrices }, program] = await Promise.all([
    supabase
      .from("procedures")
      .select(
        "id, name, default_price_cents, direct_sale, direct_sale_reception, direct_sale_sdr"
      )
      .in("id", ids),
    supabase
      .from("clinic_procedure_prices")
      .select("procedure_id, price_cents")
      .eq("clinic_id", clinicId),
    loadClientProgram(clientId),
  ]);

  const priceByProcedure = new Map<string, number>();
  for (const p of unitPrices ?? []) {
    priceByProcedure.set(p.procedure_id as string, p.price_cents as number);
  }
  const byId = new Map(
    ((procRows ?? []) as {
      id: string;
      name: string;
      default_price_cents: number;
      direct_sale: boolean | null;
      direct_sale_reception: boolean | null;
      direct_sale_sdr: boolean | null;
    }[]).map((p) => [p.id, p])
  );

  const payload: {
    procedure_id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    program_discount_cents: number;
    final_cents: number;
  }[] = [];

  for (const item of wanted) {
    const p = byId.get(item.procedureId);
    if (!p) return { ok: false, error: "Procedimento não encontrado." };
    const allowed = canLaunchDirectSaleProcedure(roles, session.isAdminMaster, {
      directSale: Boolean(p.direct_sale),
      reception: Boolean(p.direct_sale_reception),
      sdr: Boolean(p.direct_sale_sdr),
    });
    if (!allowed) {
      return {
        ok: false,
        error: `Você não pode lançar "${p.name}" na venda direta.`,
      };
    }
    const unitPriceCents =
      priceByProcedure.get(p.id) ?? p.default_price_cents ?? 0;
    const lineFull = unitPriceCents * item.quantity;
    const benefit = program.byProcedure[p.id];
    const applied =
      benefit && benefit.available
        ? applyBenefit(
            { benefitType: benefit.benefitType, benefitValue: benefit.benefitValue },
            lineFull
          )
        : { chargedCents: lineFull, savedCents: 0 };
    payload.push({
      procedure_id: p.id,
      description: p.name,
      quantity: item.quantity,
      unit_price_cents: unitPriceCents,
      program_discount_cents: applied.savedCents,
      final_cents: applied.chargedCents,
    });
  }

  const { data, error } = await supabase.rpc("create_direct_sale_v2", {
    p_client_id: clientId,
    p_appointment_id: input.appointmentId,
    p_attendance_done_before: input.attendanceDoneBefore,
    p_items: payload,
    p_notes: input.notes.trim() || null,
  });
  if (error) {
    console.error("create_direct_sale_v2 failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }

  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/comercial/venda-direta");
  revalidatePath("/notificacoes");
  return { ok: true, saleId: (data as string | null) ?? undefined };
}
