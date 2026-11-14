"use server";

// ASA3, entrega 3 — o botão "Atualizar saldo" dos Repasses da franquia.
//
// Quem pode é decidido pelo BANCO: a porta `franchise_payouts_read` só devolve
// `rede = true` (e o saldo) para quem vê a rede inteira (Admin Master e
// Financeiro da Franqueadora com a permissão). A leitura no Asaas sai daqui,
// do servidor, com a chave do Vault e o autor registrado no uso da chave e no
// log da API. Nenhum valor de chave volta para a tela.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { podeVerRepassesDaFranquia } from "@/lib/finance/repasses-franquia";
import { atualizarSaldoDaFranqueadora } from "@/lib/asaas/split-servidor";

export type ResultadoDoSaldo = { ok: boolean; error?: string };

const SEM_PERMISSAO =
  "Só quem vê a rede inteira atualiza o saldo da franqueadora.";

export async function atualizarSaldo(): Promise<ResultadoDoSaldo> {
  const session = await getSessionContext();
  if (!podeVerRepassesDaFranquia(session))
    return { ok: false, error: SEM_PERMISSAO };
  const hoje = todayInBrazil();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("franchise_payouts_read", {
    p_from: hoje,
    p_to: hoje,
    p_clinic_id: null,
    p_export: null,
  });
  if (error || !data || (data as { rede?: boolean }).rede !== true)
    return { ok: false, error: SEM_PERMISSAO };

  const r = await atualizarSaldoDaFranqueadora(session.userId, hoje);
  if (!r.ok) {
    return {
      ok: false,
      error:
        r.motivo === "sem_conta"
          ? "A conta Asaas da franqueadora não está cadastrada."
          : "O Asaas não respondeu o saldo agora. Tente de novo em instantes.",
    };
  }
  revalidatePath("/financeiro/repasses-da-franquia");
  return { ok: true };
}
