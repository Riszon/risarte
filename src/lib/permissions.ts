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
const CLINICOS: UserRole[] = [
  "dentist",
  "clinical_coordinator",
  "planner_dentist",
  "tsb",
  "asb",
];
const TODOS: UserRole[] = [
  "receptionist", "sdr", "clinical_coordinator", "planner_dentist", "dentist",
  "commercial_consultant", "commercial_assistant", "unit_manager",
  "franchisor_staff", "franchisee", "tsb", "asb", "rislife_consultant",
  "finance_franchisor", "purchaser",
];

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
    padrao: TODOS.filter((r) => r !== "dentist"),
  },
  {
    id: "menu.agenda",
    rotulo: "Agenda",
    grupo: "Navegação",
    descricao: "Marcar e acompanhar horários.",
    dependeDoBanco: false,
    padrao: TODOS,
  },
  {
    id: "menu.atendimento",
    rotulo: "Atendimento",
    grupo: "Navegação",
    descricao: "Chegada, chamada e conclusão do dia.",
    dependeDoBanco: false,
    padrao: TODOS,
  },
  {
    id: "menu.prontuarios",
    rotulo: "Prontuários",
    grupo: "Navegação",
    descricao: "A ficha dos pacientes.",
    dependeDoBanco: false,
    padrao: TODOS,
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
    rotulo: "Sistema (novidades e problemas)",
    grupo: "Navegação",
    descricao:
      "O que mudou em cada versão, o canal para relatar problema e os alertas.",
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
    descricao: "Cadastro de colaboradores (RH).",
    dependeDoBanco: false,
    padrao: ["unit_manager", "franchisor_staff", "franchisee"],
  },
  {
    id: "modulo.ppr",
    rotulo: "PPR+ (Prevenção)",
    grupo: "Módulos",
    descricao: "O programa de prevenção.",
    dependeDoBanco: false,
    padrao: TODOS,
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
    padrao: ["finance_franchisor", "unit_manager", "franchisee", ...CLINICOS],
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
    padrao: ["finance_franchisor", "unit_manager"],
  },
  {
    id: "acao.estoque.consumir",
    rotulo: "Consumo avulso de estoque",
    grupo: "Ações — Estoque",
    descricao: "Registrar material usado fora do kit do procedimento.",
    dependeDoBanco: true,
    padrao: ["finance_franchisor", "unit_manager", ...CLINICOS],
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
    padrao: ["unit_manager"],
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
    id: "acao.ppr.configurar",
    rotulo: "Configurar o PPR+",
    grupo: "Ações — Programas",
    descricao: "Planos, vantagens e regras do programa de prevenção.",
    dependeDoBanco: false,
    padrao: [],
  },
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
