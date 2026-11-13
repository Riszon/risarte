import type { UserRole } from "@/lib/roles";

/**
 * A MATRIZ DE PERMISSÕES — o catálogo do que pode ser ligado e desligado.
 *
 * Antes, quem enxerga cada módulo estava escrito dentro do código: mudar
 * "o Coordenador passa a ver Relatórios" exigia editar um arquivo e publicar.
 * Agora a resposta vem de uma tabela (`permission_matrix`), e o Admin Master
 * troca pela tela `/admin/permissoes`.
 *
 * ⚠️ AS PERMISSÕES VIVEM EM DUAS CAMADAS, e esta matriz governa UMA.
 *
 * O aplicativo decide se o módulo ABRE (é o `redirect("/")` no layout de cada
 * módulo). O BANCO decide, por regra de linha (RLS), o que cada pessoa lê e
 * escreve lá dentro — e essas regras estão escritas dentro de centenas de
 * políticas, cada uma com a lista de papéis no próprio texto.
 *
 * Consequência que a tela precisa dizer em voz alta: **desligar sempre
 * funciona** (o aplicativo barra antes de chegar ao banco), mas **ligar além do
 * padrão pode abrir a tela com os dados vazios**, porque o banco continua
 * barrando. É o que a marca `dependeDoBanco` sinaliza.
 *
 * O Admin Master não entra na matriz: ele passa por cima de tudo, sempre. Uma
 * matriz que pudesse tirar o acesso do próprio administrador criaria a porta
 * trancada com a chave dentro.
 */

export type Capability = {
  /** Chave gravada no banco. Nunca mudar depois de criada. */
  id: string;
  /** O que aparece na tela. */
  rotulo: string;
  /** Agrupamento na tela. */
  grupo: string;
  /** Explicação em uma frase, para quem nunca viu o sistema. */
  descricao: string;
  /**
   * `true` quando o banco TAMBÉM decide. Ligar aqui abre a tela; os dados
   * podem vir vazios até a regra do banco ser ajustada.
   */
  dependeDoBanco: boolean;
  /** Papéis que têm a permissão hoje, no código. Vira a semente da tabela. */
  padrao: UserRole[];
};

const FRANQUEADORA_RELATORIOS: UserRole[] = [
  "franchisor_staff",
  "planner_dentist",
  "commercial_consultant",
];
// ⚠️ DENTISTA E PLANNER NÃO VEEM O ESTOQUE — decisão do dono, confirmada em
// 09/10/2026 ("Dentista e Planner não precisam ver o estoque"). A matriz
// gravada nos dois bancos já estava assim desde 28/09; o padrão do código é
// que dizia o contrário, e o botão "devolver ao padrão" desfaria a decisão.
// Quem mexe em material na clínica é o Coordenador, a TSB e a ASB.
const CLINICOS_DO_ESTOQUE: UserRole[] = ["clinical_coordinator", "tsb", "asb"];
const TODOS: UserRole[] = [
  "receptionist", "sdr", "clinical_coordinator", "planner_dentist", "dentist",
  "commercial_consultant", "commercial_assistant", "unit_manager",
  "franchisor_staff", "franchisee", "tsb", "asb", "rislife_consultant",
  "finance_franchisor", "purchaser",
];
// ⚠️ O CONSULTOR RISLIFE NÃO VÊ PACIENTE (AP95, decisão do dono, 03/11/2026):
// ele vende o programa às empresas e trabalha só no Empresarial. As telas de
// paciente (Jornada, Agenda, Atendimento, Prontuários, PPR+) não são dele, e
// o banco também não entrega esses dados a ele (0353).
const TODOS_MENOS_RISLIFE: UserRole[] = TODOS.filter((r) => r !== "rislife_consultant");

/**
 * O catálogo. A ORDEM aqui é a ordem da tela.
 *
 * Os padrões abaixo foram lidos do código que valia antes desta matriz
 * (`src/app/(app)/layout.tsx` e `src/lib/*access*.ts`), para que ligar a
 * funcionalidade não mudasse o comportamento de ninguém no primeiro dia.
 */
