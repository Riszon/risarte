"use server";

// As ações da aba Taxas da franquia (ASA3, entrega 1; 4008). O BANCO decide de
// verdade: a porta `gateway_split_save` confere quem pode (Admin Master e
// Financeiro da Franqueadora) e que o destino é uma carteira de repasse.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeEditarRegua } from "@/lib/central/central";

export type ResultadoDoSplit = { ok: boolean; error?: string };

export type ConfiguracaoDoSplit = {
  toleranciaCentavos: number;
  multaPercent: number | null;
  jurosPercent: number | null;
  destinos: { fee: string; accountId: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function percentOuBranco(v: number | null): number | null | "erro" {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0 || v > 100) return "erro";
  return Math.round(v * 1e4) / 1e4;
}

export async function salvarConfiguracaoDoSplit(cfg: ConfiguracaoDoSplit): Promise<ResultadoDoSplit> {
  const session = await getSessionContext();
  if (!podeEditarRegua(session)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui." };
  const tol = Math.round(Number(cfg.toleranciaCentavos));
  if (!Number.isFinite(tol) || tol < 0 || tol > 1000) return { ok: false, error: "A tolerância vai de R$ 0,00 a R$ 10,00." };
  const multa = percentOuBranco(cfg.multaPercent);
  const juros = percentOuBranco(cfg.jurosPercent);
  if (multa === "erro" || juros === "erro") return { ok: false, error: "Multa e juros vão de 0 a 100%, ou em branco." };
  const destinos = (cfg.destinos ?? []).map((d) => ({
    fee: String(d.fee).slice(0, 40),
    accountId: d.accountId && UUID.test(d.accountId) ? d.accountId : null,
  }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_split_save", {
    p_tolerance_cents: tol,
    p_fine_percent: multa,
    p_interest_percent: juros,
    p_destinos: destinos,
  });
  if (error) {
    if (/DESTINATION_INVALID/.test(error.message)) return { ok: false, error: "O destino precisa ser a conta raiz ou uma carteira de repasse ativa." };
    if (/NOT_ALLOWED/.test(error.message)) return { ok: false, error: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui." };
    console.error("gateway split save failed:", error.message);
    return { ok: false, error: "Não foi possível gravar. Tente de novo." };
  }
  revalidatePath("/central", "layout");
  return { ok: true };
}
