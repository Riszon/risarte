import "server-only";
// A MENSALIDADE QUE AS TELAS MOSTRAM (AP18, 27/09/2026).
//
// Seis telas mostram a mensalidade da empresa (ficha, tela da empresa, painel,
// relatório, contrato/proposta). Todas calculavam POR TITULAR — então uma
// empresa de VALOR FIXO apareceria com um número e seria cobrada por outro.
// A regra do valor fixo mora em `mensalidade.ts`; aqui é só a leitura.
//
// ⚠️ TOLERANTE DE PROPÓSITO, como as telas já são (ver `carregarFaixasDaEmpresa`):
// se a leitura falhar, a tela mostra a conta por titular em vez de não abrir —
// e grita no log. Quem COBRA não usa isto: a cobrança lê do jeito rigoroso
// (`billing-actions.ts`) e recusa gerar.

import type { empresarialDb } from "./db";
import { ehValorFixo, mensalidadeDoFixo } from "./mensalidade";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

export type MensalidadeNaTela = {
  totalCents: number;
  /** Presente só no acordo de valor fixo — a tela explica a conta. */
  valorFixo: { fixoCents: number; termosCents: number } | null;
};

/**
 * O MÍNIMO DE TITULARES DA MENSALIDADE, para as telas (OC-00090): o limite da
 * empresa (contratado + termos aceitos). As telas passam isto a
 * `computeMonthlyCents` para mostrar o MESMO número que o boleto cobra.
 *
 * Tolerante como o resto deste arquivo: se a leitura falhar, devolve nulo (a
 * tela mostra a conta pelos cadastrados) e grita no log. Quem cobra lê do
 * jeito rigoroso, em `computeMonthlyBreakdown`.
 */
export async function minimoDeTitularesNaTela(
  db: Db,
  companyId: string
): Promise<number | null> {
  const { data, error } = await db.rpc("limite_de_titulares", { p_company_id: companyId });
  if (error) {
    console.error("mensalidade na tela (limite de titulares):", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

export async function mensalidadeNaTela(
  db: Db,
  companyId: string,
  porTitularCents: number
): Promise<MensalidadeNaTela> {
  const porTitular: MensalidadeNaTela = { totalCents: porTitularCents, valorFixo: null };
  const { data: empresa, error } = await db
    .from("companies")
    .select("billing_basis, fixed_monthly_cents")
    .eq("id", companyId)
    .maybeSingle<{ billing_basis: string | null; fixed_monthly_cents: number | null }>();
  if (error) {
    console.error("mensalidade na tela (base do acordo):", error.message);
    return porTitular;
  }
  if (!empresa || !ehValorFixo(empresa.billing_basis)) return porTitular;

  const { data: termos, error: erroDosTermos } = await db
    .from("company_inclusion_terms")
    .select("monthly_delta_cents")
    .eq("company_id", companyId)
    .eq("status", "ACEITO")
    // AP19: só termos do VALOR FIXO somam ao fixo — o termo "pela tabela"
    // (de quando a empresa era por titular) já está coberto pelo valor fixo.
    .is("base_holders", null)
    .returns<{ monthly_delta_cents: number }[]>();
  if (erroDosTermos) console.error("mensalidade na tela (termos):", erroDosTermos.message);
  const total = mensalidadeDoFixo(
    empresa.fixed_monthly_cents,
    (termos ?? []).map((t) => t.monthly_delta_cents)
  );
  if (total === null) return porTitular;
  return {
    totalCents: total,
    valorFixo: {
      fixoCents: empresa.fixed_monthly_cents ?? 0,
      termosCents: total - (empresa.fixed_monthly_cents ?? 0),
    },
  };
}
