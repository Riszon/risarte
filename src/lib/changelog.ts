import type { UserRole } from "@/lib/roles";

/**
 * O REGISTRO DE NOVIDADES — o que mudou no sistema, em linguagem de quem opera.
 *
 * ⚠️ POR QUE ISTO É CÓDIGO E NÃO TABELA DO BANCO.
 *
 * Código viaja sozinho para os DOIS ambientes a cada push (ver seção 0b do
 * `CLAUDE.md`); dado não viaja. Se as novidades morassem numa tabela, o ambiente
 * de treino mostraria uma lista vazia — ou pior, uma lista diferente da
 * produção — e a equipe treinaria achando que o sistema é outro.
 *
 * O segundo motivo é atrito: exigir uma migração a cada entrega só para
 * registrar "entreguei" mataria a disciplina em duas semanas. Aqui, acrescentar
 * a novidade é editar o mesmo arquivo em que se bumpa a versão.
 *
 * ⚠️ E HÁ UM TESTE QUE OBRIGA. `changelog.test.ts` recusa `APP_VERSION` sem
 * entrada correspondente aqui. A regra da seção 0c do `CLAUDE.md` deixa de
 * depender de alguém lembrar: o portão de entrega quebra.
 *
 * ESCREVER PENSANDO NA RECEPCIONISTA, não no programador. "A tela de login
 * passou a dizer qual foi o problema" — não "refatorado o tratamento de erro do
 * `signInWithPassword`". Quem lê isto quer saber o que muda no dia dela.
 */

export type TipoDeMudanca = "novidade" | "melhoria" | "correcao" | "aviso";

export const TIPO_ROTULO: Record<TipoDeMudanca, string> = {
  novidade: "Novidade",
  melhoria: "Melhoria",
  correcao: "Correção",
  aviso: "Atenção",
};

export type Mudanca = {
  tipo: TipoDeMudanca;
  /** Uma frase, para quem opera. Sem jargão. */
  texto: string;
  /** Quem sente a mudança. `"todos"` quando alcança a operação inteira. */
  papeis: UserRole[] | "todos";
  /** A seção do manual que mudou junto — o elo que a regra 0c exige. */
  manual?: string;
};

export type Versao = {
  versao: string;
  /** ISO `aaaa-mm-dd`. Data da publicação, não do commit. */
  data: string;
  /** A migração mais alta desta entrega, ou `null` quando não houve. */
  migracao: string | null;
  /** Uma linha que resume a entrega. */
  titulo: string;
  mudancas: Mudanca[];
};

/**
 * MAIS RECENTE PRIMEIRO. A primeira entrada tem de casar com `APP_VERSION`.
 *
 * O registro começa em 25/08/2026, quando o sistema entrou em preparação de
 * lançamento. O que veio antes foi obra, e obra não interessa a quem opera —
 * está no `ESTADO_DO_PROJETO.md`, que é o documento de quem constrói.
 */
