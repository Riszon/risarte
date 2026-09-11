"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { canViewEmpresarial } from "@/lib/empresarial/access";

// ⚠️ NADA DE CONSTANTE EXPORTADA AQUI. Este arquivo é `"use server"`: todo
// export dele tem de ser função async. `RESULTADOS` e `RESULTADO_ROTULO` moravam
// nesta altura e quebravam a tela no clique — moraram até 11/09/2026 e foram
// para `constantes.ts`, que explica o estrago. O tipo pode ficar (tipo some na
// compilação), mas o valor não.
import {
  RESULTADOS,
  type Resultado,
} from "./constantes";

export type ResultadoDoContato = { ok: boolean; error?: string };

/**
 * Registra a ligação de boas-vindas.
 *
 * ⚠️ A GUARDA DE VERDADE ESTÁ NO BANCO (`register_welcome_contact` confere a
 * empresa da própria pessoa e o alcance de quem chamou). Esta aqui é para dar
 * mensagem em português em vez de deixar o erro cru do Postgres chegar à tela.
 *
 * ⚠️ E A AUDITORIA NÃO LEVA NOME NEM TELEFONE — só ids e o resultado. Trilha de
 * LGPD com dado pessoal dentro vira o próprio vazamento que ela deveria
 * testemunhar (regra do `logAudit`).
 */
export async function registrarContato(
  companyId: string,
  pessoa: { employeeId?: string | null; dependentId?: string | null },
  resultado: Resultado,
  nota?: string
): Promise<ResultadoDoContato> {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) return { ok: false, error: "Sem permissão." };
  if (!RESULTADOS.includes(resultado)) {
    return { ok: false, error: "Resultado inválido." };
  }
  if (!pessoa.employeeId === !pessoa.dependentId) {
    return { ok: false, error: "Escolha uma pessoa." };
  }

  const db = await empresarialDb();
  const { error } = await db.rpc("register_welcome_contact", {
    p_employee_id: pessoa.employeeId ?? null,
    p_dependent_id: pessoa.dependentId ?? null,
    p_outcome: resultado,
    p_note: nota ?? null,
  });
  if (error) {
    console.error("registrarContato falhou:", error.message);
    return {
      ok: false,
      error:
        error.message.includes("NOT_ALLOWED")
          ? "Você não tem acesso a esta empresa."
          : "Não foi possível registrar o contato.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_welcome_contact",
    entityId: pessoa.employeeId ?? pessoa.dependentId ?? companyId,
    details: { outcome: resultado },
  });
  revalidatePath(`/empresarial/${companyId}/boas-vindas`);
  return { ok: true };
}

/** Desfaz um contato registrado por engano. */
export async function limparContato(
  companyId: string,
  pessoa: { employeeId?: string | null; dependentId?: string | null }
): Promise<ResultadoDoContato> {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { error } = await db.rpc("clear_welcome_contact", {
    p_employee_id: pessoa.employeeId ?? null,
    p_dependent_id: pessoa.dependentId ?? null,
  });
  if (error) {
    console.error("limparContato falhou:", error.message);
    return { ok: false, error: "Não foi possível desfazer." };
  }

  await logAudit({
    // "update": desfazer o registro é uma alteração do contato, não a
    // exclusão de um documento — o contrato de auditoria não tem "delete".
    action: "update",
    entityType: "empresarial_welcome_contact",
    entityId: pessoa.employeeId ?? pessoa.dependentId ?? companyId,
    details: {},
  });
  revalidatePath(`/empresarial/${companyId}/boas-vindas`);
  return { ok: true };
}
