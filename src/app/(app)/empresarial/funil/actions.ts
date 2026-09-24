"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatPhone } from "@/lib/masks";
import { empresarialDb } from "@/lib/empresarial/db";
import { copiarPropostaParaEmpresa } from "@/lib/empresarial/fechamento";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import {
  CAPTURE_CHANNELS,
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type LeadStage,
} from "@/lib/empresarial/constants";
import { ENTRY_STAGES } from "@/lib/empresarial/funnel";
import {
  camposDaEmpresa,
  type QualificacaoDoLead,
} from "@/lib/empresarial/proposta";
import { instantFromInputValue } from "@/lib/dates";

export type ActionResult = { ok: boolean; error?: string };

function canUseFunnel(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/** Canal da captação: só o que está na lista fechada entra (ver migração 1007). */
function captureChannel(formData: FormData): string | null {
  const v = field(formData, "capture_channel");
  return v && (CAPTURE_CHANNELS as readonly string[]).includes(v) ? v : null;
}

/**
 * O campo de data/hora chega como relógio de parede ("2026-09-14T14:00") e vira
 * instante NO FUSO DO BRASIL. Mandar o texto cru para o banco funcionava por
 * sorte (o banco está em America/Sao_Paulo desde a 0201) — e deixaria de
 * funcionar no dia em que alguém mudasse o fuso da conexão.
 */
function nextActionAt(formData: FormData): string | null {
  const v = field(formData, "next_action_at");
  if (!v) return null;
  return instantFromInputValue(v)?.toISOString() ?? null;
}

function reaisToCents(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(
    value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const companyName = field(formData, "company_name");
  if (!companyName) return { ok: false, error: "Informe o nome da empresa." };

  // Consultor "puro" assume o próprio lead; gestor pode escolher.
  let consultantId = field(formData, "consultant_id");
  if (!consultantId && isRislifeConsultant(session) && !isProgramManager(session)) {
    consultantId = session.userId;
  }

  // A fase de entrada é escolhida no cadastro; sem escolha, Captação.
  const pedida = field(formData, "stage");
  const stage =
    pedida && (ENTRY_STAGES as readonly string[]).includes(pedida)
      ? pedida
      : "CAPTURE";

  const db = await empresarialDb();
  const { data, error } = await db
    .from("commercial_leads")
    .insert({
      company_name: companyName,
      cnpj: (field(formData, "cnpj") ?? "").replace(/\D/g, "") || null,
      contact_name: field(formData, "contact_name"),
      contact_phone: field(formData, "contact_phone")
        ? formatPhone(field(formData, "contact_phone")!)
        : null,
      estimated_value_cents: reaisToCents(field(formData, "estimated_value")),
      next_action_at: nextActionAt(formData),
      next_action_note: field(formData, "next_action_note"),
      notes: field(formData, "notes"),
      capture_channel: captureChannel(formData),
      referral_name: field(formData, "referral_name"),
      referral_contact: field(formData, "referral_contact"),
      consultant_id: consultantId,
      stage,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createLead failed:", error.message);
    return { ok: false, error: "Não foi possível criar o lead." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_lead",
    entityId: data.id,
  });
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function updateLead(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const companyName = field(formData, "company_name");
  if (!companyName) return { ok: false, error: "Informe o nome da empresa." };

  const db = await empresarialDb();
  const { error } = await db
    .from("commercial_leads")
    .update({
      company_name: companyName,
      cnpj: (field(formData, "cnpj") ?? "").replace(/\D/g, "") || null,
      contact_name: field(formData, "contact_name"),
      contact_phone: field(formData, "contact_phone")
        ? formatPhone(field(formData, "contact_phone")!)
        : null,
      estimated_value_cents: reaisToCents(field(formData, "estimated_value")),
      next_action_at: nextActionAt(formData),
      next_action_note: field(formData, "next_action_note"),
      notes: field(formData, "notes"),
      capture_channel: captureChannel(formData),
      referral_name: field(formData, "referral_name"),
      referral_contact: field(formData, "referral_contact"),
    })
    .eq("id", leadId);
  if (error) {
    console.error("updateLead failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function moveLeadStage(
  leadId: string,
  stage: LeadStage,
  lostReason?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: "Etapa inválida." };
  }
  // Ordem do dono: perda SEMPRE com motivo escrito. Sem ele, seis meses depois
  // ninguém sabe por que a empresa não entrou — e é essa lista que diz o que
  // corrigir na oferta.
  if (stage === "CLOSED_LOST" && !lostReason?.trim()) {
    return { ok: false, error: "Escreva o motivo da perda." };
  }
  const db = await empresarialDb();
  const patch: Record<string, unknown> = { stage };
  if (stage === "CLOSED_LOST") patch.lost_reason = lostReason!.trim();
  const { error } = await db
    .from("commercial_leads")
    .update(patch)
    .eq("id", leadId);
  if (error) {
    console.error("moveLeadStage failed:", error.message);
    return { ok: false, error: "Não foi possível mover o lead." };
  }
  // O relógio da fase é gravado por GATILHO (migração 1007). Esta anotação é a
  // linha do tempo que a pessoa lê — e vai em português: "Movido para
  // PROPOSAL_SENT" era interface em inglês escapando para a tela.
  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "STAGE_CHANGE",
    note: `Movido para ${LEAD_STAGE_LABELS[stage]}${
      lostReason?.trim() ? ` — motivo: ${lostReason.trim()}` : ""
    }`,
  });
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function addLeadActivity(
  leadId: string,
  kind: string,
  note: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!note.trim()) return { ok: false, error: "Escreva a anotação." };
  const validKind = ["NOTE", "CALL", "MEETING", "PROPOSAL"].includes(kind)
    ? kind
    : "NOTE";
  const db = await empresarialDb();
  const { error } = await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: validKind,
    note: note.trim(),
  });
  if (error) {
    console.error("addLeadActivity failed:", error.message);
    return { ok: false, error: "Não foi possível registrar." };
  }
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/**
 * Registra uma tentativa de contato (fase 2 do funil).
 *
 * Canal e resultado são listas fechadas: é isto que permite contar depois
 * quantas ligações foram precisas até marcar a reunião — número que a anotação
 * livre da linha do tempo nunca daria.
 */
export async function registerContactAttempt(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const canal = field(formData, "channel");
  const resultado = field(formData, "outcome");
  if (!canal || !(CONTACT_CHANNELS as readonly string[]).includes(canal)) {
    return { ok: false, error: "Escolha por onde tentou o contato." };
  }
  if (!resultado || !(CONTACT_OUTCOMES as readonly string[]).includes(resultado)) {
    return { ok: false, error: "Escolha no que deu a tentativa." };
  }

  // Sem data digitada, é agora — o normal é registrar logo após tentar.
  const quando = field(formData, "attempted_at");
  const attemptedAt = quando
    ? instantFromInputValue(quando)?.toISOString() ?? null
    : new Date().toISOString();
  if (!attemptedAt) return { ok: false, error: "Data ou hora inválida." };

  const db = await empresarialDb();
  const { error } = await db.from("lead_contact_attempts").insert({
    lead_id: leadId,
    channel: canal,
    outcome: resultado,
    note: field(formData, "note"),
    attempted_at: attemptedAt,
    author_id: session.userId,
  });
  if (error) {
    console.error("registerContactAttempt failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a tentativa." };
  }
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/** Fecha o lead (ganho) criando a empresa a partir dos dados do lead. */
export async function convertLeadToCompany(
  leadId: string
): Promise<ActionResult & { companyId?: string }> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();

  const { data: lead } = await db
    .from("commercial_leads")
    .select("company_name, cnpj, consultant_id, company_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (lead.company_id) {
    return { ok: false, error: "Este lead já virou empresa." };
  }
  const cnpj = (lead.cnpj ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) {
    return {
      ok: false,
      error: "Preencha um CNPJ válido no lead antes de fechar (14 dígitos).",
    };
  }

  // O LEVANTAMENTO VIAJA PARA A EMPRESA. Sem isto, o consultor digitaria tudo
  // de novo — razão social, quem assina, quem paga, quantos titulares — e a
  // segunda digitação é onde os dados divergem.
  // `select("*")` desde a H4: a lista nomeada já tinha ficado para trás duas
  // vezes quando a proposta ganhou campos novos, e campo que fica para trás
  // aqui vira preço que o cliente combinou e o sistema não cobra.
  const { data: qual } = await db
    .from("lead_qualification")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle<QualificacaoDoLead>();

  // A regra de como o levantamento vira cadastro mora em `camposDaEmpresa`,
  // pura e com teste. Aqui só se liga o resultado ao banco: regra dentro da
  // action só seria exercitada por um clique.
  const { data: company, error: cErr } = await db
    .from("companies")
    .insert({
      ...camposDaEmpresa(qual, { company_name: lead.company_name, cnpj }),
      status: "ACTIVE",
      assigned_consultant_id: lead.consultant_id,
      // H4 (1018): os limites combinados, e de onde este cadastro veio.
      min_adhesions: qual?.min_adhesions ?? null,
      max_adhesions: qual?.max_adhesions ?? null,
      adhesion_limit_target: qual?.adhesion_limit_target ?? null,
      main_clinic_id: qual?.main_clinic_id ?? null,
      origin_lead_id: leadId,
    })
    .select("id")
    .single();
  if (cErr) {
    if (cErr.code === "23505") {
      return { ok: false, error: "Já existe uma empresa com este CNPJ." };
    }
    console.error("convertLeadToCompany failed:", cErr.message);
    return { ok: false, error: "Não foi possível criar a empresa." };
  }

  // H4 (1018): o que foi vendido vira o que será cobrado. A regra mora em
  // `copiarPropostaParaEmpresa` para poder ser conferida sem fechar um
  // negócio de verdade — dentro desta action ela só rodaria por um clique.
  const { naoCopiado } = await copiarPropostaParaEmpresa(
    db,
    leadId,
    company.id,
    qual as unknown as Record<string, unknown> | null
  );

  await db
    .from("commercial_leads")
    .update({ stage: "CLOSED_WON", company_id: company.id })
    .eq("id", leadId);
  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "STAGE_CHANGE",
    note:
      naoCopiado.length === 0
        ? "Fechado (ganho) — empresa criada com os preços, faixas e benefícios da proposta."
        : `Fechado (ganho) — empresa criada, mas NÃO foi possível copiar: ${naoCopiado.join(", ")}. Confira no cadastro.`,
  });
  await logAudit({
    action: "create",
    entityType: "empresarial_company",
    entityId: company.id,
    details: { from_lead: leadId },
  });
  revalidatePath("/empresarial/funil");
  revalidatePath("/empresarial");
  // O erro vai JUNTO com o sucesso: a empresa existe (é verdade) e algo não
  // foi copiado (também é). Dizer só a primeira metade faria alguém descobrir
  // a segunda na primeira fatura.
  return {
    ok: true,
    companyId: company.id,
    error:
      naoCopiado.length > 0
        ? `A empresa foi criada, mas não copiei: ${naoCopiado.join(", ")}. Confira no cadastro dela.`
        : undefined,
  };
}
