import type { AnexoPendente } from "@/app/(app)/problemas/anexos";

/**
 * LEVAR O RELATO PARA A BARRA DA BOIA (21/09/2026).
 *
 * Achado do dono: abrindo o relato pela tela de Problemas ("Ver relatos" →
 * "Relatar um problema"), as opções de print eram só duas — "outra aba ou
 * janela" e "anexar arquivo". Faltava justamente a que serve àquele caso:
 * **ir até a tela do problema**. Quem relata a partir da lista quase nunca
 * está na tela com defeito; era a única entrada do sistema sem o caminho.
 *
 * O caminho existia, mas só no painel da boia, porque só ele continua montado
 * quando a pessoa troca de tela. O formulário da página vive dentro da página e
 * morre na navegação — então, em vez de duplicar o mecanismo (dois jeitos de
 * guardar um rascunho acabariam discordando), ele **entrega** o que já foi
 * escrito para a boia e sai de cena.
 *
 * O evento viaja só dentro da aba, e os anexos vão como estão (`File` em
 * memória): nada é gravado em disco nem sobe para o servidor enquanto a pessoa
 * escolhe — a regra do relato continua sendo "nada sobe antes de existir o
 * relato".
 */
export const LEVAR_RELATO = "risarte:levar-relato";

/** O que a pessoa já preencheu — vai inteiro, para ela não redigitar. */
export type ValoresDoRelato = {
  kind: string;
  module: string | null;
  severity: string;
  title: string;
  screen: string;
  what_happened: string;
  expected: string;
};

export type RelatoParaLevar = {
  valores: ValoresDoRelato;
  anexos: AnexoPendente[];
};

/** Lê o formulário pelos NOMES dos campos — os ids mudam a cada instância. */
export function valoresDoFormulario(form: HTMLFormElement): ValoresDoRelato {
  return valoresDoRelato(new FormData(form));
}

/**
 * A leitura em si, separada do DOM para poder ser provada por teste.
 *
 * Os padrões (`erro`, `media`) repetem os do formulário de propósito: se um
 * campo vier vazio — coisa que acontece quando a pessoa clica em "ir até a
 * tela" antes de mexer em tudo —, o relato continua com a mesma cara que teria
 * se fosse enviado dali. Módulo vazio vira `null`, não texto em branco: é o
 * que faz a tela seguinte pedir a escolha em vez de gravar um vazio.
 */
export function valoresDoRelato(fd: FormData): ValoresDoRelato {
  const t = (nome: string) => String(fd.get(nome) ?? "");
  return {
    kind: t("kind") || "erro",
    module: t("module") || null,
    severity: t("severity") || "media",
    title: t("title"),
    screen: t("screen"),
    what_happened: t("what_happened"),
    expected: t("expected"),
  };
}
