/**
 * O CATÁLOGO DE INDICADORES DAS METAS — o "velocímetro" que vem de fábrica.
 *
 * Plano: `docs/metas/METAS-PLANO.md` (§4). Decisões do dono D1–D9, 23/10/2026.
 *
 * ⚠️ INDICADOR É CÓDIGO; META É DADO (a mesma regra do portão de certificação,
 * `src/lib/certificacao.ts`). Cada chave daqui tem a SUA consulta no banco, em
 * `_goal_measure_raw` (migração 0318). Se a tela deixasse cadastrar indicador,
 * alguém criaria um que nenhuma consulta mede, e a barra ficaria em zero para
 * sempre sem a tela explicar por quê.
 *
 * ⚠️ AS DUAS LISTAS TÊM DE SER A MESMA. `metas-catalogo.test.ts` lê a lista do
 * banco (entre as marcas `INDICADORES:INICIO/FIM` da 0318) e reprova se uma
 * chave existir só de um lado, ou se tipo/dinheiro/por pessoa divergirem.
 *
 * Os campos existem para quem CONFIGURA a meta não ter de adivinhar:
 *   * `ajuda`     — o que exatamente é contado (e o que NÃO é);
 *   * `quemConta` — a quem o número pertence quando a meta é individual;
 *   * `tipo`      — `soma` acumula no período; `taxa` é um percentual (ou
 *                   média) do período, que sobe e desce;
 *   * `dinheiro`  — valor em R$ (decisão D3: quem não vê o financeiro da
 *                   unidade vê só o percentual).
 */

export type ChaveIndicador =
  | "sales_value"
  | "sales_count"
  | "sales_ticket"
  | "appointments_created"
  | "appointments_done"
  | "evaluations_done"
  | "attendance_rate"
  | "no_show_rate"
  | "check_ins"
  | "returns_scheduled"
  | "procedures_done"
  | "new_clients"
  | "ppr_adhesions";

export type TipoIndicador = "sum" | "rate";
/** Como o número aparece: centavos (R$), quantidade ou percentual. */
export type UnidadeIndicador = "brl" | "count" | "percent";
export type Direcao = "increase" | "decrease";

/** Os recortes que a consulta do banco sabe aplicar (`filters` da meta). */
export type Recorte =
  | "appointment_types"
  | "sale_origin"
  | "specialties"
  | "client_origins"
  | "ppr_plans";

export type GrupoIndicador =
  | "Comercial"
  | "Agenda e atendimento"
  | "Clínico"
  | "Clientes"
  | "Programas da Risarte";

export type Indicador = {
  chave: ChaveIndicador;
  rotulo: string;
  grupo: GrupoIndicador;
  ajuda: string;
  onde: string;
  tipo: TipoIndicador;
  unidade: UnidadeIndicador;
  direcoes: Direcao[];
  porPessoa: boolean;
  quemConta: string;
  dinheiro: boolean;
  recortes: Recorte[];
  /** O verbo da frase SMART ("fechar", "realizar"…). */
  verbo: string;
  /** Substantivo para a frase ("em vendas fechadas"). */
  objeto: string;
};

