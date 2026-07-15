"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type SpecialtyResult = { ok: boolean; error?: string };

/** Admin Master e Dentista Planner gerenciam as especialidades (como o catálogo). */
function canManage(session: SessionContext): boolean {
  return (
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    )
  );
}

function revalidate() {
  revalidatePath("/procedimentos/especialidades");
  revalidatePath("/procedimentos");
  revalidatePath("/risartanos");
}

/** Adiciona uma especialidade (no fim da ordem). */
export async function addSpecialty(name: string): Promise<SpecialtyResult> {
  const session = await getSessionContext();
  if (!canManage(session)) {
    return { ok: false, error: "Sem permissão para gerenciar especialidades." };
  }
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Informe o nome da especialidade." };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("specialties")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.sort_order as number | undefined) ?? 0) + 10;

  const { error } = await supabase
    .from("specialties")
    .insert({ name: clean, sort_order: nextOrder });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Já existe uma especialidade com esse nome." };
    }
    console.error("addSpecialty failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar a especialidade." };
  }
  await logAudit({ action: "create", entityType: "specialty", entityId: clean });
  revalidate();
  return { ok: true };
}

/** Renomeia (cascateia para procedimentos e Risartanos via RPC). */
export async function renameSpecialty(
  id: string,
  newName: string
): Promise<SpecialtyResult> {
  const session = await getSessionContext();
  if (!canManage(session)) {
    return { ok: false, error: "Sem permissão para gerenciar especialidades." };
  }
  const clean = newName.trim();
  if (!clean) return { ok: false, error: "Informe o novo nome." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_specialty", {
    p_id: id,
    p_new_name: clean,
  });
  if (error) {
    if (error.message.includes("DUPLICATE")) {
      return { ok: false, error: "Já existe uma especialidade com esse nome." };
    }
    console.error("renameSpecialty failed:", error.message);
    return { ok: false, error: "Não foi possível renomear a especialidade." };
  }
  await logAudit({ action: "update", entityType: "specialty", entityId: id });
  revalidate();
  return { ok: true };
}

/** Ativa/desativa (desativada some das listas; dados existentes são mantidos). */
export async function setSpecialtyActive(
  id: string,
  active: boolean
): Promise<SpecialtyResult> {
  const session = await getSessionContext();
  if (!canManage(session)) {
    return { ok: false, error: "Sem permissão para gerenciar especialidades." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("specialties")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setSpecialtyActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a especialidade." };
  }
  await logAudit({
    action: "update",
    entityType: "specialty",
    entityId: id,
    details: { is_active: active },
  });
  revalidate();
  return { ok: true };
}

/** Reordena trocando a posição com a especialidade vizinha (cima/baixo). */
export async function moveSpecialty(
  id: string,
  direction: "up" | "down"
): Promise<SpecialtyResult> {
  const session = await getSessionContext();
  if (!canManage(session)) {
    return { ok: false, error: "Sem permissão para gerenciar especialidades." };
  }
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("specialties")
    .select("id, sort_order")
    .order("sort_order")
    .returns<{ id: string; sort_order: number }[]>();
  const list = rows ?? [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, error: "Especialidade não encontrada." };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return { ok: true }; // já no limite

  const a = list[idx];
  const b = list[swapIdx];
  // Troca os sort_order dos dois vizinhos.
  await supabase
    .from("specialties")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  await supabase
    .from("specialties")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  revalidate();
  return { ok: true };
}
