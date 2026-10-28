// A HORA CLÍNICA DA UNIDADE (pedido do dono, 27/10/2026; migração 0330).
//
// "Quanto custa, por hora, manter a cadeira de pé?" — o que a clínica gasta
// para existir (pessoal, aluguel, contas, administrativo, marketing e o
// desgaste dos equipamentos), dividido pelas horas em que ela produz.
//
//   hora clínica = custo fixo ÷ (horas de cadeira × ocupação esperada)
//
// Decisões do dono (HC1–HC4, as quatro como recomendado):
//   HC1 — o divisor são as horas de CADEIRA (a conta do Planejamento Anual)
//         vezes a OCUPAÇÃO ESPERADA (padrão 80%). Dividir pelas horas
//         trabalhadas faria a unidade nova, de agenda vazia, ter a hora
//         caríssima e preços que espantam o paciente. A hora REAL (sobre as
//         trabalhadas) aparece ao lado, para comparar.
//   HC2 — os ÚLTIMOS 3 MESES FECHADOS.
//   HC3 — o valor digitado vale SÓ sem dados, e a tela diz que é provisório.
//   HC4 — a DEPRECIAÇÃO entra no custo fixo.
//
// ⚠️ SÓ CUSTO FIXO. Material, laboratório, repasse, taxa do cartão e imposto
// já entram na Precificação item a item — somá-los aqui cobraria duas vezes.
// A separação fixo × variável é a do Plano de contas (a do Ponto de
// equilíbrio), e é do dono corrigir.
//
// Mês sem custo fixo lançado ou sem hora de cadeira fica FORA da conta (e das
// horas): a unidade que começou a lançar no Financeiro há um mês não pode ter
// o custo de um mês dividido pelas horas de três.
//
// Conta pura: nenhuma leitura de banco, nenhum relógio ("hoje" entra por
// parâmetro). A leitura mora em `hora-clinica-db.ts`.

import { addDaysIso, monthRangeOf } from "@/lib/dates";

/** HC1: a ocupação esperada quando ninguém configurou (rede sem valor). */
export const OCUPACAO_PADRAO = 80;

/** HC2: quantos meses fechados entram na conta. */
export const MESES_DA_HORA_CLINICA = 3;

export type PeriodoDaHoraClinica = {
  /** Primeiro dia do primeiro mês. */
  de: string;
  /** Último dia do último mês. */
  ate: string;
  /** Os meses, "AAAA-MM", do mais antigo ao mais novo. */
  meses: string[];
};

function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Os 3 meses FECHADOS que terminam em `ateMes` — ou, sem ele (ou se ele ainda
 * não fechou), os 3 anteriores ao mês de `hoje`.
 */
export function periodoDaHoraClinica(hoje: string, ateMes?: string | null): PeriodoDaHoraClinica {
  const atual = hoje.slice(0, 7);
  let ultimo = ateMes && /^\d{4}-\d{2}$/.test(ateMes) && ateMes < atual ? ateMes : mesAnterior(atual);
  const meses: string[] = [];
  for (let i = 0; i < MESES_DA_HORA_CLINICA; i++) {
    meses.unshift(ultimo);
    ultimo = mesAnterior(ultimo);
  }
  return {
    de: `${meses[0]}-01`,
    ate: monthRangeOf(`${meses[meses.length - 1]}-01`).to,
    meses,
  };
}

/** Os dias de um mês "AAAA-MM", para somar as horas dia a dia. */
export function diasDoMes(mes: string): string[] {
  const { from, to } = monthRangeOf(`${mes}-01`);
  const dias: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) dias.push(d);
  return dias;
}

export type MesDaHoraClinica = {
  /** "AAAA-MM". */
  mes: string;
  /** Custo fixo (positivo), sem a depreciação. */
  fixoCents: number;
  /** Depreciação dos bens (positivo). */
  depreciacaoCents: number;
  /** Minutos-cadeira possíveis no mês (a conta do Planejamento Anual). */
  minutosCadeira: number;
  /** Minutos trabalhados na cadeira (concluídos, pelo tempo marcado). Nulo = não lido. */
  minutosTrabalhados: number | null;
};

export type OrigemDaHora = "calculada" | "provisoria" | "sem_valor";

export type HoraClinica = {
  origem: OrigemDaHora;
  /** A hora que a Precificação, a negociação e a venda direta usam. */
  efetivaCents: number;
  /** A calculada (nula sem dados). */
  calculadaCents: number | null;
  /** A digitada (o valor provisório). */
  manualCents: number;
  /** Por que não deu para calcular (só quando não é "calculada"). */
  motivo: string | null;
  /** O que não deu para ler (em português). */
  naoLido: string[];
  ocupacaoEsperadaPercent: number;
  periodo: PeriodoDaHoraClinica;
  /** Os meses que entraram na conta (com custo fixo E horas de cadeira). */
  mesesUsados: string[];
  meses: MesDaHoraClinica[];
  /** Totais dos meses usados. */
  custoFixoCents: number;
  depreciacaoCents: number;
  minutosCadeira: number;
  /** Minutos-cadeira × ocupação esperada: as horas que pagam a estrutura. */
  minutosClinicos: number;
  /** Nulo quando não houve trabalhadas lidas nos meses usados. */
  minutosTrabalhados: number | null;
  /** Ocupação real (trabalhadas ÷ cadeira), em % com uma casa. */
  ocupacaoRealPercent: number | null;
  /** Custo fixo ÷ horas trabalhadas — para comparar, não para precificar. */
  horaRealCents: number | null;
};

