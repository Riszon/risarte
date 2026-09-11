/**
 * OS RESULTADOS DE UMA LIGAÇÃO DE BOAS-VINDAS.
 *
 * ⚠️ ESTE ARQUIVO EXISTE POR UM MOTIVO ESPECÍFICO, E O DONO PAGOU POR ELE.
 * Estas constantes moravam em `actions.ts`, que começa com `"use server"` — e
 * **num arquivo `"use server"` todo export tem de ser função async**. Constante
 * exportada dali não chega ao navegador como constante: a tela cliente recebia
 * outra coisa no lugar da lista, e `RESULTADOS.map(...)` quebrava.
 *
 * O defeito era invisível até o clique: a lista abre sem tocar nestes valores, e
 * eles só são usados **dentro do diálogo**, que só existe depois de clicar em
 * "Registrar". O build compilou, a varredura de telas abriu a página, e nada
 * acusou — porque abrir não é clicar.
 *
 * É a MESMA armadilha registrada no CLAUDE.md (a v0.229.0 quebrou na Vercel por
 * uma constante exportada de um arquivo `"use server"`). Estava escrita, e eu
 * repeti. Daqui em diante: valor compartilhado entre servidor e tela mora em
 * arquivo próprio, sem `"use server"`.
 */

export const RESULTADOS = [
  "CONTACTED",
  "NO_ANSWER",
  "CALL_LATER",
  "DECLINED",
] as const;

export type Resultado = (typeof RESULTADOS)[number];

export const RESULTADO_ROTULO: Record<Resultado, string> = {
  CONTACTED: "Falei com a pessoa",
  NO_ANSWER: "Não atendeu",
  CALL_LATER: "Pediu para ligar depois",
  DECLINED: "Não quer agora",
};

/**
 * Quais resultados devolvem a pessoa para a fila.
 *
 * ⚠️ "JÁ LIGUEI" NÃO É O MESMO QUE "RESOLVIDO": quem não atendeu e quem pediu
 * para ligar depois continuam esperando. Tirá-los faria a lista esvaziar com o
 * trabalho por fazer.
 */
export const VOLTAM_PARA_A_FILA: readonly Resultado[] = ["NO_ANSWER", "CALL_LATER"];
