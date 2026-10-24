import { addDaysIso, formatIsoDateBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { formatarHoras } from "@/lib/horas-da-agenda";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import {
  indicadorDe,
  type Direcao,
  type Indicador,
  type TipoIndicador,
  type UnidadeIndicador,
} from "./indicadores";

/**
 * AS REGRAS DAS METAS — puras, sem banco, com teste (`metas.test.ts`).
 *
 * Plano: `docs/metas/METAS-PLANO.md`. Duas contas aqui têm ESPELHO no banco
 * (0318) e precisam continuar iguais às de lá: `valorDe` (= `_goal_value`) e
 * `alvoDoSujeito` (= `_goal_subject_target`). O banco usa as dele para
 * congelar o resultado; a tela usa estas para desenhar a barra.
 */

// =============================================================================
// Tipos do que vem do banco
// =============================================================================

export type SituacaoMeta =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "finished"
  | "cancelled";

/** O que a TELA mostra: a situação gravada corrigida pela data de hoje. */
export type SituacaoExibida = SituacaoMeta | "closing";

export type Desfecho = "stretch" | "achieved" | "not_achieved" | "no_data";
export type ModoDoAlvo = "collective" | "individual" | "both";
export type RegraIndividual = "same" | "split";
export type Periodicidade = "whole" | "monthly";

export type Meta = {
  id: string;
  code: string;
  name: string;
  indicator: string;
  filters: Record<string, unknown>;
  scope: "network" | "clinics";
  clinic_ids: string[];
  how_text: string | null;
  direction: Direcao;
  target_mode: ModoDoAlvo;
  target_value: number | null;
  individual_rule: RegraIndividual | null;
  individual_value: number | null;
  stretch_value: number | null;
  baseline_value: number | null;
  baseline_from: string | null;
  baseline_to: string | null;
  resources_text: string | null;
  attainable_note: string | null;
  strategic_objective: string | null;
  relevance_text: string | null;
  periodicity: Periodicidade;
  starts_on: string;
  ends_on: string;
  /** M4 (Q5): reconhecimento combinado — texto; nada vai ao Financeiro. */
  reward_text: string | null;
  stretch_reward_text: string | null;
  /** M4 (Q4): mostrar o ranking entre unidades/pessoas. */
  show_ranking: boolean;
  status: SituacaoMeta;
  outcome: Desfecho | null;
  status_reason: string | null;
  published_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_at: string;
};

export const CAMPOS_DA_META =
  "id, code, name, indicator, filters, scope, clinic_ids, how_text, direction, target_mode, target_value, individual_rule, individual_value, stretch_value, baseline_value, baseline_from, baseline_to, resources_text, attainable_note, strategic_objective, relevance_text, periodicity, starts_on, ends_on, reward_text, stretch_reward_text, show_ranking, status, outcome, status_reason, published_at, finished_at, cancelled_at, created_by, created_at";

/** Uma medida. `pct` no lugar de `num/den` = valor em R$ escondido (D3). */
export type Medida = { num?: number | null; den?: number | null; pct?: number | null };
export type MedidaDe = Medida & { id: string };

export type Fotografia = {
  from: string;
  to: string;
  kind: TipoIndicador;
  n_clinics: number;
  n_participants: number;
  restricted: boolean;
  total: Medida;
  by_clinic: MedidaDe[];
  by_user: MedidaDe[];
  by_day: (Medida & { day: string })[];
  money_hidden?: boolean;
};

export type Congelado = {
  kind: "period" | "final";
  from: string;
  to: string;
  achieved: boolean | null;
  stretch: boolean | null;
  people_achieved: number | null;
  people_total: number | null;
  measured_at: string;
  snapshot: Fotografia;
};

export type Medicao = {
  today: string;
  money_hidden: boolean;
  live: Fotografia | null;
  frozen: Congelado[];
  milestones: { id: string; snapshot: Fotografia | null }[];
};

export type Alvo = { subject_kind: "user" | "clinic"; subject_id: string; target_value: number };

// =============================================================================
// Rótulos
// =============================================================================

export const SITUACAO_LABEL: Record<SituacaoExibida, string> = {
  draft: "Rascunho",
  scheduled: "A iniciar",
  active: "Ativa",
  paused: "Pausada",
  closing: "Finalizada — apurando",
  finished: "Finalizada",
  cancelled: "Cancelada",
};

export const SITUACAO_COR: Record<SituacaoExibida, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  paused: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  closing: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  finished: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  cancelled: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
};

