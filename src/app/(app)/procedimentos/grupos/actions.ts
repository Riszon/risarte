"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { ajusteValido, mensagemDoGrupo, minimoValido, validarGrupo } from "@/lib/procedimentos/grupos";

export type GrupoResult = { ok: boolean; error?: string; id?: string };

/**
 * GP1 (decisão do dono, 27/10/2026): o Admin Master E o Planner criam e editam
 * os grupos, que valem para a rede. O banco repete a regra (0324): aqui é só
 * para a mensagem sair antes de ir ao banco.
 */
function podeMexer(session: SessionContext): boolean {
  return (
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) => roles.includes("planner_dentist"))
  );
}

function atualizar() {
  revalidatePath("/procedimentos/grupos");
  // O cartão do procedimento mostra os grupos dele (e o botão rápido mexe aqui).
  revalidatePath("/procedimentos");
}

export async function salvarGrupo(input: {
  id: string | null;
  nome: string;
  descricao: string;
  itens: { procedureId: string; quantidade: number }[];
}): Promise<GrupoResult> {
  const session = await getSessionContext();
  if (!podeMexer(session)) return { ok: false, error: "Só o Admin Master e o Planner mexem nos grupos." };
  const problema = validarGrupo(input.nome, input.itens);
  if (problema) return { ok: false, error: problema };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_procedure_group", {
    p_id: input.id,
    p_name: input.nome.trim(),
    p_description: input.descricao.trim(),
    p_items: input.itens.map((i) => ({ procedureId: i.procedureId, quantity: i.quantidade })),
  });
  if (error) {
    console.error("save_procedure_group failed:", error.message);
    return { ok: false, error: mensagemDoGrupo(error.message) ?? "Não foi possível salvar o grupo." };
  }
  const id = data as string;
  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "procedure_group",
    entityId: id,
    details: { procedures: input.itens.length },
  });
  atualizar();
  return { ok: true, id };
}

/**
 * 0325/0326 (GP4–GP8): o preço do pacote (ajuste) e o MÍNIMO na negociação.
 * SÓ o Admin Master — o preço é dele (OC-00068), e o banco repete a regra.
 * O ajuste vale para os itens lançados DEPOIS e no envio do plano; o mínimo
 * vale na próxima vez que a negociação for salva.
 *
 * `minimoPercent` undefined = a tela não conseguiu ler o mínimo (banco sem a
 * 0326): grava só o ajuste, pela porta da 0325.
 */
export async function definirPrecoDoPacote(
  id: string,
  ajustePercent: number,
  minimoPercent?: number | null,
  /**
   * 0328 (GP9): de onde sai o desconto. `undefined` = a tela não sabe (o
   * banco sem a 0328) — grava como antes. Lista vazia = igual em todos; com
   * itens = o percentual PRÓPRIO de cada procedimento listado.
   */
  distribuicao?: { procedureId: string; percent: number | null }[],
  /** O ajuste do pacote inteiro (um de cada) — a régua do mínimo com distribuição. */
  ajusteEfetivoPercent?: number
): Promise<GrupoResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: "Só o Admin Master define o preço do pacote." };
  if (!ajusteValido(ajustePercent)) {
    return { ok: false, error: mensagemDoGrupo("INVALID_ADJUST") ?? "Ajuste inválido." };
  }
  const ajuste = Math.round(ajustePercent * 100) / 100;
  const minimo = minimoPercent == null ? null : Math.round(minimoPercent * 100) / 100;
  if (minimoPercent !== undefined) {
    const problema = minimoValido(minimo, ajusteEfetivoPercent ?? ajuste);
    if (problema) return { ok: false, error: problema };
  }
  for (const d of distribuicao ?? []) {
    if (d.percent !== null && !ajusteValido(d.percent)) {
      return { ok: false, error: mensagemDoGrupo("INVALID_ADJUST") ?? "Ajuste inválido." };
    }
  }
  const supabase = await createClient();
  // A distribuição grava o mínimo junto: só vai por ela quando a tela leu o mínimo.
  const { error } =
    distribuicao !== undefined && minimoPercent !== undefined
      ? await supabase.rpc("set_procedure_group_split", {
          p_id: id,
          p_percent: ajuste,
          p_min_percent: minimo,
          p_item_percents: distribuicao.map((d) => ({
            procedureId: d.procedureId,
            percent: d.percent === null ? null : Math.round(d.percent * 10000) / 10000,
          })),
        })
      : minimoPercent === undefined
        ? await supabase.rpc("set_procedure_group_price", { p_id: id, p_percent: ajuste })
        : await supabase.rpc("set_procedure_group_pricing", { p_id: id, p_percent: ajuste, p_min_percent: minimo });
  if (error) {
    console.error("set_procedure_group_pricing failed:", error.message);
    return { ok: false, error: mensagemDoGrupo(error.message) ?? "Não foi possível salvar o preço do pacote." };
  }
  await logAudit({
    action: "update",
    entityType: "procedure_group",
    entityId: id,
    details: {
      price_adjust_percent: ajuste,
      ...(minimoPercent !== undefined ? { min_price_percent: minimo } : {}),
      ...(distribuicao !== undefined ? { por_procedimento: distribuicao.length } : {}),
    },
  });
  atualizar();
  revalidatePath("/procedimentos");
  return { ok: true };
}

