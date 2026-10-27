"use server";

import { contagemConfirmada, naoConseguiConferir } from "@/lib/contagem";
import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import {
  dataBr,
  mensagemDaVigencia,
  quandoVale,
  RECADO_DA_DATA,
} from "@/lib/vigencia-do-preco";
import { logAudit } from "@/lib/audit";
import { formatBRL, formatSessions, parseBRLToCents } from "@/lib/pricing";
import { repasseParaGravar } from "@/lib/finance/repasse-percentual";
import { METHODOLOGY_PILLARS, type MethodologyPillar } from "@/lib/journey";
import {
  mensagemDaSugestao,
  validarSugestao,
  type CamposDaSugestao,
} from "@/lib/sugestao-de-procedimento";

export type ProcedureResult = { ok: boolean; error?: string };

/**
 * 0212: o catálogo e a Precificação mostram os MESMOS números (preço, comissão,
 * repasse). Revalidar só um deixava o outro exibindo o valor antigo — e tela de
 * dinheiro desatualizada é pior que tela vazia.
 */
function refreshCatalog() {
  revalidatePath("/procedimentos");
  revalidatePath("/procedimentos/precificacao");
}

export type ProcedureInput = {
  name: string;
  tussCode: string;
  specialty: string;
  pillar: string;
  defaultPrice: string;
  minPrice: string;
  maxPrice: string;
  commissionPercent: string;
  commissionFixed: string;
  estimatedMinutes: string;
  /** Venda direta (§7.3): autorizado + quem pode lançar. */
  directSale: boolean;
  directSaleReception: boolean;
  directSaleSdr: boolean;
  /** 0309: a partir de quando vale o PREÇO PADRÃO (aaaa-mm-dd). Vazio/hoje =
   *  já; data futura = o reajuste fica AGENDADO e o banco aplica na data. */
  priceValidFrom?: string;
};

/**
 * SÓ O ADMIN MASTER mexe no catálogo (relato OC-00068, decisão do dono
 * 19/10/2026; antes, desde a 0039, o Planner também). O Planner consulta,
 * edita as SESSÕES (`setProcedureSessions`) e SUGERE procedimento novo.
 * O banco repete a regra (0306).
 */
function canEdit(session: SessionContext): boolean {
  return session.isAdminMaster;
}

function isPlannerSession(session: SessionContext): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
}

function centsOrNull(value: string): number | null | "invalid" {
  if (value.trim() === "") return null;
  const cents = parseBRLToCents(value);
  return cents === null ? "invalid" : cents;
}

function parsePillar(value: string): MethodologyPillar | null {
  return METHODOLOGY_PILLARS.includes(value as MethodologyPillar)
    ? (value as MethodologyPillar)
    : null;
}

type ParsedProcedure = {
  name: string;
  tuss_code: string | null;
  specialty: string | null;
  pillar: MethodologyPillar | null;
  default_price_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  commission_percent: number;
  commission_fixed_cents: number;
  estimated_minutes: number | null;
  direct_sale: boolean;
  direct_sale_reception: boolean;
  direct_sale_sdr: boolean;
};

function parseProcedure(
  input: ProcedureInput
): { error: string } | { values: ParsedProcedure } {
  const name = input.name.trim();
  if (!name) return { error: "Informe o nome do procedimento." };

  const def = input.defaultPrice.trim() ? parseBRLToCents(input.defaultPrice) : 0;
  if (def === null) return { error: "Preço padrão inválido." };
  const min = centsOrNull(input.minPrice);
  if (min === "invalid") return { error: "Preço mínimo inválido." };
  const max = centsOrNull(input.maxPrice);
  if (max === "invalid") return { error: "Preço máximo inválido." };
  if (min !== null && max !== null && min > max) {
    return { error: "O preço mínimo não pode ser maior que o máximo." };
  }
  const fixed = input.commissionFixed.trim()
    ? parseBRLToCents(input.commissionFixed)
    : 0;
  if (fixed === null) return { error: "Comissão (R$) inválida." };
  const percent = input.commissionPercent.trim()
    ? Number(input.commissionPercent.replace(",", "."))
    : 0;
  if (!Number.isFinite(percent) || percent < 0) {
    return { error: "Comissão (%) inválida." };
  }
  // Par R$ ⇄ % (27/10/2026): o que fica gravado é o valor em R$. Percentual
  // vira R$ sobre o preço padrão; só sem preço ele fica como percentual.
  const repasse = repasseParaGravar({
    valorCents: fixed,
    percent,
    precoCents: def,
  });

  let estimated_minutes: number | null = null;
  const estStr = input.estimatedMinutes.trim();
  if (estStr) {
    const n = Number(estStr.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Tempo estimado inválido (use minutos, ex.: 30)." };
    }
    estimated_minutes = Math.round(n);
  }

  return {
    values: {
      name,
      tuss_code: input.tussCode.trim() || null,
      specialty: input.specialty.trim() || null,
      pillar: parsePillar(input.pillar),
      default_price_cents: def,
      min_price_cents: min,
      max_price_cents: max,
      commission_percent: repasse.percent,
      commission_fixed_cents: repasse.valorCents,
      estimated_minutes,
      // Só faz sentido liberar recepção/SDR se o procedimento é de venda direta.
      direct_sale: input.directSale,
      direct_sale_reception: input.directSale && input.directSaleReception,
      direct_sale_sdr: input.directSale && input.directSaleSdr,
    },
  };
}

