"use server";

/**
 * 4017a (19.30) — a exceção para cancelar venda com acordo de renegociação:
 * ler os acordos da venda (a tela do cancelamento recusado), pedir (Gerente ou
 * Admin Master) e decidir (Financeiro da Franqueadora ou Admin, nunca quem pediu).
 */
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AcordoDaVenda = {
  id: string;
  codigo: string | null;
  situacao: string;
  pendente: boolean;
  multi_venda: boolean;
  aberto: number;
  pago: number;
  cartao_a_receber: number;
};
export type AcordosDaVenda = {
  pode_pedir: boolean;
  acordos: AcordoDaVenda[];
  excecao: { id: string; situacao: string; valida_ate: string | null; nota: string | null } | null;
};

export async function lerAcordosDaVenda(input: { negotiationId?: string | null; directSaleId?: string | null }) {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_agreements_read", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
  });
  if (error || !data) return { ok: false as const, error: "Não foi possível ler os acordos desta venda." };
  return { ok: true as const, ...(data as AcordosDaVenda) };
}

export async function pedirExcecao(input: { negotiationId?: string | null; directSaleId?: string | null; motivo: string; clientId: string }) {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sale_cancel_exception_request", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_reason: input.motivo,
  });
  if (error) {
    const m = error.message;
    const msg = m.includes("NOT_ALLOWED")
      ? "Só o Gerente da unidade ou o Admin Master pede a exceção. Chame o Gerente."
      : m.includes("PENDING_FIRST")
        ? "Há um acordo que ainda não vale: cancele esse acordo antes; o cancelamento da venda então segue normal."
        : m.includes("MULTI_SALE")
          ? "Este acordo junta parcelas de outras vendas. O cancelamento fica para o distrato."
          : m.includes("DIRECT_SALE_PAID")
            ? "O cliente já pagou parcela do acordo desta venda direta. O cancelamento fica para o distrato; até lá, fale com o Jeferson."
            : m.includes("ALREADY_REQUESTED")
              ? "Já há um pedido aberto ou uma exceção autorizada para esta venda."
              : m.includes("NOTHING_OPEN")
                ? "O acordo não tem parcela em aberto: o cancelamento já pode seguir."
                : m.includes("REASON_REQUIRED")
                  ? "Escreva o motivo (ao menos 5 letras)."
                  : null;
    if (!msg) console.error("sale_cancel_exception_request failed:", m);
    return { ok: false as const, error: msg ?? "Não foi possível pedir a exceção." };
  }
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true as const };
}

export async function decidirExcecao(input: { id: string; aprovar: boolean; nota: string }) {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sale_cancel_exception_decide", { p_id: input.id, p_approve: input.aprovar, p_note: input.nota });
  if (error) {
    const m = error.message;
    const msg = m.includes("SELF_APPROVAL")
      ? "Quem pediu não autoriza o próprio pedido. Outra pessoa do Financeiro da Franqueadora decide."
      : m.includes("NOT_ALLOWED")
        ? "Só o Financeiro da Franqueadora ou o Admin Master decide."
        : m.includes("NOT_PENDING")
          ? "Este pedido já foi decidido."
          : m.includes("NOTE_REQUIRED")
            ? "Para negar, escreva o motivo."
            : null;
    if (!msg) console.error("sale_cancel_exception_decide failed:", m);
    return { ok: false as const, error: msg ?? "Não foi possível registrar a decisão." };
  }
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true as const };
}
