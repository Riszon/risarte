"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import {
  DISPATCH_CHANNELS,
  DISPATCH_CHANNEL_LABELS,
  DISPATCH_ITEMS,
  DISPATCH_ITEM_LABELS,
  PAYMENT_MODELS,
  type DispatchItem,
} from "@/lib/empresarial/constants";
import { BILLING_BASES, INTEREST_LEVELS } from "@/lib/empresarial/proposta";
import { COMPANY_CATEGORIES } from "@/lib/empresarial/documents";
import {
  IMPLEMENTATION_STEPS,
  impedimentosDaConferencia,
  podeNaoSeAplicar,
  type ImplementationStep,
} from "@/lib/empresarial/implantacao";
import { formatPhone } from "@/lib/masks";

export type ActionResult = { ok: boolean; error?: string };

function canUseFunnel(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function texto(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/**
 * Número inteiro, ou nulo.
 *
 * ⚠️ Campo em branco vira NULO, nunca zero. "Não perguntei quantos
 * colaboradores" e "a empresa tem zero colaboradores" são coisas diferentes, e
 * confundi-las faria o painel contar como respondida toda ficha em branco.
 */
function inteiro(formData: FormData, key: string): number | null {
  const v = texto(formData, key);
  if (v == null) return null;
  const n = Number.parseInt(v.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** "1.234,56" → 123456 centavos. Em branco continua nulo. */
function centavos(formData: FormData, key: string): number | null {
  const v = texto(formData, key);
  if (v == null) return null;
  const n = Number.parseFloat(
    v.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Caixa de marcar de TRÊS estados: sim, não, e "não perguntei". */
function triBooleano(formData: FormData, key: string): boolean | null {
  const v = texto(formData, key);
  if (v === "SIM") return true;
  if (v === "NAO") return false;
  return null;
}

function daLista<T extends string>(
  formData: FormData,
  key: string,
  lista: readonly T[]
): T | null {
  const v = texto(formData, key);
  return v && (lista as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Salva o levantamento e os dados comerciais do lead.
 *
 * Uma linha por lead: é retrato do estado atual da conversa, não histórico — o
 * que muda ao longo do tempo já está na linha do tempo e nas tentativas de
 * contato. Por isso o update-depois-insert, e não duas linhas.
 */
/**
 * ⚠️ O LEVANTAMENTO E A PROPOSTA VIRARAM DUAS GRAVAÇÕES (OC-00083,
 * 23/09/2026), porque viraram duas abas.
 *
 * Eram um formulário só, com um botão de salvar só. Cada uma escreve **apenas
 * as suas colunas** na mesma linha de `lead_qualification` — é por isso que o
 * caminho é UPDATE parcial: um upsert com o objeto inteiro apagaria, a cada
 * salvar, tudo o que a outra aba tinha preenchido. O defeito seria silencioso
 * e só apareceria quando alguém voltasse na outra aba.
 */
async function gravarNoLevantamento(
  leadId: string,
  dados: Record<string, unknown>,
  oQue: string
): Promise<ActionResult> {
  const db = await empresarialDb();
  // Atualiza-depois-insere em vez de `on conflict`: o índice único é sobre
  // lead_id, e o caminho explícito deixa claro qual dos dois aconteceu.
  const { data: existente } = await db
    .from("lead_qualification")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { error } = existente
    ? await db.from("lead_qualification").update(dados).eq("id", existente.id)
    : await db.from("lead_qualification").insert({ lead_id: leadId, ...dados });

  if (error) {
    console.error(`${oQue} failed:`, error.message);
    return { ok: false, error: `Não foi possível salvar ${oQue}.` };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_lead_qualification",
    entityId: leadId,
  });
  revalidatePath(`/empresarial/funil/${leadId}`);
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/** A ENTREVISTA: o que a empresa tem hoje e o que o consultor leu dela. */
export async function saveDiscovery(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const chance = inteiro(formData, "success_chance");
  if (chance != null && (chance < 0 || chance > 100)) {
    return { ok: false, error: "A chance de sucesso vai de 0 a 100." };
  }

  return gravarNoLevantamento(
    leadId,
    {
      has_dental_plan: triBooleano(formData, "has_dental_plan"),
      dental_plan_name: texto(formData, "dental_plan_name"),
      dental_plan_monthly_cents: centavos(formData, "dental_plan_monthly"),
      other_benefits: texto(formData, "other_benefits"),
      social_projects: triBooleano(formData, "social_projects"),
      social_projects_note: texto(formData, "social_projects_note"),
      interest_level: daLista(formData, "interest_level", INTEREST_LEVELS),
      success_chance: chance,
      notes: texto(formData, "notes"),
      updated_by: session.userId,
    },
    "o levantamento"
  );
}

/** A OFERTA: valores, carência, prazo e os dados que vão no documento. */
export async function saveProposal(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  // Os limites são os mesmos do banco (1014). Barrar aqui é UX; a barreira é
  // a `check constraint`, que vale mesmo para quem não passa por esta tela.
  const prazo = inteiro(formData, "proposal_valid_days");
  if (prazo != null && (prazo < 1 || prazo > 365)) {
    return { ok: false, error: "O prazo da proposta vai de 1 a 365 dias." };
  }
  const carenciaEmpresa = inteiro(formData, "company_grace_days");
  const carenciaColaborador = inteiro(formData, "employee_grace_days");
  for (const c of [carenciaEmpresa, carenciaColaborador]) {
    if (c != null && (c < 0 || c > 3650)) {
      return { ok: false, error: "A carência vai de 0 a 3650 dias." };
    }
  }

  return gravarNoLevantamento(
    leadId,
    {
      proposal_valid_days: prazo,
      company_grace_days: carenciaEmpresa,
      employee_grace_days: carenciaColaborador,
      payment_model: daLista(formData, "payment_model", PAYMENT_MODELS),
      subsidy_type: daLista(formData, "subsidy_type", ["PERCENT", "AMOUNT"] as const),
      subsidy_value:
        texto(formData, "subsidy_type") === "PERCENT"
          ? inteiro(formData, "subsidy_percent")
          : centavos(formData, "subsidy_amount"),
      employee_count: inteiro(formData, "employee_count"),
      includes_dependents: triBooleano(formData, "includes_dependents"),
      dependents_estimate: inteiro(formData, "dependents_estimate"),
      billing_model: daLista(formData, "billing_model", ["unico", "por_cnpj"] as const),
      billing_basis: daLista(formData, "billing_basis", BILLING_BASES),
      holder_fee_cents: centavos(formData, "holder_fee"),
      dependent_fee_cents: centavos(formData, "dependent_fee"),
      fixed_monthly_cents: centavos(formData, "fixed_monthly"),
      implantation_per_employee_cents: centavos(formData, "implantation_per_employee"),

      legal_name: texto(formData, "legal_name"),
      category: daLista(formData, "category", COMPANY_CATEGORIES),
      responsible_name: texto(formData, "responsible_name"),
      responsible_role: texto(formData, "responsible_role"),
      responsible_cpf: texto(formData, "responsible_cpf"),
      responsible_email: texto(formData, "responsible_email"),
      responsible_phone: texto(formData, "responsible_phone")
        ? formatPhone(texto(formData, "responsible_phone")!)
        : null,
      updated_by: session.userId,
    },
    "a proposta"
  );
}

// -----------------------------------------------------------------------------
// C2 — apresentação, envio do pacote e os selos do follow-up
// -----------------------------------------------------------------------------

/**
 * Salva a apresentação DESTA empresa.
 *
 * Cascata: enquanto não houver linha própria, o lead usa o padrão da rede.
 * Salvar aqui cria a personalização — e o padrão da rede continua intocado
 * para todo mundo que ainda não personalizou.
 */
export async function savePresentation(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const titulo = texto(formData, "title");
  if (!titulo) return { ok: false, error: "A apresentação precisa de um título." };

  // Os blocos chegam como titulo_0/corpo_0, titulo_1/corpo_1...
  const sections: { titulo: string; corpo: string }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const t = texto(formData, `titulo_${i}`);
    const c = texto(formData, `corpo_${i}`);
    // Bloco vazio é bloco apagado — não vira slide em branco na apresentação.
    if (!t && !c) continue;
    sections.push({ titulo: t ?? "", corpo: c ?? "" });
  }
  if (sections.length === 0) {
    return { ok: false, error: "Escreva pelo menos um bloco." };
  }

  const dados = {
    lead_id: leadId,
    title: titulo,
    subtitle: texto(formData, "subtitle"),
    sections,
    updated_by: session.userId,
  };

  const db = await empresarialDb();
  const { data: existente } = await db
    .from("presentation_templates")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { error } = existente
    ? await db.from("presentation_templates").update(dados).eq("id", existente.id)
    : await db.from("presentation_templates").insert(dados);

  if (error) {
    console.error("savePresentation failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a apresentação." };
  }
  revalidatePath(`/empresarial/funil/${leadId}`);
  return { ok: true };
}

/** Volta a usar o padrão da rede: apaga só a personalização deste lead. */
export async function resetPresentation(leadId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  // `eq("lead_id", leadId)` e não `is null`: apagar a linha da REDE tiraria a
  // apresentação padrão de todo mundo.
  const { error } = await db
    .from("presentation_templates")
    .delete()
    .eq("lead_id", leadId);
  if (error) {
    console.error("resetPresentation failed:", error.message);
    return { ok: false, error: "Não foi possível restaurar o padrão." };
  }
  revalidatePath(`/empresarial/funil/${leadId}`);
  return { ok: true };
}

/**
 * O TEXTO da proposta desta empresa (1014).
 *
 * Mesma cascata da apresentação: enquanto não houver linha própria, a empresa
 * usa o modelo da rede. Salvar aqui cria a personalização, e o modelo da rede
 * continua intocado para todo mundo que ainda não personalizou.
 */
export async function saveProposalText(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const sections: { titulo: string; corpo: string }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const t = texto(formData, `titulo_${i}`);
    const c = texto(formData, `corpo_${i}`);
    // Bloco vazio é bloco apagado — não vira parágrafo em branco no documento.
    if (!t && !c) continue;
    sections.push({ titulo: t ?? "", corpo: c ?? "" });
  }
  if (sections.length === 0) {
    return { ok: false, error: "Escreva pelo menos um bloco." };
  }

  const dados = { lead_id: leadId, sections, updated_by: session.userId };

  const db = await empresarialDb();
  const { data: existente } = await db
    .from("proposal_templates")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { error } = existente
    ? await db.from("proposal_templates").update(dados).eq("id", existente.id)
    : await db.from("proposal_templates").insert(dados);

  if (error) {
    console.error("saveProposalText failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o texto da proposta." };
  }
  revalidatePath(`/empresarial/funil/${leadId}`);
  return { ok: true };
}

/** Volta ao modelo da rede: apaga só a personalização deste lead. */
export async function resetProposalText(leadId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  // `eq("lead_id", leadId)` e não `is null`: apagar a linha da REDE tiraria o
  // modelo padrão de todo mundo.
  const { error } = await db
    .from("proposal_templates")
    .delete()
    .eq("lead_id", leadId);
  if (error) {
    console.error("resetProposalText failed:", error.message);
    return { ok: false, error: "Não foi possível restaurar o modelo da rede." };
  }
  revalidatePath(`/empresarial/funil/${leadId}`);
  return { ok: true };
}

/**
 * Registra o envio do pacote.
 *
 * O sistema NÃO manda e-mail nem WhatsApp — quem manda é a pessoa. O que fica
 * aqui é o registro do que foi enviado, quando e por onde, que é o que permite
 * cobrar depois sem perguntar "será que mandaram?".
 *
 * Mover o cartão para Follow-up é trabalho do GATILHO (migração 1010), e só
 * quando a proposta vai junto.
 */
export async function registerDispatch(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const canal = daLista(formData, "channel", DISPATCH_CHANNELS);
  if (!canal) return { ok: false, error: "Escolha por onde foi enviado." };

  const itens = formData
    .getAll("items")
    .map(String)
    .filter((i) => (DISPATCH_ITEMS as readonly string[]).includes(i));
  if (itens.length === 0) {
    return { ok: false, error: "Marque o que foi enviado." };
  }

  const db = await empresarialDb();
  const { error } = await db.from("lead_dispatches").insert({
    lead_id: leadId,
    channel: canal,
    items: itens,
    note: texto(formData, "note"),
    sent_by: session.userId,
  });
  if (error) {
    console.error("registerDispatch failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o envio." };
  }

  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "PROPOSAL",
    note: `Enviado por ${DISPATCH_CHANNEL_LABELS[canal]}: ${itens
      .map((i) => DISPATCH_ITEM_LABELS[i as DispatchItem])
      .join(", ")}.`,
  });
  await logAudit({
    action: "create",
    entityType: "empresarial_lead_dispatch",
    entityId: leadId,
  });
  revalidatePath(`/empresarial/funil/${leadId}`);
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/**
 * Marca (ou desmarca) um dos dois selos do follow-up.
 *
 * Quem fecha o negócio quando os dois estão verdes é o GATILHO da 1010 — a
 * regra mora no banco, então vale por qualquer caminho. A empresa NÃO é criada
 * aqui: isso exige CNPJ válido e é ato do consultor, no cartão.
 */
export async function setLeadSeal(
  leadId: string,
  seal: "contract" | "implantation",
  marcado: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const coluna =
    seal === "contract" ? "contract_signed_at" : "implantation_paid_at";
  const db = await empresarialDb();
  const { error } = await db
    .from("commercial_leads")
    .update({ [coluna]: marcado ? new Date().toISOString() : null })
    .eq("id", leadId);
  if (error) {
    console.error("setLeadSeal failed:", error.message);
    return { ok: false, error: "Não foi possível marcar." };
  }

  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "NOTE",
    note: `${seal === "contract" ? "Contrato assinado" : "Boleto da implantação pago"}: ${
      marcado ? "marcado" : "desmarcado"
    }.`,
  });
  revalidatePath(`/empresarial/funil/${leadId}`);
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// C3 — a conferência do fechamento e a implantação
// -----------------------------------------------------------------------------

/**
 * A conferência do consultor responsável, antes da implantação.
 *
 * Confirmar move o cartão para Implantação e **leva o combinado específico para
 * o cadastro da empresa** — as duas coisas por GATILHO (migração 1011). O
 * combinado é o que mais se perde: quem vende não é quem atende.
 */
export async function confirmClosing(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_id, stage")
    .eq("id", leadId)
    .maybeSingle<{ id: string; company_id: string | null; stage: string }>();
  if (!lead) return { ok: false, error: "Lead não encontrado." };

  const everythingOk = texto(formData, "everything_ok") === "SIM";
  const considerations = texto(formData, "considerations");

  const impedimentos = impedimentosDaConferencia({
    companyId: lead.company_id,
    everythingOk,
    considerations,
  });
  if (impedimentos.length > 0) {
    return { ok: false, error: `Antes de confirmar: ${impedimentos.join("; ")}.` };
  }

  const dados = {
    lead_id: leadId,
    confirmed_by: session.userId,
    everything_ok: everythingOk,
    considerations,
    special_agreements: texto(formData, "special_agreements"),
  };

  const { data: existente } = await db
    .from("lead_closing_reviews")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { error } = existente
    ? await db.from("lead_closing_reviews").update(dados).eq("id", existente.id)
    : await db.from("lead_closing_reviews").insert(dados);

  if (error) {
    console.error("confirmClosing failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a conferência." };
  }

  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "NOTE",
    note: everythingOk
      ? "Fechamento conferido pelo consultor — empresa liberada para implantação."
      : `Fechamento conferido COM pendência: ${considerations}`,
  });
  await logAudit({
    action: "update",
    entityType: "empresarial_lead_closing_review",
    entityId: leadId,
  });
  revalidatePath(`/empresarial/funil/${leadId}`);
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/**
 * Marca um passo da implantação como feito, não feito, ou "não se aplica".
 *
 * A linha é ESPARSA: desmarcar apaga o registro, porque "não feito" é a
 * ausência dele — guardar uma linha dizendo "não" encheria a tabela de nada.
 */
export async function setImplementationStep(
  leadId: string,
  step: ImplementationStep,
  estado: "DONE" | "NOT_APPLICABLE" | "PENDING",
  note?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!(IMPLEMENTATION_STEPS as readonly string[]).includes(step)) {
    return { ok: false, error: "Passo inválido." };
  }
  if (estado === "NOT_APPLICABLE" && !podeNaoSeAplicar(step)) {
    return {
      ok: false,
      error: "Este passo vale para toda empresa — não dá para dispensar.",
    };
  }

  const db = await empresarialDb();

  if (estado === "PENDING") {
    const { error } = await db
      .from("lead_implementation_steps")
      .delete()
      .eq("lead_id", leadId)
      .eq("step", step);
    if (error) {
      console.error("setImplementationStep (limpar) failed:", error.message);
      return { ok: false, error: "Não foi possível desmarcar." };
    }
    revalidatePath(`/empresarial/funil/${leadId}`);
    return { ok: true };
  }

  const dados = {
    lead_id: leadId,
    step,
    done_at: estado === "DONE" ? new Date().toISOString() : null,
    done_by: session.userId,
    not_applicable: estado === "NOT_APPLICABLE",
    note: note?.trim() || null,
  };

  const { data: existente } = await db
    .from("lead_implementation_steps")
    .select("id")
    .eq("lead_id", leadId)
    .eq("step", step)
    .maybeSingle();

  const { error } = existente
    ? await db
        .from("lead_implementation_steps")
        .update(dados)
        .eq("id", existente.id)
    : await db.from("lead_implementation_steps").insert(dados);

  if (error) {
    console.error("setImplementationStep failed:", error.message);
    return { ok: false, error: "Não foi possível marcar o passo." };
  }
  revalidatePath(`/empresarial/funil/${leadId}`);
  return { ok: true };
}