async function logChange(
  procedureId: string,
  userId: string,
  description: string
) {
  const supabase = await createClient();
  await supabase.from("procedure_changes").insert({
    procedure_id: procedureId,
    changed_by: userId,
    description,
  });
}

export async function addProcedure(
  input: ProcedureInput
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const parsed = parseProcedure(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedures")
    .insert(parsed.values)
    .select("id")
    .single();
  if (error || !data) {
    console.error("addProcedure failed:", error?.message);
    return { ok: false, error: "Não foi possível adicionar o procedimento." };
  }
  await logChange(data.id, session.userId, "Procedimento criado.");
  await logAudit({
    action: "create",
    entityType: "procedure",
    entityId: data.id,
  });
  refreshCatalog();
  return { ok: true };
}

const FIELD_LABELS: Record<keyof ParsedProcedure, string> = {
  name: "Nome",
  tuss_code: "Código TUSS",
  specialty: "Especialidade",
  pillar: "Pilar",
  default_price_cents: "Preço padrão",
  min_price_cents: "Preço mínimo",
  max_price_cents: "Preço máximo",
  commission_percent: "Comissão (%)",
  commission_fixed_cents: "Comissão (R$)",
  estimated_minutes: "Tempo estimado (min)",
  direct_sale: "Venda direta",
  direct_sale_reception: "Venda direta — Recepção",
  direct_sale_sdr: "Venda direta — SDR",
};

export async function editProcedure(
  id: string,
  input: ProcedureInput
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const parsed = parseProcedure(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  // 0309 (decisão do dono): o preço pode valer a partir de uma data futura.
  const quando = quandoVale(input.priceValidFrom, todayInBrazil());
  if (quando === "passado" || quando === "invalida") {
    return { ok: false, error: RECADO_DA_DATA[quando] };
  }

  const supabase = await createClient();
  const { data: old } = await supabase
    .from("procedures")
    .select(
      "name, tuss_code, specialty, pillar, default_price_cents, min_price_cents, max_price_cents, commission_percent, commission_fixed_cents, estimated_minutes, direct_sale, direct_sale_reception, direct_sale_sdr"
    )
    .eq("id", id)
    .single();

  // Preço novo com data futura: o resto salva agora; o preço fica AGENDADO
  // (o de hoje não muda até lá).
  const agendarPreco =
    quando === "futuro" && old != null && parsed.values.default_price_cents !== old.default_price_cents;
  const valores = agendarPreco
    ? { ...parsed.values, default_price_cents: old.default_price_cents }
    : parsed.values;

  const { error } = await supabase
    .from("procedures")
    .update({ ...valores, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("editProcedure failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o procedimento." };
  }

  // History: which labelled fields changed (no need to record values).
  const changed: string[] = [];
  if (old) {
    for (const key of Object.keys(parsed.values) as (keyof ParsedProcedure)[]) {
      if (String(old[key] ?? "") !== String(parsed.values[key] ?? "")) {
        changed.push(FIELD_LABELS[key]);
      }
    }
  }
  if (agendarPreco) {
    const { error: e2 } = await supabase.rpc("schedule_procedure_price", {
      p_procedure_id: id,
      p_clinic_id: null,
      p_price_cents: parsed.values.default_price_cents,
      p_valid_from: input.priceValidFrom,
      p_note: null,
    });
    if (e2) {
      console.error("schedule_procedure_price failed:", e2.message);
      return { ok: false, error: erroDaVigencia(e2.message, "Os dados foram salvos, mas o reajuste NÃO foi agendado.") };
    }
  }

  await logChange(
    id,
    session.userId,
    [
      changed.filter((c) => !(agendarPreco && c === FIELD_LABELS.default_price_cents)).length > 0
        ? `Alterou: ${changed.filter((c) => !(agendarPreco && c === FIELD_LABELS.default_price_cents)).join(", ")}.`
        : "",
      agendarPreco
        ? `Reajuste agendado: ${formatBRL(parsed.values.default_price_cents)} a partir de ${dataBr(input.priceValidFrom as string)}.`
        : "",
    ].filter(Boolean).join(" ") || "Procedimento salvo (sem mudanças)."
  );
  await logAudit({ action: "update", entityType: "procedure", entityId: id });
  refreshCatalog();
  return { ok: true };
}

export async function setProcedureActive(
  id: string,
  active: boolean
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setProcedureActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o procedimento." };
  }
  await logChange(
    id,
    session.userId,
    active ? "Reativado." : "Desativado."
  );
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: id,
    details: { is_active: active },
  });
  refreshCatalog();
  return { ok: true };
}

/**
 * "Excluir" = deactivate so it can't be used in future plans. A procedure that
 * was already used in any budget is NEVER hard-deleted (history is kept); it is
 * only deactivated. An unused procedure is removed.
 */
