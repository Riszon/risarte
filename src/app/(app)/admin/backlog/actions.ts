"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PRIORIDADES,
  SITUACOES,
  mensagemDoErro,
  type Prioridade,
  type SituacaoDoItem,
} from "@/lib/backlog";
import { MODULOS } from "@/lib/system-reports";

/**
 * As gravações da tela do backlog (BK2). Tudo passa pelas funções `backlog_*`
 * da 0366, que conferem de novo se quem chama é o Admin Master e escrevem a
 * linha do tempo do item. A trilha de alterações (auditoria) é do gatilho
 * das tabelas — por isso não há `logAudit` aqui.
 */

type Resultado = { ok: true; code?: string } | { ok: false; error: string };

function texto(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

function conferir(prioridade: string | null, situacao: string | null, modulo: string | null): string | null {
  if (prioridade && !PRIORIDADES.includes(prioridade as Prioridade)) return "Prioridade inválida.";
  if (situacao && !SITUACOES.includes(situacao as SituacaoDoItem)) return "Situação inválida.";
  if (modulo && !MODULOS.some((m) => m.value === modulo)) return "Módulo inválido.";
  return null;
}

function revalidar(code?: string) {
  revalidatePath("/admin/backlog");
  if (code) revalidatePath(`/admin/backlog/${code}`);
}

export async function atualizarItem(formData: FormData): Promise<Resultado> {
  await requireAdminMaster();
  const code = texto(formData.get("code"))?.toUpperCase() ?? "";
  if (!/^AP\d+$/.test(code)) return { ok: false, error: "Item inválido." };

  const prioridade = texto(formData.get("priority"));
  const situacao = texto(formData.get("status"));
  // "" no módulo = tirar o módulo; o banco entende "" como "nenhum".
  const moduloBruto = formData.get("module");
  const modulo = typeof moduloBruto === "string" ? moduloBruto.trim() : null;
  const invalido = conferir(prioridade, situacao, modulo || null);
  if (invalido) return { ok: false, error: invalido };

  const fechando = situacao === "resolvido" || situacao === "descartado";
  const como = texto(formData.get("resolution"));
  if (situacao === "descartado" && !como) return { ok: false, error: "Diga por que o item foi descartado." };

  const detalheBruto = formData.get("detail");
  const supabase = await createClient();
  const { error } = await supabase.rpc("backlog_update_item", {
    p_code: code,
    p_title: texto(formData.get("title")),
    p_detail: typeof detalheBruto === "string" ? detalheBruto : null,
    p_category: texto(formData.get("category")),
    p_module: modulo,
    p_priority: prioridade,
    p_status: situacao,
    p_resolved_version: fechando ? texto(formData.get("resolvedVersion")) : null,
    p_resolution: fechando ? como : null,
    p_note: texto(formData.get("note")),
    p_author_label: null,
  });
  if (error) {
    console.error("backlog_update_item:", error.message);
    return { ok: false, error: mensagemDoErro(error.message) };
  }
  revalidar(code);
  return { ok: true, code };
}

export async function criarItem(formData: FormData): Promise<Resultado> {
  await requireAdminMaster();
  const titulo = texto(formData.get("title"));
  const categoria = texto(formData.get("category"));
  if (!titulo) return { ok: false, error: "Escreva o título." };
  if (!categoria) return { ok: false, error: "Escolha a categoria." };
  const prioridade = texto(formData.get("priority")) ?? "media";
  const modulo = texto(formData.get("module"));
  const invalido = conferir(prioridade, null, modulo);
  if (invalido) return { ok: false, error: invalido };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("backlog_create_item", {
    p_title: titulo,
    p_detail: texto(formData.get("detail")) ?? "",
    p_category: categoria,
    p_priority: prioridade,
    p_module: modulo,
    p_status: "aberto",
    p_origin: "dono",
    p_author_label: null,
  });
  if (error) {
    console.error("backlog_create_item:", error.message);
    return { ok: false, error: mensagemDoErro(error.message) };
  }
  revalidar();
  return { ok: true, code: String(data) };
}

export async function salvarCategoria(formData: FormData): Promise<Resultado> {
  await requireAdminMaster();
  const id = texto(formData.get("id"));
  const nome = texto(formData.get("name"));
  if (!nome) return { ok: false, error: "Escreva o nome da categoria." };
  if (nome.length > 60) return { ok: false, error: "Nome muito longo (até 60 letras)." };
  const ordem = Number(texto(formData.get("sortOrder")) ?? "");
  const ativa = formData.get("active");

  const supabase = await createClient();
  const { error } = await supabase.rpc("backlog_save_category", {
    p_id: id,
    p_name: nome,
    p_sort_order: Number.isFinite(ordem) && ordem > 0 ? Math.round(ordem) : null,
    p_active: ativa === null ? true : ativa === "true",
  });
  if (error) {
    console.error("backlog_save_category:", error.message);
    return { ok: false, error: mensagemDoErro(error.message) };
  }
  revalidar();
  return { ok: true };
}
