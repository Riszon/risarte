"use server";

import { indicesDoFormulario } from "@/lib/indices-do-formulario";
import { revalidatePath } from "next/cache";
import { getSessionContext, requireAdminMaster } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { BENEFIT_TYPES } from "@/lib/empresarial/constants";
import { lerModelo, problemasDoModelo } from "@/lib/empresarial/contrato";
import { maskDocument } from "@/lib/empresarial/documents";
import {
  limparDetalhe,
  problemasDasVantagens,
  type VantagemEscolhida,
} from "@/lib/empresarial/vantagens";

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

/** As regras do benefício (cobertura, usos, carência, parcelas), iguais para um ou vários. */
function lerRegrasDoBeneficio(
  formData: FormData
): { values: Record<string, unknown> } | { error: string } {
  const benefitType = field(formData, "benefit_type") ?? "";
  if (!(BENEFIT_TYPES as readonly string[]).includes(benefitType)) {
    return { error: "Tipo de benefício inválido." };
  }

  let benefitValue: number | null = null;
  if (benefitType === "DISCOUNT_PERCENT") {
    benefitValue = num(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue < 0 || benefitValue > 100) {
      return { error: "Informe um percentual entre 0 e 100." };
    }
  } else if (benefitType === "DISCOUNT_AMOUNT") {
    benefitValue = reaisToCents(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue <= 0) {
      return { error: "Informe o valor do desconto." };
    }
  }

  return {
    values: {
      benefit_type: benefitType,
      benefit_value: benefitValue,
      usage_limit_count: intOrNull(field(formData, "usage_limit_count")),
      usage_period_months: intOrNull(field(formData, "usage_period_months")),
      grace_period_months: intOrNull(field(formData, "grace_period_months")) ?? 0,
      max_installments: intOrNull(field(formData, "max_installments")),
    },
  };
}

/** Um procedimento por vez acima disso seria engano (a rede inteira tem ~400). */
const MAXIMO_DE_UMA_VEZ = 500;

/**
 * VÁRIOS PROCEDIMENTOS, AS MESMAS REGRAS (pedido do dono, 28/10/2026: "inserir
 * 10 procedimentos que têm as mesmas regras sem fazer um por vez"). Só cria —
 * procedimento que já tem benefício neste escopo faz recusar tudo (mudar é
 * pelo Editar da linha). Um INSERT só: ou entram todos, ou nenhum.
 */
