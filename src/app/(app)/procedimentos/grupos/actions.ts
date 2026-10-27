"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { mensagemDoGrupo, validarGrupo } from "@/lib/procedimentos/grupos";

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
