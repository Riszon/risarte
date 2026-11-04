"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PRIORIDADES,
  SITUACOES,
  mensagemDoErro,
  type ItemDoPedido,
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

// -----------------------------------------------------------------------------
// BK3 — vários itens de uma vez.
// -----------------------------------------------------------------------------

const MAXIMO_NO_LOTE = 100;

function codigosValidos(codes: string[]): string[] | null {
  const lista = [...new Set(codes.map((c) => String(c).trim().toUpperCase()))];
  if (lista.length === 0 || lista.length > MAXIMO_NO_LOTE) return null;
  return lista.every((c) => /^AP\d+$/.test(c)) ? lista : null;
}

/** Os itens escolhidos, com o detalhe inteiro — para montar o pedido. */
export async function lerItensDoPedido(
  codes: string[]
): Promise<{ ok: true; itens: ItemDoPedido[] } | { ok: false; error: string }> {
  await requireAdminMaster();
  const lista = codigosValidos(codes);
  if (!lista) return { ok: false, error: `Escolha de 1 a ${MAXIMO_NO_LOTE} itens.` };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("backlog_items")
    .select("code, title, detail, priority, status, module, backlog_categories ( name )")
    .in("code", lista)
    .returns<
      {
        code: string;
        title: string;
        detail: string;
        priority: Prioridade;
        status: SituacaoDoItem;
        module: string | null;
        backlog_categories: { name: string } | null;
      }[]
    >();
  if (error) {
    console.error("backlog (pedido):", error.message);
    return { ok: false, error: "Não foi possível ler os itens. Tente de novo." };
  }
  // Leu menos do que pediu: dizer, nunca montar o pedido pela metade.
  if ((data ?? []).length !== lista.length) {
    return { ok: false, error: "Algum item escolhido não existe mais. Recarregue a página." };
  }
  return {
    ok: true,
    itens: (data ?? []).map((r) => ({
      code: r.code,
      title: r.title,
      detail: r.detail,
      priority: r.priority,
      status: r.status,
      module: r.module,
      category: r.backlog_categories?.name ?? "—",
    })),
  };
}

export type ResultadoDoLote = { ok: boolean; gravados: string[]; falhas: { code: string; error: string }[] };

/**
 * A mesma mudança em vários itens. Item a item, pela mesma porta da tela de
 * detalhe: cada um ganha o seu evento na linha do tempo. Uma falha não
 * esconde as outras — o resultado diz quais passaram e quais não.
 */
export async function mudarEmLote(
  codes: string[],
  mudanca: { status?: SituacaoDoItem; priority?: Prioridade; category?: string; note?: string }
): Promise<ResultadoDoLote> {
  await requireAdminMaster();
  const lista = codigosValidos(codes);
  if (!lista) return { ok: false, gravados: [], falhas: [{ code: "—", error: `Escolha de 1 a ${MAXIMO_NO_LOTE} itens.` }] };
  if (mudanca.status === "resolvido" || mudanca.status === "descartado") {
    return { ok: false, gravados: [], falhas: [{ code: "—", error: "Resolver e descartar são item a item." }] };
  }
  const invalido = conferir(mudanca.priority ?? null, mudanca.status ?? null, null);
  if (invalido) return { ok: false, gravados: [], falhas: [{ code: "—", error: invalido }] };
  if (!mudanca.status && !mudanca.priority && !mudanca.category) {
    return { ok: false, gravados: [], falhas: [{ code: "—", error: "Nada para mudar." }] };
  }

  const supabase = await createClient();
  const gravados: string[] = [];
  const falhas: { code: string; error: string }[] = [];
  for (const code of lista) {
    const { error } = await supabase.rpc("backlog_update_item", {
      p_code: code,
      p_status: mudanca.status ?? null,
      p_priority: mudanca.priority ?? null,
      p_category: mudanca.category ?? null,
      p_note: mudanca.note?.trim() || null,
      p_author_label: null,
    });
    if (error) {
      console.error("backlog_update_item (lote):", code, error.message);
      falhas.push({ code, error: mensagemDoErro(error.message) });
    } else gravados.push(code);
  }
  revalidar();
  return { ok: falhas.length === 0, gravados, falhas };
}