export async function adicionarBeneficios(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult & { quantos?: number }> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const ids = [
    ...new Set(
      formData
        .getAll("procedure_id")
        .map((v) => String(v).trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) return { ok: false, error: "Marque pelo menos um procedimento." };
  if (ids.length > MAXIMO_DE_UMA_VEZ) {
    return { ok: false, error: `No máximo ${MAXIMO_DE_UMA_VEZ} procedimentos de uma vez.` };
  }
  const regras = lerRegrasDoBeneficio(formData);
  if ("error" in regras) return { ok: false, error: regras.error };

  const db = await empresarialDb();
  let sel = db.from("procedure_benefits").select("procedure_id").in("procedure_id", ids);
  sel = companyId === null ? sel.is("company_id", null) : sel.eq("company_id", companyId);
  const { data: jaTem, error: erroDaLeitura } = await sel;
  if (erroDaLeitura) {
    console.error("adicionarBeneficios read failed:", erroDaLeitura);
    return { ok: false, error: "Não foi possível conferir os benefícios que já existem." };
  }
  if ((jaTem ?? []).length > 0) {
    return {
      ok: false,
      error: `${jaTem!.length} dos procedimentos marcados já têm benefício (alguém acabou de incluir?). Atualize a tela e tente de novo — nada foi gravado.`,
    };
  }

  const { error } = await db
    .from("procedure_benefits")
    .insert(ids.map((procedureId) => ({ company_id: companyId, procedure_id: procedureId, ...regras.values })));
  if (error) {
    console.error("adicionarBeneficios failed:", error);
    return { ok: false, error: "Não foi possível salvar os benefícios. Nada foi gravado." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_procedure_benefit",
    entityId: companyId ?? "network",
    details: { procedure_ids: ids },
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, quantos: ids.length };
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
  const regras = lerRegrasDoBeneficio(formData);
  if ("error" in regras) return { ok: false, error: regras.error };
  const values = regras.values;

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
  for (const i of indicesDoFormulario(formData, "proc_")) {
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

  // 1033: AS OUTRAS VANTAGENS DO GRUPO, pela mesma regra — o conjunto inteiro
  // é substituído. Só mexe quando o bloco estava na tela.
  if (formData.has("vantagens_no_formulario")) {
    const vantagens = vantagensDoFormulario(formData);
    const problemas = problemasDasVantagens(vantagens);
    if (problemas.length > 0) {
      return { ok: false, error: `Os procedimentos foram salvos, mas as vantagens não: ${problemas.join("; ")}.` };
    }
    const { error: eDelV } = await db.from("benefit_group_perks").delete().eq("group_id", groupId);
    const { error: eInsV } =
      eDelV || vantagens.length === 0
        ? { error: null }
        : await db.from("benefit_group_perks").insert(
            vantagens.map((v) => ({ group_id: groupId, perk_id: v.perkId, detail: v.detail }))
          );
    if (eDelV || eInsV) {
      console.error("salvarItensDoGrupo (vantagens) failed:", (eDelV ?? eInsV)?.message);
      return { ok: false, error: "Os procedimentos foram salvos, mas as outras vantagens não." };
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

// -----------------------------------------------------------------------------
// 1033 — as outras vantagens do programa (catálogo da rede)
// -----------------------------------------------------------------------------

/** As vantagens escolhidas num formulário: `vant_i` (id) e `vant_det_i` (detalhe). */
function vantagensDoFormulario(formData: FormData): VantagemEscolhida[] {
  const lista: VantagemEscolhida[] = [];
  for (const i of indicesDoFormulario(formData, "vant_")) {
    const perkId = field(formData, `vant_${i}`);
    if (!perkId) continue;
    lista.push({ perkId, detail: limparDetalhe(field(formData, `vant_det_${i}`)) });
  }
  return lista;
}

/**
 * Cria ou edita uma vantagem do catálogo da rede.
 *
 * ⚠️ RENOMEAR NÃO REESCREVE O QUE FOI VENDIDO: a empresa que fechou guarda o
 * nome e o detalhe na linha dela (`company_perks`). O que muda é o que as
 * propostas mostram daqui em diante.
 */
export async function salvarVantagem(formData: FormData): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const id = field(formData, "perk_id");
  const name = field(formData, "name");
  if (!name) return { ok: false, error: "Dê um nome à vantagem." };
  if (name.length > 120) return { ok: false, error: "O nome passa de 120 letras." };
  const linha = {
    name,
    description: field(formData, "description"),
    is_active: id ? formData.get("is_active") === "on" : true,
  };

  const db = await empresarialDb();
  const { data, error } = id
    ? await db.from("perks").update(linha).eq("id", id).select("id").single()
    : await db
        .from("perks")
        .insert({ ...linha, created_by: session.userId })
        .select("id")
        .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe uma vantagem com este nome." };
    console.error("salvarVantagem failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a vantagem." };
  }

  await logAudit({
    action: id ? "update" : "create",
    entityType: "empresarial_perk",
    entityId: data.id,
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

/**
 * Exclui uma vantagem — só a que NUNCA foi usada.
 *
 * Usada numa proposta ou num grupo, o banco recusa (`on delete restrict`) e a
 * tela manda desativar: apagar levaria junto o que foi oferecido.
 */
export async function excluirVantagem(perkId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { error } = await db.from("perks").delete().eq("id", perkId);
  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error: "Esta vantagem já está em proposta ou grupo. Desmarque “Disponível” para tirá-la das próximas, em vez de excluir.",
      };
    }
    console.error("excluirVantagem failed:", error.message);
    return { ok: false, error: "Não foi possível excluir a vantagem." };
  }
  await logAudit({ action: "update", entityType: "empresarial_perk_excluida", entityId: perkId });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// 1027 — o contrato dentro do sistema
// -----------------------------------------------------------------------------

/**
 * Salva o MODELO DE CONTRATO da rede.
 *
 * ⚠️ MUDA O CONTRATO DE TODA EMPRESA que não personalizou o texto. Por isso é
 * ato do gestor do programa (e a RLS confirma), e modelo com campo que o
 * sistema não conhece é RECUSADO — ele sairia impresso com as chaves num
 * documento que vai para assinatura.
 */
export async function salvarContratoDaRede(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const modelo = lerModelo(formData);
  const problemas = problemasDoModelo(modelo);
  if (problemas.length) {
    return { ok: false, error: `Antes de salvar: ${problemas.join("; ")}.` };
  }

  const dados = {
    title: modelo.titulo,
    preamble: modelo.preambulo,
    sections: modelo.blocos,
    closing: modelo.fecho,
    updated_by: session.userId,
  };
  const db = await empresarialDb();
  const { data: existente, error: erroDaLeitura } = await db
    .from("contract_templates")
    .select("id")
    .is("lead_id", null)
    .maybeSingle();
  if (erroDaLeitura) {
    console.error("salvarContratoDaRede (leitura) failed:", erroDaLeitura.message);
    return {
      ok: false,
      error: "Não foi possível ler o modelo. Confirme se a migração 1027 foi aplicada neste banco.",
    };
  }

  const { error } = existente
    ? await db.from("contract_templates").update(dados).eq("id", existente.id)
    : await db.from("contract_templates").insert({ lead_id: null, ...dados });
  if (error) {
    console.error("salvarContratoDaRede failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o modelo de contrato." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_contract_template",
    entityId: "rede",
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}

/**
 * A parte da RISARTE no contrato: razão social, CNPJ, endereço, e o
 * representante (nome, RG, CPF).
 *
 * ⚠️ É DADO PESSOAL DO REPRESENTANTE, e mora só aqui (decisão do dono,
 * 13/10/2026): não está em migração nem em código. O registro de auditoria
 * desta action não leva nenhum dos valores.
 */
export async function salvarDadosDaContratada(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const cpf = field(formData, "rep_cpf");
  if (cpf && cpf.replace(/\D/g, "").length !== 11) {
    return { ok: false, error: "O CPF do representante deve ter 11 dígitos." };
  }
  const cnpj = field(formData, "cnpj");
  if (cnpj && cnpj.replace(/\D/g, "").length !== 14) {
    return { ok: false, error: "O CNPJ da contratada deve ter 14 dígitos." };
  }

  const db = await empresarialDb();
  const { error } = await db.from("contract_settings").upsert(
    {
      id: true,
      legal_name: field(formData, "legal_name"),
      cnpj: cnpj ? maskDocument("CNPJ", cnpj) : null,
      address: field(formData, "address"),
      rep_name: field(formData, "rep_name"),
      rep_role: field(formData, "rep_role"),
      rep_nationality: field(formData, "rep_nationality"),
      rep_rg: field(formData, "rep_rg"),
      rep_cpf: cpf ? maskDocument("CPF", cpf) : null,
      signing_city: field(formData, "signing_city"),
      updated_by: session.userId,
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("salvarDadosDaContratada failed:", error.message);
    return {
      ok: false,
      error: "Não foi possível salvar. Confirme se a migração 1027 foi aplicada neste banco.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_contract_settings",
    entityId: "rede",
  });
  revalidatePath("/empresarial/configuracoes");
  return { ok: true };
}
