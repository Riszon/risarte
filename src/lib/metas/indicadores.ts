/**
 * O CATÁLOGO DE INDICADORES DAS METAS — o "velocímetro" que vem de fábrica.
 *
 * Plano: `docs/metas/METAS-PLANO.md` (§4). Decisões do dono D1–D9, 23/10/2026.
 *
 * ⚠️ INDICADOR É CÓDIGO; META É DADO (a mesma regra do portão de certificação,
 * `src/lib/certificacao.ts`). Cada chave daqui tem a SUA consulta no banco, em
 * `_goal_measure_raw` (migrações 0318 e 0319). Se a tela deixasse cadastrar indicador,
 * alguém criaria um que nenhuma consulta mede, e a barra ficaria em zero para
 * sempre sem a tela explicar por quê.
 *
 * ⚠️ AS DUAS LISTAS TÊM DE SER A MESMA. `metas-catalogo.test.ts` lê a lista do
 * banco (entre as marcas `INDICADORES:INICIO/FIM` da migração mais nova) e
 * reprova se uma chave existir só de um lado, ou se tipo/financeiro/por
 * pessoa/limite divergirem.
 *
 * Os campos existem para quem CONFIGURA a meta não ter de adivinhar:
 *   * `ajuda`     — o que exatamente é contado (e o que NÃO é);
 *   * `quemConta` — a quem o número pertence quando a meta é individual;
 *   * `tipo`      — `sum` acumula no período; `rate` é um percentual (ou
 *                   média) do período, que sobe e desce; `point` é uma
 *                   FOTOGRAFIA — o valor de hoje (inadimplência, vidas). O
 *                   sistema guarda uma foto por dia e o resultado final é o
 *                   valor do último dia do prazo (N1, 23/10/2026);
 *   * `limite`    — soma em que a meta é "no máximo" (cancelamentos, N2): a
 *                   barra mostra quanto do limite já foi usado;
 *   * `financeiro`— dado financeiro (D3/N7): quem não vê o financeiro da
 *                   unidade vê só o percentual da meta. Inclui a TAXA de
 *                   inadimplência, que não é R$ mas é dado do financeiro.
 */

export type ChaveIndicador =
  | "sales_value"
  | "sales_count"
  | "sales_ticket"
  | "conversion_rate"
  | "revenue_received"
  | "revenue_billed"
  | "overdue_rate"
  | "overdue_value"
  | "overdue_recovery"
  | "appointments_created"
  | "appointments_done"
  | "evaluations_done"
  | "attendance_rate"
  | "no_show_rate"
  | "check_ins"
  | "returns_scheduled"
  | "procedures_done"
  | "provider_production"
  | "plan_options_approved"
  | "new_clients"
  | "new_clients_evaluated"
  | "ppr_adhesions"
  | "ppr_cancellations"
  | "ppr_lives"
  | "indica_referrals"
  | "indica_conversions"
  | "indica_ambassadors"
  | "empresarial_companies"
  | "empresarial_lives";