export const DESFECHO_LABEL: Record<Desfecho, string> = {
  stretch: "Super Meta atingida",
  achieved: "Meta atingida",
  not_achieved: "Não atingida",
  no_data: "Sem dados para apurar",
};

export const MODO_LABEL: Record<ModoDoAlvo, string> = {
  collective: "Coletiva (um número só, de todos)",
  individual: "Individual (cada participante com o seu alvo)",
  both: "Coletiva e individual",
};

export const OBJETIVOS_ESTRATEGICOS = [
  { value: "growth", label: "Crescer a receita" },
  { value: "loyalty", label: "Fidelizar clientes" },
  { value: "programs", label: "Expandir um programa da Risarte" },
  { value: "efficiency", label: "Eficiência da operação" },
  { value: "quality", label: "Qualidade do atendimento" },
  { value: "financial_health", label: "Saúde financeira" },
  { value: "cost", label: "Reduzir custos" },
  { value: "team", label: "Desenvolver a equipe" },
] as const;

export function objetivoLabel(v: string | null): string {
  return OBJETIVOS_ESTRATEGICOS.find((o) => o.value === v)?.label ?? "—";
}

// =============================================================================
// Abas do painel
// =============================================================================

export const ABAS = [
  { chave: "ativas", rotulo: "Ativas" },
  { chave: "a-iniciar", rotulo: "A iniciar" },
  { chave: "pausadas", rotulo: "Pausadas" },
  { chave: "finalizadas", rotulo: "Finalizadas" },
  { chave: "canceladas", rotulo: "Canceladas" },
  { chave: "rascunhos", rotulo: "Rascunhos" },
] as const;
export type Aba = (typeof ABAS)[number]["chave"];

export function lerAba(v: string | undefined): Aba {
  return ABAS.some((a) => a.chave === v) ? (v as Aba) : "ativas";
}

/**
 * A situação que a tela mostra. A rotina da madrugada é quem GRAVA a troca
 * (A iniciar → Ativa; prazo vencido → Finalizada, congelando o resultado), mas
 * a tela não espera por ela: uma meta que começa hoje já aparece Ativa às 8h.
 */
export function situacaoEfetiva(
  meta: Pick<Meta, "status" | "starts_on" | "ends_on">,
  hoje: string
): SituacaoExibida {
  const { status } = meta;
  if (status === "draft" || status === "cancelled" || status === "finished") return status;
  if (meta.ends_on < hoje) return "closing";
  if (status === "scheduled" && meta.starts_on <= hoje) return "active";
  return status;
}

/** "Rede toda", "Unidade Centro", "A, B e mais 3". */
export function ondeDaMeta(meta: Pick<Meta, "scope" | "clinic_ids">, nomes: Map<string, string>): string {
  if (meta.scope === "network") return "Rede toda";
  const lista = meta.clinic_ids.map((id) => nomes.get(id) ?? "Unidade");
  if (lista.length <= 2) return lista.join(" e ");
  return `${lista.slice(0, 2).join(", ")} e mais ${lista.length - 2}`;
}

export function abaDa(s: SituacaoExibida): Aba {
  switch (s) {
    case "draft":
      return "rascunhos";
    case "scheduled":
      return "a-iniciar";
    case "active":
      return "ativas";
    case "paused":
      return "pausadas";
    case "closing":
    case "finished":
      return "finalizadas";
    case "cancelled":
      return "canceladas";
  }
}