export async function deleteProcedure(id: string): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();
  const usos = contagemConfirmada(
    await supabase
      .from("treatment_plan_option_items")
      .select("id", { count: "exact", head: true })
      .eq("procedure_id", id)
  );
  // ⚠️ AP11: sem conseguir contar, NÃO se escolhe entre inativar e apagar.
  // Com `count ?? 0`, uma contagem que falhou mandava o procedimento para o
  // caminho de APAGAR. O banco ainda segurava (a ligação com os orçamentos
  // impede), mas quem tentou recebia um erro sem explicação nenhuma.
  if (usos === null) {
    return {
      ok: false,
      error: naoConseguiConferir("se o procedimento já foi usado em algum orçamento"),
    };
  }

  if (usos > 0) {
    const { error } = await supabase
      .from("procedures")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("deleteProcedure (deactivate) failed:", error.message);
      return { ok: false, error: "Não foi possível desativar o procedimento." };
    }
    await logChange(
      id,
      session.userId,
      "Desativado (já usado em orçamentos — não pode ser excluído)."
    );
    refreshCatalog();
    return {
      ok: true,
      error:
        "Procedimento já usado em orçamentos: foi DESATIVADO (não é mais oferecido), preservando o histórico.",
    };
  }

  const { error } = await supabase.from("procedures").delete().eq("id", id);
  if (error) {
    console.error("deleteProcedure failed:", error.message);
    // 0324: procedimento que está num grupo não se apaga (a ligação segura).
    if (error.message.includes("procedure_group_items")) {
      return {
        ok: false,
        error: "Este procedimento está num grupo de procedimentos. Tire-o do grupo (Procedimentos → Grupos) ou desative-o.",
      };
    }
    return { ok: false, error: "Não foi possível excluir o procedimento." };
  }
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: id,
    details: { removed: true },
  });
  refreshCatalog();
  return { ok: true };
}

/** Bulk import from a spreadsheet (rows already mapped to ProcedureInput on the
 * client). Matches existing procedures by name (case-insensitive): updates them,
 * inserts the rest. Returns how many were inserted/updated and any errors. */
export async function importProcedures(
  rows: ProcedureInput[]
): Promise<ProcedureResult & { inserted?: number; updated?: number; errors?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  if (rows.length === 0) return { ok: false, error: "A planilha está vazia." };
  if (rows.length > 2000) {
    return { ok: false, error: "Limite de 2000 procedimentos por importação." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("procedures")
    .select("id, name")
    .returns<{ id: string; name: string }[]>();
  const idByName = new Map(
    (existing ?? []).map((p) => [p.name.trim().toLowerCase(), p.id])
  );

  const toInsert: ParsedProcedure[] = [];
  const toUpdate: { id: string; values: ParsedProcedure }[] = [];
  let errors = 0;

  for (const row of rows) {
    const parsed = parseProcedure(row);
    if ("error" in parsed) {
      errors += 1;
      continue;
    }
    const id = idByName.get(parsed.values.name.trim().toLowerCase());
    if (id) toUpdate.push({ id, values: parsed.values });
    else toInsert.push(parsed.values);
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("procedures")
      .insert(toInsert)
      .select("id");
    if (error) {
      console.error("importProcedures insert failed:", error.message);
      return { ok: false, error: "Não foi possível importar (inserção)." };
    }
    inserted = data?.length ?? 0;
    if (data && data.length > 0) {
      await supabase.from("procedure_changes").insert(
        data.map((p) => ({
          procedure_id: p.id,
          changed_by: session.userId,
          description: "Criado (importação de planilha).",
        }))
      );
    }
  }

  let updated = 0;
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("procedures")
      .update({ ...u.values, updated_at: new Date().toISOString() })
      .eq("id", u.id);
    if (!error) {
      updated += 1;
      await logChange(u.id, session.userId, "Atualizado (importação de planilha).");
    }
  }

  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: "import",
    details: { inserted, updated, errors },
  });
  refreshCatalog();
  return { ok: true, inserted, updated, errors };
}

