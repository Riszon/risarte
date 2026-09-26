import type { UserRole } from "@/lib/roles";

/**
 * O PORTÃO DE CERTIFICAÇÃO — ninguém entra no riSZon real sem provar no treino.
 *
 * Decisão do dono (25/09/2026), do documento "Avaliação no riSZon teste":
 * *"Estamos definindo aqui o padrão único de entrada para o sistema real:
 * ninguém passa sem cumprir a missão."*
 *
 * ⚠️ A TRANCA JÁ EXISTIA (0259): o riSZon real nasce FECHADO para todo
 * Risartano novo. O que falta é a CHAVE que gira sozinha quando a missão é
 * cumprida — e é isso que este módulo define.
 *
 * ⚠️ POR QUE O CATÁLOGO ESTÁ AQUI E NÃO NUMA TABELA DO BANCO.
 *
 * Cada indicador precisa de uma CONSULTA PRÓPRIA ao banco de treino para ser
 * contado ("quantos clientes esta pessoa cadastrou lá"). Uma tabela de
 * indicadores deixaria o Admin cadastrar "atendimentos de urgência" e o número
 * ficaria eternamente em zero, sem nada na tela explicando por quê — a tela
 * prometeria uma medição que ninguém escreveu. Indicador é código; META é dado.
 *
 * É a mesma separação do `network_fee_types` (0233), pelo lado oposto: lá a
 * matemática era genérica (percentual ou fixo), então a taxa virou dado. Aqui
 * cada contagem é diferente, então o catálogo é código.
 *
 * ⚠️ NADA AQUI DEPENDE DE UNIDADE. Ordem do dono: padrão ÚNICO da rede. É a
 * única configuração do sistema fora da cascata rede→unidade, porque a unidade
 * com mais pressa para operar seria exatamente a que baixaria a própria régua.
 *
 * ⚠️ DE ONDE SAIU ESTA LISTA (25/09/2026). Não saiu de memória nem do
 * documento: saiu do BANCO. A consulta pediu toda coluna que aponta para
 * `profiles` — 155 tabelas, 224 colunas que registram QUEM fez. Dessas, ficaram
 * aqui as que são ato de TRABALHO de uma função, e não configuração, auditoria
 * ou sobra de sistema. É a lei do §0 do CLAUDE.md, que já custou dados reais
 * duas vezes: pergunte ao banco o que existe, nunca deduza das migrações.
 */

/**
 * O que o sistema consegue contar no treino. Cada chave = uma consulta.
 *
 * `origem` NÃO é comentário: é a consulta da Etapa 2 escrita por extenso,
 * decidida agora, com o banco aberto na frente. Sem ela, daqui a duas semanas
 * alguém escreveria a contagem "de cabeça" e o número sairia de outro lugar —
 * a tela continuaria mostrando "3 de 5" e ninguém saberia 3 do quê. É a mesma
 * lei do repasse por nível e do custo do kit: mostrar a origem do número faz
 * parte do número.
 */