// =============================================================================
// Datas (só datas de calendário, sem relógio — nenhuma armadilha de fuso)
// =============================================================================

function diaUTC(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Dias de `de` a `ate`, as duas pontas inclusas (0 se `ate` < `de`). */
export function diasEntre(de: string, ate: string): number {
  const n = diaUTC(ate) - diaUTC(de) + 1;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function menor(a: string, b: string) {
  return a < b ? a : b;
}
function maior(a: string, b: string) {
  return a > b ? a : b;
}

export function primeiroDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function ultimoDoMes(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const proximo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDaysIso(proximo, -1);
}

/** Os meses de uma meta mensal (o primeiro e o último podem ser parciais). */
export function periodosMensais(de: string, ate: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let m = primeiroDoMes(de);
  while (m <= ate) {
    out.push({ from: maior(m, de), to: menor(ultimoDoMes(m), ate) });
    m = addDaysIso(ultimoDoMes(m), 1);
  }
  return out;
}

/** A janela medida AGORA — a mesma conta de `goal_measure` no banco. */
export function janelaAtual(
  meta: Pick<Meta, "periodicity" | "starts_on" | "ends_on">,
  hoje: string
): { from: string; to: string } | null {
  if (meta.starts_on > hoje) return null;
  const to = menor(meta.ends_on, hoje);
  const from = meta.periodicity === "monthly" ? maior(meta.starts_on, primeiroDoMes(to)) : meta.starts_on;
  return { from, to };
}

/** A janela INTEIRA do período corrente (para o ritmo): o mês todo, ou a meta toda. */
export function periodoCorrente(
  meta: Pick<Meta, "periodicity" | "starts_on" | "ends_on">,
  hoje: string
): { from: string; to: string } {
  if (meta.periodicity !== "monthly") return { from: meta.starts_on, to: meta.ends_on };
  const ref = menor(maior(hoje, meta.starts_on), meta.ends_on);
  return { from: maior(meta.starts_on, primeiroDoMes(ref)), to: menor(ultimoDoMes(ref), meta.ends_on) };
}

export type Pausa = { de: string; ate: string | null };

/**
 * Quanto do período JÁ deveria ter sido feito (0 a 1), contando os dias JÁ
 * ENCERRADOS — até ontem. Hoje ainda está acontecendo: contar o dia de hoje
 * pintava de vermelho, às 8h do primeiro dia, uma meta que nem teve tempo
 * de começar (achado conferindo a tela, 23/10/2026).
 *
 * D4 (23/10/2026): o tempo PAUSADO não conta para o ritmo, e o prazo NÃO se
 * estende sozinho — então os dias pausados saem do que passou E do total.
 */
export function fracaoEsperada(
  periodo: { from: string; to: string },
  hoje: string,
  pausas: Pausa[] = []
): number {
  if (hoje <= periodo.from) return 0;
  const corte = menor(addDaysIso(hoje, -1), periodo.to);
  const passados = diasEntre(periodo.from, corte);
  const total = diasEntre(periodo.from, periodo.to);
  let pausados = 0;
  for (const p of pausas) {
    const de = maior(p.de, periodo.from);
    const ate = menor(p.ate ?? corte, corte);
    pausados += diasEntre(de, ate);
  }
  pausados = Math.min(pausados, passados);
  const util = total - pausados;
  if (util <= 0) return 1;
  return Math.max(0, Math.min(1, (passados - pausados) / util));
}

// =============================================================================
// Valores e percentuais
// =============================================================================

/** Espelho de `_goal_value` (0318). Taxa = num ÷ den; den zero = sem dado. */
export function valorDe(m: Medida | null | undefined): number | null {
  if (!m || m.num == null) return null;
  if (m.den == null) return Number(m.num);
  const den = Number(m.den);
  if (den === 0) return null;
  return Number(m.num) / den;
}

/**
 * O percentual da barra. Espelho de `_goal_percent` (0319).
 *   * AUMENTAR até X: realizado ÷ alvo.
 *   * REDUZIR até X: quanto já caiu ÷ quanto precisava cair, a partir da
 *     linha de base. Sem base (ou base já abaixo do alvo): 100% se está
 *     dentro, senão alvo ÷ realizado.
 *   * LIMITE (soma de "no máximo", N2): o USO do limite — realizado ÷ limite.
 *     Aqui, MENOS é melhor: 60% = sobra 40% do limite; acima de 100% passou.
 * O número volta inteiro (pode passar de 100); a barra é quem para em 100.
 */
export function percentual(
  direcao: Direcao,
  valor: number | null,
  alvo: number | null,
  base: number | null = null,
  limite = false
): number | null {
  if (valor == null || alvo == null) return null;
  if (limite) {
    if (alvo === 0) return valor > 0 ? 999 : 0;
    return (valor / alvo) * 100;
  }
  if (direcao === "increase") {
    if (alvo === 0) return valor > 0 ? 100 : 0;
    return (valor / alvo) * 100;
  }
  if (base != null && base > alvo) {
    return Math.max(0, ((base - valor) / (base - alvo)) * 100);
  }
  if (valor <= alvo) return 100;
  return valor === 0 ? 100 : (alvo / valor) * 100;
}

/** O percentual de uma medida — a que veio escondida (D3) já traz o seu. */
export function percentualDaMedida(
  m: Medida | null | undefined,
  direcao: Direcao,
  alvo: number | null,
  base: number | null = null,
  limite = false
): number | null {
  if (!m) return null;
  if (m.pct !== undefined) return m.pct == null ? null : Number(m.pct);
  return percentual(direcao, valorDe(m), alvo, base, limite);
}

/** A meta é de LIMITE ("no máximo" numa soma)? */
export function ehLimite(meta: Pick<Meta, "indicator" | "direction">): boolean {
  return Boolean(indicadorDe(meta.indicator)?.limite) && meta.direction === "decrease";
}

export function atingiu(direcao: Direcao, valor: number | null, alvo: number | null): boolean | null {
  if (valor == null || alvo == null) return null;
  return direcao === "decrease" ? valor <= alvo : valor >= alvo;
}

/**
 * Espelho de `_goal_subject_target` (0318): o ajuste manual, senão a regra.
 * Pessoa: "igual para todos" = o valor individual; "dividido" = alvo ÷ n.
 * Unidade (D2): soma = alvo ÷ número de unidades; taxa = o próprio alvo.
 */
export function alvoDoSujeito(
  meta: Pick<Meta, "indicator" | "target_value" | "individual_rule" | "individual_value">,
  tipo: "user" | "clinic",
  id: string,
  n: number,
  ajustes: Alvo[]
): number | null {
  const ajuste = ajustes.find((a) => a.subject_kind === tipo && a.subject_id === id);
  if (ajuste) return Number(ajuste.target_value);
  if (tipo === "user" && meta.individual_rule === "same") return meta.individual_value;
  // Taxa e fotografia não se dividem: cada unidade/pessoa tem o próprio alvo.
  if (indicadorDe(meta.indicator)?.tipo !== "sum") {
    return tipo === "user" ? meta.individual_value : meta.target_value;
  }
  if (n > 0 && meta.target_value != null) return meta.target_value / n;
  return null;
}

/**
 * M4 (Q4): a posição de alguém numa lista de percentuais — "3º de 12".
 * Empate divide a posição (dois em 1º, o seguinte é 3º). No LIMITE, menos é
 * melhor. Sem percentual (sem dado) fica no fim.
 */
export function posicao(
  lista: { id: string; pct: number | null }[],
  id: string,
  limite = false
): { lugar: number; de: number } | null {
  const minha = lista.find((x) => x.id === id);
  if (!minha || minha.pct == null) return null;
  const melhor = (a: number, b: number) => (limite ? a < b : a > b);
  const acima = lista.filter((x) => x.pct != null && melhor(x.pct, minha.pct as number)).length;
  return { lugar: acima + 1, de: lista.length };
}

export type Farol = "verde" | "amarelo" | "vermelho" | "neutro";

export const FAROL_LABEL: Record<Farol, string> = {
  verde: "No ritmo",
  amarelo: "Atenção",
  vermelho: "Atrás do ritmo",
  neutro: "Começando",
};

/** No limite, o farol fala do quanto sobra (N2). */
export const FAROL_LABEL_LIMITE: Record<Farol, string> = {
  verde: "Dentro do limite",
  amarelo: "Perto do limite",
  vermelho: "Passou do limite",
  neutro: "Começando",
};

export const FAROL_COR: Record<Farol, string> = {
  verde: "bg-emerald-500",
  amarelo: "bg-amber-500",
  vermelho: "bg-destructive",
  neutro: "bg-muted-foreground/40",
};

/** Abaixo disto do ritmo esperado, o farol fica vermelho (soma). */
export const LIMITE_ATENCAO = 0.85;

/**
 * O farol do ritmo.
 *   * SOMA: compara o feito com o que já deveria ter sido feito hoje.
 *   * TAXA e FOTOGRAFIA: compara com o próprio alvo (não "acumulam").
 *   * LIMITE: `pct` é o USO do limite — verde enquanto o uso não passa da
 *     parte do prazo que já correu; âmbar acima disso; vermelho passou.
 */
export function farol(tipo: TipoIndicador, pct: number | null, esperado: number, limite = false): Farol {
  if (pct == null) return "neutro";
  if (limite) {
    if (pct > 100) return "vermelho";
    if (pct <= esperado * 100) return "verde";
    return "amarelo";
  }
  if (tipo !== "sum") {
    if (pct >= 100) return "verde";
    if (pct >= 90) return "amarelo";
    return "vermelho";
  }
  if (esperado <= 0) return "neutro";
  if (pct >= 100) return "verde";
  const r = pct / (esperado * 100);
  if (r >= 1) return "verde";
  if (r >= LIMITE_ATENCAO) return "amarelo";
  return "vermelho";
}

/** "No ritmo atual, termina em X%" — só faz sentido para soma. */
export function projecao(tipo: TipoIndicador, pct: number | null, esperado: number): number | null {
  if (tipo !== "sum" || pct == null || esperado <= 0) return null;
  return pct / esperado;
}

// =============================================================================
// Selo "Atingível"
// =============================================================================

export type NivelAtingivel = "realista" | "desafiador" | "muito_acima" | "sem_historico";

/** Até 10% de melhora sobre o histórico = realista; até 30% = desafiador. */
export const LIMITE_REALISTA = 0.1;
export const LIMITE_DESAFIADOR = 0.3;

export const ATINGIVEL_LABEL: Record<NivelAtingivel, string> = {
  realista: "Realista",
  desafiador: "Desafiador",
  muito_acima: "Muito acima do histórico",
  sem_historico: "Sem histórico para comparar",
};

/**
 * Compara o alvo com o que a unidade já fez num período equivalente. A
 * melhora pedida é relativa: aumentar = alvo ÷ base − 1; reduzir = base ÷
 * alvo − 1 (cair de 10% para 5% é pedir o dobro de melhora).
 */
export function seloAtingivel(
  direcao: Direcao,
  alvo: number | null,
  base: number | null
): { nivel: NivelAtingivel; melhora: number | null } {
  if (alvo == null || base == null || base <= 0) return { nivel: "sem_historico", melhora: null };
  const melhora = direcao === "increase" ? alvo / base - 1 : alvo > 0 ? base / alvo - 1 : Infinity;
  const nivel =
    melhora <= LIMITE_REALISTA ? "realista" : melhora <= LIMITE_DESAFIADOR ? "desafiador" : "muito_acima";
  return { nivel, melhora: Number.isFinite(melhora) ? melhora : null };
}

/**
 * A base de comparação para o período da meta: a soma é proporcional ao
 * tamanho (média por dia × dias); a taxa é a própria taxa do histórico.
 */
export function baseParaOPeriodo(
  tipo: TipoIndicador,
  valorDoHistorico: number | null,
  diasDoHistorico: number,
  diasDoPeriodo: number
): number | null {
  if (valorDoHistorico == null) return null;
  if (tipo !== "sum") return valorDoHistorico;
  if (diasDoHistorico <= 0) return null;
  return (valorDoHistorico / diasDoHistorico) * diasDoPeriodo;
}

// =============================================================================
// Formatação
// =============================================================================

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatarValor(unidade: UnidadeIndicador, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unidade === "brl") return formatBRL(Math.round(v));
  if (unidade === "percent") return `${NUM.format(v)}%`;
  // Horas guardadas em minutos (a conta da cadeira): "7h30", como no Planejamento Anual.
  if (unidade === "hours") return formatarHoras(v);
  return NUM.format(v);
}

export function formatarPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${NUM.format(v)}%`;
}

/** O alvo como o usuário digita: R$ em reais e horas na tela; centavos e minutos no banco. */
export function paraBanco(unidade: UnidadeIndicador, digitado: number): number {
  if (unidade === "brl") return Math.round(digitado * 100);
  if (unidade === "hours") return Math.round(digitado * 60);
  return digitado;
}

export function daBanco(unidade: UnidadeIndicador, v: number | null): number | null {
  if (v == null) return null;
  if (unidade === "brl") return v / 100;
  if (unidade === "hours") return v / 60;
  return v;
}

// =============================================================================
// Participantes (espelho de `_goal_participants`, para a prévia do assistente)
// =============================================================================

export type RegraDeParticipante =
  | { kind: "all" }
  | { kind: "role"; role: UserRole }
  | { kind: "user"; user_id: string };

export type Candidato = {
  user_id: string;
  full_name: string;
  role: string;
  clinic_id: string;
  /** A função é numa clínica da Franqueadora (vem do banco: `goal_candidates`). */
  at_franchisor: boolean;
};

/**
 * Quem está na meta, a partir das regras. "Unidade toda" = todos com função
 * nas unidades da meta; "por função" = quem tem a função nessas unidades OU
 * na Franqueadora (o consultor atende as unidades de lá); "pessoa" = fixa.
 */
export function resolverParticipantes(
  regras: RegraDeParticipante[],
  candidatos: Candidato[],
  clinicasDaMeta: string[]
): { user_id: string; full_name: string; roles: string[] }[] {
  const todos = regras.some((r) => r.kind === "all");
  const funcoes = new Set(regras.flatMap((r) => (r.kind === "role" ? [r.role as string] : [])));
  const pessoas = new Set(regras.flatMap((r) => (r.kind === "user" ? [r.user_id] : [])));
  const naMeta = new Set(clinicasDaMeta);
  const out = new Map<string, { user_id: string; full_name: string; roles: Set<string> }>();
  for (const c of candidatos) {
    const entra =
      (todos && naMeta.has(c.clinic_id)) ||
      (funcoes.has(c.role) && (naMeta.has(c.clinic_id) || c.at_franchisor)) ||
      pessoas.has(c.user_id);
    if (!entra) continue;
    const p = out.get(c.user_id) ?? { user_id: c.user_id, full_name: c.full_name, roles: new Set<string>() };
    if (
      (todos && naMeta.has(c.clinic_id)) ||
      (funcoes.has(c.role) && (naMeta.has(c.clinic_id) || c.at_franchisor))
    ) {
      p.roles.add(c.role);
    }
    out.set(c.user_id, p);
  }
  return [...out.values()]
    .map((p) => ({ user_id: p.user_id, full_name: p.full_name, roles: [...p.roles] }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
}

export function resumoDosParticipantes(regras: RegraDeParticipante[], nomes: Map<string, string>): string {
  const partes: string[] = [];
  if (regras.some((r) => r.kind === "all")) partes.push("toda a equipe");
  const funcoes = regras.flatMap((r) => (r.kind === "role" ? [ROLE_LABELS[r.role]] : []));
  if (funcoes.length) partes.push(funcoes.join(", "));
  const pessoas = regras.flatMap((r) => (r.kind === "user" ? [nomes.get(r.user_id) ?? "uma pessoa"] : []));
  if (pessoas.length) partes.push(pessoas.join(", "));
  return partes.join(" + ") || "ninguém ainda";
}

// =============================================================================
// A frase SMART
// =============================================================================

export type DadosDaFrase = {
  indicador: Indicador | null;
  direction: Direcao;
  target_mode: ModoDoAlvo;
  target_value: number | null;
  individual_rule: RegraIndividual | null;
  individual_value: number | null;
  periodicity: Periodicidade;
  starts_on: string | null;
  ends_on: string | null;
  /** "de Ortodontia", "do plano Familiar" — já montado. */
  recorte?: string;
  /** "na Unidade Centro", "na rede toda". */
  onde: string;
  /** "com os Consultores Comerciais". */
  quem?: string;
};

/**
 * A meta escrita por extenso, como no exemplo do dono: "Fechar R$ 15.000,00
 * em vendas de Ortodontia por mês na Unidade Centro, de 01/01/2027 a
 * 31/03/2027." Montada ao vivo enquanto o assistente é preenchido.
 */
export function fraseSmart(d: DadosDaFrase): string {
  const ind = d.indicador;
  if (!ind) return "Escolha o indicador para montar a frase da meta.";
  const porMes = d.periodicity === "monthly" ? " por mês" : "";
  const recorte = d.recorte ? ` ${d.recorte}` : "";
  const fmt = (v: number | null) => (v == null ? "…" : formatarValor(ind.unidade, v));

  // O número vai antes do objeto; o "como se divide" vai depois dele.
  let numero: string;
  let sufixo = "";
  if (d.target_mode === "individual") {
    if (d.individual_rule === "split") {
      numero = fmt(d.target_value);
      sufixo = ", divididos entre os participantes";
    } else {
      numero = fmt(d.individual_value);
      sufixo = " por participante";
    }
  } else {
    numero = fmt(d.target_value);
    if (d.target_mode === "both") {
      sufixo =
        d.individual_rule === "same"
          ? ` (e ${fmt(d.individual_value)} por participante)`
          : " (divididos entre os participantes)";
    }
  }

  let inicio: string;
  if (ind.limite && d.direction === "decrease") {
    inicio = `Ter no máximo ${numero} ${ind.objeto}${recorte}${porMes}${sufixo}`;
  } else if (ind.tipo !== "sum") {
    const limite = d.direction === "decrease" ? "no máximo" : "no mínimo";
    const acao = d.direction === "decrease" ? "Reduzir para" : "Alcançar";
    inicio = `${acao} ${limite} ${numero} ${ind.objeto}${recorte}${porMes}${sufixo}`;
  } else {
    const verbo = ind.verbo.charAt(0).toUpperCase() + ind.verbo.slice(1);
    inicio = `${verbo} ${numero} ${ind.objeto}${recorte}${porMes}${sufixo}`;
  }
  const quem = d.quem ? `, ${d.quem}` : "";
  const prazo =
    d.starts_on && d.ends_on
      ? `, de ${formatIsoDateBr(d.starts_on)} a ${formatIsoDateBr(d.ends_on)}`
      : ", com prazo a definir";
  return `${inicio} ${d.onde}${quem}${prazo}.`;
}