/** Apply a percentage readjustment to procedure prices, by scope. */
export async function readjustPrices(input: {
  percent: string;
  scope: "all" | "specialty" | "pillar" | "selected";
  specialty?: string;
  pillar?: string;
  ids?: string[];
  applyToBand: boolean;
  /** 0309: data futura = o reajuste fica agendado (sobre o preço de HOJE). */
  validFrom?: string;
}): Promise<ProcedureResult & { adjusted?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const percent = Number(input.percent.replace(",", "."));
  if (!Number.isFinite(percent) || percent === 0) {
    return { ok: false, error: "Informe um percentual válido (ex.: 10 ou -5)." };
  }
  const factor = 1 + percent / 100;
  if (factor <= 0) {
    return { ok: false, error: "Percentual reduz o preço a zero ou menos." };
  }

  const supabase = await createClient();
  let query = supabase
    .from("procedures")
    .select("id, default_price_cents, min_price_cents, max_price_cents");

  if (input.scope === "specialty") {
    if (!input.specialty) return { ok: false, error: "Escolha a especialidade." };
    query = query.eq("specialty", input.specialty);
  } else if (input.scope === "pillar") {
    if (!input.pillar) return { ok: false, error: "Escolha o pilar." };
    query = query.eq("pillar", input.pillar);
  } else if (input.scope === "selected") {
    if (!input.ids || input.ids.length === 0) {
      return { ok: false, error: "Selecione ao menos um procedimento." };
    }
    query = query.in("id", input.ids);
  }

  const { data: procs } = await query.returns<
    {
      id: string;
      default_price_cents: number;
      min_price_cents: number | null;
      max_price_cents: number | null;
    }[]
  >();
  if (!procs || procs.length === 0) {
    return { ok: false, error: "Nenhum procedimento no escopo selecionado." };
  }

  const quando = quandoVale(input.validFrom, todayInBrazil());
  if (quando === "passado" || quando === "invalida") {
    return { ok: false, error: RECADO_DA_DATA[quando] };
  }
  if (quando === "futuro") {
    const { data: n, error } = await supabase.rpc("schedule_price_readjust", {
      p_procedure_ids: procs.map((p) => p.id),
      p_percent: percent,
      p_apply_to_band: input.applyToBand,
      p_valid_from: input.validFrom,
    });
    if (error) {
      console.error("schedule_price_readjust failed:", error.message);
      return { ok: false, error: erroDaVigencia(error.message, "Não foi possível agendar o reajuste.") };
    }
    const rotulo = `Reajuste de ${percent > 0 ? "+" : ""}${input.percent}% agendado para ${dataBr(input.validFrom as string)}.`;
    for (const p of procs) await logChange(p.id, session.userId, rotulo);
    await logAudit({
      action: "update",
      entityType: "procedure",
      entityId: "readjust",
      details: { percent, scope: input.scope, scheduled: Number(n ?? procs.length) },
    });
    refreshCatalog();
    return { ok: true, adjusted: Number(n ?? procs.length) };
  }

  const adj = (cents: number | null) =>
    cents == null ? null : Math.max(0, Math.round(cents * factor));
  const label = `Reajuste de ${percent > 0 ? "+" : ""}${input.percent}%.`;

  let adjusted = 0;
  for (const p of procs) {
    const patch: Record<string, number | null | string> = {
      default_price_cents: adj(p.default_price_cents) ?? p.default_price_cents,
      updated_at: new Date().toISOString(),
    };
    if (input.applyToBand) {
      patch.min_price_cents = adj(p.min_price_cents);
      patch.max_price_cents = adj(p.max_price_cents);
    }
    const { error } = await supabase
      .from("procedures")
      .update(patch)
      .eq("id", p.id);
    if (!error) {
      adjusted += 1;
      await logChange(p.id, session.userId, label);
    }
  }

  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: "readjust",
    details: { percent, scope: input.scope, adjusted },
  });
  refreshCatalog();
  return { ok: true, adjusted };
}

/**
 * H4.13: define a comissão (%, R$ fixo, ou ambos) em massa, por escopo. Campos
 * em branco não são alterados. A comissão só é REALIZADA com o procedimento
 * finalizado — o pagamento é feito no módulo financeiro (Fase 2); aqui é só o
 * cadastro da regra por procedimento.
 */
export async function setCommissionBulk(input: {
  percent?: string;
  fixed?: string;
  scope: "all" | "specialty" | "pillar" | "selected";
  specialty?: string;
  pillar?: string;
  ids?: string[];
}): Promise<ProcedureResult & { adjusted?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }

  const percentStr = (input.percent ?? "").trim();
  const fixedStr = (input.fixed ?? "").trim();
  let percent: number | null = null;
  if (percentStr) {
    const n = Number(percentStr.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Comissão (%) inválida." };
    }
    percent = n;
  }
  let fixedCents: number | null = null;
  if (fixedStr) {
    const c = parseBRLToCents(fixedStr);
    if (c === null) return { ok: false, error: "Comissão (R$) inválida." };
    fixedCents = c;
  }
  if (percent === null && fixedCents === null) {
    return { ok: false, error: "Informe a comissão (% e/ou R$) a aplicar." };
  }

  const supabase = await createClient();
  let query = supabase.from("procedures").select("id");
  if (input.scope === "specialty") {
    if (!input.specialty) return { ok: false, error: "Escolha a especialidade." };
    query = query.eq("specialty", input.specialty);
  } else if (input.scope === "pillar") {
    if (!input.pillar) return { ok: false, error: "Escolha o pilar." };
    query = query.eq("pillar", input.pillar);
  } else if (input.scope === "selected") {
    if (!input.ids || input.ids.length === 0) {
      return { ok: false, error: "Selecione ao menos um procedimento." };
    }
    query = query.in("id", input.ids);
  }
  const { data: procs } = await query.returns<{ id: string }[]>();
  if (!procs || procs.length === 0) {
    return { ok: false, error: "Nenhum procedimento no escopo selecionado." };
  }

  const patch: Record<string, number | string> = {
    updated_at: new Date().toISOString(),
  };
  if (percent !== null) patch.commission_percent = percent;
  if (fixedCents !== null) patch.commission_fixed_cents = fixedCents;

  const ids = procs.map((p) => p.id);
  const { error } = await supabase.from("procedures").update(patch).in("id", ids);
  if (error) {
    console.error("setCommissionBulk failed:", error.message);
    return { ok: false, error: "Não foi possível aplicar a comissão." };
  }

  const parts: string[] = [];
  if (percent !== null) parts.push(`${input.percent!.trim()}%`);
  if (fixedCents !== null) parts.push(formatBRL(fixedCents));
  const label = `Comissão definida em massa: ${parts.join(" + ")}.`;
  await supabase.from("procedure_changes").insert(
    ids.map((id) => ({
      procedure_id: id,
      changed_by: session.userId,
      description: label,
    }))
  );
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: "commission-bulk",
    details: { scope: input.scope, count: ids.length },
  });
  refreshCatalog();
  return { ok: true, adjusted: ids.length };
}

