// O QUE O SISTEMA DIZ SOZINHO — um lugar só para os textos automáticos.
//
// Pedido do dono (20/09/2026): *"coloque na tela Orientações os textos que
// estão configurados para a tela de boas-vindas, para saber o que os usuários
// estão recebendo quando entram no sistema; daqui 2 semanas provavelmente não
// vou lembrar mais"*.
//
// ⚠️ POR QUE ELES VIVEM AQUI, E NÃO DENTRO DE CADA TELA. Se a tela de
// Orientações tivesse uma CÓPIA do texto, as duas divergiriam na primeira
// correção — e a tela que existe para o dono saber o que a equipe recebe
// passaria a mentir. Aqui é a fonte; a janela, o guia do treino e a tela de
// Orientações apenas mostram.
//
// O `**negrito**` é lido pelo componente `<ComNegrito>`: texto é dado, não JSX,
// para poder ser mostrado em qualquer lugar (inclusive numa tela de consulta).

export const BOAS_VINDAS = {
  quando:
    "Nos 3 primeiros dias em que a pessoa abre o Início do sistema real (uma vez por dia).",
  titulo: (primeiroNome: string) => `Bem-vindo(a) ao riSZon, ${primeiroNome}!`,
  abertura:
    "Que bom ter você na Risarte. O riSZon é o nosso sistema: é nele que a jornada de cada paciente acontece — do primeiro contato ao acompanhamento depois do tratamento — e é nele que a equipe trabalha junta, cada um na sua função.",
  proximoPasso: {
    /** Para quem ainda não tem o sistema real liberado (vê só o Início). */
    recemChegado:
      "**Seu primeiro passo é o riSZon Treino.** Lá você usa o sistema completo, com dados de mentira, no seu ritmo e sem medo de errar. Quando terminar o treinamento, a Franqueadora libera para você o sistema do dia a dia. O atalho do treino está aqui no Início, e o login é o mesmo.",
    /** Para quem já entra no sistema do dia a dia. */
    liberado:
      "**Seu acesso está liberado.** No menu da esquerda estão os módulos da sua função. Na dúvida, faça antes no **riSZon Treino** — o mesmo sistema, com dados de mentira. O atalho está aqui no Início.",
  },
  senha:
    "**Troque a sua senha** em **Perfil → Minha senha**. A senha nova vale aqui e no treino.",
  manual:
    "**Ficou com dúvida?** O **Manual** (o livro, no alto da tela) explica cada parte do sistema, sempre na versão que está no ar.",
  botao: "Vamos começar",
} as const;

export const GUIA_DO_TREINO = {
  quando: "Sempre, na tela de Início do riSZon Treino (dá para recolher).",
  titulo: "Este é o riSZon Treino — aqui é para testar",
  abertura:
    "É o **mesmo sistema** que a Risarte usa no dia a dia, com as mesmas telas e as mesmas regras — só que com **dados de mentira**. Nada do que você fizer aqui chega ao sistema real, a um paciente ou ao caixa de uma unidade.",
  itens: [
    {
      titulo: "Fique à vontade — e teste os limites.",
      texto:
        "Cadastre pacientes inventados, agende, remarque, faça a avaliação, monte o plano, feche a venda, dê baixa, cancele. Tente o caminho errado de propósito para ver o que o sistema responde. Errar aqui é o jeito de não errar lá.",
    },
    {
      titulo: "Ele fica sempre disponível.",
      texto:
        "Não é só para o treinamento inicial: depois de liberado no sistema real, volte aqui sempre que tiver dúvida. Antes de fazer algo novo no real, faça primeiro aqui.",
    },
    {
      titulo: "Nunca use dados de pacientes reais.",
      texto:
        "Nome, CPF, telefone, fotos e exames de verdade são dados de saúde protegidos pela LGPD e não podem entrar aqui. Invente tudo.",
      alerta: true,
    },
    {
      titulo: "A equipe vem do sistema real.",
      texto:
        "Os Risartanos, os acessos e as permissões são uma cópia de lá, só para consulta. Sua senha também: troque no Perfil do sistema real e ela passa a valer aqui.",
    },
  ],
  rodape:
    "A faixa amarela no alto da tela está sempre lá para lembrar onde você está. Se ela sumir, você está no sistema real.",
} as const;

/** Um pedaço de texto: normal ou em negrito. */
export type Pedaco = { texto: string; forte: boolean };

/**
 * Parte o texto nos `**negritos**`. Pura, para ter teste — e para o mesmo texto
 * poder ser desenhado na janela, no guia e na tela de consulta.
 */
export function pedacos(texto: string): Pedaco[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((p) => p !== "")
    .map((p) =>
      p.startsWith("**") && p.endsWith("**")
        ? { texto: p.slice(2, -2), forte: true }
        : { texto: p, forte: false }
    );
}

/** O mesmo texto sem as marcas — para onde não há formatação. */
export function semMarcas(texto: string): string {
  return texto.replace(/\*\*/g, "");
}
