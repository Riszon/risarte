// QUAL AMBIENTE É ESTE.
//
// O mesmo código roda em dois endereços: o sistema de verdade e o ambiente de
// treino, que aponta para um banco separado. As duas telas são IDÊNTICAS — e é
// justamente por isso que confundir é fácil e caro: alguém cadastra o paciente
// de verdade no treino e o registro some no dia em que o banco de teste for
// zerado; ou alguém treina no sistema de verdade e polui o prontuário.
//
// A separação existe no endereço e na chave do banco. Este arquivo só a torna
// VISÍVEL, que é o que impede o erro humano.
//
// `NEXT_PUBLIC_` no nome é obrigatório: o valor precisa chegar ao navegador
// para o aviso aparecer também nas telas desenhadas do lado do cliente.

export type Ambiente = "producao" | "treino";

/**
 * Produção é o PADRÃO, de propósito.
 *
 * Se a variável faltar, o sistema se comporta como o de verdade — sem faixa de
 * aviso. O contrário seria pior: um esquecimento de configuração faria o
 * sistema real exibir "ambiente de teste" e a equipe pararia de confiar nos
 * próprios dados.
 */
export function ambiente(): Ambiente {
  return process.env.NEXT_PUBLIC_AMBIENTE === "treino" ? "treino" : "producao";
}

export function isTreino(): boolean {
  return ambiente() === "treino";
}
