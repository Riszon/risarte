import { isValidCpf } from "@/lib/masks";

/**
 * CPF INVÁLIDO SÓ AVISA, NÃO BARRA (decisão do dono, 02/11/2026 — AP90).
 *
 * O cadastro confere só os 11 dígitos; o dígito verificador errado passa e
 * o defeito aparecia só no envio para assinatura (`signatures/validate.ts`).
 * Agora o formulário avisa na hora e o prontuário mantém um lembrete até
 * alguém corrigir. Recusar no salvar barraria a edição dos cadastros antigos
 * com CPF errado — por isso, por enquanto, só o aviso.
 */

/** Enquanto se digita: avisa só quando os 11 dígitos estão lá e não conferem. */
export function cpfDigitadoInvalido(cpf: string | null | undefined): boolean {
  const digitos = (cpf ?? "").replace(/\D/g, "");
  return digitos.length === 11 && !isValidCpf(digitos);
}

/** Já gravado: qualquer CPF preenchido que não passa na conta é inválido. */
export function cpfGravadoInvalido(cpf: string | null | undefined): boolean {
  return (cpf ?? "").replace(/\D/g, "") !== "" && !isValidCpf(cpf);
}

export const AVISO_CPF_INVALIDO =
  "Este CPF não é válido (os dígitos não conferem). Dá para salvar, mas confira com o documento: com ele, o envio para assinatura digital fica bloqueado.";

/**
 * Quem, na ficha do cliente, tem CPF inválido gravado: o próprio cliente e
 * cada responsável. Devolve como a ficha deve chamar cada um.
 */
export function cpfsInvalidosDaFicha(ficha: {
  cpf: string | null;
  noCpf: boolean | null;
  responsaveis: { nome: string | null; cpf: string | null }[];
}): string[] {
  const quem: string[] = [];
  if (!ficha.noCpf && cpfGravadoInvalido(ficha.cpf)) quem.push("do cliente");
  for (const r of ficha.responsaveis) {
    if (cpfGravadoInvalido(r.cpf)) {
      quem.push(r.nome ? `de ${r.nome} (responsável)` : "do responsável");
    }
  }
  return quem;
}
