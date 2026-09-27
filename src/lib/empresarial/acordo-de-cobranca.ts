// Risarte Empresarial — O ACORDO DE COBRANÇA EDITADO NA EMPRESA (AP19).
//
// Decisão do dono (27/09/2026): empresa cadastrada DIRETO (sem funil) também
// pode ser de valor fixo e ter regra do excedente — na edição, por quem já
// mexe no preço da empresa. E a quantidade contratada vem junto: sem ela não
// há trava nem termo de inclusão, e a regra do excedente nunca seria usada.
//
// Puro e testado: é o que decide o que o boleto cobra.
//
// ⚠️ O QUE NÃO ESTÁ NA TELA NÃO É ESCRITO. Na empresa por titular, o valor fixo
// e a regra do excedente somem da tela — e continuam gravados, sem uso. Mudar
// de volta para valor fixo mostra o que estava lá. Nada é apagado por trocar
// uma opção.

import { BASES_DE_COBRANCA, type BaseDeCobranca } from "./mensalidade";

export type AcordoDigitado = {
  base: string | null;
  fixoCents: number | null;
  titularesContratados: number | null;
  dependentesContratados: number | null;
  modoDoExcedente: string | null;
  excedenteFixoCents: number | null;
  excedenteTitularCents: number | null;
  excedenteDependenteCents: number | null;
};

/** As colunas de `companies` que o salvar escreve — só o que está na tela. */
export type AcordoParaGravar = {
  billing_basis: BaseDeCobranca;
  contracted_holders: number | null;
  contracted_dependents: number | null;
  fixed_monthly_cents?: number;
  excess_mode?: "NEW_FIXED" | "PER_ADHESION" | null;
  excess_fixed_cents?: number | null;
  excess_holder_fee_cents?: number | null;
  excess_dependent_fee_cents?: number | null;
};

export function validarAcordo(
  a: AcordoDigitado
): { ok: true; valores: AcordoParaGravar } | { ok: false; erro: string } {
  if (!a.base || !(BASES_DE_COBRANCA as readonly string[]).includes(a.base)) {
    return { ok: false, erro: "Escolha como a mensalidade é cobrada." };
  }
  const base = a.base as BaseDeCobranca;

  // Quantidade contratada: vazio = sem trava (como toda empresa antiga).
  for (const [n, rotulo] of [
    [a.titularesContratados, "titulares"],
    [a.dependentesContratados, "dependentes"],
  ] as const) {
    if (n != null && (!Number.isInteger(n) || n < 0)) {
      return { ok: false, erro: `A quantidade contratada de ${rotulo} tem de ser um número inteiro.` };
    }
  }
  const valores: AcordoParaGravar = {
    billing_basis: base,
    contracted_holders: a.titularesContratados,
    contracted_dependents: a.dependentesContratados,
  };
  if (base === "PER_EMPLOYEE") return { ok: true, valores };

  // ---- valor fixo ----
  if (a.fixoCents == null || a.fixoCents <= 0) {
    return { ok: false, erro: "Informe o valor fixo mensal da empresa." };
  }
  valores.fixed_monthly_cents = a.fixoCents;

  const modo = a.modoDoExcedente || null;
  if (modo !== null && modo !== "NEW_FIXED" && modo !== "PER_ADHESION") {
    return { ok: false, erro: "Regra do excedente inválida." };
  }
  valores.excess_mode = modo;
  // Trocar o modo limpa os campos do OUTRO modo — é o que o salvar da
  // proposta já faz, e deixar os dois gravados faria a tela mostrar um valor
  // que não vale.
  valores.excess_fixed_cents = null;
  valores.excess_holder_fee_cents = null;
  valores.excess_dependent_fee_cents = null;
  if (modo === "NEW_FIXED") {
    if (a.excedenteFixoCents == null || a.excedenteFixoCents <= a.fixoCents) {
      return {
        ok: false,
        erro: "O novo valor fixo do pacote tem de ser MAIOR que o valor fixo atual — o termo cobra a diferença.",
      };
    }
    valores.excess_fixed_cents = a.excedenteFixoCents;
  } else if (modo === "PER_ADHESION") {
    if (a.excedenteTitularCents == null || a.excedenteTitularCents <= 0) {
      return { ok: false, erro: "Informe o preço de cada titular a mais." };
    }
    valores.excess_holder_fee_cents = a.excedenteTitularCents;
    valores.excess_dependent_fee_cents =
      a.excedenteDependenteCents != null && a.excedenteDependenteCents > 0
        ? a.excedenteDependenteCents
        : null;
  }
  return { ok: true, valores };
}