export const INDICADORES = [
  // -- Recepção e captação ---------------------------------------------------
  {
    chave: "cadastros",
    rotulo: "Cadastros de clientes",
    ajuda: "Pessoas que ela cadastrou.",
    origem: "clients.created_by",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "primeiros_agendamentos",
    rotulo: "Primeiros agendamentos",
    ajuda: "Avaliações agendadas — a passagem da Fase 1 para a Fase 2.",
    origem: "appointments.created_by + type=evaluation",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "agendamentos_reavaliacao",
    rotulo: "Agendamentos de reavaliação",
    ajuda: "Reavaliações agendadas (Fase 6).",
    origem: "appointments.created_by + type=reevaluation",
    papeis: ["receptionist"],
  },
  {
    chave: "agendamentos_inicio",
    rotulo: "Agendamentos de início de tratamento",
    ajuda: "O agendamento que a recepção faz depois do fechamento (Fase 5).",
    origem: "appointments.created_by + type=treatment_start",
    papeis: ["receptionist"],
  },
  {
    chave: "check_ins",
    rotulo: "Check-ins na recepção",
    ajuda: "Chegadas registradas na sala de espera.",
    origem: "appointments.checked_in_by",
    papeis: ["receptionist", "tsb", "asb"],
  },
  {
    chave: "remarcacoes",
    rotulo: "Remarcações",
    ajuda: "Agendamentos que ela alterou de horário.",
    origem: "appointment_changes.changed_by",
    papeis: ["receptionist"],
  },
  {
    chave: "anamneses",
    rotulo: "Fichas de anamnese preenchidas",
    ajuda: "Fichas respondidas com a ajuda dela.",
    origem: "anamnesis_fills.filled_by",
    papeis: ["receptionist", "tsb", "asb"],
  },
  {
    chave: "consentimentos",
    rotulo: "Consentimentos registrados",
    ajuda: "Autorizações de LGPD e de gravação registradas por ela.",
    origem: "client_consents.recorded_by",
    papeis: ["receptionist", "clinical_coordinator"],
  },
  {
    chave: "edicoes_cliente",
    rotulo: "Fichas de cliente editadas",
    ajuda: "Alterações feitas por ela no cadastro de alguém.",
    origem: "client_changes.changed_by",
    papeis: ["sdr"],
  },

  // -- Clínico ---------------------------------------------------------------
  {
    chave: "avaliacoes",
    rotulo: "Avaliações concluídas",
    ajuda: "Avaliações que ela abriu e fechou (Fase 2).",
    origem: "clinical_evaluations.closed_by + kind=avaliacao",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "reavaliacoes",
    rotulo: "Reavaliações concluídas",
    ajuda: "Reavaliações fechadas por ela (Fase 6).",
    origem: "clinical_evaluations.closed_by + kind=reavaliacao",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "midias_enviadas",
    rotulo: "Fotos e exames enviados",
    ajuda: "Arquivos clínicos que ela anexou à ficha.",
    origem: "clinical_media.uploaded_by",
    papeis: ["clinical_coordinator", "tsb", "asb"],
  },
  {
    chave: "aprovacoes_plano",
    rotulo: "Opções de plano avaliadas",
    ajuda: "Opções que ela aprovou ou devolveu ao Planner.",
    origem: "treatment_plan_options.reviewed_by",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "atendimentos_concluidos",
    rotulo: "Atendimentos concluídos",
    ajuda: "Consultas que ela deu por encerradas.",
    origem: "appointments.done_by",
    papeis: ["clinical_coordinator", "dentist"],
  },
  {
    chave: "solicitacoes_clinicas",
    rotulo: "Solicitações clínicas",
    ajuda: "Pedidos de exame ou encaminhamento feitos por ela.",
    origem: "clinical_requests.requested_by",
    papeis: ["clinical_coordinator", "dentist"],
  },

  // -- Centro de Planejamento ------------------------------------------------
  {
    chave: "planos_criados",
    rotulo: "Planos de tratamento criados",
    ajuda: "Planos montados por ela no Centro de Planejamento.",
    origem: "treatment_plans.created_by",
    papeis: ["planner_dentist"],
  },
  {
    chave: "planos_enviados",
    rotulo: "Planos enviados para aprovação",
    ajuda: "Planos que ela submeteu ao Coordenador.",
    origem: "treatment_plan_status_events.changed_by + status=submitted",
    papeis: ["planner_dentist"],
  },
  {
    chave: "complementos_planejamento",
    rotulo: "Complementos de planejamento",
    ajuda: "Pedidos de informação que faltava, abertos por ela.",
    origem: "planning_supplements.created_by",
    papeis: ["planner_dentist"],
  },

  // -- Execução clínica ------------------------------------------------------
  {
    chave: "sessoes_concluidas",
    rotulo: "Sessões de tratamento concluídas",
    ajuda: "Sessões que ela executou e deu por concluídas.",
    origem: "treatment_sessions.executed_by + status=done",
    papeis: ["dentist"],
  },
  {
    chave: "evolucoes",
    rotulo: "Evoluções escritas no prontuário",
    ajuda: "Anotações de evolução assinadas por ela.",
    origem: "clinical_progress_notes.author_id",
    papeis: ["dentist"],
  },
  {
    chave: "consumo_avulso",
    rotulo: "Lançamentos de consumo de material",
    ajuda: "Baixas de estoque registradas à mão por ela.",
    origem: "stock_movements.created_by",
    papeis: ["tsb", "asb"],
  },

  // -- Comercial -------------------------------------------------------------
  {
    chave: "apresentacoes",
    rotulo: "Apresentações comerciais",
    ajuda: "Apresentações conduzidas por ela (Fase 4).",
    origem: "commercial_presentations.consultant_id",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "negociacoes",
    rotulo: "Negociações montadas",
    ajuda: "Propostas de pagamento que ela montou.",
    origem: "plan_negotiations.created_by",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "movimentacoes_funil",
    rotulo: "Cartões movimentados no funil",
    ajuda: "Vezes que ela moveu um cliente de coluna no funil.",
    origem: "commercial_card_events.actor_id",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "fechamentos",
    rotulo: "Contratos assinados",
    ajuda: "Vendas em que ela registrou a assinatura do contrato.",
    origem: "commercial_sales.contract_signed_by",
    papeis: ["commercial_consultant", "commercial_assistant"],
  },
  {
    chave: "followups",
    rotulo: "Tentativas de follow-up",
    ajuda: "Contatos de retomada registrados por ela.",
    origem: "commercial_followup_attempts.created_by",
    papeis: ["commercial_consultant", "commercial_assistant"],
  },
  {
    chave: "links_pagamento",
    rotulo: "Links de pagamento enviados",
    ajuda: "Cobranças emitidas por ela.",
    origem: "commercial_sales.payment_issued_by",
    papeis: ["commercial_assistant"],
  },
  {
    chave: "pagamentos_confirmados",
    rotulo: "Pagamentos confirmados",
    ajuda: "Vendas em que ela confirmou a entrada do dinheiro.",
    origem: "commercial_sales.payment_confirmed_by",
    papeis: ["commercial_assistant"],
  },

  // -- Gestão da unidade -----------------------------------------------------
  {
    chave: "contas_aprovadas",
    rotulo: "Contas a pagar aprovadas",
    ajuda: "Despesas que ela autorizou.",
    origem: "payables.approved_by",
    papeis: ["unit_manager", "finance_franchisor"],
  },
  {
    chave: "inventarios",
    rotulo: "Inventários aplicados",
    ajuda: "Contagens de estoque que ela fechou.",
    origem: "stock_counts.applied_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "pedidos_decididos",
    rotulo: "Pedidos de compra decididos",
    ajuda: "Rateios da rodada que ela aprovou ou recusou.",
    origem: "purchase_allocations.decided_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "autorizacoes_negociacao",
    rotulo: "Descontos autorizados",
    ajuda: "Negociações fora da regra que ela liberou.",
    origem: "plan_negotiations.authorized_by",
    papeis: ["unit_manager"],
  },

  // -- Financeiro da Franqueadora --------------------------------------------
  {
    chave: "recebimentos",
    rotulo: "Recebimentos lançados",
    ajuda: "Baixas de cobrança registradas por ela.",
    origem: "payment_receipts.created_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "conciliacoes",
    rotulo: "Lançamentos conciliados",
    ajuda: "Linhas do razão que ela bateu com o extrato.",
    origem: "financial_entries.reconciled_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "extratos_importados",
    rotulo: "Extratos importados",
    ajuda: "Arquivos de banco que ela trouxe para o sistema.",
    origem: "bank_statement_imports.created_by",
    papeis: ["finance_franchisor"],
  },

  // -- Compras ---------------------------------------------------------------
  {
    chave: "rodadas_criadas",
    rotulo: "Rodadas de compra abertas",
    ajuda: "Mesas de negociação que ela montou.",
    origem: "purchase_rounds.created_by",
    papeis: ["purchaser"],
  },
  {
    chave: "cotacoes",
    rotulo: "Cotações lançadas",
    ajuda: "Propostas de fornecedor registradas por ela.",
    origem: "purchase_quotes.created_by",
    papeis: ["purchaser"],
  },
  {
    chave: "itens_escolhidos",
    rotulo: "Itens adjudicados",
    ajuda: "Itens em que ela escolheu o fornecedor vencedor.",
    origem: "purchase_round_items.awarded_by",
    papeis: ["purchaser"],
  },

  // -- Risarte Empresarial ---------------------------------------------------
  {
    chave: "leads_empresariais",
    rotulo: "Empresas no funil",
    ajuda: "Empresas sob responsabilidade dela.",
    origem: "empresarial.commercial_leads.consultant_id",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "reunioes_empresariais",
    rotulo: "Reuniões com empresas",
    ajuda: "Reuniões que ela marcou com a empresa.",
    origem: "empresarial.lead_meetings.created_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "propostas_enviadas",
    rotulo: "Propostas enviadas",
    ajuda: "Envios de proposta registrados por ela.",
    origem: "empresarial.lead_dispatches.sent_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "fechamentos_empresariais",
    rotulo: "Fechamentos de empresa",
    ajuda: "Conferências de fechamento confirmadas por ela.",
    origem: "empresarial.lead_closing_reviews.confirmed_by",
    papeis: ["rislife_consultant"],
  },
] as const satisfies readonly {
  chave: string;
  rotulo: string;
  ajuda: string;
  origem: string;
  papeis: readonly UserRole[];
}[];