export const INDICADORES_DE_META: Indicador[] = [
  // ===========================================================================
  // COMERCIAL
  // ===========================================================================
  {
    chave: "sales_value",
    rotulo: "Vendas fechadas (R$)",
    grupo: "Comercial",
    ajuda:
      "Valor final das vendas de plano e das vendas diretas FECHADAS no período (contrato assinado e pagamento confirmado). Venda cancelada não conta.",
    onde: "Comercial → fechamento da venda; Venda direta",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação (venda direta: quem a lançou)",
    dinheiro: true,
    recortes: ["sale_origin"],
    verbo: "fechar",
    objeto: "em vendas",
  },
  {
    chave: "sales_count",
    rotulo: "Vendas fechadas (quantidade)",
    grupo: "Comercial",
    ajuda:
      "Quantas vendas de plano e vendas diretas foram fechadas no período. Venda cancelada não conta.",
    onde: "Comercial → fechamento da venda; Venda direta",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação (venda direta: quem a lançou)",
    dinheiro: false,
    recortes: ["sale_origin"],
    verbo: "fechar",
    objeto: "vendas",
  },
  {
    chave: "sales_ticket",
    rotulo: "Ticket médio das vendas",
    grupo: "Comercial",
    ajuda:
      "Valor médio por venda fechada no período: soma das vendas ÷ quantidade. Sobe e desce conforme as vendas entram.",
    onde: "Comercial → fechamento da venda; Venda direta",
    tipo: "rate",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação (venda direta: quem a lançou)",
    dinheiro: true,
    recortes: ["sale_origin"],
    verbo: "alcançar",
    objeto: "de ticket médio",
  },
  // ===========================================================================
  // AGENDA E ATENDIMENTO
  // ===========================================================================
  {
    chave: "appointments_created",
    rotulo: "Agendamentos marcados",
    grupo: "Agenda e atendimento",
    ajuda:
      "Agendamentos MARCADOS no período (pela data em que foram marcados, não a do horário). Cancelado não conta; falta conta, porque o agendamento foi feito.",
    onde: "Agenda → Agendar",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem marcou o agendamento",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "marcar",
    objeto: "agendamentos",
  },
  {
    chave: "appointments_done",
    rotulo: "Atendimentos concluídos",
    grupo: "Agenda e atendimento",
    ajuda:
      "Agendamentos CONCLUÍDOS no período (atendimento terminado). Falta, desistência e cancelamento não contam.",
    onde: "Atendimento → concluir",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o profissional do horário",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "realizar",
    objeto: "atendimentos",
  },
  {
    chave: "evaluations_done",
    rotulo: "Avaliações realizadas",
    grupo: "Agenda e atendimento",
    ajuda:
      "Atendimentos concluídos do tipo Avaliação — a porta de entrada da Jornada (Fase 2).",
    onde: "Atendimento → concluir a avaliação",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o profissional do horário",
    dinheiro: false,
    recortes: [],
    verbo: "realizar",
    objeto: "avaliações",
  },
  {
    chave: "attendance_rate",
    rotulo: "Taxa de comparecimento",
    grupo: "Agenda e atendimento",
    ajuda:
      "Dos horários do período que JÁ passaram e tiveram desfecho, quantos % o cliente veio (chegou, foi atendido ou desistiu depois de chegar). Horário sem desfecho registrado fica de fora.",
    onde: "Agenda → registrar chegada / falta",
    tipo: "rate",
    unidade: "percent",
    direcoes: ["increase", "decrease"],
    porPessoa: true,
    quemConta: "quem marcou o agendamento",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "alcançar",
    objeto: "de comparecimento",
  },
  {
    chave: "no_show_rate",
    rotulo: "Taxa de faltas",
    grupo: "Agenda e atendimento",
    ajuda:
      "O inverso do comparecimento: dos horários que já passaram e tiveram desfecho, quantos % foram falta. Meta típica: reduzir.",
    onde: "Agenda → registrar falta",
    tipo: "rate",
    unidade: "percent",
    direcoes: ["decrease", "increase"],
    porPessoa: true,
    quemConta: "quem marcou o agendamento",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "chegar a",
    objeto: "de faltas",
  },
  {
    chave: "check_ins",
    rotulo: "Check-ins na recepção",
    grupo: "Agenda e atendimento",
    ajuda: "Chegadas registradas no período — é o que põe o paciente na sala de espera.",
    onde: "Agenda → Registrar chegada",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem registrou a chegada",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "registrar",
    objeto: "check-ins",
  },
  {
    chave: "returns_scheduled",
    rotulo: "Retornos e reavaliações marcados",
    grupo: "Agenda e atendimento",
    ajuda:
      "Agendamentos de Retorno e de Reavaliação marcados no período (Fases 6 e 7: o cliente que volta). Cancelado não conta.",
    onde: "Agenda → Agendar (Retorno / Reavaliação)",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem marcou o agendamento",
    dinheiro: false,
    recortes: ["appointment_types"],
    verbo: "marcar",
    objeto: "retornos e reavaliações",
  },
  // ===========================================================================
  // CLÍNICO
  // ===========================================================================
  {
    chave: "procedures_done",
    rotulo: "Procedimentos executados",
    grupo: "Clínico",
    ajuda:
      "Sessões de tratamento concluídas no período. Pode recortar por especialidade (ex.: Ortodontia). Sessão cancelada não conta.",
    onde: "Atendimento → concluir a sessão",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o dentista que executou (ou o indicado pelo Planner, como no repasse)",
    dinheiro: false,
    recortes: ["specialties"],
    verbo: "executar",
    objeto: "procedimentos",
  },
  // ===========================================================================
  // CLIENTES
  // ===========================================================================
  {
    chave: "new_clients",
    rotulo: "Novos clientes",
    grupo: "Clientes",
    ajuda:
      "Clientes cadastrados no período, pela unidade onde nasceu o cadastro (transferência depois não muda). Pode recortar pela origem: unidade, Empresarial ou Riso+.",
    onde: "Clientes → Novo cliente",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem fez o cadastro",
    dinheiro: false,
    recortes: ["client_origins"],
    verbo: "conquistar",
    objeto: "novos clientes",
  },
  // ===========================================================================
  // PROGRAMAS DA RISARTE
  // ===========================================================================
  {
    chave: "ppr_adhesions",
    rotulo: "Adesões ao Riso+ (Programa de Prevenção)",
    grupo: "Programas da Risarte",
    ajuda:
      "Adesões ATIVADAS no período (contrato assinado + 1º pagamento). Adesão só criada não conta, e transferência entre unidades não é adesão nova. Pode recortar pelo plano (ex.: Familiar).",
    onde: "PPR+ → Nova adesão",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem vendeu a adesão",
    dinheiro: false,
    recortes: ["ppr_plans"],
    verbo: "fechar",
    objeto: "adesões ao Riso+",
  },
];

const POR_CHAVE = new Map(INDICADORES_DE_META.map((i) => [i.chave, i]));

export function indicadorDe(chave: string): Indicador | null {
  return POR_CHAVE.get(chave as ChaveIndicador) ?? null;
}

export const GRUPOS_DE_INDICADOR: GrupoIndicador[] = [
  ...new Set(INDICADORES_DE_META.map((i) => i.grupo)),
];

export const ROTULO_DO_RECORTE: Record<Recorte, string> = {
  appointment_types: "Tipo de agendamento",
  sale_origin: "Origem da venda",
  specialties: "Especialidade",
  client_origins: "Origem do cliente",
  ppr_plans: "Plano do Riso+",
};

export const ORIGENS_DA_VENDA = [
  { value: "plan", label: "Venda de plano de tratamento" },
  { value: "direct", label: "Venda direta" },
] as const;

export const ORIGENS_DO_CLIENTE = [
  { value: "unidade", label: "Unidade" },
  { value: "empresarial", label: "Empresarial" },
  { value: "ppr", label: "Riso+" },
] as const;

export const DIRECAO_LABEL: Record<Direcao, string> = {
  increase: "Aumentar até (no mínimo)",
  decrease: "Reduzir até (no máximo)",
};