// ---------------------------------------------------------------------------
// Protocolo de sessões (E1 rede / E2 unidade). Substitui o protocolo do escopo
// (rede = clinicId null; unidade = clinicId) e, na rede, recalcula o total
// (procedures.estimated_minutes).
// ---------------------------------------------------------------------------
export type SessionInput = {
  name: string;
  minutes: number;
  /** Dias mínimos após a sessão anterior (ignorado na 1ª sessão). */
  intervalDays?: number | null;
};

type CleanSession = { name: string; minutes: number; intervalDays: number | null };

function cleanSessions(sessions: SessionInput[]): CleanSession[] {
  return sessions.slice(0, 30).map((s, i) => ({
    name: s.name.trim() || `Sessão ${i + 1}`,
    minutes: Math.max(0, Math.round(Number(s.minutes) || 0)),
    intervalDays:
      s.intervalDays != null && Number.isFinite(Number(s.intervalDays))
        ? Math.max(0, Math.round(Number(s.intervalDays)))
        : null,
  }));
}

/** Substitui o protocolo do escopo (rede/unidade) — sem checagem de permissão. */
async function writeProcedureSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  procedureId: string,
  clinicId: string | null,
  clean: CleanSession[],
  userId: string
): Promise<{ error?: string; total: number }> {
  const isNetwork = clinicId === null;
  let del = supabase
    .from("procedure_sessions")
    .delete()
    .eq("procedure_id", procedureId);
  del = isNetwork ? del.is("clinic_id", null) : del.eq("clinic_id", clinicId);
  await del;

  const rows = clean.map((s, i) => ({
    procedure_id: procedureId,
    clinic_id: clinicId,
    session_index: i + 1,
    name: s.name,
    estimated_minutes: s.minutes,
    // A 1ª sessão não tem intervalo (não há sessão anterior).
    min_interval_days: i === 0 ? null : s.intervalDays,
    created_by: userId,
  }));
  const { error } = await supabase.from("procedure_sessions").insert(rows);
  if (error) {
    console.error("writeProcedureSessions failed:", error.message);
    return { error: "Não foi possível salvar as sessões.", total: 0 };
  }
  const total = clean.reduce((sum, s) => sum + s.minutes, 0);
  if (isNetwork) {
    await supabase
      .from("procedures")
      .update({
        estimated_minutes: total > 0 ? total : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", procedureId);
  }
  return { total };
}

export async function setProcedureSessions(
  procedureId: string,
  clinicId: string | null,
  sessions: SessionInput[]
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const isNetwork = clinicId === null;
  // OC-00068 (decisão do dono, 19/10/2026): o Planner EDITA DIRETO o
  // protocolo da REDE — é a única coisa que ele grava no catálogo. Na unidade
  // segue o Coordenador (o Planner propõe).
  const allowed = isNetwork
    ? session.isAdminMaster || isPlannerSession(session)
    : session.isAdminMaster ||
      hasRoleInClinic(session, clinicId!, ["clinical_coordinator"]);
  if (!allowed) {
    return {
      ok: false,
      error: "Sem permissão para aplicar direto. Use 'Propor alteração'.",
    };
  }

  const clean = cleanSessions(sessions);
  if (clean.length === 0) {
    return { ok: false, error: "Defina ao menos uma sessão." };
  }

  const supabase = await createClient();
  // A REDE grava pela função do banco (0306): ela confere quem pode, troca o
  // protocolo, recalcula o tempo do procedimento e registra no histórico —
  // o Planner não grava mais em `procedures` direto.
  let total = 0;
  if (isNetwork) {
    const { error } = await supabase.rpc("set_network_procedure_sessions", {
      p_procedure_id: procedureId,
      p_sessions: clean.map((c) => ({ name: c.name, minutes: c.minutes, intervalDays: c.intervalDays })),
    });
    if (error) {
      console.error("set_network_procedure_sessions failed:", error.message);
      return {
        ok: false,
        error: /could not find the function|schema cache/i.test(error.message)
          ? "O banco ainda não recebeu a atualização 0306."
          : "Não foi possível salvar as sessões.",
      };
    }
    total = clean.reduce((soma, c) => soma + c.minutes, 0);
  } else {
    const w = await writeProcedureSessions(supabase, procedureId, clinicId, clean, session.userId);
    if (w.error) return { ok: false, error: w.error };
    total = w.total;
    await logChange(
      procedureId,
      session.userId,
      `Protocolo da unidade: ${formatSessions(clean.length)}, ${w.total} min.`
    );
  }
  await logAudit({
    action: "update",
    entityType: "procedure_sessions",
    entityId: procedureId,
    details: { network: isNetwork, sessions: clean.length, total },
  });
  refreshCatalog();
  return { ok: true };
}

/** H4.3 Lote 4: o Planner PROPÕE uma alteração definitiva (rede ou unidade). */
export async function proposeProtocolChange(
  procedureId: string,
  clinicId: string | null,
  sessions: SessionInput[],
  note: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  if (!session.isAdminMaster && !isPlanner) {
    return { ok: false, error: "Apenas o Dentista Planner pode propor." };
  }
  const clean = cleanSessions(sessions);
  if (clean.length === 0) {
    return { ok: false, error: "Defina ao menos uma sessão." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("protocol_change_proposals")
    .insert({
      procedure_id: procedureId,
      clinic_id: clinicId,
      proposed_by: session.userId,
      note: note.trim() || null,
      sessions: clean,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("proposeProtocolChange failed:", error?.message);
    return { ok: false, error: "Não foi possível registrar a proposta." };
  }
  await supabase.rpc("notify_protocol_proposal", { p_proposal_id: data.id });
  await logAudit({
    action: "create",
    entityType: "protocol_change_proposal",
    entityId: data.id,
    clinicId: clinicId ?? undefined,
  });
  refreshCatalog();
  return { ok: true };
}

/** H4.3 Lote 4: Admin (rede) ou Coordenador (unidade) aprova/recusa a proposta. */
export async function reviewProtocolProposal(
  proposalId: string,
  approve: boolean,
  reviewNotes: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: prop } = await supabase
    .from("protocol_change_proposals")
    .select("id, procedure_id, clinic_id, sessions, status")
    .eq("id", proposalId)
    .maybeSingle();
  if (!prop) return { ok: false, error: "Proposta não encontrada." };
  if (prop.status !== "pending") {
    return { ok: false, error: "Esta proposta já foi revisada." };
  }
  const canReview =
    session.isAdminMaster ||
    (prop.clinic_id != null &&
      hasRoleInClinic(session, prop.clinic_id, ["clinical_coordinator"]));
  if (!canReview) {
    return { ok: false, error: "Sem permissão para revisar esta proposta." };
  }
  if (!approve && !reviewNotes.trim()) {
    return { ok: false, error: "Informe o motivo da recusa." };
  }

  if (approve) {
    const clean = cleanSessions((prop.sessions ?? []) as SessionInput[]);
    if (clean.length === 0) {
      return { ok: false, error: "A proposta não tem sessões." };
    }
    const w = await writeProcedureSessions(
      supabase,
      prop.procedure_id,
      prop.clinic_id,
      clean,
      session.userId
    );
    if (w.error) return { ok: false, error: w.error };
    await logChange(
      prop.procedure_id,
      session.userId,
      `Protocolo ${prop.clinic_id ? "da unidade" : "da rede"} aplicado por proposta: ${formatSessions(clean.length)}, ${w.total} min.`
    );
  }

  const { error } = await supabase
    .from("protocol_change_proposals")
    .update({
      status: approve ? "approved" : "rejected",
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes.trim() || null,
    })
    .eq("id", proposalId);
  if (error) {
    console.error("reviewProtocolProposal failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a decisão." };
  }
  await supabase.rpc("notify_protocol_decision", { p_proposal_id: proposalId });
  await logAudit({
    action: "update",
    entityType: "protocol_change_proposal",
    entityId: proposalId,
    clinicId: prop.clinic_id ?? undefined,
    details: { approved: approve },
  });
  refreshCatalog();
  return { ok: true };
}

/** Remove a unit's customized protocol (reverts to the network default). */
export async function clearProcedureSessions(
  procedureId: string,
  clinicId: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const allowed =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["clinical_coordinator"]);
  if (!allowed) return { ok: false, error: "Sem permissão." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("procedure_sessions")
    .delete()
    .eq("procedure_id", procedureId)
    .eq("clinic_id", clinicId);
  if (error) {
    console.error("clearProcedureSessions failed:", error.message);
    return { ok: false, error: "Não foi possível remover a personalização." };
  }
  await logChange(
    procedureId,
    session.userId,
    "Removeu o protocolo personalizado da unidade (voltou ao padrão da Rede)."
  );
  await logAudit({
    action: "update",
    entityType: "procedure_sessions",
    entityId: procedureId,
    details: { cleared_unit: clinicId },
  });
  refreshCatalog();
  return { ok: true };
}

/** Set (or clear, when blank) a unit's price override for a procedure. */
export async function setUnitPrice(
  clinicId: string,
  procedureId: string,
  price: string,
  /** 0309: data futura = agenda o preço da unidade. */
  validFrom?: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();

  const quando = quandoVale(validFrom, todayInBrazil());
  if (quando === "passado" || quando === "invalida") {
    return { ok: false, error: RECADO_DA_DATA[quando] };
  }
  if (quando === "futuro") {
    if (price.trim() === "") {
      return { ok: false, error: "Para a unidade voltar ao preço da rede, use a data de hoje." };
    }
    const cents = parseBRLToCents(price);
    if (cents === null) return { ok: false, error: "Preço inválido." };
    const { error } = await supabase.rpc("schedule_procedure_price", {
      p_procedure_id: procedureId,
      p_clinic_id: clinicId,
      p_price_cents: cents,
      p_valid_from: validFrom,
      p_note: null,
    });
    if (error) {
      console.error("schedule_procedure_price (unit) failed:", error.message);
      return { ok: false, error: erroDaVigencia(error.message, "Não foi possível agendar o preço da unidade.") };
    }
    await logChange(procedureId, session.userId, `Preço da unidade agendado: ${formatBRL(cents)} a partir de ${dataBr(validFrom as string)}.`);
    refreshCatalog();
    return { ok: true };
  }

  if (price.trim() === "") {
    const { error } = await supabase
      .from("clinic_procedure_prices")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("procedure_id", procedureId);
    if (error) {
      console.error("setUnitPrice (clear) failed:", error.message);
      return { ok: false, error: "Não foi possível remover o preço da unidade." };
    }
    refreshCatalog();
    return { ok: true };
  }

  const priceCents = parseBRLToCents(price);
  if (priceCents === null) return { ok: false, error: "Preço inválido." };

  const { error } = await supabase.from("clinic_procedure_prices").upsert(
    {
      clinic_id: clinicId,
      procedure_id: procedureId,
      price_cents: priceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,procedure_id" }
  );
  if (error) {
    console.error("setUnitPrice failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o preço da unidade." };
  }
  refreshCatalog();
  return { ok: true };
}

/**
 * 0212 — repasse por NÍVEL, lançado no próprio procedimento.
 *
 * Grava sempre no escopo da REDE (clinic_id nulo): o catálogo é da rede, e a
 * unidade que negociou contrato próprio sobrescreve em Financeiro › Repasses.
 * É a mesma cascata do preço.
 *
 * Quem grava é o banco (`set_payout_rate_for_level`): trocar o valor significa
 * ENCERRAR a vigência anterior e abrir outra, e essas duas coisas não podem
 * acontecer pela metade — senão o mesmo procedimento fica com dois valores
 * vigentes e a apuração passa a depender de sorte.
 */
export async function saveProcedurePayoutLevels(input: {
  procedureId: string;
  values: { levelId: string; amount: string }[];
}): Promise<ProcedureResult> {
  const session = await getSessionContext();
  // Repasse é dinheiro do dentista: o Planner edita o catálogo, mas não a
  // remuneração. A RLS diz o mesmo — aqui é só para o erro sair legível.
  if (!session.isAdminMaster) {
    return {
      ok: false,
      error: "Só o Admin Master define o repasse padrão da rede.",
    };
  }
  const supabase = await createClient();

  for (const v of input.values) {
    const cents = parseBRLToCents(v.amount);
    if (cents === null || cents < 0) {
      return { ok: false, error: `Valor inválido: ${v.amount}` };
    }
    const { error } = await supabase.rpc("set_payout_rate_for_level", {
      p_procedure_id: input.procedureId,
      p_level_id: v.levelId,
      p_clinic_id: null,
      p_amount_cents: cents,
      p_valid_from: null,
    });
    if (error) {
      console.error("set_payout_rate_for_level failed:", error.message);
      if (error.message.includes("NOT_ALLOWED")) {
        return { ok: false, error: "Sem permissão para definir o repasse." };
      }
      return { ok: false, error: "Não foi possível salvar o repasse." };
    }
  }

  await logAudit({
    action: "update",
    entityType: "payout_rate",
    entityId: input.procedureId,
  });
  refreshCatalog();
  revalidatePath("/financeiro/repasses");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SUGESTÃO DE PROCEDIMENTO (relatos OC-00067/OC-00068, 0306)
// ---------------------------------------------------------------------------
function refreshSugestoes() {
  revalidatePath("/procedimentos");
}

function erroDaSugestao(message: string, padrao: string): string {
  if (/could not find the function|schema cache/i.test(message)) {
    return "O banco ainda não recebeu a atualização 0306.";
  }
  return mensagemDaSugestao(message) ?? padrao;
}

/** O Planner (ou o Admin) sugere um procedimento que o catálogo não tem. */
export async function suggestProcedure(
  campos: CamposDaSugestao
): Promise<ProcedureResult & { code?: string }> {
  await getSessionContext();
  const v = validarSugestao(campos);
  if ("erro" in v) return { ok: false, error: v.erro };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_procedure", {
    p_name: v.valores.name,
    p_specialty: v.valores.specialty,
    p_pillar: v.valores.pillar,
    p_sessions: v.valores.sessions,
    p_total_minutes: v.valores.totalMinutes,
    p_justification: v.valores.justification,
  });
  if (error) {
    console.error("suggest_procedure failed:", error.message);
    return { ok: false, error: erroDaSugestao(error.message, "Não foi possível enviar a sugestão.") };
  }
  await logAudit({ action: "create", entityType: "procedure_suggestion", entityId: String(data) });
  refreshSugestoes();
  return { ok: true, code: String(data) };
}

export async function askProcedureSuggestionInfo(id: string, question: string): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master decide as sugestões." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ask_procedure_suggestion_info", { p_id: id, p_question: question });
  if (error) return { ok: false, error: erroDaSugestao(error.message, "Não foi possível enviar a pergunta.") };
  await logAudit({ action: "update", entityType: "procedure_suggestion", entityId: id, details: { acao: "pergunta" } });
  refreshSugestoes();
  return { ok: true };
}

export async function answerProcedureSuggestion(
  id: string,
  answer: string,
  campos: CamposDaSugestao
): Promise<ProcedureResult> {
  await getSessionContext();
  const v = validarSugestao(campos);
  if ("erro" in v) return { ok: false, error: v.erro };
  if (answer.trim().length < 3) return { ok: false, error: "Escreva a resposta." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_procedure_suggestion", {
    p_id: id,
    p_answer: answer.trim(),
    p_name: v.valores.name,
    p_specialty: v.valores.specialty,
    p_pillar: v.valores.pillar,
    p_sessions: v.valores.sessions,
    p_total_minutes: v.valores.totalMinutes,
    p_justification: v.valores.justification,
  });
  if (error) return { ok: false, error: erroDaSugestao(error.message, "Não foi possível enviar a resposta.") };
  await logAudit({ action: "update", entityType: "procedure_suggestion", entityId: id, details: { acao: "resposta" } });
  refreshSugestoes();
  return { ok: true };
}

export async function rejectProcedureSuggestion(id: string, reason: string): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master decide as sugestões." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_procedure_suggestion", { p_id: id, p_reason: reason });
  if (error) return { ok: false, error: erroDaSugestao(error.message, "Não foi possível recusar.") };
  await logAudit({ action: "update", entityType: "procedure_suggestion", entityId: id, details: { acao: "recusa" } });
  refreshSugestoes();
  return { ok: true };
}