export type Indicador = (typeof INDICADORES)[number];
export type ChaveDeIndicador = Indicador["chave"];

/**
 * As funções que TÊM o que ser medido, na ordem da jornada do cliente.
 *
 * ⚠️ QUEM FICA DE FORA, E POR QUÊ. `franchisee` (Franqueado) e
 * `franchisor_staff` (Franqueadora/Rede) são papéis de LEITURA — pela matriz
 * da §5 do CLAUDE.md eles veem tudo e não executam ato clínico nem comercial.
 * Não há o que contar, e inventar uma meta para eles ("abrir 10 relatórios")
 * mediria navegação, não competência. `admin_master` também fica fora: a 0259
 * já o deixa passar por definição, senão a primeira configuração trancaria o
 * dono para fora do próprio sistema.
 */
export const PAPEIS_COM_MISSAO = [
  "receptionist",
  "sdr",
  "clinical_coordinator",
  "planner_dentist",
  "dentist",
  "tsb",
  "asb",
  "commercial_consultant",
  "commercial_assistant",
  "unit_manager",
  "finance_franchisor",
  "purchaser",
  "rislife_consultant",
] as const satisfies readonly UserRole[];

export type PapelComMissao = (typeof PAPEIS_COM_MISSAO)[number];

/** Os indicadores que fazem sentido para aquela função. */
export function indicadoresDoPapel(papel: UserRole): readonly Indicador[] {
  return INDICADORES.filter((i) =>
    (i.papeis as readonly UserRole[]).includes(papel)
  );
}

