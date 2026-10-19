"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  mensagemDoOdontograma,
  validarRegra,
  validarSituacao,
  type CamposDaSituacao,
  type RegraDoProcedimento,
} from "@/lib/odontograma/referencia";

/**
 * Administração → Odontograma (OD1, pedido do dono, 19/10/2026): o Admin
 * ajusta o que veio das planilhas revisadas. O banco (0308) repete todas as
 * regras — o que é oficial da TUSS não muda, e nada se apaga.
 */

type Resultado = { ok: boolean; error?: string };

async function soAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { error: "Só o Admin Master configura o odontograma." };
  return { userId: session.userId };
}

function erroDoBanco(mensagem: string, padrao: string): string {
  if (/relation .* does not exist|schema cache/i.test(mensagem)) {
    return "O banco ainda não recebeu a atualização 0308.";
  }
  return mensagemDoOdontograma(mensagem) ?? padrao;
}

function atualizar() {
  revalidatePath("/admin/odontograma");
}

/** Cria (código novo, só da Risarte) ou altera uma situação. */
export async function salvarSituacao(
  campos: CamposDaSituacao & { isActive: boolean },
  nova: boolean
): Promise<Resultado> {
  const quem = await soAdmin();
  if ("error" in quem) return { ok: false, error: quem.error };
  const v = validarSituacao(campos, nova);
  if ("erro" in v) return { ok: false, error: v.erro };

  const supabase = await createClient();
  const linha = {
    name: v.valores.name,
    applies_to: v.valores.appliesTo,
    usage: v.valores.usage,
    symbol: v.valores.symbol,
    is_active: campos.isActive,
  };
  const { error } = nova
    ? await supabase.from("dental_conditions").insert({
        ...linha,
        code: v.valores.code,
        source: "risarte",
        sort_order: 1000,
      })
    : await supabase.from("dental_conditions").update(linha).eq("code", v.valores.code);
  if (error) {
    console.error("salvarSituacao failed:", error.message);
    return { ok: false, error: erroDoBanco(error.message, "Não foi possível salvar a situação.") };
  }
  await logAudit({ action: nova ? "create" : "update", entityType: "dental_condition", entityId: v.valores.code });
  atualizar();
  return { ok: true };
}

/** Troca as faces de um dente. */
export async function salvarFacesDoDente(dente: string, faces: string[]): Promise<Resultado> {
  const quem = await soAdmin();
  if ("error" in quem) return { ok: false, error: quem.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_tooth_faces", { p_tooth: dente, p_faces: faces });
  if (error) {
    console.error("set_tooth_faces failed:", error.message);
    return { ok: false, error: erroDoBanco(error.message, "Não foi possível salvar as faces.") };
  }
  await logAudit({ action: "update", entityType: "dental_tooth_faces", entityId: dente });
  atualizar();
  return { ok: true };
}

/** Troca os dentes que uma região seleciona (vazio = tecido/osso). */
export async function salvarDentesDaRegiao(regiao: string, dentes: string[]): Promise<Resultado> {
  const quem = await soAdmin();
  if ("error" in quem) return { ok: false, error: quem.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_region_teeth", { p_region: regiao, p_teeth: dentes });
  if (error) {
    console.error("set_region_teeth failed:", error.message);
    return { ok: false, error: erroDoBanco(error.message, "Não foi possível salvar a região.") };
  }
  await logAudit({ action: "update", entityType: "dental_region_teeth", entityId: regiao });
  atualizar();
  return { ok: true };
}

/** Cria ou altera a regra clínica de um procedimento. */
export async function salvarRegraDoProcedimento(
  procedureId: string,
  regra: RegraDoProcedimento
): Promise<Resultado> {
  const quem = await soAdmin();
  if ("error" in quem) return { ok: false, error: quem.error };
  const v = validarRegra(regra);
  if ("erro" in v) return { ok: false, error: v.erro };
  const r = v.regra;

  const supabase = await createClient();
  const { error } = await supabase.from("procedure_dental_rules").upsert(
    {
      procedure_id: procedureId,
      application_level: r.level,
      face_count_min: r.faceCountMin,
      face_count_max: r.faceCountMax,
      fixed_faces: r.fixedFaces,
      dentition: r.dentition,
      tooth_groups: r.toothGroups,
      blocked_conditions: r.blockedConditions,
      required_conditions: r.requiredConditions,
      effect_condition: r.effectCondition,
      effect_when_absent: r.effectWhenAbsent,
    },
    { onConflict: "procedure_id" }
  );
  if (error) {
    console.error("salvarRegraDoProcedimento failed:", error.message);
    return { ok: false, error: erroDoBanco(error.message, "Não foi possível salvar a regra.") };
  }
  await logAudit({ action: "update", entityType: "procedure_dental_rule", entityId: procedureId });
  atualizar();
  revalidatePath("/procedimentos");
  return { ok: true };
}
