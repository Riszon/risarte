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
 */

/** O que o sistema consegue contar no treino. Cada chave = uma consulta. */
export const INDICADORES = [
  {
    chave: "cadastros",
    rotulo: "Cadastros de clientes",
    ajuda: "Pessoas cadastradas por ela no treino.",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "primeiros_agendamentos",
    rotulo: "Primeiros agendamentos",
    ajuda: "Avaliações agendadas — a passagem da Fase 1 para a Fase 2.",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "agendamentos_reavaliacao",
    rotulo: "Agendamentos de reavaliação",
    ajuda: "Reavaliações agendadas (Fase 6).",
    papeis: ["receptionist"],
  },
  {
    chave: "avaliacoes",
    rotulo: "Avaliações realizadas",
    ajuda: "Atendimentos de avaliação concluídos por ela.",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "aprovacoes_plano",
    rotulo: "Aprovações de planejamento",
    ajuda: "Planos de tratamento que ela aprovou ou devolveu.",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "planos_criados",
    rotulo: "Planos de tratamento criados",
    ajuda: "Planos montados por ela no Centro de Planejamento.",
    papeis: ["planner_dentist"],
  },
  {
    chave: "sessoes_concluidas",
    rotulo: "Sessões de tratamento concluídas",
    ajuda: "Sessões que ela executou e deu por concluídas.",
    papeis: ["dentist", "tsb", "asb"],
  },
  {
    chave: "apresentacoes",
    rotulo: "Apresentações comerciais",
    ajuda: "Apresentações realizadas por ela (Fase 4).",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "fechamentos",
    rotulo: "Fechamentos de venda",
    ajuda: "Vendas fechadas por ela — documento assinado e pagamento.",
    papeis: ["commercial_consultant", "commercial_assistant"],
  },
] as const satisfies readonly {
  chave: string;
  rotulo: string;
  ajuda: string;
  papeis: readonly UserRole[];
}[];

export type Indicador = (typeof INDICADORES)[number];
export type ChaveDeIndicador = Indicador["chave"];

/** As funções que TÊM o que ser medido, na ordem da jornada do cliente. */
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
] as const satisfies readonly UserRole[];

export type PapelComMissao = (typeof PAPEIS_COM_MISSAO)[number];

/** Os indicadores que fazem sentido para aquela função. */
export function indicadoresDoPapel(
  papel: UserRole
): readonly Indicador[] {
  return INDICADORES.filter((i) =>
    (i.papeis as readonly UserRole[]).includes(papel)
  );
}

// -- Os dois eixos do documento ---------------------------------------------

export const ESCOPOS = ["individual", "coletiva"] as const;
export type Escopo = (typeof ESCOPOS)[number];

export const GATILHOS = ["automatica", "aprovacao"] as const;
export type Gatilho = (typeof GATILHOS)[number];

export const ESCOPO_ROTULO: Record<Escopo, string> = {
  individual: "Individual",
  coletiva: "Coletiva (por unidade)",
};

export const ESCOPO_AJUDA: Record<Escopo, string> = {
  individual:
    "Cada pessoa é liberada assim que cumpre a própria missão, sem depender dos colegas.",
  coletiva:
    "O sistema real só abre para a unidade quando TODOS os selecionados cumprirem a missão.",
};

export const GATILHO_ROTULO: Record<Gatilho, string> = {
  automatica: "Automática",
  aprovacao: "Com aprovação do Admin Master",
};

export const GATILHO_AJUDA: Record<Gatilho, string> = {
  automatica: "Cumpriu a missão, o sistema real abre na hora, sem ninguém confirmar.",
  aprovacao:
    "Cumpriu a missão, o Admin Master recebe um aviso e decide. Nada abre sozinho.",
};

export type ConfiguracaoDoPortao = {
  release_scope: Escopo;
  release_trigger: Gatilho;
};

/** O padrão mais cauteloso dos quatro — ver o comentário da migração 0271. */
export const PADRAO_DO_PORTAO: ConfiguracaoDoPortao = {
  release_scope: "individual",
  release_trigger: "aprovacao",
};

export function ehEscopo(v: string): v is Escopo {
  return (ESCOPOS as readonly string[]).includes(v);
}

export function ehGatilho(v: string): v is Gatilho {
  return (GATILHOS as readonly string[]).includes(v);
}

// -- As metas ----------------------------------------------------------------

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
 * Uma frase para a lista: "3 cadastros · 2 primeiros agendamentos".
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