// -- Os dois eixos do documento ----------------------------------------------

export const ESCOPOS = ["individual", "coletiva"] as const;
export type Escopo = (typeof ESCOPOS)[number];

export const GATILHOS = ["automatica", "aprovacao"] as const;
export type Gatilho = (typeof GATILHOS)[number];

/** Na liberação coletiva: quem conta é escolhido por CARGO ou por PESSOA. */
export const MODOS_DE_GRUPO = ["papeis", "pessoas"] as const;
export type ModoDeGrupo = (typeof MODOS_DE_GRUPO)[number];

export const ESCOPO_ROTULO: Record<Escopo, string> = {
  individual: "Individual",
  coletiva: "Coletiva (por unidade)",
};

export const ESCOPO_AJUDA: Record<Escopo, string> = {
  individual:
    "Cada pessoa é liberada assim que cumpre a própria missão, sem depender dos colegas.",
  coletiva:
    "O sistema real só abre para a unidade quando todos os participantes escolhidos cumprirem a missão.",
};

export const GATILHO_ROTULO: Record<Gatilho, string> = {
  automatica: "Automática",
  aprovacao: "Com aprovação do Admin Master",
};

export const GATILHO_AJUDA: Record<Gatilho, string> = {
  automatica:
    "Cumpriu a missão, o sistema real abre na hora, sem ninguém confirmar.",
  aprovacao:
    "Cumpriu a missão, o Admin Master recebe um aviso e decide. Nada abre sozinho.",
};

export const MODO_ROTULO: Record<ModoDeGrupo, string> = {
  papeis: "Por cargo",
  pessoas: "Por pessoa",
};

export const MODO_AJUDA: Record<ModoDeGrupo, string> = {
  papeis:
    "Conta todo mundo da unidade que tiver um dos cargos marcados. Quem for contratado depois entra no grupo sozinho.",
  pessoas:
    "Conta apenas as pessoas marcadas, pelo nome. Quem for contratado depois NÃO entra sozinho.",
};