/** Meio para cima, em centavos. */
function arredondar(v: number): number {
  return Math.floor(v + 0.5);
}

/** HC1: a ocupação válida (1 a 100); fora disso, a da rede ou a padrão. */
export function ocupacaoValida(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 100;
}

/** Custo ÷ (minutos ÷ 60), em centavos. Sem minutos, nulo. */
export function custoPorHora(custoCents: number, minutos: number): number | null {
  if (!(minutos > 0) || !(custoCents > 0)) return null;
  return arredondar((custoCents * 60) / minutos);
}

export function calcularHoraClinica(input: {
  periodo: PeriodoDaHoraClinica;
  meses: MesDaHoraClinica[];
  ocupacaoEsperadaPercent: number | null;
  /** O valor digitado (provisório). */
  manualCents: number;
  /** O que não deu para ler (em português). Vazio = leu tudo. */
  naoLido?: string[];
}): HoraClinica {
  const ocupacao = ocupacaoValida(input.ocupacaoEsperadaPercent)
    ? input.ocupacaoEsperadaPercent
    : OCUPACAO_PADRAO;
  const manualCents = Math.max(0, Math.round(input.manualCents || 0));
  const usados = input.meses.filter(
    (m) => m.fixoCents + m.depreciacaoCents > 0 && m.minutosCadeira > 0
  );
  const custoFixoCents = usados.reduce((s, m) => s + m.fixoCents, 0);
  const depreciacaoCents = usados.reduce((s, m) => s + m.depreciacaoCents, 0);
  const minutosCadeira = usados.reduce((s, m) => s + m.minutosCadeira, 0);
  const minutosClinicos = (minutosCadeira * ocupacao) / 100;
  const custo = custoFixoCents + depreciacaoCents;
  const comTrabalhadas = usados.filter((m) => m.minutosTrabalhados !== null);
  const minutosTrabalhados =
    usados.length > 0 && comTrabalhadas.length === usados.length
      ? comTrabalhadas.reduce((s, m) => s + (m.minutosTrabalhados ?? 0), 0)
      : null;

  const calculadaCents =
    (input.naoLido?.length ?? 0) > 0 ? null : custoPorHora(custo, minutosClinicos);

  let motivo: string | null = null;
  if (calculadaCents === null) {
    if ((input.naoLido?.length ?? 0) > 0) {
      motivo = `Não consegui ler ${input.naoLido!.join(", ")}.`;
    } else if (!input.meses.some((m) => m.fixoCents + m.depreciacaoCents > 0)) {
      motivo = "Nenhum custo fixo lançado no Financeiro nos últimos 3 meses fechados.";
    } else if (!input.meses.some((m) => m.minutosCadeira > 0)) {
      motivo = "A agenda não tem horas de cadeira nos últimos 3 meses fechados.";
    } else {
      motivo = "Nenhum mês com custo fixo lançado E horas de cadeira na agenda.";
    }
  }

  const origem: OrigemDaHora =
    calculadaCents !== null ? "calculada" : manualCents > 0 ? "provisoria" : "sem_valor";

  return {
    origem,
    efetivaCents: calculadaCents ?? manualCents,
    calculadaCents,
    manualCents,
    motivo,
    naoLido: input.naoLido ?? [],
    ocupacaoEsperadaPercent: ocupacao,
    periodo: input.periodo,
    mesesUsados: usados.map((m) => m.mes),
    meses: input.meses,
    custoFixoCents,
    depreciacaoCents,
    minutosCadeira,
    minutosClinicos,
    minutosTrabalhados,
    ocupacaoRealPercent:
      minutosTrabalhados !== null && minutosCadeira > 0
        ? Math.round((minutosTrabalhados / minutosCadeira) * 1000) / 10
        : null,
    horaRealCents: minutosTrabalhados !== null ? custoPorHora(custo, minutosTrabalhados) : null,
  };
}

/** Média mensal dos meses usados (o "por mês" das telas). */
export function porMesUsado(total: number, h: Pick<HoraClinica, "mesesUsados">): number {
  return h.mesesUsados.length > 0 ? total / h.mesesUsados.length : 0;
}

// ---------------------------------------------------------------------------
// A rede (Painel da rede)
// ---------------------------------------------------------------------------

/**
 * A HORA CLÍNICA DA REDE — soma em cima, soma embaixo, só com as unidades
 * calculadas. A média simples das horas daria o mesmo peso à unidade de uma
 * cadeira e à de seis.
 */
