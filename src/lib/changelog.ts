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
    versao: "0.240.0",
    data: "2026-09-10",
    migracao: null,
    titulo: "A tela de Início mostra o que espera por você",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "A tela de Início ganhou o bloco \"O que espera por você\": cartões com um número, o que ele significa e o caminho para resolver — os agendamentos de hoje, quem já fez check-in e está esperando, os planos aguardando a sua aprovação, os casos com prazo estourado, as compras a aprovar, os itens abaixo do mínimo. Cada pessoa vê os cartões da SUA função.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "Cartão sem nada pendente não aparece, em vez de mostrar um \"0\". E quando não há nada esperando em nada, a tela diz isso com todas as letras.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "O alto da tela ganhou dois ou três atalhos do que você mais faz para começar o dia — a recepção tem \"Cadastrar cliente\" e \"Abrir a agenda\"; o dentista, \"Meu Dia\".",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "A lista das suas clínicas, funções e unidades sob responsabilidade saiu do Início e foi para o Perfil (clique no seu nome, no rodapé do menu). No Início ficou uma linha com a unidade e a sua função ali. Seção 2.2 do manual.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.239.2",
    data: "2026-09-10",
    migracao: null,
    titulo: "A barra lateral da Franqueadora ficou mais legível",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "Na Franqueadora, o texto da barra lateral escureceu e ganhou peso: os nomes dos módulos, os rótulos das seções, o seu e-mail e a versão do sistema deixaram de ser cinza-claro sobre turquesa. O módulo em que você está agora é marcado por uma faixa na borda, e não mais só por uma diferença de tom.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.239.1",
    data: "2026-09-10",
    migracao: null,
    titulo: "O caminho da compra acompanha você dentro de cada etapa",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "A trilha das etapas (Pedir, Aprovar, Receber) passou a aparecer também DENTRO de cada etapa, com a atual marcada. Você sempre vê onde está, o que veio antes e o que vem depois — e volta clicando na etapa, sem precisar do botão do navegador.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "As telas de Aprovar e Receber ganharam o cabeçalho com a marca e o caminho de volta para Compras, como as demais.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.239.0",
    data: "2026-09-10",
    migracao: null,
    titulo: "Compras mostra o caminho de uma compra, com o que espera por você",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "Os links soltos no alto da tela de Compras viraram as três etapas do caminho: Pedir, Aprovar e Receber, numeradas e com uma linha explicando cada uma. A etapa em que você está fica marcada.",
        papeis: "todos",
      },
      {
        tipo: "novidade",
        texto:
          "Cada etapa mostra quantos itens esperam por você — quantas aprovações pendentes e quantas entregas em aberto. Etapa sem nada pendente não mostra número.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "O Painel de compras e a Mesa de negociação saíram da fila de etapas: nenhum dos dois é passo da compra. O painel é onde se mede depois; a mesa é uma sala da Franqueadora.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.8",
    data: "2026-09-10",
    migracao: null,
    titulo: "As telas da rede ficaram iguais entre si",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "Taxas da rede, Compras, Rodadas de compra, Painel de compras e Relatórios ganharam o mesmo cabeçalho com a marca do Consolidado. Antes cada uma abria de um jeito.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "As explicações que ficavam num parágrafo cinza embaixo do título viraram um painel próprio, com o que importa em destaque. São as regras de cada módulo — quem as perde, erra.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.7",
    data: "2026-09-10",
    migracao: null,
    titulo: "A tela do Consolidado ficou mais fácil de ler",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "O Consolidado ganhou o cabeçalho com a marca, e a explicação de “Resultado do Grupo” e “Faturamento da Rede” saiu de um parágrafo corrido para duas colunas — com o aviso de que os dois não se somam em destaque.",
        papeis: "todos",
        manual: "Financeiro",
      },
      {
        tipo: "correcao",
        texto:
          "Na tabela de contas do Consolidado, o nome da conta era empurrado para fora do cartão em telas estreitas. Agora a tabela rola dentro do próprio cartão, sem desalinhar as colunas de valores.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.6",
    data: "2026-09-10",
    migracao: null,
    titulo: "Relatórios do Empresarial com a logomarca, e dois botões que sumiam",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Os arquivos gerados no Risarte Empresarial (ficha, relatório e extrato) saíam desalinhados e cortavam parte do conteúdo a partir da segunda página. Corrigido: agora o documento ocupa a folha inteira e quebra as páginas corretamente.",
        papeis: "todos",
      },
      {
        tipo: "novidade",
        texto:
          "Esses mesmos arquivos passaram a levar a logomarca do Risarte Empresarial no topo, no lugar da linha de texto que havia antes.",
        papeis: "todos",
      },
      {
        tipo: "correcao",
        texto:
          "Os botões “Nova empresa” e “Editar” ficavam quase da mesma cor do cabeçalho e não davam para ler. Corrigidos.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.5",
    data: "2026-09-10",
    migracao: null,
    titulo: "As telas de dentro do Empresarial ficaram iguais entre si",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "Funil, Painel, Configurações e a ficha da empresa ganharam o mesmo cabeçalho com a marca da tela principal. Antes cada uma tinha um desenho um pouco diferente, e a diferença aparecia justamente ao trocar de tela.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "Na ficha da empresa, a situação (Ativa, Suspensa, Encerrada) passou a aparecer com um ponto colorido ao lado do nome. A cor continua dizendo o estado, e o texto ficou legível sobre o cabeçalho.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.4",
    data: "2026-09-10",
    migracao: null,
    titulo: "O símbolo voltou na barra encolhida, e o Empresarial ganhou cabeçalho",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Ao encolher o menu lateral no Risarte Empresarial, o símbolo da Risarte no topo sumia — ele ficava da mesma cor do fundo. Corrigido.",
        papeis: "todos",
      },
      {
        tipo: "melhoria",
        texto:
          "A tela do Risarte Empresarial ganhou o mesmo cabeçalho com a marca que o Programa de Prevenção e o Comercial já têm. Era o único módulo com só um título solto, e a diferença aparecia justamente ao trocar de tela.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.3",
    data: "2026-09-10",
    migracao: null,
    titulo: "Correção: o botão “Painel” sumia no Programa de Prevenção",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Na Franqueadora, o botão “Painel” do Programa de Prevenção ficava da mesma cor do próprio fundo e desaparecia, nas duas luzes. Corrigido.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.2",
    data: "2026-09-10",
    migracao: null,
    titulo: "Correção: o resto dos textos e ícones claros demais",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Números, códigos e ícones em destaque ficavam apagados demais para ler — e, no Empresarial e no menu lateral, alguns ficavam da mesma cor do fundo, sumindo por completo. Foram corrigidos os 84 pontos do sistema, nos três ambientes e nas duas luzes.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.1",
    data: "2026-09-09",
    migracao: null,
    titulo: "Correção: selos e ícones claros demais para ler",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Depois da mudança visual, os selos e ícones coloridos (como o “Riso+ Social” no Programa de Prevenção) ficaram com a letra quase da mesma cor do fundo. Foi corrigido em todas as telas, nos três ambientes e nas duas luzes.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.238.0",
    data: "2026-09-09",
    migracao: null,
    titulo: "A identidade visual nova da Risarte entrou no sistema",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "O sistema passou a usar a marca nova: a logomarca, as cores e a tipografia do manual da Risarte. A assinatura no alto do menu muda conforme onde você está — Odontologia numa unidade, Franchising na Franqueadora, Empresarial no módulo de empresas.",
        papeis: "todos",
        manual: "2.1. A cor da tela diz onde você está",
      },
      {
        tipo: "novidade",
        texto:
          "Cada ambiente ganhou a sua cor: azul-marinho nas unidades, turquesa na Franqueadora e bordô no Empresarial. É para você saber onde está sem precisar ler nada.",
        papeis: "todos",
        manual: "2.1. A cor da tela diz onde você está",
      },
      {
        tipo: "novidade",
        texto:
          "Entrou o botão de lua/sol na barra de cima: dá para usar o sistema no modo claro ou escuro. A escolha fica guardada no seu computador.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
      {
        tipo: "aviso",
        texto:
          "As cores das sete fases da Jornada NÃO mudaram — continuam exatamente as mesmas. Só o texto sobre elas clareia no modo escuro, para continuar legível.",
        papeis: "todos",
        manual: "2.1. A cor da tela diz onde você está",
      },
    ],
  },
  {
    versao: "0.237.0",
    data: "2026-09-08",
    migracao: "0252",
    titulo: "A boia passou a avisar quando há algo esperando",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "O ícone da boia, na barra de cima, ganhou um número. Se você relatou um problema e foi respondido, ele avisa — e some quando você abre a tela de Problemas para ler.",
        papeis: "todos",
        manual: "15.2. Problemas",
      },
      {
        tipo: "novidade",
        texto:
          "Para o Admin Master o mesmo número mostra a fila dele: quantos relatos ainda estão abertos ou em análise, de todas as unidades. Some conforme ele responde.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
    ],
  },
  {
    versao: "0.236.0",
    data: "2026-09-08",
    migracao: null,
    titulo: "Alertas e Problemas agora são duas telas separadas",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "Os dois desenhos da barra de cima abriam a mesma tela e só mudavam a aba: quem clicava no triângulo (Alertas) encontrava “Relatar um problema” do lado. Agora o triângulo abre só os alertas e a boia abre só os problemas — cada desenho leva ao seu assunto.",
        papeis: "todos",
        manual: "15. Novidades, problemas e alertas",
      },
      {
        tipo: "melhoria",
        texto:
          "O relógio do sistema (que compara a hora do seu computador com a do servidor) passou a ficar na tela de Alertas. Hora fora do lugar é o sistema avisando, não alguém relatando defeito.",
        papeis: "todos",
        manual: "15.4. Relógio",
      },
    ],
  },
  {
    versao: "0.235.1",
    data: "2026-09-08",
    migracao: null,
    titulo: "Correção: o sistema não abria depois da barra de cima",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Logo depois da entrega da barra de cima, qualquer tela do sistema respondia “ocorreu um erro no servidor” e nada abria. Era um defeito nos ícones da barra nova, e foi corrigido. Nenhum dado foi afetado.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.235.0",
    data: "2026-09-08",
    migracao: null,
    titulo: "Barra de cima: o que se usa em qualquer tela saiu do menu lateral",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "A busca de paciente, o Chat, as Notificações, o Manual, o relato de problema e os Alertas passaram para uma barra no alto da tela — junto com a data e a hora. O menu lateral ficou só com a navegação entre módulos.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
      {
        tipo: "novidade",
        texto:
          "As novidades do sistema (esta lista) passaram a aparecer na tela de Início. Antes ficavam escondidas numa aba, e novidade que precisa de dois cliques ninguém lê.",
        papeis: "todos",
        manual: "15.1. Novidades",
      },
    ],
  },
  {
    versao: "0.234.0",
    data: "2026-09-08",
    migracao: null,
    titulo: "O sistema ficou mais rápido em todas as telas",
    mudancas: [
      {
        tipo: "melhoria",
        texto:
          "Cada clique perdia cerca de um segundo antes de a tela começar a aparecer, porque o sistema perguntava duas vezes pela rede quem era você. Agora essa conferência é feita no próprio servidor.",
        papeis: "todos",
      },
      {
        tipo: "aviso",
        texto:
          "Usuário desativado passa a ser barrado pelo sistema, e não só pelo login: ao abrir qualquer tela, ele vê um aviso e é convidado a sair. Antes o campo “ativo” era consultado e nunca verificado.",
        papeis: "todos",
        manual: "11.1. Regras do sistema",
      },
    ],
  },
  {
    versao: "0.233.0",
    data: "2026-09-08",
    migracao: "0251",
    titulo: "Procurar um paciente de qualquer tela, sem abrir Prontuários",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "No alto da barra lateral há agora “Procurar paciente”. Abre um campo, você digita, escolhe com as setas e abre o prontuário com Enter — de qualquer tela do sistema. O atalho é Ctrl + K.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
      {
        tipo: "melhoria",
        texto:
          "A busca acha por nome, pelo código do paciente (ex.: CAM-00001) e pelo CPF — inclusive digitando só os números, sem pontos nem traço.",
        papeis: "todos",
        manual: "6.1. Recepcionista",
      },
      {
        tipo: "melhoria",
        texto:
          "A lista da tela Prontuários passou a procurar do mesmo jeito. Antes ela só encontrava por nome: quem tinha o CPF ou o código na mão não achava nada ali.",
        papeis: "todos",
        manual: "6.1. Recepcionista",
      },
    ],
  },
  {
    versao: "0.232.0",
    data: "2026-09-08",
    migracao: "0250",
    titulo: "O cliente que volta ao Comercial reaparece em “A apresentar”",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "Quem tinha sido dado por perdido e voltava para a Conversão Comercial continuava marcado como perdido — ficava na fase certa e invisível no quadro. Agora o cartão reabre sozinho ao entrar na fase.",
        papeis: "todos",
        manual: "8. Fluxo 4 — o cliente que volta depois de perdido",
      },
      {
        tipo: "melhoria",
        texto:
          "Quem volta começa uma rodada nova: o cartão não abre mais dizendo “4ª tentativa” para um cliente com quem ninguém falou ainda desta vez. As tentativas antigas continuam no Histórico do funil.",
        papeis: "todos",
        manual: "6.5. Consultor Comercial",
      },
    ],
  },
  {
    versao: "0.231.0",
    data: "2026-09-08",
    migracao: "0249",
    titulo: "Cliente perdido no Comercial deixa de ficar preso na Fase 4",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "Marcar um cliente como perdido ou cancelado no Comercial agora o move para o Acompanhamento (Fase 7) e o marca como inativo. O motivo, a data e quem marcou continuam no Histórico do Comercial.",
        papeis: "todos",
        manual: "6.5. Consultor Comercial",
      },
      {
        tipo: "correcao",
        texto:
          "A recepção não conseguia agendar uma reavaliação para quem tinha sido dado por perdido — só apresentação comercial ou urgência. Agora consegue, e o cliente volta a ser ativo assim que o horário é marcado.",
        papeis: ["receptionist", "sdr"],
        manual: "8. Fluxo 4 — o cliente que volta depois de perdido",
      },
      {
        tipo: "melhoria",
        texto:
          "Quem já estava em tratamento não volta para trás quando o cartão comercial é encerrado — o clínico já aconteceu.",
        papeis: "todos",
      },
    ],
  },
  {
    versao: "0.230.0",
    data: "2026-09-07",
    migracao: null,
    titulo: "O problema relatado vira pedido de correção em dois cliques",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "Em Sistema → Problemas, o Admin Master ganhou o botão “Preparar para correção”: ele transforma o relato — com tela, versão, unidade, função e navegador — num texto pronto para pedir o conserto.",
        papeis: "todos",
        manual: "15.2. Problemas",
      },
      {
        tipo: "novidade",
        texto:
          "O mesmo botão serve para o caminho oposto: quando não é defeito, gera o pedido de uma resposta em linguagem simples para quem relatou.",
        papeis: "todos",
        manual: "15.2. Problemas",
      },
      {
        tipo: "aviso",
        texto:
          "O texto aparece para revisão antes de ser copiado — é onde se troca o nome de um paciente por “o paciente”. O nome de quem relatou nunca entra.",
        papeis: "todos",
        manual: "11.1. Regras do sistema",
      },
    ],
  },
  {
    versao: "0.229.0",
    data: "2026-09-07",
    migracao: "0248",
    titulo: "As tentativas de realizar a apresentação passam a ter registro",
    mudancas: [
      {
        tipo: "novidade",
        texto:
          "Na coluna “A apresentar”, o cartão mostra quando é a apresentação e com quem — e avisa em vermelho quando NÃO há nenhuma marcada, que é o caso que trava o funil.",
        papeis: ["commercial_consultant", "commercial_assistant", "unit_manager", "franchisee"],
        manual: "6.5. Consultor Comercial",
      },
      {
        tipo: "novidade",
        texto:
          "Botão “Registrar acontecimento”: cliente não compareceu, pediu para remarcar, falei com ele. Fica no histórico do funil com data, hora e autor — e o cartão passa a contar “3ª tentativa · 2 não comparecimentos”.",
        papeis: ["commercial_consultant", "commercial_assistant"],
        manual: "6.5. Consultor Comercial",
      },
      {
        tipo: "novidade",
        texto:
          "Botão “Pedir agendamento”: o Consultor pede uma nova data e o aviso chega à Recepção da unidade do cliente, com o motivo. Um pedido por dia por cliente.",
        papeis: ["commercial_consultant", "commercial_assistant", "receptionist"],
        manual: "6.1. Recepcionista",
      },
      {
        tipo: "melhoria",
        texto:
          "Quando a Recepção marca ou remarca a apresentação, o cartão do Comercial mostra sozinho e o histórico registra a nova data. Ninguém precisa avisar ninguém.",
        papeis: ["commercial_consultant", "commercial_assistant", "receptionist"],
      },
      {
        tipo: "aviso",
        texto:
          "Acontecimento registrado não se apaga. Para corrigir, registre outro — o histórico é a memória do caso.",
        papeis: ["commercial_consultant", "commercial_assistant"],
      },
    ],
  },
  {
    versao: "0.228.0",
    data: "2026-09-05",
    migracao: null,
    titulo: "Todos os horários do sistema agora batem com o relógio de Brasília",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "A Auditoria mostrava 3 horas a mais (15:07 quando eram 12:07). O mesmo acontecia em toda data e hora escrita pelo sistema — o texto era montado no relógio do servidor, que fica 3 horas à frente.",
        papeis: "todos",
        manual: "15.4. Relógio",
      },
      {
        tipo: "correcao",
        texto:
          "Filtros de “hoje”, “esta semana” e “este mês” começavam às 21h do dia anterior. Painel do Dentista, Atendimento, Auditoria, Relatórios, Centro de Planejamento e Comercial pegavam um pedaço do dia errado.",
        papeis: "todos",
      },
      {
        tipo: "correcao",
        texto:
          "Na agenda, um atendimento marcado depois das 21h não aparecia no dia dele — a janela do dia terminava três horas cedo.",
        papeis: "todos",
        manual: "6.1. Recepcionista",
      },
    ],
  },
  {
    versao: "0.227.0",
    data: "2026-09-05",
    migracao: null,
    titulo: "O relógio da agenda estava 3 horas adiantado",
    mudancas: [
      {
        tipo: "correcao",
        texto:
          "A agenda recusava marcar ou remarcar para as próximas 3 horas dizendo que o horário “já passou” — e não tinha passado. O horário digitado era entendido no fuso do servidor, que fica 3 horas à frente do Brasil.",
        papeis: "todos",
        manual: "6.1. Recepcionista",
      },
      {
        tipo: "correcao",
        texto:
          "Pelo mesmo motivo, os horários livres das próximas 3 horas sumiam da lista de opções, e quem abrisse a agenda depois das 21h caía no dia seguinte.",
        papeis: "todos",
      },
      {
        tipo: "novidade",
        texto:
          "A barra lateral passou a mostrar a data e a hora, sempre no horário de Brasília — que é o que o sistema usa para tudo.",
        papeis: "todos",
        manual: "2. Início rápido",
      },
      {
        tipo: "novidade",
        texto:
          "Em Sistema há agora um painel de relógio que avisa se a hora do SEU computador está errada — computador com relógio torto faz horários parecerem passados sem que o sistema tenha culpa.",
        papeis: "todos",
        manual: "15.4. Relógio",
      },
      {
        tipo: "aviso",
        texto:
          "Agendamentos criados antes desta correção podem estar gravados 3 horas antes do combinado. Confira a agenda dos próximos dias antes de confiar nela.",
        papeis: "todos",
        manual: "9. Erros, falhas e mau funcionamento",
      },
    ],
  },
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
