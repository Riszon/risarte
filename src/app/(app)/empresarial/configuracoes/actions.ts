"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, requireAdminMaster } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { BENEFIT_TYPES } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

/** Config da REDE (company_id null) = Admin/Franqueadora; da EMPRESA = gestor do programa. */
function canEditConfig(session: SessionContext, companyId: string | null): boolean {
  if (companyId === null) {
    return (
      session.isAdminMaster ||
      Object.values(session.rolesByClinic).flat().includes("franchisor_staff")
    );
  }
  return isProgramManager(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function reaisToCents(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(
    value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function num(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Upsert em cascata: cria/atualiza a linha da rede (null) ou da empresa. */
async function upsertCascadeRow(
  db: Db,
  table: string,
  companyId: string | null,
  values: Record<string, unknown>,
  matchExtra?: Record<string, unknown>
): Promise<{ error: string | null }> {
  let sel = db.from(table).select("id");
  sel = companyId === null ? sel.is("company_id", null) : sel.eq("company_id", companyId);
  for (const [k, v] of Object.entries(matchExtra ?? {})) sel = sel.eq(k, v);
  const { data: existing } = await sel.maybeSingle();

  if (existing?.id) {
    const { error } = await db.from(table).update(values).eq("id", existing.id);
    return { error: error?.message ?? null };
  }
  const { error } = await db
    .from(table)
    .insert({ company_id: companyId, ...matchExtra, ...values });
  return { error: error?.message ?? null };
}

export async function saveAdhesionPricing(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const values = {
    holder_fee_cents: reaisToCents(field(formData, "holder_fee")) ?? 0,
    dependent_individual_fee_cents:
      reaisToCents(field(formData, "dependent_individual_fee")) ?? 0,
    dependent_family_fee_cents:
      reaisToCents(field(formData, "dependent_family_fee")) ?? 0,
    dependent_family_extra_fee_cents:
      reaisToCents(field(formData, "dependent_family_extra_fee")) ?? 0,
    max_installments: intOrNull(field(formData, "max_installments")) ?? 24,
  };
  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "adhesion_pricing", companyId, values);
  if (error) {
    console.error("saveAdhesionPricing failed:", error);
    return { ok: false, error: "Não foi possível salvar os preços." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_adhesion_pricing",
    entityId: companyId ?? "network",
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function saveSplitRules(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const fr = num(field(formData, "first_payment_risarte_pct")) ?? 0;
  const rr = num(field(formData, "recurring_risarte_pct")) ?? 0;
  if (fr < 0 || fr > 100 || rr < 0 || rr > 100) {
    return { ok: false, error: "Os percentuais devem ficar entre 0 e 100." };
  }
  const values = {
    first_payment_risarte_pct: fr,
    first_payment_rislife_pct: 100 - fr,
    recurring_risarte_pct: rr,
    recurring_rislife_pct: 100 - rr,
  };
  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "split_rules", companyId, values);
  if (error) {
    console.error("saveSplitRules failed:", error);
    return { ok: false, error: "Não foi possível salvar o split." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_split_rules",
    entityId: companyId ?? "network",
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function upsertProcedureBenefit(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const procedureId = field(formData, "procedure_id");
  if (!procedureId) return { ok: false, error: "Escolha o procedimento." };
  const benefitType = field(formData, "benefit_type") ?? "";
  if (!(BENEFIT_TYPES as readonly string[]).includes(benefitType)) {
    return { ok: false, error: "Tipo de benefício inválido." };
  }

  let benefitValue: number | null = null;
  if (benefitType === "DISCOUNT_PERCENT") {
    benefitValue = num(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue < 0 || benefitValue > 100) {
      return { ok: false, error: "Informe um percentual entre 0 e 100." };
    }
  } else if (benefitType === "DISCOUNT_AMOUNT") {
    benefitValue = reaisToCents(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue <= 0) {
      return { ok: false, error: "Informe o valor do desconto." };
    }
  }

  const values = {
    benefit_type: benefitType,
    benefit_value: benefitValue,
    usage_limit_count: intOrNull(field(formData, "usage_limit_count")),
    usage_period_months: intOrNull(field(formData, "usage_period_months")),
    grace_period_months: intOrNull(field(formData, "grace_period_months")) ?? 0,
    max_installments: intOrNull(field(formData, "max_installments")),
  };

  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "procedure_benefits", companyId, values, {
    procedure_id: procedureId,
  });
  if (error) {
    console.error("upsertProcedureBenefit failed:", error);
    return { ok: false, error: "Não foi possível salvar o benefício." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_procedure_benefit",
    entityId: companyId ?? "network",
    details: { procedure_id: procedureId },
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** LGPD: roda a rotina de retenção (anonimiza dados de quem saiu há +5 anos). */
export async function runRetention(): Promise<ActionResult & { count?: number }> {
  await requireAdminMaster();
  const db = await empresarialDb();
  const { data, error } = await db.rpc("run_retention", {});
  if (error) {
    console.error("runRetention failed:", error.message);
    return { ok: false, error: "Não foi possível rodar a retenção." };
  }
  await logAudit({
    action: "anonymize",
    entityType: "empresarial_retention",
    details: { count: data ?? 0 },
  });
  return { ok: true, count: (data as number) ?? 0 };
}

export async function removeOverride(
  table: "adhesion_pricing" | "split_rules",
  companyId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from(table).delete().eq("company_id", companyId);
  if (error) {
    console.error("removeOverride failed:", error);
    return { ok: false, error: "Não foi possível voltar ao padrão da rede." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function deleteProcedureBenefit(
  benefitId: string,
  companyId: string | null
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from("procedure_benefits").delete().eq("id", benefitId);
  if (error) {
    console.error("deleteProcedureBenefit failed:", error);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * O MODELO DE PROPOSTA DA REDE (1014) — prazo padrão e blocos de texto.
 *
 * ⚠️ É a linha com `lead_id` NULO, a que vale para todas as empresas que ainda
 * não personalizaram. Por isso a guarda é a mesma das outras configurações da
 * rede, e não a de quem mexe numa empresa só.
 */
export async function salvarPropostaDaRede(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, null)) return { ok: false, error: "Sem permissão." };

  const dias = Number.parseInt(String(formData.get("valid_days") ?? ""), 10);
  if (!Number.isFinite(dias) || dias < 1 || dias > 365) {
    return { ok: false, error: "A validade padrão vai de 1 a 365 dias." };
  }

  const sections: { titulo: string; corpo: string }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const t = field(formData, `titulo_${i}`);
    const c = field(formData, `corpo_${i}`);
    if (!t && !c) continue;
    sections.push({ titulo: t ?? "", corpo: c ?? "" });
  }
  if (sections.length === 0) {
    return { ok: false, error: "Escreva pelo menos um bloco." };
  }

  const db = await empresarialDb();
  const { data: existente } = await db
    .from("proposal_templates")
    .select("id")
    .is("lead_id", null)
    .maybeSingle();

  const dados = { sections, valid_days: dias, updated_by: session.userId };
  const { error } = existente
    ? await db.from("proposal_templates").update(dados).eq("id", existente.id)
    : await db.from("proposal_templates").insert({ lead_id: null, ...dados });

  if (error) {
    console.error("salvarPropostaDaRede failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o modelo da rede." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_proposal_template",
    entityId: "rede",
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// H2 — grupos de benefícios (1016)
// -----------------------------------------------------------------------------

/**
 * Renomeia, descreve e liga/desliga um grupo.
 *
 * ⚠️ DESLIGAR NÃO APAGA. Grupo desligado some da lista de "aplicar" e continua
 * existindo — as propostas que já o usaram guardaram os benefícios na própria
 * linha delas, então nada muda no que já foi ofertado.
 */
export async function salvarGrupoDeBeneficios(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const id = field(formData, "group_id");
  const nome = field(formData, "name");
  if (!id) return { ok: false, error: "Grupo não informado." };
  if (!nome) return { ok: false, error: "O grupo precisa de um nome." };

  const db = await empresarialDb();
  const { error } = await db
    .from("benefit_groups")
    .update({
      name: nome,
      description: field(formData, "description"),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um grupo com este nome." };
    console.error("salvarGrupoDeBeneficios failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o grupo." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_benefit_group",
    entityId: id,
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

/**
 * Apaga um grupo de vez.
 *
 * Só o grupo: as propostas que o aplicaram copiaram os benefícios para a
 * linha delas, e continuam exatamente como estavam. Apagar aqui não mexe em
 * negociação nenhuma — por isso não há trava.
 */
export async function excluirGrupoDeBeneficios(
  groupId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { error } = await db.from("benefit_groups").delete().eq("id", groupId);
  if (error) {
    console.error("excluirGrupoDeBeneficios failed:", error.message);
    return { ok: false, error: "Não foi possível excluir o grupo." };
  }

  // A trilha não tem "delete" (LGPD: apagar é anonimizar, e aqui não há dado
  // pessoal nenhum). "update" com o tipo próprio registra o que aconteceu.
  await logAudit({
    action: "update",
    entityType: "empresarial_benefit_group_excluido",
    entityId: groupId,
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

/**
 * Cria um grupo de benefícios direto em Configurações (I2).
 *
 * Antes só dava para criar a partir de uma proposta — o que obrigava a abrir
 * uma negociação para montar algo que é da REDE. Aqui o grupo nasce vazio ou
 * copiando o padrão da rede, e os itens são ajustados em seguida.
 */
export async function criarGrupoDeBeneficios(
  formData: FormData
): Promise<ActionResult & { groupId?: string }> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const nome = field(formData, "name");
  if (!nome) return { ok: false, error: "Dê um nome ao grupo." };

  const db = await empresarialDb();
  const { data: grupo, error } = await db
    .from("benefit_groups")
    .insert({
      name: nome,
      description: field(formData, "description"),
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um grupo com este nome." };
    console.error("criarGrupoDeBeneficios failed:", error.message);
    return { ok: false, error: "Não foi possível criar o grupo." };
  }

  // Começar do padrão da rede é o caminho útil: é o que a Risarte já pratica,
  // e o gestor tira ou ajusta o que aquele grupo precisa mudar. Grupo vazio
  // continua possível — basta desmarcar.
  if (formData.get("copiar_da_rede") === "on") {
    const { data: rede } = await db
      .from("procedure_benefits")
      .select(
        "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent"
      )
      .is("company_id", null);
    if (rede?.length) {
      const { error: eI } = await db
        .from("benefit_group_items")
        .insert(rede.map((b) => ({ group_id: grupo.id, ...b })));
      if (eI) {
        console.error("criarGrupoDeBeneficios (itens) failed:", eI.message);
        return {
          ok: true,
          groupId: grupo.id,
          error: "O grupo foi criado, mas os benefícios da rede não entraram.",
        };
      }
    }
  }

  await logAudit({
    action: "create",
    entityType: "empresarial_benefit_group",
    entityId: grupo.id,
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true, groupId: grupo.id };
}

/**
 * Troca os benefícios de um grupo, substituindo o conjunto inteiro.
 *
 * Mesma regra da proposta: o que sumiu da tela sumiu do banco. Um upsert sem
 * limpeza deixaria para sempre o item que alguém tirou.
 */
export async function salvarItensDoGrupo(
  groupId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const itens: Record<string, unknown>[] = [];
  for (let i = 0; i < 200; i += 1) {
    const procedureId = field(formData, `proc_${i}`);
    const tipo = field(formData, `tipo_${i}`);
    if (!procedureId || !tipo) continue;
    if (!(BENEFIT_TYPES as readonly string[]).includes(tipo)) continue;
    const bruto = field(formData, `valor_${i}`);
    const numero = (v: string | null) => {
      if (!v) return null;
      const n = Number.parseFloat(v.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const forHolder = formData.get(`titular_${i}`) === "on";
    const forDependent = formData.get(`dependente_${i}`) === "on";
    // A mesma trava do banco, com a mensagem em português.
    if (!forHolder && !forDependent) {
      return {
        ok: false,
        error: "Todo benefício precisa valer para o titular, para o dependente ou para os dois.",
      };
    }
    itens.push({
      group_id: groupId,
      procedure_id: procedureId,
      benefit_type: tipo,
      benefit_value:
        tipo === "DISCOUNT_PERCENT"
          ? (numero(bruto) ?? null)
          : tipo === "DISCOUNT_AMOUNT"
            ? Math.round((numero(bruto) ?? 0) * 100) || null
            : null,
      usage_limit_count: field(formData, `limite_${i}`)
        ? Number.parseInt(field(formData, `limite_${i}`)!, 10)
        : null,
      usage_period_months: field(formData, `janela_${i}`)
        ? Number.parseInt(field(formData, `janela_${i}`)!, 10)
        : null,
      grace_period_months: field(formData, `carencia_${i}`)
        ? Number.parseInt(field(formData, `carencia_${i}`)!, 10)
        : 0,
      for_holder: forHolder,
      for_dependent: forDependent,
    });
  }

  const db = await empresarialDb();
  const { error: eDel } = await db
    .from("benefit_group_items")
    .delete()
    .eq("group_id", groupId);
  if (eDel) {
    console.error("salvarItensDoGrupo (limpeza) failed:", eDel.message);
    return { ok: false, error: "Não foi possível salvar os benefícios do grupo." };
  }
  if (itens.length > 0) {
    const { error } = await db.from("benefit_group_items").insert(itens);
    if (error) {
      console.error("salvarItensDoGrupo failed:", error.message);
      return { ok: false, error: "Não foi possível salvar os benefícios do grupo." };
    }
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_benefit_group",
    entityId: groupId,
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}