export const CAPACIDADES: Capability[] = [
  // ---- navegação -----------------------------------------------------------
  {
    id: "menu.jornada",
    rotulo: "Jornada",
    grupo: "Navegação",
    descricao: "O quadro dos pacientes por fase.",
    dependeDoBanco: false,
    // Regra antiga: todos, menos quem tem SÓ o papel de dentista.
    padrao: TODOS_MENOS_RISLIFE.filter((r) => r !== "dentist"),
  },
  {
    id: "menu.agenda",
    rotulo: "Agenda",
    grupo: "Navegação",
    descricao: "Marcar e acompanhar horários.",
    dependeDoBanco: false,
    padrao: TODOS_MENOS_RISLIFE,
  },
  {
    id: "menu.atendimento",
    rotulo: "Atendimento",
    grupo: "Navegação",
    descricao: "Chegada, chamada e conclusão do dia.",
    dependeDoBanco: false,
    // 0269 (relato OC-00073): o CONSULTOR COMERCIAL sai daqui. Ele trabalha no
    // funil, em /comercial — a sala de espera é da recepção. Desde a 0269 as
    // duas telas se falam sozinhas: a recepção coloca "em espera" e o cartão
    // dele mostra; ele inicia a apresentação e o cliente vira "em atendimento"
    // na tela dela. Com o espelho funcionando, a segunda tela virou ruído.
    //
    // ⚠️ Este padrão só vale onde a matriz NÃO tem linha gravada. A instalação
    // do dono tinha (liberando o menu), e por isso a 0269 apaga aquela linha —
    // mudar só este arquivo não teria efeito nenhum.
    padrao: TODOS_MENOS_RISLIFE.filter((r) => r !== "commercial_consultant"),
  },
  {
    id: "menu.prontuarios",
    rotulo: "Prontuários",
    grupo: "Navegação",
    descricao: "A ficha dos pacientes.",
    dependeDoBanco: false,
    padrao: TODOS_MENOS_RISLIFE,
  },
  {
    id: "menu.planejamento",
    rotulo: "Centro de Planejamento",
    grupo: "Navegação",
    descricao: "A fila dos casos a planejar, priorizada por prazo.",
    dependeDoBanco: false,
    // Antes da matriz: `isAdminMaster || isPlanner`. Só o Planner, portanto —
    // o Admin passa por cima da matriz de qualquer forma.
    padrao: ["planner_dentist"],
  },
  {
    id: "menu.procedimentos",
    rotulo: "Procedimentos",
    grupo: "Navegação",
    descricao: "O catálogo com preços, protocolos e comissionamento.",
    dependeDoBanco: false,
    padrao: ["planner_dentist"],
  },
  {
    id: "menu.manual",
    rotulo: "Manual",
    grupo: "Navegação",
    descricao:
      "O manual de treinamento dentro do sistema, sempre na versão do dia.",
    dependeDoBanco: false,
    // Toda a operação, de propósito: manual que só alguns leem não é manual.
    padrao: TODOS,
  },
  {
    id: "menu.sistema",
    rotulo: "Alertas e problemas",
    grupo: "Navegação",
    // As duas telas (`/alertas` e `/problemas`) dividem esta permissão: separar
    // os ÍCONES foi o pedido do dono; separar quem PODE ver cada uma é outra
    // decisão, que ele deixou para uma entrega própria. Enquanto for uma só, o
    // rótulo tem de nomear as duas — permissão com nome de uma tela faz quem
    // configura desligar sem saber o que mais está desligando.
    descricao:
      "Os alertas que o sistema levanta e o canal para relatar um problema.",
    dependeDoBanco: false,
    // Desligar isto para alguém devolve o relato de problema para o WhatsApp,
    // que é exatamente de onde ele está saindo.
    padrao: TODOS,
  },

  // ---- módulos -------------------------------------------------------------
  {
    id: "modulo.planos",
    rotulo: "Planos de Tratamento",
    grupo: "Módulos",
    descricao: "Visão gerencial dos planos da unidade.",
    dependeDoBanco: false,
    padrao: [
      ...FRANQUEADORA_RELATORIOS,
      "unit_manager", "clinical_coordinator", "franchisee",
    ],
  },
  {
    id: "modulo.comercial",
    rotulo: "Comercial",
    grupo: "Módulos",
    descricao: "O funil de negociação e fechamento.",
    dependeDoBanco: false,
    padrao: [
      "commercial_consultant", "commercial_assistant",
      "unit_manager", "franchisee",
    ],
  },
  {
    id: "modulo.relatorios",
    rotulo: "Relatórios",
    grupo: "Módulos",
    descricao: "Indicadores de agenda, rede e produtividade.",
    dependeDoBanco: false,
    padrao: [...FRANQUEADORA_RELATORIOS, "unit_manager", "franchisee"],
  },
  {
    id: "modulo.risartanos",
    rotulo: "Risartanos",
    grupo: "Módulos",
    descricao: "A equipe: cadastro, unidades e acesso ao sistema.",
    dependeDoBanco: false,
    padrao: ["unit_manager", "franchisor_staff", "franchisee"],
  },
  {
    id: "modulo.ppr",
    rotulo: "PPR+ (Prevenção)",
    grupo: "Módulos",
    descricao: "O programa de prevenção.",
    dependeDoBanco: false,
    padrao: TODOS_MENOS_RISLIFE,
  },
  {
    id: "modulo.empresarial",
    rotulo: "Empresarial",
    grupo: "Módulos",
    descricao: "Convênio com empresas parceiras.",
    dependeDoBanco: true,
    padrao: [
      "rislife_consultant", "franchisor_staff", "finance_franchisor",
      "unit_manager", "franchisee", "sdr", "receptionist",
    ],
  },
  {
    id: "modulo.indica",
    rotulo: "Indica +Risos",
    grupo: "Módulos",
    descricao:
      "O programa de indicação: registrar, acompanhar e converter as indicações dos clientes.",
    dependeDoBanco: true,
    // ⚠️ NASCE ESCONDIDO (decisão do dono, 28/09/2026): a matriz gravada no
    // banco não tem linha desta permissão, então só o Admin Master vê. Este
    // padrão é o que o "Restaurar padrão" de /admin/permissoes liga quando o
    // dono decidir abrir para a equipe.
    padrao: [
      "receptionist", "sdr", "commercial_consultant", "commercial_assistant",
      "unit_manager", "franchisee", "franchisor_staff",
    ],
  },
  {
    // Rita 0A.7 (3006) — "O que a Rita sabe": a assistente virtual de cada
    // unidade, o que ela vai dizer e o que falta para ligar. O BANCO
    // (`rita.screen_unit`) só entrega as unidades que a pessoa enxerga;
    // ligar é só do Admin Master, desligar também do Gerente da unidade.
    id: "modulo.rita",
    rotulo: "Assistente virtual (Rita)",
    grupo: "Módulos",
    descricao:
      "O que a Rita sabe de cada unidade, o que falta para ligar e o registro do que ela fez. O Gerente pode desligar a da unidade dele.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "franchisor_staff"],
  },
  {
    // ASA0 (4002) — a Central de Configuração: toda a configuração comercial
    // e financeira numa tela só (conta Asaas e tarifas na ASA0; as fases
    // seguintes acrescentam as abas delas). NASCE SÓ COM O ADMIN MASTER
    // (decisão do dono, 10/11/2026: cada fase entra escondida atrás da
    // permissão). O BANCO decide o que cada um lê: o Financeiro da
    // Franqueadora vê a rede, o Gerente só a própria unidade.
    id: "modulo.central",
    rotulo: "Central de Configuração",
    grupo: "Módulos",
    descricao:
      "A conta Asaas de cada unidade, as tarifas e o que falta para a unidade poder cobrar. Ligar para o Gerente mostra só a unidade dele.",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    // ASA0 (4000) — colar a chave de API da conta Asaas da própria unidade.
    // Mesmo com a permissão ligada, o BANCO só aceita a chave do Gerente
    // depois de o termo de autorização do franqueado estar registrado
    // (`_gateway_actor_can_link`).
    id: "acao.central.vincular_conta",
    rotulo: "Central: gravar a chave da conta Asaas",
    grupo: "Módulos",
    descricao:
      "Colar a chave de API da conta Asaas da própria unidade. O banco só aceita depois de o termo de autorização do franqueado estar registrado.",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    // 4004 — Cobrança pelo Asaas (ASA1). Nascem só com o Admin Master; o BANCO
    // decide de novo quem emite (Admin, Financeiro da Franqueadora, Gerente e
    // Recepcionista da unidade) e quem cancela (Admin, Financeiro, Gerente).
    id: "acao.cobranca.ver",
    rotulo: "Cobranças: ver",
    grupo: "Módulos",
    descricao:
      "Ver as cobranças do Asaas nas parcelas do paciente: a situação, o link da fatura, o Pix e o boleto.",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    id: "acao.cobranca.emitir",
    rotulo: "Cobranças: emitir",
    grupo: "Módulos",
    descricao:
      "Gerar a cobrança de uma parcela no Asaas (boleto, Pix ou cartão à vista) e enviar o link ao paciente.",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    id: "acao.cobranca.cancelar",
    rotulo: "Cobranças: cancelar",
    grupo: "Módulos",
    descricao:
      "Cancelar a cobrança no Asaas, marcar parcela cobrada fora do riSZon e quitar por valor menor (este último só Gerente e Admin).",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    // 4006 — Selo "Em atraso" (ASA2, entrega 2; spec 17.1). Duas etapas: nasce
    // com Gerente e Franqueado; o dono libera depois Recepcionista, Consultor e
    // Assistente Comercial e Financeiro da Franqueadora. O BANCO lê esta matriz
    // (`_gateway_cap_clinics`) e tem um TETO: Dentista, Planner, TSB, ASB e SDR
    // nunca veem, mesmo marcados aqui.
    id: "acao.cobranca.selo_atraso",
    rotulo: "Selo \"Em atraso\"",
    grupo: "Módulos",
    descricao:
      "Ver o selo \"Em atraso há N dias\" na ficha, na agenda e no cockpit da avaliação, sem valores. Dentistas, auxiliares e SDR nunca veem.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "franchisee"],
  },
  {
    // 4006 — Painel de cobranças (spec 17.2). Nasce só com o Admin Master
    // enquanto a integração está em testes. Teto no BANCO: Gerente e Franqueado
    // (a própria unidade) e Financeiro da Franqueadora (a rede).
    id: "modulo.painel_cobrancas",
    rotulo: "Painel de cobranças",
    grupo: "Módulos",
    descricao:
      "Financeiro → Cobranças: o que o Asaas ainda vai creditar e a lista das cobranças emitidas, com planilha. A Recepcionista nunca vê.",
    dependeDoBanco: true,
    padrao: [],
  },
  {
    // 4009 — Pedir estorno (ASA3, entrega 2; spec 18.7.1). O Admin Master
    // sempre pode. Para os demais, o BANCO exige esta permissão E o papel que a
    // UNIDADE indicou na Central como tendo o acesso de autorização do Asaas
    // (por padrão o Franqueado; o Admin pode liberar o Gerente). Teto no banco:
    // Franqueado e Gerente. O código de autorização nunca passa pelo riSZon.
    id: "acao.cobranca.estorno",
    rotulo: "Pedir estorno",
    grupo: "Módulos",
    descricao:
      "Pedir ao Asaas o estorno total de uma cobrança paga, pela ficha. Só quem a unidade indicou como titular do acesso de autorização do Asaas.",
    dependeDoBanco: true,
    padrao: ["franchisee", "unit_manager"],
  },
  {
    // 0318 — Metas SMART. Todos veem o módulo; o BANCO decide quais metas
    // cada um enxerga (as que cria, as das unidades que gere, e aquelas em
    // que participa).
    id: "modulo.metas",
    rotulo: "Metas",
    grupo: "Módulos",
    descricao:
      "Acompanhar as metas da rede e da unidade, com a barra do realizado. Cada pessoa vê as metas em que participa.",
    dependeDoBanco: true,
    padrao: TODOS,
  },
  {
    // 0329 — Ortodontia. O menu e a lista de casos; o BANCO (`ortho_can_view`)
    // deixa ler quem é da unidade ou da rede, e o dentista só vê os casos em
    // que é o ortodontista (regra de tela, `orthoRestrictedToOwn`).
    id: "modulo.ortodontia",
    rotulo: "Ortodontia",
    grupo: "Módulos",
    descricao:
      "Os pacientes em tratamento ortodôntico: casos, cronograma de manutenções e a lista de quem precisa de atenção.",
    dependeDoBanco: true,
    padrao: [
      "unit_manager", "clinical_coordinator", "receptionist", "franchisee",
      "franchisor_staff", "finance_franchisor", "dentist",
    ],
  },
  {
    // A Recepção fica de fora de propósito (decisão do dono): ela acompanha
    // quem precisa de agendamento, não os números da especialidade.
    id: "modulo.ortodontia.painel",
    rotulo: "Painel da Ortodontia",
    grupo: "Módulos",
    descricao:
      "Os números da ortodontia: em tratamento, novos, finalizados, no prazo × atrasados, faltas, previsão e receita.",
    dependeDoBanco: true,
    padrao: [
      "unit_manager", "clinical_coordinator", "franchisee",
      "franchisor_staff", "finance_franchisor",
    ],
  },
  {
    id: "modulo.financeiro",
    rotulo: "Financeiro",
    grupo: "Módulos",
    descricao: "Contas, DRE, fluxo de caixa, taxas e repasses.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor", "unit_manager", "franchisee"],
  },
  {
    id: "modulo.estoque",
    rotulo: "Estoque",
    grupo: "Módulos",
    descricao: "Itens, kits, saldo e inventário.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor", "unit_manager", "franchisee", ...CLINICOS_DO_ESTOQUE],
  },
  {
    id: "modulo.compras",
    rotulo: "Compras",
    grupo: "Módulos",
    descricao: "Requisição, cotação, pedido e recebimento.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "purchaser", "franchisee", "finance_franchisor"],
  },

  // ---- ações ---------------------------------------------------------------
  {
    id: "acao.financeiro.lancar",
    rotulo: "Lançar e editar dinheiro",
    grupo: "Ações — Financeiro",
    descricao:
      "Registrar recebimento, pagamento e lançamento. Quem só vê, não lança.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor", "unit_manager"],
  },
  {
    id: "acao.financeiro.repasse.relatorio",
    rotulo: "Montar o relatório de repasse",
    grupo: "Ações — Financeiro",
    descricao:
      "Gerar o relatório de repasse dos dentistas, excluir procedimento com motivo e cancelar o rascunho. O banco só aceita o Financeiro da Franqueadora (e o Admin Master).",
    dependeDoBanco: true,
    padrao: ["finance_franchisor"],
  },
  {
    id: "acao.financeiro.configurar_rede",
    rotulo: "Configurar o financeiro da REDE",
    grupo: "Ações — Financeiro",
    descricao:
      "Plano de contas, centros de custo padrão, multa e juros da rede. Vale para todas as unidades.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor"],
  },
  {
    id: "acao.estoque.gerir",
    rotulo: "Entrada e inventário de estoque",
    grupo: "Ações — Estoque",
    descricao: "Dar entrada em mercadoria e aplicar contagem.",
    dependeDoBanco: true,
    // AP106: a ASB (0296) e a TSB (0351) dão entrada e contam — o banco
    // (`can_post_stock_entry`) já deixa. Sem elas aqui, "voltar ao padrão"
    // desligava as duas e a missão delas ficava com itens impossíveis.
    padrao: ["finance_franchisor", "unit_manager", "asb", "tsb"],
  },
  {
    id: "acao.estoque.consumir",
    rotulo: "Consumo avulso de estoque",
    grupo: "Ações — Estoque",
    descricao: "Registrar material usado fora do kit do procedimento.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor", "unit_manager", ...CLINICOS_DO_ESTOQUE],
  },
  {
    id: "acao.estoque.catalogo",
    rotulo: "Cadastrar item no catálogo",
    grupo: "Ações — Estoque",
    descricao: "O catálogo de itens é da rede, não da unidade.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor"],
  },
  {
    id: "acao.compras.requisitar",
    rotulo: "Criar requisição de compra",
    grupo: "Ações — Compras",
    descricao: "Montar a lista do que falta na unidade.",
    dependeDoBanco: true,
    // AP106: os mesmos de `can_request_purchase` (0296 e 0351).
    padrao: ["unit_manager", "clinical_coordinator", "asb", "tsb"],
  },
  {
    // OC-00102: aprovar tinha carona em "Criar requisição", que não está
    // ligada para o Financeiro da Franqueadora. Quem aprova é quem paga — o
    // banco (`can_decide_purchase`, 0294) deixa o Financeiro decidir só a
    // compra da PRÓPRIA Franqueadora.
    id: "acao.compras.aprovar",
    rotulo: "Aprovar compra da unidade",
    grupo: "Ações — Compras",
    descricao:
      "Aprovar ou recusar o que a rede negociou e gerar o pedido. Quem aprova é quem paga: o gerente na unidade; o Financeiro da Franqueadora na compra da Franqueadora.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "finance_franchisor"],
  },
  {
    id: "acao.compras.negociar",
    rotulo: "Mesa de negociação (cotação)",
    grupo: "Ações — Compras",
    descricao:
      "Ver as cotações dos fornecedores e escolher o vencedor. Quem compra não é quem paga.",
    dependeDoBanco: true,
    padrao: ["purchaser"],
  },
  {
    // 0329 — o banco (`ortho_can_manage`) só aceita Gerente e Coordenador.
    id: "acao.ortodontia.gerir",
    rotulo: "Gerir o caso ortodôntico",
    grupo: "Ações — Programas",
    descricao:
      "Abrir, editar, iniciar, pôr em contenção, finalizar e interromper o caso de ortodontia.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "clinical_coordinator"],
  },
  {
    // O banco (`ortho_can_evolve`) aceita o Coordenador e o DENTISTA que é o
    // ortodontista do caso.
    id: "acao.ortodontia.evoluir",
    rotulo: "Registrar manutenção ortodôntica",
    grupo: "Ações — Programas",
    descricao:
      "Registrar a manutenção realizada e a evolução (fio, observações, próximo passo). Gera o repasse do ortodontista.",
    dependeDoBanco: true,
    padrao: ["dentist", "clinical_coordinator"],
  },
  {
    // Decisão O2 (28/10/2026, 0331): a baixa é do Gerente e do Financeiro da
    // Franqueadora (e da Franqueadora/Rede). A Recepção, o Franqueado e o
    // Coordenador VEEM a situação financeira sem esta capacidade
    // (`ortho_can_see_money`, 0332); o banco (`ortho_can_settle`) confere.
    id: "acao.ortodontia.financeiro",
    rotulo: "Mensalidades da ortodontia",
    grupo: "Ações — Programas",
    descricao:
      "Gerar as mensalidades do mês e dar baixa (quem só vê a situação financeira não precisa disto).",
    dependeDoBanco: true,
    padrao: ["unit_manager", "franchisor_staff", "finance_franchisor"],
  },
  {
    id: "acao.ppr.configurar",
    rotulo: "Configurar o PPR+",
    grupo: "Ações — Programas",
    descricao: "Planos, vantagens e regras do programa de prevenção.",
    dependeDoBanco: false,
    padrao: [],
  },
  {
    id: "acao.indica.indicar",
    rotulo: "Pedir e registrar indicação",
    grupo: "Ações — Programas",
    descricao:
      "Os botões \"Pedi indicação\" e \"Nova indicação\" na ficha do cliente, sem ver o módulo inteiro.",
    dependeDoBanco: true,
    // Também nasce escondido (ver modulo.indica). Quem tem o módulo já pode
    // indicar; esta permissão é para quem SÓ pede e registra (clínico).
    padrao: ["clinical_coordinator", "dentist", "tsb", "asb"],
  },
  {
    // D1 (23/10/2026): meta de rede ou de várias unidades. O banco aceita
    // só Admin e Franqueadora/Rede (`_goal_can_create`, 0318) — ligar para
    // outra função aqui abriria o botão sem o banco aceitar gravar.
    id: "acao.metas.criar_rede",
    rotulo: "Criar meta da rede",
    grupo: "Ações — Metas",
    descricao: "Criar, editar, pausar e cancelar metas da rede toda ou de várias unidades.",
    dependeDoBanco: true,
    padrao: ["franchisor_staff"],
  },
  {
    id: "acao.metas.criar_unidade",
    rotulo: "Criar meta da unidade",
    grupo: "Ações — Metas",
    descricao:
      "Criar, editar, pausar e cancelar metas da própria unidade. O banco aceita Gerente e Franqueado.",
    dependeDoBanco: true,
    padrao: ["unit_manager", "franchisee"],
  },

  // ---- assinaturas digitais (ZapSign, 0340) -----------------------------------
  // ⚠️ AQUI O BANCO LÊ A MATRIZ (exceção à 0246, restrita ao módulo — decisão
  // do dono em 31/10/2026). As regras de linha das tabelas `signature_*`
  // chamam `public.signature_can(capacidade, unidade)`, que consulta a
  // `permission_matrix`. Ligar um papel na tela liga no banco também — por
  // isso `dependeDoBanco: false`. Com a matriz vazia o banco cai nestes
  // mesmos padrões (`signature_default_roles`; há teste que compara).
  // O que NÃO passa pela matriz: Admin Master/Admin Principal (sempre podem) e
  // a trava do Consultor RisLife (só as empresas/leads em que é o responsável).
  ...(() => {
    const ENVIAM: UserRole[] = [
      "commercial_consultant", "rislife_consultant", "commercial_assistant",
      "finance_franchisor", "unit_manager",
    ];
    const VEEM: UserRole[] = [...ENVIAM, "clinical_coordinator"];
    const GRUPO = "Assinaturas digitais";
    const caps: Capability[] = [
      {
        id: "modulo.assinaturas",
        rotulo: "Assinaturas",
        grupo: GRUPO,
        descricao:
          "O menu Assinaturas: documentos enviados para assinatura digital (ZapSign) e o painel do módulo.",
        dependeDoBanco: false,
        padrao: VEEM,
      },
      {
        id: "acao.assinaturas.enviar",
        rotulo: "Enviar para assinatura",
        grupo: GRUPO,
        descricao:
          "Montar o pacote (contrato, TCLE, orçamento, autorização, adesão) e enviar aos signatários.",
        dependeDoBanco: false,
        padrao: ENVIAM,
      },
      {
        id: "acao.assinaturas.cancelar",
        rotulo: "Cancelar envio",
        grupo: GRUPO,
        descricao:
          "Cancelar um pacote ainda não assinado, com o motivo. Pacote assinado nunca cancela.",
        dependeDoBanco: false,
        padrao: ENVIAM,
      },
      {
        id: "acao.assinaturas.visualizar",
        rotulo: "Ver pacotes e documentos",
        grupo: GRUPO,
        descricao:
          "Abrir o pacote da unidade, ver quem já assinou e ler o PDF no visualizador (sem baixar).",
        dependeDoBanco: false,
        padrao: VEEM,
      },
      {
        id: "acao.assinaturas.baixar",
        rotulo: "Baixar o PDF assinado",
        grupo: GRUPO,
        descricao: "Baixar o documento assinado e as cópias. Fica registrado na auditoria.",
        dependeDoBanco: false,
        padrao: VEEM,
      },
      {
        id: "acao.assinaturas.painel_unidade",
        rotulo: "Painel da unidade",
        grupo: GRUPO,
        descricao:
          "Os indicadores de assinatura das próprias unidades: enviados, assinados, aguardando, tempo de resposta.",
        dependeDoBanco: false,
        padrao: ENVIAM,
      },
      {
        id: "acao.assinaturas.painel_rede",
        rotulo: "Painel da rede",
        grupo: GRUPO,
        descricao:
          "Os indicadores de TODAS as unidades, o comparativo e o consumo do plano ZapSign. Libera a leitura dos pacotes de toda a rede.",
        dependeDoBanco: false,
        padrao: ["finance_franchisor"],
      },
      {
        id: "acao.assinaturas.configurar",
        rotulo: "Configurar as assinaturas",
        grupo: GRUPO,
        descricao:
          "Parâmetros da rede, modelos, kits, plano ZapSign e destinatários do relatório mensal. Nasce só com o Admin Master; liberável aqui.",
        dependeDoBanco: false,
        padrao: [],
      },
    ];
    return caps;
  })(),
];

export const CAPACIDADES_POR_ID = new Map(CAPACIDADES.map((c) => [c.id, c]));

/** Os grupos, na ordem em que aparecem na tela. */
export const GRUPOS = [...new Set(CAPACIDADES.map((c) => c.grupo))];

/** A matriz resolvida: para cada permissão, os papéis que a têm. */
export type MatrizPermissoes = Record<string, UserRole[]>;

/** A matriz que vale quando ninguém mexeu em nada. */
export function matrizPadrao(): MatrizPermissoes {
  return Object.fromEntries(CAPACIDADES.map((c) => [c.id, [...c.padrao]]));
}

/**
 * A pergunta que o sistema faz o tempo todo: esta pessoa pode isto?
 *
 * O Admin Master responde SIM sempre, sem consultar a matriz — ver o comentário
 * do topo. Fora ele, basta ter UM papel com a permissão, em qualquer clínica ou
 * na clínica indicada, conforme a pergunta.
 */
export function podeComPapeis(
  matriz: MatrizPermissoes,
  capacidade: string,
  papeis: UserRole[]
): boolean {
  const permitidos = matriz[capacidade];
  if (!permitidos) return false;
  return papeis.some((p) => permitidos.includes(p));
}
