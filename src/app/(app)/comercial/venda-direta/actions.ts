"use server";

import { mensagemDoAcordoEmAberto } from "@/lib/acordo-em-aberto";
import { comBoletosCancelados } from "@/lib/asaas/boletos-da-operacao";
import { prepararParcelasDoAcordo } from "@/lib/renegociacao/excecao";
import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import {
  automaticDiscountPercent,
  resolveCommercialRule,
  ruleWithProgramConditions,
  type CommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import { loadEmpresarialConditions } from "@/lib/empresarial/conditions";
import { directSaleViolations } from "@/lib/direct-sale";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { effectiveRuleWithPpr } from "@/lib/ppr/rules";
import { loadPprConditionsForClients } from "@/lib/ppr/benefits";
import {
  ehVendaNova,
  erroDoMeioDaVendaNova,
  meioParaARegra,
  mensagemDoErroDeMeio,
} from "@/lib/venda-direta-meios";

export type DirectSaleResult = { ok: boolean; error?: string; closed?: boolean };

const CLOSE_ROLES = ["receptionist", "unit_manager", "sdr"] as const;

async function saleClinic(saleId: string): Promise<{
  clinicId: string;
  clientId: string | null;
  subtotalCents: number;
  programDiscountCents: number;
  isProgramMember: boolean;
  /** 4011: 'asa4' = venda direta nova (meio por parcela). */
  methodRule: string | null;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("direct_sales")
    .select(
      "clinic_id, client_id, subtotal_cents, program_discount_cents, client:clients!direct_sales_client_id_fkey ( empresarial_company_id, empresarial_active )"
    )
    .eq("id", saleId)
    .single();
  if (!data) return null;
  const client = Array.isArray(data.client) ? data.client[0] : data.client;
  // Banco sem a 4011: a coluna ainda não existe — vale a regra antiga.
  const { data: regra } = await supabase
    .from("direct_sales")
    .select("method_rule")
    .eq("id", saleId)
    .maybeSingle();
  return {
    clinicId: data.clinic_id as string,
    clientId: (data.client_id as string | null) ?? null,
    subtotalCents: data.subtotal_cents as number,
    // Desconto de PROGRAMA (Empresarial/riso+) tem coluna própria a partir da
    // 0159; o desconto manual é validado sobre (subtotal − programa).
    programDiscountCents: data.program_discount_cents as number,
    isProgramMember: Boolean(
      client?.empresarial_company_id && client?.empresarial_active !== false
    ),
    methodRule: ((regra as { method_rule?: string | null } | null)?.method_rule as string | null) ?? null,
  };
}

/** Define as condições de pagamento (só quem FECHA). Bloqueia fora da regra. */
export async function setDirectSaleConditions(
  saleId: string,
  input: {
    paymentMethod: string;
    installments: number;
    discountReais: string;
    surchargeReais: string;
  }
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  const isManager =
    session.isAdminMaster ||
    hasRoleInClinic(session, info.clinicId, ["unit_manager"]);
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, [...CLOSE_ROLES])
  ) {
    return { ok: false, error: "Você não pode fechar esta venda direta." };
  }

  let discountCents = input.discountReais.trim()
    ? (parseBRLToCents(input.discountReais) ?? 0)
    : 0;
  const surchargeCents = input.surchargeReais.trim()
    ? (parseBRLToCents(input.surchargeReais) ?? 0)
    : 0;
  const installments = Math.max(1, Math.floor(input.installments) || 1);

  const vendaNova = ehVendaNova(info.methodRule);
  if (vendaNova) {
    // 4011: Asaas (Pix, boleto, cartão), dinheiro ou permuta; à vista só Pix,
    // dinheiro ou permuta (19.11). O banco confere de novo.
    const erroMeio = erroDoMeioDaVendaNova(input.paymentMethod || null, installments, isManager);
    if (erroMeio) return { ok: false, error: erroMeio };
  }
  // À VISTA (1×) só é liberado em PIX ou depósito (regra do dono, 26/07/2026).
  if (
    !vendaNova &&
    installments === 1 &&
    input.paymentMethod &&
    input.paymentMethod !== "pix" &&
    input.paymentMethod !== "deposito_avista"
  ) {
    return {
      ok: false,
      error: "À vista (1×) o pagamento é só por PIX ou depósito à vista.",
    };
  }

  const supabase = await createClient();
  const { data: ruleRows } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method")
    .returns<CommercialRuleRow[]>();
  // O plano do cliente (PPR+) é SUPERIOR à regra da rede/unidade: amplia
  // parcelas e formas de pagamento (decisão do dono, 25/07/2026).
  const pprConditions = info.clientId
    ? (await loadPprConditionsForClients([info.clientId])).get(info.clientId) ??
      null
    : null;
  // J5: a condição da empresa parceira (boleto + parcelamento próprio) vale
  // aqui também — a validação do servidor precisa concordar com a tela.
  const empresarialConditions = info.clientId
    ? await loadEmpresarialConditions(info.clientId)
    : null;
  const rule = ruleWithProgramConditions(
    effectiveRuleWithPpr(
      resolveCommercialRule(ruleRows ?? [], info.clinicId),
      pprConditions
    ) as CommercialRule,
    empresarialConditions
  );

  if (pprConditions) {
    // PPR+: o desconto da faixa é do SISTEMA, não da tela — recalculado AQUI a
    // cada salvamento pelo parcelamento escolhido (18× sem faixa = 0%). O valor
    // vindo do cliente é ignorado de propósito, para nunca ficar congelado um
    // desconto de uma escolha anterior de parcelas.
    const pct =
      installments <= 1
        ? pprConditions.cashDiscountPercent
        : ([...pprConditions.tiers]
            .sort((a, b) => a.upToInstallments - b.upToInstallments)
            .find((t) => installments <= t.upToInstallments)?.discountPercent ??
          0);
    const { data: itemRows } = await supabase
      .from("direct_sale_items")
      .select("final_cents, program_discount_cents")
      .eq("sale_id", saleId);
    // Procedimento já coberto pelo plano não recebe desconto de novo.
    const coveredCents = (
      (itemRows ?? []) as { final_cents: number; program_discount_cents: number }[]
    )
      .filter((i) => (i.program_discount_cents ?? 0) > 0)
      .reduce((s, i) => s + (i.final_cents ?? 0), 0);
    const base = Math.max(
      0,
      info.subtotalCents - info.programDiscountCents - coveredCents
    );
    discountCents = Math.round((base * Math.max(0, pct)) / 100);
  } else if (
    !info.isProgramMember &&
    installments <= 1 &&
    input.paymentMethod !== "permuta" &&
    // 4027: o cartão à vista não tem o desconto à vista automático (tem tarifa).
    !(vendaNova && input.paymentMethod === "cartao")
  ) {
    // I8: cliente SEM programa — à vista ganha o desconto automático da regra
    // comercial (ex.: 5%). No parcelado não há automático: vale só o manual.
    const auto = automaticDiscountPercent(rule, installments);
    if (auto > 0) {
      const base = Math.max(0, info.subtotalCents - info.programDiscountCents);
      const autoCents = Math.round((base * auto) / 100);
      // O manual maior que o automático prevalece (o teto ainda é validado).
      discountCents = Math.max(discountCents, autoCents);
    }
  }

  if (info.isProgramMember && !pprConditions && discountCents > 0) {
    // Empresarial (desconto automático) não recebe desconto manual.
    return {
      ok: false,
      error:
        "Cliente de programa (desconto automático) — não é permitido desconto manual.",
    };
  }

  // A regra comercial BLOQUEIA o fechamento fora do padrão (§7.5).
  const violations = directSaleViolations(
    {
      subtotalCents: info.subtotalCents,
      programDiscountCents: info.programDiscountCents,
      discountCents,
      surchargeCents,
      installments,
      // 4011: o dinheiro segue o "depósito à vista" da regra; a permuta não
      // depende da regra comercial.
      paymentMethod: (vendaNova ? meioParaARegra(input.paymentMethod || null) : input.paymentMethod || null) as never,
    },
    rule,
    { isManager }
  );
  if (violations.length > 0) {
    return { ok: false, error: violations.join("; ") };
  }

  const { error } = await supabase.rpc("direct_sale_set_conditions", {
    p_sale_id: saleId,
    p_payment_method: input.paymentMethod || null,
    p_installments: installments,
    p_discount_cents: discountCents,
    p_surcharge_cents: surchargeCents,
  });
  if (error) {
    const m = error.message;
    if (m.includes("SURCHARGE_MANAGER_ONLY"))
      return { ok: false, error: "Só o Gerente pode aplicar acréscimo." };
    if (m.includes("PROGRAM_NO_DISCOUNT"))
      return {
        ok: false,
        error:
          "Cliente de programa (desconto automático) — não é permitido desconto manual.",
      };
    if (m.includes("ALREADY_CLOSED"))
      return { ok: false, error: "Venda já concluída." };
    const meio = mensagemDoErroDeMeio(m);
    if (meio) return { ok: false, error: meio };
    // AP79 (0386): o banco confere a faixa de cada procedimento e devolve a
    // lista já em português ("Fulano abaixo do mínimo: R$ … (mínimo R$ …)").
    const faixa = m.match(/PRICE_OUT_OF_RANGE:([\s\S]*)$/);
    if (faixa)
      return {
        ok: false,
        error: `Fora da faixa de preço do procedimento — ${faixa[1].trim()}. Ajuste o desconto ou o acréscimo.`,
      };
    console.error("direct_sale_set_conditions failed:", m);
    return { ok: false, error: "Não foi possível salvar as condições." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_conditions",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}

/** Passo do fechamento: contrato / cobrança emitida / pagamento confirmado. */
export async function closeDirectSaleStep(
  saleId: string,
  step: "contract" | "payment_issued" | "payment_confirmed",
  value: boolean,
  /** D5: o motivo de DESMARCAR o termo (obrigatório; vai para a Auditoria). */
  motivo?: string
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, [...CLOSE_ROLES])
  ) {
    return { ok: false, error: "Você não pode fechar esta venda direta." };
  }
  // D5 (VD3, decisão do dono): desmarcar o termo assinado é só do Gerente (ou
  // do Admin Master), com motivo escrito — fica na Auditoria.
  const desmarcandoTermo = step === "contract" && !value;
  const motivoLimpo = (motivo ?? "").trim();
  if (desmarcandoTermo) {
    if (!session.isAdminMaster && !hasRoleInClinic(session, info.clinicId, ["unit_manager"])) {
      return { ok: false, error: "Só o Gerente desmarca o termo assinado." };
    }
    if (motivoLimpo.length < 5) {
      return { ok: false, error: "Escreva o motivo de desmarcar o termo (pelo menos 5 letras)." };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("direct_sale_close_step", {
    p_sale_id: saleId,
    p_step: step,
    p_value: value,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_CLOSED"))
      return { ok: false, error: "Venda já concluída." };
    if (m.includes("CONDITIONS_REQUIRED"))
      return {
        ok: false,
        error:
          "Defina a forma de pagamento e o parcelamento antes de assinar o contrato ou emitir a cobrança.",
      };
    // VD3-2 (0415): o termo não se marca à mão — ZapSign ou papel anexado.
    if (m.includes("PAPER_REQUIRED"))
      return {
        ok: false,
        error:
          "O termo da venda direta não se marca à mão: envie pela ZapSign ou anexe o termo assinado no papel (abra a venda pelo prontuário ou pela fila Para receber).",
      };
    console.error("direct_sale_close_step failed:", m);
    return { ok: false, error: "Não foi possível atualizar o fechamento." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_close",
    entityId: saleId,
    clinicId: info.clinicId,
    details: { step, value, ...(desmarcandoTermo ? { motivo: motivoLimpo.slice(0, 300) } : {}) },
  });
  // ASA4 (4012): contrato assinado na venda direta nova → as parcelas pelo
  // Asaas que vencem dentro do prazo nascem agora (o banco decide; idempotente).
  if (step === "contract" && value && ehVendaNova(info.methodRule)) {
    await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: saleId }).catch((e) =>
      console.error("auto charge on direct sale failed:", e instanceof Error ? e.message : e)
    );
  }
  revalidatePath("/comercial/venda-direta");
  revalidatePath("/comercial");
  return { ok: true, closed: Boolean((data as { closed?: boolean } | null)?.closed) };
}

/** Cancela a venda direta (recepção/gerente/admin). */
export async function cancelDirectSale(
  saleId: string,
  /** 4017a: a pessoa confirmou que o cancelamento cancela os boletos vivos (venda e acordo). */
  confirmarCancelamento = false
): Promise<DirectSaleResult & { acordo?: boolean; distrato?: boolean; precisaConfirmar?: number }> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, ["receptionist", "unit_manager"])
  ) {
    return { ok: false, error: "Você não pode cancelar esta venda direta." };
  }
  const supabase = await createClient();
  // J4a: uma função só no banco cancela a venda E os procedimentos dela. Antes
  // a tela cancelava a venda e as sessões ficavam "Concluído" no prontuário
  // (bug relatado pelo dono). A função também devolve o benefício do programa
  // e cancela as cobranças em aberto.
  // 4017a: com a exceção autorizada, as parcelas do acordo em aberto também
  // caem; os boletos vivos (da venda e do acordo) são cancelados no Asaas antes,
  // pelo caminho da 4015, com a confirmação da tela.
  const { data: abertas } = await supabase.from("payment_installments").select("id").eq("direct_sale_id", saleId).eq("status", "em_aberto");
  const { data: excecao } = await supabase
    .from("sale_cancel_exceptions")
    .select("id")
    .eq("direct_sale_id", saleId)
    .eq("status", "autorizada")
    .is("used_at", null)
    .maybeSingle();
  const doAcordo = excecao
    ? await prepararParcelasDoAcordo({ negotiationId: null, directSaleId: saleId, actorId: session.userId })
    : { ok: true as const, installmentIds: [] as string[] };
  if (!doAcordo.ok) return { ok: false, error: doAcordo.error };
  const op = await comBoletosCancelados<unknown>({
    operacao: "cancelamento da venda direta",
    motivo: "cancelamento da venda direta",
    installmentIds: [...(abertas ?? []).map((x) => x.id as string), ...doAcordo.installmentIds],
    actorId: session.userId,
    confirmar: confirmarCancelamento,
    venda: { directSaleId: saleId },
    tentar: async () => {
      const r = await supabase.rpc("cancel_direct_sale", { p_sale_id: saleId });
      return { error: r.error };
    },
  });
  if (!op.ok && op.precisaConfirmar) return { ok: false, error: op.error, precisaConfirmar: op.precisaConfirmar };
  const error = op.ok ? null : { message: op.error };
  if (error) {
    const m = error.message;
    const acordo = mensagemDoAcordoEmAberto(m);
    if (acordo) return { ok: false, error: acordo, acordo: true };
    // 4020 (4a): com algo pago, o cancelamento é o distrato, com o acerto.
    if (m.includes("DISTRATO_REQUIRED")) {
      return {
        ok: false,
        error:
          "O cliente já pagou parte desta venda. O cancelamento é pelo distrato, com o acerto do que foi feito e do que foi pago (sem multa). Use \"Abrir distrato\" (Gerente ou Admin Master).",
        distrato: true,
      };
    }
    if (m.includes("ALREADY_CLOSED")) {
      return {
        ok: false,
        error: "Venda já concluída: o cancelamento é pelo distrato, com o acerto do que foi feito e do que foi pago (Gerente ou Admin Master).",
        distrato: true,
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Você não pode cancelar esta venda direta." };
    }
    console.error("cancel_direct_sale failed:", m);
    return { ok: false, error: "Não foi possível cancelar a venda." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_cancel",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  // VD3-2 (0415): o termo ainda aberto na ZapSign é recusado lá também.
  const { cancelarTermoDaVenda } = await import("@/lib/venda-direta-termo");
  await cancelarTermoDaVenda(saleId);
  revalidatePath("/comercial/venda-direta");
  revalidatePath(`/prontuarios/${info.clientId ?? ""}`);
  return { ok: true };
}