export type TipoIndicador = "sum" | "rate" | "point";
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
  | "Financeiro"
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
  financeiro: boolean;
  /** Soma de "no máximo": a barra é o uso do limite (N2). */
  limite?: boolean;
  /** A medição é por período inteiro (DRE): sem gráfico dia a dia (N3). */
  semDiaADia?: boolean;
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
      "Valor final das vendas de plano e das vendas diretas FECHADAS no período (contrato assinado e pagamento confirmado). Venda cancelada não conta. Com especialidade escolhida, conta só a parte da venda que é dela (o desconto se reparte na mesma proporção).",
    onde: "Comercial → fechamento da venda; Venda direta",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação (venda direta: quem a lançou)",
    financeiro: true,
    recortes: ["sale_origin", "specialties"],
    verbo: "fechar",
    objeto: "em vendas",
  },
  {
    chave: "sales_count",
    rotulo: "Vendas fechadas (quantidade)",
    grupo: "Comercial",
    ajuda:
      "Quantas vendas de plano e vendas diretas foram fechadas no período. Venda cancelada não conta. Com especialidade escolhida, conta a venda que tem ao menos um procedimento dela.",
    onde: "Comercial → fechamento da venda; Venda direta",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação (venda direta: quem a lançou)",
    financeiro: false,
    recortes: ["sale_origin", "specialties"],
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
    financeiro: true,
    recortes: ["sale_origin", "specialties"],
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
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
    financeiro: false,
    recortes: ["ppr_plans"],
    verbo: "fechar",
    objeto: "adesões ao Riso+",
  },
  // ===========================================================================
  // ETAPA M2 (0319) — COMERCIAL, FINANCEIRO, CLÍNICO, CLIENTES E PROGRAMAS
  // ===========================================================================
  {
    chave: "conversion_rate",
    rotulo: "Taxa de conversão (apresentação → venda)",
    grupo: "Comercial",
    ajuda:
      "Das negociações ABERTAS no período, quantas % já foram aceitas — a mesma conta do painel do Comercial. Versão substituída do plano não conta.",
    onde: "Comercial → negociação",
    tipo: "rate",
    unidade: "percent",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor da negociação",
    financeiro: false,
    recortes: [],
    verbo: "alcançar",
    objeto: "de conversão",
  },
  {
    chave: "revenue_received",
    rotulo: "Receita recebida (caixa)",
    grupo: "Financeiro",
    ajuda:
      "Dinheiro que entrou no período: os recebimentos registrados, sem os estornados. Só meta coletiva — quem registra o recebimento é a recepção, não quem vendeu.",
    onde: "Financeiro → Recebíveis → receber",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: true,
    recortes: [],
    verbo: "receber",
    objeto: "em caixa",
  },
  {
    chave: "revenue_billed",
    rotulo: "Receita faturada (DRE)",
    grupo: "Financeiro",
    ajuda:
      "Receita bruta menos deduções no período, pela própria conta da DRE (competência). A DRE é por período: esta meta tem a barra, sem o gráfico dia a dia.",
    onde: "Financeiro → DRE",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: true,
    semDiaADia: true,
    recortes: [],
    verbo: "faturar",
    objeto: "de receita",
  },
  {
    chave: "overdue_rate",
    rotulo: "Taxa de inadimplência",
    grupo: "Financeiro",
    ajuda:
      "Quanto do que está a receber já venceu, em % — a mesma conta da tela do Financeiro. É uma FOTOGRAFIA: vale o número de cada dia; o sistema guarda uma foto por dia, e o resultado é o do último dia do prazo.",
    onde: "Financeiro → Recebíveis",
    tipo: "point",
    unidade: "percent",
    direcoes: ["decrease", "increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: true,
    recortes: [],
    verbo: "chegar a",
    objeto: "de inadimplência",
  },
  {
    chave: "overdue_value",
    rotulo: "Valor inadimplente (R$)",
    grupo: "Financeiro",
    ajuda:
      "A soma das parcelas vencidas e ainda não pagas. FOTOGRAFIA: vale o valor de cada dia, e o resultado é o do último dia do prazo.",
    onde: "Financeiro → Recebíveis",
    tipo: "point",
    unidade: "brl",
    direcoes: ["decrease", "increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: true,
    recortes: [],
    verbo: "chegar a",
    objeto: "em atraso",
  },
  {
    chave: "overdue_recovery",
    rotulo: "Recuperação de inadimplência (R$)",
    grupo: "Financeiro",
    ajuda:
      "Dinheiro recebido DEPOIS do vencimento, de parcelas que ficaram vencidas. Estorno não conta.",
    onde: "Financeiro → Recebíveis → inadimplentes",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: true,
    recortes: [],
    verbo: "recuperar",
    objeto: "de inadimplência",
  },
  {
    chave: "provider_production",
    rotulo: "Produção do dentista (R$)",
    grupo: "Clínico",
    ajuda:
      "O repasse das sessões concluídas no período, o mesmo valor congelado da tela de Repasses. Pode recortar por especialidade.",
    onde: "Atendimento → concluir a sessão; Financeiro → Repasses",
    tipo: "sum",
    unidade: "brl",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o dentista do repasse",
    financeiro: true,
    recortes: ["specialties"],
    verbo: "produzir",
    objeto: "em repasse",
  },
  {
    chave: "plan_options_approved",
    rotulo: "Opções de plano aprovadas",
    grupo: "Clínico",
    ajuda:
      "Opções de plano de tratamento aprovadas pelo Coordenador no período. O número é do Planner que montou o plano. Devolvida não conta.",
    onde: "Planejamento → aprovação do Coordenador",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o Planner que montou o plano",
    financeiro: false,
    recortes: [],
    verbo: "ter",
    objeto: "opções de plano aprovadas",
  },
  {
    chave: "new_clients_evaluated",
    rotulo: "Novos clientes que avaliaram",
    grupo: "Clientes",
    ajuda:
      "Clientes cadastrados no período que já fizeram a avaliação (atendimento de avaliação concluído). Mede a qualidade do cadastro, não só a quantidade.",
    onde: "Clientes → Novo cliente; Atendimento → avaliação",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem fez o cadastro",
    financeiro: false,
    recortes: ["client_origins"],
    verbo: "conquistar",
    objeto: "novos clientes avaliados",
  },
  {
    chave: "ppr_cancellations",
    rotulo: "Cancelamentos do Riso+",
    grupo: "Programas da Risarte",
    ajuda:
      "Adesões canceladas no período. É uma meta de NO MÁXIMO: a barra mostra quanto do limite já foi usado. Transferência entre unidades não é cancelamento.",
    onde: "PPR+ → adesão → cancelar",
    tipo: "sum",
    unidade: "count",
    direcoes: ["decrease"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: false,
    limite: true,
    recortes: ["ppr_plans"],
    verbo: "ter",
    objeto: "cancelamentos do Riso+",
  },
  {
    chave: "ppr_lives",
    rotulo: "Vidas no Riso+",
    grupo: "Programas da Risarte",
    ajuda:
      "Beneficiários (titulares e dependentes) das adesões ativas. FOTOGRAFIA: vale o número de cada dia, e o resultado é o do último dia do prazo.",
    onde: "PPR+ → adesões",
    tipo: "point",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: false,
    recortes: ["ppr_plans"],
    verbo: "chegar a",
    objeto: "vidas no Riso+",
  },
  {
    chave: "indica_referrals",
    rotulo: "Indica +Risos — indicações recebidas",
    grupo: "Programas da Risarte",
    ajuda: "Indicações registradas no período, em qualquer situação.",
    onde: "Indica +Risos → Nova indicação",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o Risartano que registrou a indicação",
    financeiro: false,
    recortes: [],
    verbo: "receber",
    objeto: "indicações",
  },
  {
    chave: "indica_conversions",
    rotulo: "Indica +Risos — indicações convertidas",
    grupo: "Programas da Risarte",
    ajuda:
      "Indicações convertidas em venda, pela data do fechamento — a mesma régua da apuração do Indica.",
    onde: "Indica +Risos → indicação",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o Risartano da conversão",
    financeiro: false,
    recortes: [],
    verbo: "converter",
    objeto: "indicações",
  },
  {
    chave: "indica_ambassadors",
    rotulo: "Indica +Risos — novos Embaixadores",
    grupo: "Programas da Risarte",
    ajuda: "Embaixadores cadastrados no período.",
    onde: "Indica +Risos → Embaixadores",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "quem cadastrou o Embaixador",
    financeiro: false,
    recortes: [],
    verbo: "cadastrar",
    objeto: "novos Embaixadores",
  },
  {
    chave: "empresarial_companies",
    rotulo: "Empresarial — empresas que aderiram",
    grupo: "Programas da Risarte",
    ajuda:
      "Empresas que entraram em Fechado (ganho) no funil do Empresarial no período, pela unidade principal da empresa. Empresa sem unidade principal não entra.",
    onde: "Empresarial → Funil",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: true,
    quemConta: "o consultor RisLife do lead",
    financeiro: false,
    recortes: [],
    verbo: "fechar",
    objeto: "adesões de empresas",
  },
  {
    chave: "empresarial_lives",
    rotulo: "Empresarial — vidas incluídas",
    grupo: "Programas da Risarte",
    ajuda: "Titulares e dependentes incluídos no convênio no período, pela unidade de cada vida.",
    onde: "Empresarial → empresa → colaboradores",
    tipo: "sum",
    unidade: "count",
    direcoes: ["increase"],
    porPessoa: false,
    quemConta: "a unidade (meta coletiva)",
    financeiro: false,
    recortes: [],
    verbo: "incluir",
    objeto: "vidas no Empresarial",
  },
];

const POR_CHAVE = new Map(INDICADORES_DE_META.map((i) => [i.chave, i]));

export function indicadorDe(chave: string): Indicador | null {
  return POR_CHAVE.get(chave as ChaveIndicador) ?? null;
}

/** A ordem dos grupos nas listas (fixa: a ordem do catálogo é a da etapa). */
export const GRUPOS_DE_INDICADOR: GrupoIndicador[] = [
  "Comercial",
  "Financeiro",
  "Agenda e atendimento",
  "Clínico",
  "Clientes",
  "Programas da Risarte",
];

/** "Reduzir até" de uma soma de limite se lê "No máximo". */
export function rotuloDaDirecao(ind: Indicador | null, d: Direcao): string {
  if (ind?.limite && d === "decrease") return "No máximo (limite no período)";
  return DIRECAO_LABEL[d];
}

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