/**
 * O botão rápido do procedimento (pedido do dono, 27/10/2026): pôr ou tirar o
 * procedimento de um grupo sem abrir o editor do grupo. Quem entra vai para o
 * FIM do grupo, com quantidade 1 (a ordem se ajusta no editor). Pela mesma
 * porta do editor (`save_procedure_group`): as mesmas regras (2 a 30, ativo,
 * sem repetir) e a mesma permissão (GP1: Admin Master e Planner).
 */
export async function vincularAoGrupo(input: {
  grupoId: string;
  procedureId: string;
  vincular: boolean;
}): Promise<GrupoResult> {
  const session = await getSessionContext();
  if (!podeMexer(session)) return { ok: false, error: "Só o Admin Master e o Planner mexem nos grupos." };
  const supabase = await createClient();
  const { data: grupo, error: erroDoGrupo } = await supabase
    .from("procedure_groups")
    .select("id, name, description, procedure_group_items ( procedure_id, quantity, sort_order, procedure:procedures ( is_active ) )")
    .eq("id", input.grupoId)
    .maybeSingle<{
      id: string;
      name: string;
      description: string | null;
      procedure_group_items: {
        procedure_id: string;
        quantity: number;
        sort_order: number;
        procedure: { is_active: boolean } | { is_active: boolean }[] | null;
      }[];
    }>();
  if (erroDoGrupo || !grupo) {
    if (erroDoGrupo) console.error("vincularAoGrupo (ler) failed:", erroDoGrupo.message);
    return { ok: false, error: "Não foi possível ler o grupo agora. Nada foi alterado." };
  }
  // Procedimento que saiu do catálogo não volta: o banco recusaria salvar.
  const atuais = [...grupo.procedure_group_items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((i) => (Array.isArray(i.procedure) ? i.procedure[0] : i.procedure)?.is_active !== false)
    .map((i) => ({ procedureId: i.procedure_id, quantidade: i.quantity }));
  const jaEsta = atuais.some((i) => i.procedureId === input.procedureId);
  if (input.vincular === jaEsta) return { ok: true, id: grupo.id };
  const itens = input.vincular
    ? [...atuais, { procedureId: input.procedureId, quantidade: 1 }]
    : atuais.filter((i) => i.procedureId !== input.procedureId);
  const problema = validarGrupo(grupo.name, itens);
  if (problema) {
    return {
      ok: false,
      error: input.vincular
        ? problema
        : `${problema} Para desfazer o grupo, inative ou exclua o grupo.`,
    };
  }
  return salvarGrupo({ id: grupo.id, nome: grupo.name, descricao: grupo.description ?? "", itens });
}

export async function ativarGrupo(id: string, ativo: boolean): Promise<GrupoResult> {
  const session = await getSessionContext();
  if (!podeMexer(session)) return { ok: false, error: "Só o Admin Master e o Planner mexem nos grupos." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_procedure_group_active", { p_id: id, p_active: ativo });
  if (error) {
    console.error("set_procedure_group_active failed:", error.message);
    return { ok: false, error: mensagemDoGrupo(error.message) ?? "Não foi possível mudar o grupo." };
  }
  await logAudit({ action: "update", entityType: "procedure_group", entityId: id, details: { active: ativo } });
  atualizar();
  return { ok: true };
}

export async function excluirGrupo(id: string): Promise<GrupoResult> {
  const session = await getSessionContext();
  if (!podeMexer(session)) return { ok: false, error: "Só o Admin Master e o Planner mexem nos grupos." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_procedure_group", { p_id: id });
  if (error) {
    console.error("delete_procedure_group failed:", error.message);
    return { ok: false, error: mensagemDoGrupo(error.message) ?? "Não foi possível excluir o grupo." };
  }
  await logAudit({ action: "update", entityType: "procedure_group", entityId: id, details: { removed: true } });
  atualizar();
  return { ok: true };
}
