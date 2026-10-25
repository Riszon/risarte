import { addDaysIso } from "@/lib/dates";
import { indicadorDe, type ChaveIndicador, type Direcao, type UnidadeIndicador } from "./indicadores";
import { primeiroDoMes, ultimoDoMes, type ModoDoAlvo } from "./regras";

/**
 * Os MODELOS PRONTOS do assistente. Um modelo só preenche o formulário; quem
 * cria revisa tudo e o banco confere como qualquer meta. O alvo NÃO vem do
 * modelo: é sugerido pela linha de base (+10%), porque o número certo depende
 * da unidade.
 *
 * M5 (R3): os modelos moram no BANCO (`goal_templates`, 0322) e o Admin e a
 * Franqueadora editam pela tela. A lista abaixo é a semente da 0322 (a régua
 * em `metas.test.ts` compara as duas) e a RESERVA enquanto um banco não
 * recebeu a 0322 — o assistente continua oferecendo os modelos.
 */
export type FiltrosDoModelo = {
  specialties?: string[];
  appointment_types?: string[];
  client_origins?: string[];
  sale_origin?: string;
};

export type Modelo = {
  /** O id do banco; nulo na lista de reserva do código. */
  id: string | null;
  /** Identifica o modelo na tela: o id do banco, ou a chave da semente. */
  chave: string;
  ativo: boolean;
  nome: string;
  resumo: string;
  indicator: ChaveIndicador;
  direction: Direcao;
  target_mode: ModoDoAlvo;
  /** Recorte já marcado (só chaves que o indicador aceita). */
  filtros?: FiltrosDoModelo;
  /** "mes": até o fim do mês atual; "trimestre": até o fim do 3º mês. */
  duracao: "mes" | "trimestre";
  how_text: string;
  resources_text: string;
  strategic_objective: string;
  relevance_text: string;
};

export const MODELOS_DE_META: Modelo[] = ([
  {
    id: null,
    ativo: true,
    chave: "mes_riso_mais",
    nome: "Mês do Riso+",
    resumo: "Adesões ao Riso+ no mês, por consultor.",
    indicator: "ppr_adhesions",
    direction: "increase",
    target_mode: "individual",
    duracao: "mes",
    how_text: "Oferecer o Riso+ em toda apresentação e no retorno dos clientes que ainda não aderiram.",
    resources_text: "Material do Riso+ na recepção e o roteiro de oferta do Comercial.",
    strategic_objective: "programs",
    relevance_text: "O Riso+ fideliza e dá receita recorrente; um mês de foco cria o hábito da oferta.",
  },
  {
    id: null,
    ativo: true,
    chave: "avaliacoes_do_mes",
    nome: "Avaliações do mês",
    resumo: "Avaliações realizadas na unidade no mês.",
    indicator: "evaluations_done",
    direction: "increase",
    target_mode: "collective",
    duracao: "mes",
    how_text: "Confirmar a véspera de cada avaliação e reagendar na hora quem desmarcar.",
    resources_text: "A agenda de avaliação aberta e a confirmação pela recepção.",
    strategic_objective: "growth",
    relevance_text: "Toda venda começa numa avaliação: é o primeiro número do funil.",
  },
  {
    id: null,
    ativo: true,
    chave: "reduzir_faltas",
    nome: "Reduzir faltas",
    resumo: "Taxa de faltas dos agendamentos, para baixo.",
    indicator: "no_show_rate",
    direction: "decrease",
    target_mode: "collective",
    duracao: "mes",
    how_text: "Confirmar todo agendamento na véspera e oferecer outro horário a quem não puder vir.",
    resources_text: "A lista de confirmação da recepção e as mensagens prontas de lembrete.",
    strategic_objective: "efficiency",
    relevance_text: "Cada falta é uma cadeira parada que já estava paga.",
  },
  {
    id: null,
    ativo: true,
    chave: "ortodontia_trimestre",
    nome: "Ortodontia no trimestre",
    resumo: "Procedimentos de Ortodontia realizados em três meses.",
    indicator: "procedures_done",
    direction: "increase",
    target_mode: "collective",
    filtros: { specialties: ["Ortodontia"] },
    duracao: "trimestre",
    how_text: "Indicar a avaliação ortodôntica nas consultas de rotina e abrir horários à tarde.",
    resources_text: "A cadeira de ortodontia e a agenda do ortodontista.",
    strategic_objective: "growth",
    relevance_text: "A ortodontia ocupa a cadeira por meses e sustenta a receita do trimestre.",
  },
  {
    id: null,
    ativo: true,
    chave: "inadimplencia_limite",
    nome: "Inadimplência abaixo do limite",
    resumo: "O percentual em atraso, para baixo.",
    indicator: "overdue_rate",
    direction: "decrease",
    target_mode: "collective",
    duracao: "mes",
    how_text: "Lembrar o vencimento antes do dia e ligar no dia seguinte ao atraso.",
    resources_text: "A tela de Recebíveis e as mensagens de cobrança.",
    strategic_objective: "financial_health",
    relevance_text: "Dinheiro em atraso é caixa que falta para pagar as contas do mês.",
  },
  {
    id: null,
    ativo: true,
    chave: "ocupacao_cadeira",
    nome: "Ocupação da cadeira",
    resumo: "Ocupação das cadeiras no mês (a conta do Planejamento Anual).",
    indicator: "chair_occupancy",
    direction: "increase",
    target_mode: "collective",
    duracao: "mes",
    how_text: "Preencher os buracos da agenda com retornos e encaixes antes de abrir horário novo.",
    resources_text: "A agenda da unidade e a lista de retornos pendentes.",
    strategic_objective: "efficiency",
    relevance_text: "A cadeira ociosa é o custo fixo que não volta.",
  },
  {
    id: null,
    ativo: true,
    chave: "novos_clientes",
    nome: "Novos clientes",
    resumo: "Clientes novos cadastrados no mês.",
    indicator: "new_clients",
    direction: "increase",
    target_mode: "collective",
    duracao: "mes",
    how_text: "Cadastrar todo contato que chegar e pedir indicação aos clientes satisfeitos.",
    resources_text: "O Indica +Risos e o cadastro pela recepção e pela SDR.",
    strategic_objective: "growth",
    relevance_text: "Sem cliente novo a agenda envelhece.",
  },
  {
    id: null,
    ativo: true,
    chave: "ticket_medio",
    nome: "Ticket médio",
    resumo: "Valor médio de cada venda fechada, por consultor.",
    indicator: "sales_ticket",
    direction: "increase",
    target_mode: "individual",
    duracao: "mes",
    how_text: "Apresentar o plano completo antes das alternativas e mostrar o valor de cada etapa.",
    resources_text: "A apresentação do plano e a tabela de pagamento.",
    strategic_objective: "growth",
    relevance_text: "Vender melhor cada caso rende mais que atender mais casos.",
  },
] satisfies Modelo[]) as Modelo[];

