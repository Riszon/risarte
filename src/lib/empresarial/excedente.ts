// Risarte Empresarial — O EXCEDENTE DE ADESÕES (OC-00083, I4).
//
// Pedido do dono (24/09/2026): a empresa contratou 100 titulares e mandou 120
// nomes. O sistema **não pode cadastrar os 120** — cadastra os 100 e, para os
// outros, gera um **termo de inclusão** com o cálculo da diferença, que a
// empresa aceita antes de os cadastros serem liberados.
//
// E, no acordo de VALOR FIXO: o teto é combinado na proposta, e os valores do
// excedente também — "pode ser uma nova faixa de valor fixo ou por adesões de
// titulares ou dependentes".
//
// Tudo em CENTAVOS, puro e testado: é dinheiro, e regra de dinheiro não mora
// em componente de tela.

export type RegraDoExcedente = {
  /**
   * `NEW_FIXED` = o pacote passa a valer outro valor fixo.
   * `PER_ADHESION` = cada pessoa a mais tem preço.
   * `null` = não foi combinado na proposta.
   */
  modo: "NEW_FIXED" | "PER_ADHESION" | null;
  /** Valor fixo novo do pacote, quando o modo é `NEW_FIXED`. */
  fixoCents: number | null;
  /** Preço de cada titular a mais, quando o modo é `PER_ADHESION`. */
  titularCents: number | null;
  /** Preço de cada dependente a mais. */
  dependenteCents: number | null;
  /** O que a empresa paga hoje por mês — a base da diferença no `NEW_FIXED`. */
  mensalidadeAtualCents: number;
  /** Implantação por adesão, quando houver. */
  implantacaoPorAdesaoCents: number;
};

export type ContaDoExcedente = {
  titulares: number;
  dependentes: number;
  /** Quanto a MAIS por mês, em centavos. */
  mensalDeltaCents: number;
  /** Implantação das pessoas a mais, cobrada uma vez. */
  implantacaoCents: number;
  /** Valores congelados no termo — é o que a empresa aceita. */
  titularCents: number | null;
  dependenteCents: number | null;
  fixoCents: number | null;
  /**
   * O que o sistema NÃO conseguiu calcular sozinho. Vazio = o termo nasce com
   * o número pronto; com item aqui, alguém precisa combinar antes.
   */
  faltaCombinar: string[];
};

/**
 * QUANTO CUSTA INCLUIR ESTAS PESSOAS.
 *
 * ⚠️ Quando a regra não foi combinada na proposta, a conta devolve **zero e
 * diz o que falta** — não inventa preço. Termo de inclusão com valor chutado
 * seria pior que termo nenhum: a empresa assinaria um número que a Risarte não
 * combinou, e a diferença apareceria na renegociação seguinte.
 */
export function contaDoExcedente(
  regra: RegraDoExcedente,
  titulares: number,
  dependentes: number
): ContaDoExcedente {
  const t = Math.max(0, Math.floor(titulares));
  const d = Math.max(0, Math.floor(dependentes));
  const faltaCombinar: string[] = [];

  let mensalDeltaCents = 0;
  let titularCents: number | null = null;
  let dependenteCents: number | null = null;
  let fixoCents: number | null = null;

  if (regra.modo === "NEW_FIXED") {
    if (regra.fixoCents == null) {
      faltaCombinar.push("o novo valor fixo do pacote");
    } else {
      fixoCents = regra.fixoCents;
      // ⚠️ A DIFERENÇA, e não o valor cheio: a empresa já paga a mensalidade
      // atual. Cobrar o pacote inteiro de novo seria cobrar duas vezes o que
      // ela nunca deixou de pagar.
      mensalDeltaCents = Math.max(0, regra.fixoCents - regra.mensalidadeAtualCents);
    }
  } else if (regra.modo === "PER_ADHESION") {
    if (t > 0 && regra.titularCents == null) {
      faltaCombinar.push("o preço do titular excedente");
    }
    if (d > 0 && regra.dependenteCents == null) {
      faltaCombinar.push("o preço do dependente excedente");
    }
    titularCents = regra.titularCents;
    dependenteCents = regra.dependenteCents;
    mensalDeltaCents =
      t * Math.max(0, regra.titularCents ?? 0) +
      d * Math.max(0, regra.dependenteCents ?? 0);
  } else {
    faltaCombinar.push("a regra do excedente (não foi combinada na proposta)");
  }

  // A implantação é POR PESSOA que entra, e só dos titulares — é o que a
  // proposta cobra por adesão. Dependente não paga implantação em lugar
  // nenhum do sistema.
  const implantacaoCents = t * Math.max(0, regra.implantacaoPorAdesaoCents);

  return {
    titulares: t,
    dependentes: d,
    mensalDeltaCents,
    implantacaoCents,
    titularCents,
    dependenteCents,
    fixoCents,
    faltaCombinar,
  };
}