export type ConfiguracaoDoPortao = {
  release_scope: Escopo;
  release_trigger: Gatilho;
  cohort_mode: ModoDeGrupo;
};

/** O padrão mais cauteloso dos quatro — ver o comentário da migração 0271. */
export const PADRAO_DO_PORTAO: ConfiguracaoDoPortao = {
  release_scope: "individual",
  release_trigger: "aprovacao",
  cohort_mode: "papeis",
};

export function ehEscopo(v: string): v is Escopo {
  return (ESCOPOS as readonly string[]).includes(v);
}

export function ehGatilho(v: string): v is Gatilho {
  return (GATILHOS as readonly string[]).includes(v);
}

export function ehModoDeGrupo(v: string): v is ModoDeGrupo {
  return (MODOS_DE_GRUPO as readonly string[]).includes(v);
}

// -- As metas -----------------------------------------------------------------

export type MetaDoTreino = {
  role: UserRole;
  indicator: string;
  minimum_count: number;
};

/**
 * A meta daquela função, indicador por indicador. Indicador sem linha no banco
 * volta como ZERO — e zero é a ausência de exigência, não uma exigência de
 * zero (mesma lei do orçamento, 0229: meta zero apaga a linha).
 */
export function missaoDoPapel(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): { indicador: Indicador; minimo: number }[] {
  return indicadoresDoPapel(papel).map((indicador) => ({
    indicador,
    minimo:
      metas.find((m) => m.role === papel && m.indicator === indicador.chave)
        ?.minimum_count ?? 0,
  }));
}

/** Função sem nenhuma meta não tem missão — e a tela precisa dizer isso. */
export function temMissao(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): boolean {
  return missaoDoPapel(metas, papel).some((m) => m.minimo > 0);
}

/**
 * Lê o que veio do formulário. Texto vazio, lixo e negativo viram ZERO (ou
 * seja, "sem exigência") em vez de derrubar a gravação: a tela tem um campo por
 * indicador, e um deles em branco não pode impedir o Admin de salvar os outros.
 */
export function normalizarMeta(bruto: unknown): number {
  const n = Number(String(bruto ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Uma frase para a lista: "3 × cadastros · 2 × primeiros agendamentos".
 * Devolve `null` quando não há missão — quem chama decide o que dizer, em vez
 * de receber uma frase vazia com cara de erro.
 */
export function resumoDaMissao(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): string | null {
  const partes = missaoDoPapel(metas, papel)
    .filter((m) => m.minimo > 0)
    .map((m) => `${m.minimo} × ${m.indicador.rotulo.toLowerCase()}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

// -- O grupo do teste coletivo (0272) -----------------------------------------

export type ParticipanteDoGrupo = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

/**
 * ⚠️ GRUPO COLETIVO VAZIO É CONFIGURAÇÃO INCOMPLETA, NÃO "TODO MUNDO".
 *
 * A diferença não é de gosto: "todo mundo" inclui quem está de férias, quem
 * entrou ontem e quem nem vai usar o sistema — e bastaria UMA dessas pessoas
 * para a unidade inteira ficar travada sem ninguém entender por quê. Ler o
 * vazio como "todos" seria escolher o comportamento mais destrutivo justamente
 * quando o Admin ainda não escolheu nada.
 *
 * Por isso a tela AVISA em vez de assumir, e a Etapa 3 não deve liberar
 * ninguém por coletivo enquanto isto devolver `false`.
 */
export function grupoEstaDefinido(
  modo: ModoDeGrupo,
  papeis: readonly UserRole[],
  pessoas: readonly { user_id: string }[]
): boolean {
  return modo === "papeis" ? papeis.length > 0 : pessoas.length > 0;
}

/**
 * Só entram no grupo por cargo as funções que TÊM missão — marcar um cargo sem
 * meta nenhuma criaria um participante que já nasce aprovado, e a liberação
 * coletiva passaria a depender de gente que não foi medida.
 */
export function cargosElegiveis(
  metas: readonly MetaDoTreino[]
): readonly UserRole[] {
  return PAPEIS_COM_MISSAO.filter((p) => temMissao(metas, p));
}