/**
 * APROVAR = CADASTRAR. O procedimento nasce aqui (o Admin define preço e
 * comissão, pela mesma régua do cadastro), e o banco liga a sugestão a ele e
 * transforma as sessões sugeridas no protocolo da rede.
 */
export async function approveProcedureSuggestion(id: string, input: ProcedureInput): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master decide as sugestões." };
  const parsed = parseProcedure(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase.from("procedures").insert(parsed.values).select("id").single();
  if (error || !data) {
    console.error("approveProcedureSuggestion (cadastro) failed:", error?.message);
    return { ok: false, error: "Não foi possível cadastrar o procedimento." };
  }
  const { error: erroDaLigacao } = await supabase.rpc("approve_procedure_suggestion", {
    p_id: id,
    p_procedure_id: data.id,
  });
  if (erroDaLigacao) {
    // O procedimento já existe — o Admin vê e pode ligar de novo; não some nada.
    console.error("approve_procedure_suggestion failed:", erroDaLigacao.message);
    return {
      ok: false,
      error: `O procedimento foi cadastrado, mas a sugestão não foi marcada como aprovada: ${erroDaSugestao(erroDaLigacao.message, "tente de novo")}.`,
    };
  }
  await logChange(data.id, session.userId, "Procedimento criado a partir de sugestão do Centro de Planejamento.");
  await logAudit({ action: "create", entityType: "procedure", entityId: data.id });
  await logAudit({ action: "update", entityType: "procedure_suggestion", entityId: id, details: { acao: "aprovacao" } });
  refreshCatalog();
  refreshSugestoes();
  return { ok: true };
}

