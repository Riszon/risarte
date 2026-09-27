// Risarte Empresarial — A MENSALIDADE QUANDO O ACORDO É DE VALOR FIXO (AP18).
//
// Regras do dono (27/09/2026):
//   1. No valor fixo, a mensalidade É o valor fixo — mais o que os termos de
//      inclusão ACEITOS acrescentaram.
//   2. No termo "novo valor fixo", a empresa paga a mais: novo fixo − fixo
//      atual (o termo já guarda essa diferença em `monthly_delta_cents`).
//   3. A implantação é SEMPRE o primeiro pagamento: no valor fixo, um mês do
//      fixo; depois, só o que cada termo acrescentou.
//
// Puro e testado: é dinheiro, e regra de dinheiro não mora em tela nem em
// action.

import { precoDaFaixa, type FaixaDePreco } from "./condicoes-da-proposta";

export const BASES_DE_COBRANCA = ["PER_EMPLOYEE", "FIXED_PER_COMPANY"] as const;
export type BaseDeCobranca = (typeof BASES_DE_COBRANCA)[number];

/** Só `FIXED_PER_COMPANY` é valor fixo — valor estranho ou ausente é por titular. */
export function ehValorFixo(base: string | null | undefined): boolean {
  return base === "FIXED_PER_COMPANY";
}

/**
 * A mensalidade do acordo de valor fixo.
 *
 * ⚠️ A SOMA DOS TERMOS, e não "o valor do último termo": um termo "novo valor
 * fixo" guarda a DIFERENÇA (novo − atual). Somando, o total vira exatamente o
 * novo pacote — e o histórico dos termos continua explicando cada centavo.
 * Sobrescrever o fixo apagaria esse rastro.
 *
 * Nulo quando o fixo não existe: não há conta sem o valor combinado.
 */
export function mensalidadeDoFixo(
  fixoCents: number | null | undefined,
  termosAceitosCents: readonly number[]
): number | null {
  if (fixoCents == null || !Number.isFinite(fixoCents) || fixoCents < 0) return null;
  const termos = termosAceitosCents.reduce(
    (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
    0
  );
  return fixoCents + termos;
}

export type ImplantacaoDoFixo =
  | { tipo: "primeira"; aCobrarCents: number }
  | { tipo: "diferenca"; aCobrarCents: number; jaCobradoCents: number }
  | { tipo: "nada"; jaCobradoCents: number };

/**
 * A implantação no valor fixo: o PRIMEIRO PAGAMENTO do que ainda não pagou
 * implantação.
 *
 * Na 1ª vez, é a mensalidade inteira (um mês do fixo). Depois de um termo
 * aceito, é só o que ele acrescentou — a mensalidade de hoje menos o que as
 * implantações anteriores (não canceladas) já cobraram. Clique duplo cai em
 * "nada".
 */
export function implantacaoDoFixo(
  mensalidadeCents: number,
  implantacoesAnterioresCents: readonly number[]
): ImplantacaoDoFixo {
  const jaCobradoCents = implantacoesAnterioresCents.reduce(
    (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
    0
  );
  if (implantacoesAnterioresCents.length === 0) {
    return { tipo: "primeira", aCobrarCents: Math.max(0, mensalidadeCents) };
  }
  const aCobrarCents = mensalidadeCents - jaCobradoCents;
  if (aCobrarCents <= 0) return { tipo: "nada", jaCobradoCents };
  return { tipo: "diferenca", aCobrarCents, jaCobradoCents };
}

/**
 * O fixo que vai para a empresa no FECHAMENTO: o da proposta, com a faixa do
 * tamanho da empresa aplicada — exatamente o número que a empresa leu.
 */
export function fixoDoFechamento(
  fixoCents: number,
  faixas: readonly FaixaDePreco[],
  titulares: number
): number {
  return precoDaFaixa(faixas, Math.max(0, Math.floor(titulares)), Math.max(0, fixoCents)).precoCents;
}
