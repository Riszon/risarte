"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { logAudit } from "@/lib/audit";
import {
  COLLECTION_OUTCOMES,
  exigeDataPrometida,
  type CollectionOutcome,
} from "@/lib/finance/collection";
import { todayInBrazil } from "@/lib/dates";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Registra o retorno de uma tentativa de cobrança (OC-00009).
 *
 * É sempre um registro NOVO, nunca uma edição: a sequência de tentativas é o
 * que mostra se a cobrança está andando, e sobrescrever apagaria a ligação da
 * semana passada.
 */
export async function registerCollectionContact(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canViewFinance(session)) return { ok: false, error: "Sem permissão." };

  const clinicId = session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Selecione uma unidade." };

  const bruto = String(formData.get("outcome") ?? "").trim();
  if (!(COLLECTION_OUTCOMES as readonly string[]).includes(bruto)) {
    return { ok: false, error: "Escolha o que aconteceu no contato." };
  }
  const outcome = bruto as CollectionOutcome;

  const dataPrometida = String(formData.get("promised_date") ?? "").trim() || null;
  if (exigeDataPrometida(outcome)) {
    if (!dataPrometida) {
      return {
        ok: false,
        error: "Informe para que dia a pessoa prometeu pagar.",
      };
    }
    // Promessa para ontem não é promessa — e deixaria a lista de promessas
    // vencidas nascer errada.
    if (dataPrometida < todayInBrazil()) {
      return { ok: false, error: "A data prometida não pode estar no passado." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("collection_contacts").insert({
    clinic_id: clinicId,
    client_id: clientId,
    outcome,
    note: String(formData.get("note") ?? "").trim() || null,
    // A data só é guardada quando faz sentido: "não atendeu" com data
    // prometida seria um registro que se contradiz.
    promised_date: exigeDataPrometida(outcome) ? dataPrometida : null,
    author_id: session.userId,
  });
  if (error) {
    console.error("registerCollectionContact failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o contato." };
  }

  // Trilha LGPD: só ids e o resultado — nunca o nome, o telefone ou a
  // observação, que é onde a conversa com o paciente ficaria exposta.
  await logAudit({
    action: "create",
    entityType: "collection_contact",
    entityId: clientId,
    details: { outcome },
  });
  revalidatePath("/financeiro/recebiveis/inadimplentes");
  return { ok: true };
}