export function modeloDe(chave: string, lista: Modelo[] = MODELOS_DE_META): Modelo | undefined {
  return lista.find((m) => m.chave === chave);
}

/** Só os recortes que o indicador aceita (o resto o banco ignoraria em silêncio). */
export function filtrosDoModelo(indicador: string, f: FiltrosDoModelo | Record<string, unknown> | null | undefined): FiltrosDoModelo {
  const ind = indicadorDe(indicador);
  const x = (f ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === "string" && i !== "") : []);
  const out: FiltrosDoModelo = {};
  if (!ind) return out;
  if (ind.recortes.includes("specialties") && lista(x.specialties).length) out.specialties = lista(x.specialties);
  if (ind.recortes.includes("appointment_types") && lista(x.appointment_types).length)
    out.appointment_types = lista(x.appointment_types);
  if (ind.recortes.includes("client_origins") && lista(x.client_origins).length) out.client_origins = lista(x.client_origins);
  if (ind.recortes.includes("sale_origin") && typeof x.sale_origin === "string" && x.sale_origin) out.sale_origin = x.sale_origin;
  return out;
}

/** Uma linha de `goal_templates` no formato da tela. */
export function modeloDoBanco(r: Record<string, unknown>): Modelo {
  const indicator = String(r.indicator ?? "") as ChaveIndicador;
  return {
    id: String(r.id),
    chave: String(r.id),
    ativo: r.is_active !== false,
    nome: String(r.name ?? ""),
    resumo: String(r.summary ?? ""),
    indicator,
    direction: r.direction === "decrease" ? "decrease" : "increase",
    target_mode: r.target_mode === "individual" || r.target_mode === "both" ? r.target_mode : "collective",
    filtros: filtrosDoModelo(indicator, r.filters as Record<string, unknown>),
    duracao: r.duration === "trimestre" ? "trimestre" : "mes",
    how_text: String(r.how_text ?? ""),
    resources_text: String(r.resources_text ?? ""),
    strategic_objective: String(r.strategic_objective ?? ""),
    relevance_text: String(r.relevance_text ?? ""),
  };
}

/** O fim do período do modelo, a partir de hoje. */
export function fimDoModelo(duracao: Modelo["duracao"], hoje: string): string {
  if (duracao === "mes") return ultimoDoMes(hoje);
  let mes = primeiroDoMes(hoje);
  for (let i = 0; i < 2; i++) mes = primeiroDoMes(addDaysIso(mes, 32));
  return ultimoDoMes(mes);
}

/**
 * M4: o alvo SUGERIDO — a linha de base +10% (reduzir: −10%), o limite do
 * "realista" do selo Atingível. Arredonda para um número que alguém digitaria,
 * sempre a favor da meta: contagem inteira, R$ e horas inteiros, % com uma
 * casa. Sem base (ou base zero), não há sugestão: inventar um número seria pior.
 */
export function alvoSugerido(direcao: Direcao, base: number | null, unidade: UnidadeIndicador): number | null {
  if (base == null || !Number.isFinite(base) || base <= 0) return null;
  const sobe = direcao === "increase";
  const bruto = base * (sobe ? 1.1 : 0.9);
  const passo = unidade === "brl" ? 100 : unidade === "hours" ? 60 : unidade === "percent" ? 0.1 : 1;
  const arred = sobe ? Math.ceil(bruto / passo - 1e-9) : Math.floor(bruto / passo + 1e-9);
  const v = Math.round(arred * passo * 10) / 10;
  return v > 0 ? v : null;
}