// =============================================================================
// 0309 — VIGÊNCIA DO PREÇO: cancelar, aplicar o atrasado, ler o histórico.
// =============================================================================

function erroDaVigencia(mensagem: string, padrao: string): string {
  if (/could not find the function|schema cache|does not exist/i.test(mensagem)) {
    return "O banco ainda não recebeu a atualização 0309.";
  }
  return mensagemDaVigencia(mensagem) ?? padrao;
}

export async function cancelarReajusteAgendado(id: string): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) return { ok: false, error: "Só o Admin Master mexe no preço." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_procedure_price_schedule", { p_id: id });
  if (error) {
    console.error("cancel_procedure_price_schedule failed:", error.message);
    return { ok: false, error: erroDaVigencia(error.message, "Não foi possível cancelar o reajuste.") };
  }
  await logAudit({ action: "update", entityType: "procedure_price_schedule", entityId: id });
  refreshCatalog();
  return { ok: true };
}

/** "Aplicar agora": para quando a rotina da madrugada não aplicou. */
export async function aplicarReajustesAtrasados(): Promise<ProcedureResult & { aplicados?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) return { ok: false, error: "Só o Admin Master mexe no preço." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_due_procedure_prices");
  if (error) {
    console.error("apply_due_procedure_prices failed:", error.message);
    return { ok: false, error: erroDaVigencia(error.message, "Não foi possível aplicar os reajustes.") };
  }
  await logAudit({ action: "update", entityType: "procedure_price_schedule", entityId: "aplicar-atrasados" });
  refreshCatalog();
  return { ok: true, aplicados: Number(data ?? 0) };
}

export type LinhaDoHistoricoDePreco = {
  clinicId: string | null;
  priceCents: number | null;
  validFrom: string;
  source: string;
  quem: string | null;
};

/** O histórico de preço de um procedimento (lido quando o cartão abre). */
export async function historicoDoPreco(
  procedureId: string
): Promise<{ ok: true; linhas: LinhaDoHistoricoDePreco[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedure_price_history")
    .select("clinic_id, price_cents, valid_from, source, created_at, quem:profiles!procedure_price_history_changed_by_fkey(full_name)")
    .eq("procedure_id", procedureId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("historicoDoPreco failed:", error.message);
    return { ok: false, error: erroDaVigencia(error.message, "Não foi possível ler o histórico de preço.") };
  }
  return {
    ok: true,
    linhas: (data ?? []).map((r) => {
      const quem = Array.isArray(r.quem) ? r.quem[0] : r.quem;
      return {
        clinicId: r.clinic_id as string | null,
        priceCents: r.price_cents as number | null,
        validFrom: r.valid_from as string,
        source: r.source as string,
        quem: (quem?.full_name as string | undefined) ?? null,
      };
    }),
  };
}