export const CHANGELOG: Versao[] = [
  {
    versao: "0.226.0",
    data: "2026-09-04",
    migracao: "0247",
    titulo: "O manual dentro do sistema, e um lugar para relatar problema",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "O manual de treinamento passou a viver dentro do sistema, no menu Manual. É sempre a versão do dia — ninguém mais precisa procurar o arquivo que recebeu por mensagem.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
      {
        tipo: "novidade",
        texto:
          "Nova tela Sistema, com três abas: Novidades (esta lista), Problemas (para relatar e acompanhar) e Alertas (o que o sistema está avisando).",
        papeis: "todos",
        manual: "15. Novidades, problemas e alertas",
      },
      {
        tipo: "novidade",
        texto:
          "Para relatar um problema não é mais preciso copiar formulário nenhum: o sistema já preenche quem é você, sua função, a unidade, a tela e a versão. Você escreve só o que aconteceu.",
        papeis: "todos",
        manual: "9.4. Como relatar um problema",
      },
      {
        tipo: "melhoria",
        texto:
          "Quando algo quebra de verdade, no lugar da tela cinza de erro aparece uma explicação em português, com o código do erro e um botão que já abre o relato preenchido.",
        papeis: "todos",
        manual: "9.1. Como reconhecer",
      },
      {
        tipo: "aviso",
        texto:
          "Você enxerga os problemas relatados na SUA unidade — assim ninguém abre cinco vezes o mesmo, e quem chegar depois já lê a resposta.",
        papeis: "todos",
        manual: "15.2. Problemas",
      },
    ],
  },
  {
    versao: "0.225.0",
    data: "2026-09-01",
    migracao: "0246",
    titulo: "Permissões viraram tela, sem depender de alteração no código",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "Administração → Permissões: o Admin Master liga e desliga o que cada função enxerga, sem esperar uma nova versão do sistema.",
        papeis: "todos",
        manual: "13b. Para o Admin Master: alterar permissões",
      },
      {
        tipo: "correcao",
        texto:
          "Centro de Planejamento e Procedimentos nunca apareceram para todas as funções — só para o Dentista Planner. O manual dizia o contrário e foi corrigido.",
        papeis: "todos",
        manual: "4.2. As duas camadas de proteção",
      },
    ],
  },
  {
    versao: "0.224.0",
    data: "2026-08-31",
    migracao: null,
    titulo: "A tela de login parou de culpar a senha por qualquer falha",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          'Antes, qualquer falha ao entrar dizia "E-mail ou senha incorretos" — inclusive quando o problema era a internet ou tentativas demais. Agora cada caso tem a sua mensagem.',
        papeis: "todos",
        manual: "9.5. Categorias",
      },
    ],
  },
  {
    versao: "0.223.0",
    data: "2026-08-31",
    migracao: null,
    titulo: "O ambiente de treino ficou impossível de confundir",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          'O ambiente de treino ganhou faixa amarela em toda tela e "TREINO" no título da aba. Se você não vê a faixa, está no sistema de verdade — o que fizer ali vale.',
        papeis: "todos",
        manual: "2. Início rápido",
      },
    ],
  },
  {
    versao: "0.222.0",
    data: "2026-08-28",
    migracao: null,
    titulo: "Correções encontradas nos testes de ponta a ponta",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Fechar dois avisos empilhados pelo teclado deixava a tela inteira invisível para leitor de tela. Corrigido.",
        papeis: "todos",
      },
      {
        tipo: "correcao",
        texto:
          "A tela de Atendimento enchia o console de erro por causa do cronômetro. Sem efeito para quem usa, mas escondia erro de verdade.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.221.0",
    data: "2026-08-26",
    migracao: "0245",
    titulo: "O código do documento nunca mais é cortado",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Códigos como PT-00001 e VD-00042 podiam ser truncados em telas com pouco espaço. É por eles que se liga o clínico ao financeiro — agora aparecem inteiros.",
        papeis: "todos",
        manual: "12. Glossário",
      },
    ],
  },
  {
    versao: "0.220.0",
    data: "2026-08-25",
    migracao: "0244",
    titulo: "CPF repetido e clique duplo",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "O mesmo CPF digitado com e sem pontuação criava dois pacientes. Agora o sistema compara só os números e reconhece quem já existe.",
        papeis: ["receptionist", "sdr"],
        manual: "6.1. Recepcionista",
      },
      {
        tipo: "correcao",
        texto:
          "Clicar duas vezes seguidas no botão de salvar o plano criava dois registros. Corrigido.",
        papeis: ["planner_dentist"],
      },
    ],
  },
];

/** A versão mais recente do registro. */
export function versaoMaisRecente(): Versao {
  return CHANGELOG[0];
}

/**
 * As entradas que interessam a quem tem estes papéis.
 *
 * Admin Master vê tudo — ele responde pelo sistema inteiro, e filtrar esconderia
 * dele justamente o que a equipe vai perguntar.
 */
export function novidadesPara(
  papeis: UserRole[],
  isAdminMaster: boolean
): Versao[] {
  if (isAdminMaster) return CHANGELOG;
  return CHANGELOG.map((v) => ({
    ...v,
    mudancas: v.mudancas.filter(
      (m) => m.papeis === "todos" || m.papeis.some((p) => papeis.includes(p))
    ),
  })).filter((v) => v.mudancas.length > 0);
}
