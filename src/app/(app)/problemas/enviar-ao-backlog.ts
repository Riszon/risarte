"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { responderNoTreino } from "@/lib/relatos-do-treino";
import { MODULOS } from "@/lib/system-reports";
import { PRIORIDADES, mensagemDoErro, type Prioridade } from "@/lib/backlog";

/**
 * RELATO → BACKLOG (BK4, migração 0367). Só o Admin Master.
 *
 * O relato vira um item novo do backlog, ou se liga a um item que já existe
 * (vários relatos do mesmo defeito, um item só). Decisão do dono (B-D4): o
 * relato que estava "Aberto" passa a "Em análise" — sem resposta escrita; a
 * resposta vem quando o item for resolvido.
 *
 * Cada passo diz o que deu certo: um relato que não se ligou ou não mudou de
 * situação aparece na lista de falhas, nunca some.
 */

export type RelatoEnviado = {
  id: string;
  code: string;
  title: string;
  ambiente: "sistema" | "treino";
  status: string;
};

export type DestinoNoBacklog =
  | { tipo: "novo"; title: string; detail: string; category: string; priority: string; module: string | null }
  | { tipo: "existente"; code: string };

export type ResultadoDoEnvio =
  | { ok: true; code: string; falhas: string[] }
  | { ok: false; error: string };

export async function categoriasDoBacklog(): Promise<string[]> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("backlog_categories")
    .select("name")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  return (data ?? []).map((c) => c.name);
}

export async function enviarAoBacklog(
  relatos: RelatoEnviado[],
  destino: DestinoNoBacklog
): Promise<ResultadoDoEnvio> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Você não tem permissão para isto." };
  if (relatos.length === 0 || relatos.length > 50) return { ok: false, error: "Escolha de 1 a 50 relatos." };
  if (relatos.some((r) => !r.id || !/^OC-\d+$/.test(r.code) || !["sistema", "treino"].includes(r.ambiente))) {
    return { ok: false, error: "Relato inválido." };
  }

  const supabase = await createClient();
  let code: string;

  if (destino.tipo === "existente") {
    code = destino.code.trim().toUpperCase();
    if (!/^AP\d+$/.test(code)) return { ok: false, error: "Escreva o código do item (ex.: AP56)." };
    const { data, error } = await supabase.from("backlog_items").select("code").eq("code", code).maybeSingle();
    if (error) return { ok: false, error: "Não foi possível ler o backlog agora." };
    if (!data) return { ok: false, error: `${code} não existe no backlog.` };
  } else {
    const titulo = destino.title.trim();
    if (!titulo) return { ok: false, error: "Escreva o título do item." };
    if (!PRIORIDADES.includes(destino.priority as Prioridade)) return { ok: false, error: "Prioridade inválida." };
    if (destino.module && !MODULOS.some((m) => m.value === destino.module)) return { ok: false, error: "Módulo inválido." };
    const { data, error } = await supabase.rpc("backlog_create_item", {
      p_title: titulo,
      p_detail: destino.detail,
      p_category: destino.category,
      p_priority: destino.priority,
      p_module: destino.module,
      p_status: "aberto",
      p_origin: "relato",
      p_author_label: null,
    });
    if (error) {
      console.error("backlog_create_item (relato):", error.message);
      return { ok: false, error: mensagemDoErro(error.message) };
    }
    code = String(data);
  }

  const falhas: string[] = [];
  for (const r of relatos) {
    const { error } = await supabase.rpc("backlog_link_report", {
      p_code: code,
      p_ambiente: r.ambiente,
      p_report_id: r.id,
      p_report_code: r.code,
      p_report_title: r.title,
      p_author_label: null,
    });
    if (error) {
      console.error("backlog_link_report:", r.code, error.message);
      falhas.push(
        /Could not find the function|backlog_link_report/.test(error.message)
          ? `${r.code}: falta aplicar a migração 0367 neste banco.`
          : `${r.code}: não foi ligado (${mensagemDoErro(error.message)})`
      );
      continue;
    }

    // B-D4: o aberto passa a "Em análise". O que já andou fica como está.
    if (r.status !== "aberto") continue;
    if (r.ambiente === "treino") {
      const t = await responderNoTreino({
        reportId: r.id,
        status: "em_analise",
        answer: null,
        resolvedVersion: null,
        prodAdminId: session.userId,
      });
      if (!t.ok) falhas.push(`${r.code}: ligado a ${code}, mas não mudou para Em análise (${t.error}).`);
    } else {
      const { error: e2 } = await supabase.rpc("answer_system_report", {
        p_report_id: r.id,
        p_status: "em_analise",
        p_answer: null,
        p_resolved_version: null,
      });
      if (e2) {
        console.error("answer_system_report (backlog):", r.code, e2.message);
        falhas.push(`${r.code}: ligado a ${code}, mas não mudou para Em análise.`);
      }
    }
    await logAudit({
      action: "update",
      entityType: "system_reports",
      entityId: r.id,
      clinicId: session.activeClinic?.id,
      details: { status: "em_analise", backlog: code, ambiente: r.ambiente },
    });
  }

  revalidatePath("/problemas", "layout");
  revalidatePath("/admin/backlog");
  revalidatePath(`/admin/backlog/${code}`);
  return { ok: true, code, falhas };
}