export type ContaPelaTabela = {
  titulares: number;
  dependentes: number;
  /** Quantos titulares o contrato cobria antes, e o preço de cada um. */
  antesTitulares: number;
  antesPrecoCents: number;
  /** Com os novos: o total de titulares e o preço (a faixa pode ter mudado). */
  depoisTitulares: number;
  depoisPrecoCents: number;
  /** Depois − antes. PODE SER NEGATIVO: a faixa nova vale para todos. */
  mensalDeltaCents: number;
  /** O 1º pagamento dos titulares novos, pelo preço de depois. */
  implantacaoCents: number;
};

/**
 * O TERMO DA EMPRESA POR TITULAR (AP19 — decisão do dono, 27/09/2026).
 *
 * Quem passa do contratado paga o PREÇO DA TABELA da empresa, com a faixa —
 * a mesma conta do boleto. Por isso não há "preço do excedente" aqui, nem
 * nada a combinar: a regra do excedente só existe no acordo de valor fixo.
 *
 * ⚠️ A DIFERENÇA É ENTRE O CONTRATO CHEIO ANTES E DEPOIS, e pode ser NEGATIVA.
 * A faixa vale para o total: entrar gente pode baixar o preço de todos, e o
 * termo mostra isso como é — esconder faria o documento dizer uma coisa e o
 * boleto outra, que é o defeito que esta regra existe para acabar.
 *
 * ⚠️ DEPENDENTES NÃO ENTRAM NA CONTA (mesma regra da proposta, 24/09/2026):
 * o preço deles depende do plano de cada família, que ninguém sabe antes do
 * cadastro. O termo cita a tabela do contrato.
 */
export function contaPelaTabela(
  antesTitulares: number,
  antesPrecoCents: number,
  depoisPrecoCents: number,
  titulares: number,
  dependentes: number
): ContaPelaTabela {
  const t = Math.max(0, Math.floor(titulares));
  const d = Math.max(0, Math.floor(dependentes));
  const antes = Math.max(0, Math.floor(antesTitulares));
  const pAntes = Math.max(0, antesPrecoCents);
  const pDepois = Math.max(0, depoisPrecoCents);
  const depois = antes + t;
  return {
    titulares: t,
    dependentes: d,
    antesTitulares: antes,
    antesPrecoCents: pAntes,
    depoisTitulares: depois,
    depoisPrecoCents: pDepois,
    mensalDeltaCents: depois * pDepois - antes * pAntes,
    implantacaoCents: t * pDepois,
  };
}

/**
 * Quantos cabem ainda, e quantos sobram.
 *
 * ⚠️ LIMITE NULO É "SEM TRAVA", não "zero". Toda empresa cadastrada antes
 * desta regra tem limite nulo, e travá-las seria parar a operação inteira por
 * causa de um campo novo.
 */
export function vagasDisponiveis(
  limite: number | null,
  ativos: number
): { semTrava: boolean; vagas: number; excedente: number } {
  if (limite == null) return { semTrava: true, vagas: Number.POSITIVE_INFINITY, excedente: 0 };
  const vagas = Math.max(0, limite - ativos);
  return { semTrava: false, vagas, excedente: Math.max(0, ativos - limite) };
}

/**
 * A frase que a tela mostra quando o cadastro é recusado.
 *
 * Ela diz os DOIS números e o caminho — "não pode" sozinho faria a pessoa
 * tentar de novo achando que foi engano.
 */
export function recusaDoCadastro(limite: number, ativos: number): string {
  return (
    `Esta empresa já tem ${ativos} titular(es) ativos, e o contrato fechou ${limite}. ` +
    `Para incluir mais, gere um termo de inclusão — ele calcula a diferença e, ` +
    `depois de aceito pela empresa, libera os cadastros.`
  );
}

/**
 * A mesma frase, para DEPENDENTES (1021).
 *
 * ⚠️ POR QUE UMA FUNÇÃO IRMÃ, e não um parâmetro "quem" na de cima: a saída é
 * um texto que alguém lê no meio do atendimento, e montar frase por
 * concatenação de pedaços ("já tem 5 " + palavra + "(es) ativos") produz
 * português torto na primeira flexão que não encaixa. Duas frases escritas por
 * extenso custam três linhas e dizem exatamente o que precisam dizer.
 *
 * O teto de dependentes é DA EMPRESA, não de cada titular: o acordo combina
 * "até 50 dependentes", e como eles se distribuem entre as famílias é assunto
 * da empresa.
 */
export function recusaDoDependente(limite: number, ativos: number): string {
  return (
    `Esta empresa já tem ${ativos} dependente(s) ativos, e o contrato fechou ${limite}. ` +
    `Para incluir mais, gere um termo de inclusão — ele calcula a diferença e, ` +
    `depois de aceito pela empresa, libera os cadastros.`
  );
}