export function horaClinicaDaRede(
  us: Pick<HoraClinica, "origem" | "custoFixoCents" | "depreciacaoCents" | "minutosClinicos">[]
): number | null {
  const calc = us.filter((u) => u.origem === "calculada");
  const custo = calc.reduce((s, u) => s + u.custoFixoCents + u.depreciacaoCents, 0);
  const minutos = calc.reduce((s, u) => s + u.minutosClinicos, 0);
  return custoPorHora(custo, minutos);
}

/** Quanto a hora da unidade está acima (+) ou abaixo (−) da rede, em %. */
export function distanciaDaRede(horaCents: number | null, redeCents: number | null): number | null {
  if (horaCents === null || redeCents === null || redeCents <= 0) return null;
  return Math.round(((horaCents - redeCents) / redeCents) * 1000) / 10;
}

/** A faixa em volta da média da rede que ainda conta como "na média" (%). */
export const FAIXA_DA_HORA_PERCENT = 10;

export function formatarPercentual(p: number | null, sinal = false): string {
  if (p === null) return "—";
  const v = Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (!sinal) return `${v}%`;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${v}%`;
}

// ---------------------------------------------------------------------------
// A aba "Hora clínica" do Painel da rede
// ---------------------------------------------------------------------------

export type UnidadeHora = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  hora: HoraClinica;
};

export type FarolDaHora = "amarelo" | "verde" | "sem_dado";

/**
 * A COR É A HORA CONTRA A DA REDE (como a margem na aba DRE): mais de 10% acima
 * é amarelo ("estrutura mais cara"); dentro da faixa ou abaixo, verde. Sem
 * conta (valor provisório ou nenhum), cinza — a hora digitada não se compara.
 */
export function farolHora(
  u: UnidadeHora,
  redeCents: number | null
): { farol: FarolDaHora; motivo: string } {
  const h = u.hora;
  if (h.origem !== "calculada") {
    return {
      farol: "sem_dado",
      motivo:
        h.origem === "provisoria"
          ? `Sem dados para calcular — vale o valor digitado (${brlHora(h.manualCents)})`
          : "Sem dados para calcular e sem valor provisório",
    };
  }
  const d = distanciaDaRede(h.calculadaCents, redeCents);
  if (d !== null && d > FAIXA_DA_HORA_PERCENT)
    return { farol: "amarelo", motivo: `Hora ${formatarPercentual(d)} mais cara que a da rede` };
  if (d !== null && d < -FAIXA_DA_HORA_PERCENT)
    return { farol: "verde", motivo: `Hora ${formatarPercentual(d)} mais barata que a da rede` };
  return { farol: "verde", motivo: "Na média da rede" };
}

function brlHora(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h`;
}

/** Primeiro as mais caras; as sem conta no fim. */
export function porAtencaoHora(a: UnidadeHora, b: UnidadeHora): number {
  const ca = a.hora.calculadaCents;
  const cb = b.hora.calculadaCents;
  if (ca === null && cb === null) return a.nome.localeCompare(b.nome, "pt-BR");
  if (ca === null) return 1;
  if (cb === null) return -1;
  return cb - ca || a.nome.localeCompare(b.nome, "pt-BR");
}

export type TotaisHora = {
  /** A hora da rede (soma em cima, soma embaixo, só as calculadas). */
  horaCents: number | null;
  /** Por mês, somando as unidades calculadas. */
  custoMensalCents: number;
  minutosCadeiraMes: number;
  ocupacaoRealPercent: number | null;
  horaRealCents: number | null;
  calculadas: number;
  farois: Record<"vermelho" | FarolDaHora, number>;
};

export function totaisHora(us: UnidadeHora[]): TotaisHora {
  const calc = us.filter((u) => u.hora.origem === "calculada");
  const horaCents = horaClinicaDaRede(calc.map((u) => u.hora));
  const comReal = calc.filter((u) => u.hora.minutosTrabalhados !== null);
  const custoReal = comReal.reduce((s, u) => s + u.hora.custoFixoCents + u.hora.depreciacaoCents, 0);
  const trab = comReal.reduce((s, u) => s + (u.hora.minutosTrabalhados ?? 0), 0);
  const cadReal = comReal.reduce((s, u) => s + u.hora.minutosCadeira, 0);
  const farois = { vermelho: 0, amarelo: 0, verde: 0, sem_dado: 0 };
  for (const u of us) farois[farolHora(u, horaCents).farol] += 1;
  return {
    horaCents,
    custoMensalCents: Math.round(
      calc.reduce((s, u) => s + porMesUsado(u.hora.custoFixoCents + u.hora.depreciacaoCents, u.hora), 0)
    ),
    minutosCadeiraMes: Math.round(calc.reduce((s, u) => s + porMesUsado(u.hora.minutosCadeira, u.hora), 0)),
    ocupacaoRealPercent: cadReal > 0 ? Math.round((trab / cadReal) * 1000) / 10 : null,
    horaRealCents: custoPorHora(custoReal, trab),
    calculadas: calc.length,
    farois,
  };
}
