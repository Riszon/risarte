// O RESPONSÁVEL FINANCEIRO (ASA1, D8; migração 4003) — as regras puras.
//
// O pagador das cobranças é o responsável marcado como financeiro, quando
// houver; senão, o próprio cliente.
//   * MENOR de 18 anos: pelo menos um responsável, e EXATAMENTE um marcado
//     como financeiro. Com um responsável só, ele é marcado sozinho.
//   * ADULTO: responsável é opcional (cônjuge, pai, mãe que pagam); no máximo
//     um marcado.
// O banco garante o "no máximo um" (`client_guardians_one_financial`); o
// "exatamente um no menor" é daqui (a tela e a ação usam a mesma regra).

export type ResponsavelParaRegra = { isFinancial?: boolean };

/** Ajusta a marca antes de gravar: menor com UM responsável → ele é o pagador. */
export function normalizarPagador<T extends ResponsavelParaRegra>(lista: T[], menor: boolean): T[] {
  if (menor && lista.length === 1 && !lista[0].isFinancial) {
    return [{ ...lista[0], isFinancial: true }];
  }
  return lista;
}

/** O erro do cadastro, em português, ou `null` quando está tudo certo. */
export function erroDosResponsaveis(lista: ResponsavelParaRegra[], menor: boolean): string | null {
  const marcados = lista.filter((g) => g.isFinancial).length;
  if (menor && lista.length === 0) {
    return "Cliente menor de 18 anos: informe ao menos um responsável.";
  }
  if (marcados > 1) {
    return "Marque só um responsável financeiro — é ele quem paga as cobranças.";
  }
  if (menor && marcados === 0) {
    return "Cliente menor de 18 anos: marque qual responsável é o financeiro (quem paga as cobranças).";
  }
  return null;
}

/**
 * A ordem de gravação: primeiro quem DEIXA de ser pagador, depois os demais.
 * O banco confere "um só" no fim de cada comando; gravar a troca na ordem
 * certa evita dois marcados no meio do caminho.
 */
export function ordemDeGravacao<T extends ResponsavelParaRegra>(lista: T[]): T[] {
  return [...lista.filter((g) => !g.isFinancial), ...lista.filter((g) => g.isFinancial)];
}
