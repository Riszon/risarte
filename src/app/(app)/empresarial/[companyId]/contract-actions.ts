"use server";

import { ehValorFixo, mensalidadeDoFixo } from "@/lib/empresarial/mensalidade";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatBRL } from "@/lib/pricing";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import { createZapDocument, isZapsignConfigured } from "@/lib/empresarial/zapsign";
import { carregarFaixasParaCobrar } from "@/lib/empresarial/faixas-da-empresa";
import { contagemConfirmada } from "@/lib/contagem";
import {
  computeMonthlyCents,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "@/lib/empresarial/pricing";
import type { DependentPlan } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

const GAMMA_BASE = "https://public-api.gamma.app/v1.0";

function canUse(session: Awaited<ReturnType<typeof getSessionContext>>): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

export async function createContract(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUse(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.from("contracts").insert({
    company_id: companyId,
    title: field(formData, "title") ?? "Contrato Risarte Empresarial",
    signer_name: field(formData, "signer_name"),
    signer_email: field(formData, "signer_email"),
    status: "DRAFT",
  });
  if (error) {
    console.error("createContract failed:", error.message);
    return { ok: false, error: "Não foi possível criar o contrato." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function sendContract(
  companyId: string,
  contractId: string,
  pdfUrl?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUse(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { data: c } = await db
    .from("contracts")
    .select("title, signer_name, signer_email")
    .eq("id", contractId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Contrato não encontrado." };

  const patch: Record<string, unknown> = {
    status: "SENT",
    sent_at: new Date().toISOString(),
  };

  // Se a ZapSign estiver configurada E houver um PDF, emite de verdade.
  if (isZapsignConfigured() && pdfUrl && c.signer_name && c.signer_email) {
    const r = await createZapDocument({
      name: c.title,
      url_pdf: pdfUrl,
      signer_name: c.signer_name,
      signer_email: c.signer_email,
    });
    if (r.ok) {
      patch.zapsign_doc_id = r.data.token;
      patch.zapsign_url = r.data.sign_url ?? null;
    } else if (!r.notConfigured) {
      return { ok: false, error: r.error };
    }
  }

  const { error } = await db.from("contracts").update(patch).eq("id", contractId);
  if (error) {
    console.error("sendContract failed:", error.message);
    return { ok: false, error: "Não foi possível enviar o contrato." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_contract",
    entityId: contractId,
    details: { sent: true, zapsign: Boolean(patch.zapsign_doc_id) },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Baixa manual: marca assinado (simula o webhook da ZapSign, para testes). */
export async function markContractSigned(
  companyId: string,
  contractId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUse(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db
    .from("contracts")
    .update({ status: "SIGNED", signed_at: new Date().toISOString() })
    .eq("id", contractId);
  if (error) {
    console.error("markContractSigned failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function cancelContract(
  companyId: string,
  contractId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUse(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db
    .from("contracts")
    .update({ status: "CANCELLED" })
    .eq("id", contractId);
  if (error) return { ok: false, error: "Não foi possível cancelar." };
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

// ---- Proposta comercial (Gamma) --------------------------------------------

async function buildProposalText(companyId: string): Promise<string | null> {
  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select("legal_name, trade_name, payment_model, billing_basis, fixed_monthly_cents")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;
  // AP18: no valor fixo, o investimento é o fixo (+ termos aceitos).
  let fixoDaProposta: number | null = null;
  if (ehValorFixo(company.billing_basis)) {
    const { data: aceitos, error: erroDosTermos } = await db
      .from("company_inclusion_terms")
      .select("monthly_delta_cents")
      .eq("company_id", companyId)
      .eq("status", "ACEITO")
      // AP19: só termos do VALOR FIXO somam ao fixo — o termo "pela tabela"
      // (de quando a empresa era por titular) já está coberto pelo valor fixo.
      .is("base_holders", null)
      .returns<{ monthly_delta_cents: number }[]>();
    if (erroDosTermos || !aceitos) return null;
    fixoDaProposta = mensalidadeDoFixo(company.fixed_monthly_cents, aceitos.map((t) => t.monthly_delta_cents));
    if (fixoDaProposta === null) return null;
  }

  // ⚠️ AP13: a proposta vai para a empresa com PREÇO. Qualquer leitura que
  // falhe devolve nulo (a tela diz que não conseguiu montar) — antes, a falha
  // virava o preço padrão, zero dependentes e "Mais de 0 procedimentos".
  const [
    { data: pricingRows, error: erroDoPreco },
    { data: emps, error: erroDosTitulares },
    { data: deps, error: erroDosDependentes },
    contagemDosBeneficios,
  ] = await Promise.all([
      db
        .from("adhesion_pricing")
        .select(
          "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments"
        )
        .or(`company_id.eq.${companyId},company_id.is.null`),
      db
        .from("employees")
        .select("id, dependent_plan, status")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .returns<{ id: string; dependent_plan: DependentPlan; status: "ACTIVE" }[]>(),
      db.from("dependents").select("employee_id, status").eq("status", "ACTIVE"),
      db
        .from("procedure_benefits")
        .select("id", { count: "exact", head: true })
        .or(`company_id.eq.${companyId},company_id.is.null`),
    ]);
  const benCount = contagemConfirmada(contagemDosBeneficios);
  const faixas = await carregarFaixasParaCobrar(db, companyId);
  // OC-00090: o contratado é o mínimo da mensalidade. Rigoroso como o resto
  // (AP13): sem conseguir ler o limite, a proposta sairia com o valor a menor.
  const { data: limiteRow, error: erroDoLimite } = await db.rpc("limite_de_titulares", {
    p_company_id: companyId,
  });
  if (
    erroDoPreco || erroDosTitulares || erroDosDependentes || erroDoLimite ||
    !pricingRows || !emps || !deps || benCount === null || !faixas
  ) {
    return null;
  }
  const minimoDeTitulares = typeof limiteRow === "number" ? limiteRow : null;

  const rows = pricingRows as {
    company_id: string | null;
    holder_fee_cents: number;
    dependent_individual_fee_cents: number;
    dependent_family_fee_cents: number;
    dependent_family_extra_fee_cents: number;
    max_installments: number;
  }[];
  const chosen =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const pricing: AdhesionPricing = chosen
    ? {
        holderFeeCents: chosen.holder_fee_cents,
        dependentIndividualFeeCents: chosen.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosen.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents: chosen.dependent_family_extra_fee_cents,
        maxInstallments: chosen.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;
  const depCount = new Map<string, number>();
  for (const d of (deps ?? []) as { employee_id: string }[])
    depCount.set(d.employee_id, (depCount.get(d.employee_id) ?? 0) + 1);
  const monthly = computeMonthlyCents(
    pricing,
    (emps ?? []).map((e) => ({
      status: "ACTIVE" as const,
      dependentPlan: e.dependent_plan,
      activeDependentCount: depCount.get(e.id) ?? 0,
    })),
    faixas,
    minimoDeTitulares
  );

  const name = company.trade_name || company.legal_name;
  // 1 card por bloco (separados por ---), formato do Gamma já usado no projeto.
  return [
    `# Proposta Risarte Empresarial\n## ${name}`,
    `## Saúde bucal como benefício\nLeve odontologia de qualidade aos seus titulares, com rede credenciada e acompanhamento contínuo.`,
    `## Como funciona\n- Titulares e dependentes viram pacientes da rede Risarte\n- Benefícios e descontos exclusivos em procedimentos\n- Gestão simples: uma mensalidade única para a empresa`,
    fixoDaProposta != null
      ? `## Investimento\n- Valor fixo mensal: **${formatBRL(fixoDaProposta)}**\n- Não depende de quantos titulares estão cadastrados`
      : `## Investimento\n- Titular: ${formatBRL(pricing.holderFeeCents)}/mês\n- Plano de dependentes a partir de ${formatBRL(pricing.dependentIndividualFeeCents)}/mês\n- Mensalidade estimada hoje: **${formatBRL(monthly.totalCents)}**`,
    `## Benefícios clínicos\nMais de ${benCount} procedimentos com cobertura/desconto do programa, incluindo prevenção periódica sem custo.`,
    `## Próximos passos\n1. Assinatura do contrato\n2. Cadastro dos titulares\n3. Início dos atendimentos`,
  ].join("\n\n---\n\n");
}

export type GammaGenerateResult =
  | { ok: true; generationId: string }
  | { ok: false; error: string };

export async function generateCompanyProposal(
  companyId: string
): Promise<GammaGenerateResult> {
  const session = await getSessionContext();
  if (!canUse(session)) return { ok: false, error: "Sem permissão." };
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "O Gamma ainda não está configurado (chave ausente)." };
  }
  const inputText = await buildProposalText(companyId);
  // AP13: nulo também é "não consegui ler preço/cadastros" — dizer "empresa
  // não encontrada" mandaria procurar o defeito no lugar errado.
  if (!inputText) {
    return {
      ok: false,
      error:
        "Não foi possível montar a proposta agora (preços ou cadastros não responderam). Nada foi enviado — tente de novo em instantes.",
    };
  }

  try {
    const res = await fetch(`${GAMMA_BASE}/generations`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText,
        format: "presentation",
        textMode: "preserve",
        cardSplit: "inputTextBreaks",
        imageOptions: { source: "aiGenerated" },
        textOptions: { language: "pt-br", tone: "comercial e profissional" },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: "O Gamma recusou a geração. Tente de novo." };
    }
    const json = (await res.json().catch(() => null)) as {
      generationId?: string;
    } | null;
    if (!json?.generationId) return { ok: false, error: "Resposta inesperada do Gamma." };
    await logAudit({
      action: "export",
      entityType: "empresarial_proposal",
      entityId: companyId,
      details: { gamma: true },
    });
    return { ok: true, generationId: json.generationId };
  } catch (e) {
    console.error("generateCompanyProposal failed:", e);
    return { ok: false, error: "Não foi possível falar com o Gamma." };
  }
}

export async function getProposalStatus(
  generationId: string
): Promise<{ status: "pending" | "completed" | "error"; gammaUrl: string | null }> {
  const apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) return { status: "error", gammaUrl: null };
  try {
    const res = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!res.ok) return { status: "error", gammaUrl: null };
    const json = (await res.json()) as { status?: string; gammaUrl?: string };
    if (json.status === "completed" && json.gammaUrl) {
      return { status: "completed", gammaUrl: json.gammaUrl };
    }
    return { status: "pending", gammaUrl: null };
  } catch {
    return { status: "error", gammaUrl: null };
  }
}
