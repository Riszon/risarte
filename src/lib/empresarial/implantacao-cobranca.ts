/**
 * QUANTO DE IMPLANTAÇÃO AINDA FALTA COBRAR (AP12, 26/09/2026).
 *
 * A regra, nas palavras do dono: *"sempre que for acrescentado novos titulares
 * o primeiro pagamento é a implantação (...) uma empresa com 100 colaboradores
 * fez a adesão de 80 em uma primeira etapa, e uma segunda etapa dos 20
 * restantes, será cobrado a implantação nas duas vezes, proporcional à
 * quantidade."*
 *
 * Ou seja: **cada titular paga implantação UMA vez**, na etapa em que entra.
 *
 * ⚠️ O QUE ESTAVA ERRADO. A implantação era calculada sempre do zero: pela
 * quantidade contratada, ou por todos os titulares cadastrados. Na segunda
 * etapa (termo de inclusão de +20), "Gerar implantação" cobrava os 100 — e os
 * 80 que já tinham pago pagavam de novo. Dois cliques também duplicavam.
 *
 * O CONSERTO: cada implantação guarda QUANTOS titulares cobriu
 * (`holders_covered`, 1023), e a próxima cobra só a diferença:
 *
 *     base de hoje (contratado + termos aceitos, ou os ativos se forem mais)
 *   − o que as implantações vivas já cobriram
 *   = o que falta
 *
 * Diferença zero = não há o que cobrar — e é isso que também acaba com o
 * clique duplo.
 */

/** Uma implantação VIVA (não cancelada) já gerada para a empresa. */
export type ImplantacaoAnterior = {
  /** Quantos titulares ela cobriu. `null` = gerada antes da 1023, sem registro. */
  holders_covered: number | null;
};

export type DecisaoDaImplantacao =
  /** Nenhuma implantação viva: vale a regra de sempre (a de 25/09). */
  | { tipo: "primeira" }
  /** Já houve implantação; esta cobra só quem ainda não pagou. */
  | { tipo: "diferenca"; base: number; jaCobertos: number; aCobrar: number }
  /** Todo mundo já pagou implantação. */
  | { tipo: "nada"; base: number; jaCobertos: number }
  /** Há implantação antiga sem o registro de quantos cobriu. */
  | { tipo: "desconhecido"; semRegistro: number };

/**
 * ⚠️ IMPLANTAÇÃO SEM REGISTRO NÃO VALE ZERO — vale "não sei".
 *
 * Uma implantação gerada antes da 1023 não guardou quantos titulares cobriu.
 * Tratá-la como zero faria a próxima cobrar todo mundo de novo — exatamente o
 * defeito que isto conserta. Tratá-la como "cobriu todos" poderia deixar de
 * cobrar quem entrou depois. Nenhum dos dois palpites é dado; a tela mostra a
 * conta de sempre e AVISA, para uma pessoa conferir. (Na produção, em
 * 26/09/2026, não havia cobrança nenhuma — então esse caso só existe no treino.)
 */
export function decidirImplantacao(entrada: {
  /** Contratado + termos de inclusão aceitos. `null` = contrato sem quantidade. */
  limite: number | null;
  /** Titulares ativos agora. */
  ativos: number;
  /** Implantações VIVAS da empresa (quem chama tira as canceladas). */
  anteriores: readonly ImplantacaoAnterior[];
}): DecisaoDaImplantacao {
  if (entrada.anteriores.length === 0) return { tipo: "primeira" };

  const semRegistro = entrada.anteriores.filter((a) => a.holders_covered === null).length;
  if (semRegistro > 0) return { tipo: "desconhecido", semRegistro };

  // A base é o contrato — mas, se já há MAIS gente ativa do que o contrato diz
  // (cadastro de antes da trava da quantidade), quem está ativo também paga.
  const base =
    entrada.limite != null ? Math.max(entrada.limite, entrada.ativos) : entrada.ativos;
  const jaCobertos = entrada.anteriores.reduce(
    (s, a) => s + Math.max(0, a.holders_covered ?? 0),
    0
  );
  const aCobrar = base - jaCobertos;

  if (aCobrar <= 0) return { tipo: "nada", base, jaCobertos };
  return { tipo: "diferenca", base, jaCobertos, aCobrar };
}
