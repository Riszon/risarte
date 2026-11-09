"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { isFinanceFranchisor } from "@/lib/finance/access";
import {
  codigoDoTipo,
  faltaNaFicha,
  supplierToPayload,
  type SupplierForm,
} from "@/lib/fornecedores";

type Result = { ok: boolean; error?: string; id?: string };

function refresh() {
  revalidatePath("/financeiro/fornecedores");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/estoque");
  revalidatePath("/financeiro/bens");
}

/**
 * As recusas da porta `save_supplier` já vêm em português ("Você só pode
 * escolher as unidades que gerencia."); qualquer outro erro vira genérico.
 */
function mensagemDoBanco(error: { code?: string; message?: string }, padrao: string): string {
  return error.code === "P0001" && error.message ? error.message : padrao;
}

/** FIN3 + 0371 — grava a ficha pela porta do banco (que confere quem pode). */
export async function saveSupplier(form: SupplierForm, ownerClinicId: string | null): Promise<Result> {
  await getSessionContext();
  const falta = faltaNaFicha(form);
  if (falta) return { ok: false, error: falta };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supplier", {
    p: supplierToPayload(form, ownerClinicId),
  });
  if (error) {
    console.error("saveSupplier failed:", error.message);
    return { ok: false, error: mensagemDoBanco(error, "Não foi possível salvar o fornecedor.") };
  }

  const id = String(data);
  await logAudit({
    action: form.id ? "update" : "create",
    entityType: "supplier",
    entityId: id,
  });
  refresh();
  return { ok: true, id };
}

export type SupplierHistoryRow = {
  id: number;
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  actor: string;
  tableName: string;
  op: "I" | "U" | "D";
  changes: Record<string, unknown> | null;
};

/** O histórico da ficha (a trilha da auditoria, só deste fornecedor). */
export async function loadSupplierHistory(
  supplierId: string
): Promise<{ ok: boolean; rows: SupplierHistoryRow[]; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supplier_history", { p_supplier_id: supplierId });
  if (error) {
    console.error("loadSupplierHistory failed:", error.message);
    return { ok: false, rows: [], error: "Não foi possível ler o histórico." };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    occurredAt: String(r.occurred_at),
    userId: (r.user_id as string | null) ?? null,
    userName: (r.user_name as string | null) ?? null,
    actor: String(r.actor ?? "usuario"),
    tableName: String(r.table_name),
    op: r.op as "I" | "U" | "D",
    changes: (r.changes as Record<string, unknown> | null) ?? null,
  }));
  return { ok: true, rows };
}

/** Outro fornecedor com o mesmo CNPJ/CPF em qualquer lugar da rede. */
export async function findSameDocument(
  document: string,
  exceptId: string | null
): Promise<{ id: string; name: string; scope: string; active: boolean }[]> {
  const d = document.replace(/\D/g, "");
  if (d.length !== 11 && d.length !== 14) return [];
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supplier_same_document", {
    p_document: d,
    p_except: exceptId || null,
  });
  if (error) return [];
  return (data ?? []) as { id: string; name: string; scope: string; active: boolean }[];
}

/** Tipos de fornecedor: só o Admin Master e o Financeiro da Franqueadora. */
export async function saveSupplierKind(input: {
  code: string | null;
  label: string;
  sortOrder: number;
  active: boolean;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!session.isAdminMaster && !isFinanceFranchisor(session)) {
    return { ok: false, error: "Só o Financeiro da Franqueadora edita os tipos." };
  }
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Informe o nome do tipo." };

  const supabase = await createClient();
  const agora = new Date().toISOString();
  if (input.code) {
    const { error } = await supabase
      .from("supplier_kinds")
      .update({
        label,
        sort_order: input.sortOrder,
        active: input.active,
        updated_at: agora,
        updated_by: session.userId,
      })
      .eq("code", input.code);
    if (error) {
      console.error("saveSupplierKind failed:", error.message);
      return { ok: false, error: "Não foi possível salvar o tipo." };
    }
  } else {
    const base = codigoDoTipo(label) || "tipo";
    const { data: existentes } = await supabase
      .from("supplier_kinds")
      .select("code")
      .like("code", `${base}%`);
    const usados = new Set((existentes ?? []).map((r) => r.code as string));
    let code = base;
    for (let i = 2; usados.has(code); i++) code = `${base}_${i}`;
    const { error } = await supabase.from("supplier_kinds").insert({
      code,
      label,
      sort_order: input.sortOrder,
      active: true,
      created_by: session.userId,
      updated_by: session.userId,
    });
    if (error) {
      console.error("saveSupplierKind failed:", error.message);
      return { ok: false, error: "Não foi possível criar o tipo." };
    }
  }
  await logAudit({ action: input.code ? "update" : "create", entityType: "supplier_kind", entityId: input.code ?? label });
  refresh();
  return { ok: true };
}
