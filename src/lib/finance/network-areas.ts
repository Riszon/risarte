/**
 * OC-00121 — O PAINEL DA REDE POR ÁREA.
 *
 * Cada aba do Painel da rede (Contas a pagar · Recebíveis · Fluxo de caixa ·
 * DRE) mostra o total da rede e uma linha por unidade, na ordem de atenção, com
 * uma cor e a FRASE que explica a cor. Puro e com teste, como
 * `network-panel.ts` e `network-receivables.ts`: a tela desenha, aqui se decide.
 *
 * ⚠️ NENHUMA CONTA NOVA DE DINHEIRO MORA AQUI. Os números de cada unidade saem
 * das MESMAS funções que a tela da unidade usa (`viewPayable`,
 * `summarizePayables`, `buildCashFlow`, `network_units_summary`) — é isso que
 * faz o número da rede bater com o da unidade por construção. Este arquivo só
 * junta, compara, colore e ordena.
 */

import { monthRangeOf } from "@/lib/dates";
import { firstNegative, type CashPeriod } from "./cash-flow";
import {
  acimaDoLimite,
  porAtencao,
  taxaDaRede,
  type UnidadeRecebivel,
} from "./network-receivables";

export type Farol = "vermelho" | "amarelo" | "verde" | "sem_dado";

export const NETWORK_TABS = [
  { key: "visao", label: "Visão geral" },
  { key: "pagar", label: "Contas a pagar" },
  { key: "receber", label: "Recebíveis" },
  { key: "caixa", label: "Fluxo de caixa" },
  { key: "dre", label: "DRE" },
] as const;

export type NetworkTab = (typeof NETWORK_TABS)[number]["key"];

/** Endereço com aba desconhecida (ou sem aba) abre a Visão geral. */
export function parseNetworkTab(v: string | undefined | null): NetworkTab {
  return NETWORK_TABS.some((t) => t.key === v) ? (v as NetworkTab) : "visao";
}

/**
 * O MÊS ESCOLHIDO, como período. Ano ou mês fora do lugar viram o mês de
 * `hoje` — endereço digitado à mão não pode virar uma consulta de 13/2026.
 */
export function periodoDoMes(
  ano: number,
  mes: number,
  hoje: string
): { ano: number; mes: number; de: string; ate: string } {
  const ok =
    Number.isInteger(ano) &&
    ano >= 2000 &&
    ano <= 2100 &&
    Number.isInteger(mes) &&
    mes >= 1 &&
    mes <= 12;
  const a = ok ? ano : Number(hoje.slice(0, 4));
  const m = ok ? mes : Number(hoje.slice(5, 7));
  const { from, to } = monthRangeOf(`${a}-${String(m).padStart(2, "0")}-01`);
  return { ano: a, mes: m, de: from, ate: to };
}

const RANK: Record<Farol, number> = {
  vermelho: 0,
  amarelo: 1,
  verde: 2,
  sem_dado: 3,
};

export type ContagemDeFarol = Record<Farol, number>;

function contarFarois(fs: Farol[]): ContagemDeFarol {
  const out: ContagemDeFarol = { vermelho: 0, amarelo: 0, verde: 0, sem_dado: 0 };
  for (const f of fs) out[f] += 1;
  return out;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------
// CONTAS A PAGAR
// ---------------------------------------------------------------------------

export type UnidadePagar = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  /** Ainda a pagar hoje (inclui o que espera autorização). */
  aPagarCents: number;
  vencidoCents: number;
  vencidoQuantidade: number;
  aAutorizarQuantidade: number;
  aAutorizarCents: number;
  /** Em aberto que vence dentro do mês escolhido (e ainda não venceu). */
  venceNoMesCents: number;
  /** Pago no mês escolhido (com multa e juros que a unidade pagou). */
  pagoNoMesCents: number;
};

/**
 * ⚠️ VERMELHO É CONTA VENCIDA — é o que já está custando multa e crédito com
 * o fornecedor. Esperando autorização é AMARELO: ainda não atrasou, mas não
 * anda sem alguém decidir. Sem nenhuma conta nem pagamento é "sem dado", nunca
 * verde: unidade que não lança nada não está em dia, está calada.
 */
export function farolPagar(u: UnidadePagar): { farol: Farol; motivo: string } {
  if (u.vencidoCents > 0)
    return {
      farol: "vermelho",
      motivo: `${brl(u.vencidoCents)} vencidos em ${plural(u.vencidoQuantidade, "conta", "contas")}`,
    };
  if (u.aAutorizarQuantidade > 0)
    return {
      farol: "amarelo",
      motivo: `${plural(u.aAutorizarQuantidade, "conta esperando", "contas esperando")} autorização (${brl(u.aAutorizarCents)})`,
    };
  if (u.aPagarCents <= 0 && u.pagoNoMesCents <= 0)
    return { farol: "sem_dado", motivo: "Nenhuma conta a pagar nem pagamento no mês" };
  return { farol: "verde", motivo: "Nada vencido" };
}

export function porAtencaoPagar(a: UnidadePagar, b: UnidadePagar): number {
  const d = RANK[farolPagar(a).farol] - RANK[farolPagar(b).farol];
  if (d !== 0) return d;
  if (a.vencidoCents !== b.vencidoCents) return b.vencidoCents - a.vencidoCents;
  if (a.aPagarCents !== b.aPagarCents) return b.aPagarCents - a.aPagarCents;
  return a.nome.localeCompare(b.nome);
}

export type TotaisPagar = Omit<UnidadePagar, "clinicId" | "nome" | "ownership"> & {
  unidades: number;
  farois: ContagemDeFarol;
};

export function totaisPagar(us: UnidadePagar[]): TotaisPagar {
  const soma = (f: (u: UnidadePagar) => number) => us.reduce((s, u) => s + f(u), 0);
  return {
    unidades: us.length,
    aPagarCents: soma((u) => u.aPagarCents),
    vencidoCents: soma((u) => u.vencidoCents),
    vencidoQuantidade: soma((u) => u.vencidoQuantidade),
    aAutorizarQuantidade: soma((u) => u.aAutorizarQuantidade),
    aAutorizarCents: soma((u) => u.aAutorizarCents),
    venceNoMesCents: soma((u) => u.venceNoMesCents),
    pagoNoMesCents: soma((u) => u.pagoNoMesCents),
    farois: contarFarois(us.map((u) => farolPagar(u).farol)),
  };
}

// ---------------------------------------------------------------------------
// RECEBÍVEIS
// ---------------------------------------------------------------------------

export type UnidadeReceber = UnidadeRecebivel & {
  /** Recebido no mês escolhido (estornos fora, como na tela da unidade). */
  recebidoNoMesCents: number;
};

/**
 * Mesma régua dos Recebíveis da rede (OC-00005): passar do TETO da unidade é
 * vermelho; ter vencido dentro do teto é amarelo. Nada a receber é "sem dado"
 * — 0% se leria como "em dia", quando a verdade é "não há o que medir".
 */
export function farolReceber(u: UnidadeReceber): { farol: Farol; motivo: string } {
  if (acimaDoLimite(u))
    return {
      farol: "vermelho",
      motivo: `Inadimplência de ${fmtPct(u.taxaPercent)} acima do limite de ${fmtPct(u.limitePercent)} (${brl(u.vencidoCents)} vencidos)`,
    };
  if (u.vencidoCents > 0)
    return {
      farol: "amarelo",
      motivo: `${brl(u.vencidoCents)} vencidos (${fmtPct(u.taxaPercent)} do que há a receber)`,
    };
  if (u.taxaPercent === null) return { farol: "sem_dado", motivo: "Nada a receber" };
  return { farol: "verde", motivo: "Nada vencido" };
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** A ordem é a dos Recebíveis da rede — uma régua só para a mesma pergunta. */
export const porAtencaoReceber: (a: UnidadeReceber, b: UnidadeReceber) => number =
  porAtencao;

export type TotaisReceber = {
  unidades: number;
  abertoCents: number;
  vencidoCents: number;
  taxaPercent: number | null;
  recebidoNoMesCents: number;
  farois: ContagemDeFarol;
};

export function totaisReceber(us: UnidadeReceber[]): TotaisReceber {
  return {
    unidades: us.length,
    abertoCents: us.reduce((s, u) => s + u.abertoCents, 0),
    vencidoCents: us.reduce((s, u) => s + u.vencidoCents, 0),
    taxaPercent: taxaDaRede(us),
    recebidoNoMesCents: us.reduce((s, u) => s + u.recebidoNoMesCents, 0),
    farois: contarFarois(us.map((u) => farolReceber(u).farol)),
  };
}

// ---------------------------------------------------------------------------
// FLUXO DE CAIXA
// ---------------------------------------------------------------------------

export type UnidadeCaixa = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  saldoInicialCents: number;
  entradasCents: number;
  saidasCents: number;
  saldoFinalCents: number;
  /** Primeiro dia do mês em que o saldo fica negativo (série diária). */
  primeiroNegativo: { dia: string; saldoCents: number } | null;
  /** A leitura desta unidade falhou: a linha avisa em vez de mostrar zero. */
  falhou?: boolean;
};

/**
 * Monta a linha da unidade a partir da série DIÁRIA do mês — a mesma que a
 * tela da unidade usa para o aviso. Agrupado por mês, um buraco no dia 8
 * coberto por um recebimento no dia 25 desapareceria.
 */
export function linhaDeCaixa(
  base: Pick<UnidadeCaixa, "clinicId" | "nome" | "ownership">,
  diario: CashPeriod[],
  saldoInicialCents: number
): UnidadeCaixa {
  const neg = firstNegative(diario);
  const entradas = diario.reduce((s, p) => s + p.inflowCents, 0);
  const saidas = diario.reduce((s, p) => s + p.outflowCents, 0);
  return {
    ...base,
    saldoInicialCents,
    entradasCents: entradas,
    saidasCents: saidas,
    saldoFinalCents: diario.length
      ? diario[diario.length - 1].balanceCents
      : saldoInicialCents,
    primeiroNegativo: neg ? { dia: neg.start, saldoCents: neg.balanceCents } : null,
  };
}

/**
 * ⚠️ VERMELHO É O SALDO FICAR NEGATIVO EM ALGUM DIA DO MÊS — é o cheque que
 * volta, mesmo que o mês termine no azul. Sair mais do que entra, com o saldo
 * aguentando, é amarelo: ainda há colchão, mas ele está sendo gasto.
 */
export function farolCaixa(u: UnidadeCaixa): { farol: Farol; motivo: string } {
  if (u.falhou)
    return { farol: "sem_dado", motivo: "Não foi possível ler o caixa desta unidade" };
  if (u.primeiroNegativo)
    return {
      farol: "vermelho",
      motivo: `Saldo fica negativo em ${dataCurta(u.primeiroNegativo.dia)} (${brl(u.primeiroNegativo.saldoCents)})`,
    };
  const liquido = u.entradasCents - u.saidasCents;
  if (u.entradasCents === 0 && u.saidasCents === 0 && u.saldoInicialCents === 0)
    return { farol: "sem_dado", motivo: "Nenhum movimento no mês" };
  if (liquido < 0)
    return {
      farol: "amarelo",
      motivo: `Sai mais do que entra no mês (${brl(liquido)}), o saldo aguenta`,
    };
  return { farol: "verde", motivo: "Saldo positivo o mês inteiro" };
}

export function porAtencaoCaixa(a: UnidadeCaixa, b: UnidadeCaixa): number {
  const d = RANK[farolCaixa(a).farol] - RANK[farolCaixa(b).farol];
  if (d !== 0) return d;
  // Dentro do vermelho, quem fica negativo PRIMEIRO vem antes: é o prazo que
  // sobra para agir. Depois, o pior saldo final.
  if (a.primeiroNegativo && b.primeiroNegativo) {
    const c = a.primeiroNegativo.dia.localeCompare(b.primeiroNegativo.dia);
    if (c !== 0) return c;
  }
  if (a.saldoFinalCents !== b.saldoFinalCents) return a.saldoFinalCents - b.saldoFinalCents;
  return a.nome.localeCompare(b.nome);
}

export type TotaisCaixa = {
  unidades: number;
  saldoInicialCents: number;
  entradasCents: number;
  saidasCents: number;
  saldoFinalCents: number;
  /** Quantas ficam negativas em algum dia do mês. */
  negativas: number;
  farois: ContagemDeFarol;
};

/**
 * ⚠️ O TOTAL DA REDE NÃO É UM CAIXA. Somar o saldo de unidades diferentes dá
 * um número que nenhuma conta bancária tem — unidade com sobra não cobre a
 * outra. Por isso o total conta QUANTAS ficam negativas; a soma do saldo
 * aparece só como referência.
 */
export function totaisCaixa(us: UnidadeCaixa[]): TotaisCaixa {
  const ok = us.filter((u) => !u.falhou);
  return {
    unidades: us.length,
    saldoInicialCents: ok.reduce((s, u) => s + u.saldoInicialCents, 0),
    entradasCents: ok.reduce((s, u) => s + u.entradasCents, 0),
    saidasCents: ok.reduce((s, u) => s + u.saidasCents, 0),
    saldoFinalCents: ok.reduce((s, u) => s + u.saldoFinalCents, 0),
    negativas: ok.filter((u) => u.primeiroNegativo).length,
    farois: contarFarois(us.map((u) => farolCaixa(u).farol)),
  };
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

export type UnidadeDre = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  receitaBrutaCents: number;
  receitaLiquidaCents: number;
  resultadoCents: number;
};

/** A faixa em volta da média que ainda conta como "na média" (pontos percentuais). */
export const FAIXA_DA_MEDIA_PP = 2;

/** Margem = resultado ÷ receita líquida. `null` sem receita (não há o que dividir). */
export function margem(u: Pick<UnidadeDre, "receitaLiquidaCents" | "resultadoCents">): number | null {
  if (u.receitaLiquidaCents <= 0) return null;
  return u.resultadoCents / u.receitaLiquidaCents;
}

/**
 * A MARGEM DA REDE — soma em cima, soma embaixo, como a taxa dos Recebíveis
 * da rede. A média simples das margens daria o mesmo peso a uma unidade que
 * faturou R$ 5 mil e a outra que faturou R$ 500 mil, e a régua de "puxa para
 * baixo" passaria a medir a unidade pequena.
 */
export function margemDaRede(us: UnidadeDre[]): number | null {
  const receita = us.reduce((s, u) => s + u.receitaLiquidaCents, 0);
  if (receita <= 0) return null;
  return us.reduce((s, u) => s + u.resultadoCents, 0) / receita;
}

/** Diferença da margem da unidade para a da rede, em pontos percentuais. */
export function distanciaDaMedia(u: UnidadeDre, mediaDaRede: number | null): number | null {
  const m = margem(u);
  if (m === null || mediaDaRede === null) return null;
  return Math.round((m - mediaDaRede) * 1000) / 10;
}

/**
 * K3 (dono, 22/10/2026): A COR DO DRE É A MARGEM CONTRA A MÉDIA DA REDE, e não
 * o valor — em R$ a unidade grande sempre "puxaria para cima" e a pequena
 * sempre "para baixo", e a cor mediria tamanho, não desempenho.
 *
 * Prejuízo é vermelho sempre (inclusive sem receita). Abaixo da média além da
 * faixa é amarelo ("puxa para baixo"); dentro dela ou acima, verde.
 */
export function farolDre(
  u: UnidadeDre,
  mediaDaRede: number | null
): { farol: Farol; motivo: string } {
  const m = margem(u);
  if (u.resultadoCents < 0)
    return {
      farol: "vermelho",
      motivo:
        m === null
          ? `Prejuízo de ${brl(-u.resultadoCents)} sem receita no mês`
          : `Prejuízo de ${brl(-u.resultadoCents)} (margem de ${fmtMargem(m)})`,
    };
  if (m === null) return { farol: "sem_dado", motivo: "Sem receita no mês" };
  const d = distanciaDaMedia(u, mediaDaRede);
  if (d === null) return { farol: "verde", motivo: `Margem de ${fmtMargem(m)}` };
  if (d < -FAIXA_DA_MEDIA_PP)
    return {
      farol: "amarelo",
      motivo: `Puxa a rede para baixo: margem de ${fmtMargem(m)}, ${fmtPp(d)} da média`,
    };
  if (d > FAIXA_DA_MEDIA_PP)
    return {
      farol: "verde",
      motivo: `Puxa a rede para cima: margem de ${fmtMargem(m)}, ${fmtPp(d)} da média`,
    };
  return { farol: "verde", motivo: `Na média da rede (margem de ${fmtMargem(m)})` };
}

export function fmtMargem(m: number | null): string {
  if (m === null) return "—";
  return `${(m * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function fmtPp(d: number | null): string {
  if (d === null) return "—";
  const v = Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${v} p.p.`;
}

/**
 * OC-00122 — QUANTO A UNIDADE REPRESENTA DA REDE, na coluna principal de cada
 * aba. `null` quando a rede não tem nada naquela coluna (0% de nada não é
 * informação) ou quando o valor é negativo (resultado negativo não é "parte"
 * de nada — no DRE quem compara é a margem).
 */
export function participacao(valorCents: number, totalCents: number): number | null {
  if (totalCents <= 0 || valorCents < 0) return null;
  return valorCents / totalCents;
}

export function fmtParticipacao(p: number | null): string {
  if (p === null) return "";
  if (p > 0 && p < 0.005) return "<1% da rede";
  return `${Math.round(p * 100)}% da rede`;
}

export function porAtencaoDre(mediaDaRede: number | null) {
  return (a: UnidadeDre, b: UnidadeDre): number => {
    const d = RANK[farolDre(a, mediaDaRede).farol] - RANK[farolDre(b, mediaDaRede).farol];
    if (d !== 0) return d;
    // Dentro da mesma cor, a pior margem primeiro (sem receita vai por último).
    const ma = margem(a);
    const mb = margem(b);
    if (ma !== null && mb !== null && ma !== mb) return ma - mb;
    if (ma === null && mb !== null) return 1;
    if (mb === null && ma !== null) return -1;
    if (a.resultadoCents !== b.resultadoCents) return a.resultadoCents - b.resultadoCents;
    return a.nome.localeCompare(b.nome);
  };
}

export type TotaisDre = {
  unidades: number;
  receitaBrutaCents: number;
  receitaLiquidaCents: number;
  resultadoCents: number;
  margem: number | null;
  farois: ContagemDeFarol;
};

export function totaisDre(us: UnidadeDre[]): TotaisDre {
  const media = margemDaRede(us);
  return {
    unidades: us.length,
    receitaBrutaCents: us.reduce((s, u) => s + u.receitaBrutaCents, 0),
    receitaLiquidaCents: us.reduce((s, u) => s + u.receitaLiquidaCents, 0),
    resultadoCents: us.reduce((s, u) => s + u.resultadoCents, 0),
    margem: media,
    farois: contarFarois(us.map((u) => farolDre(u, media).farol)),
  };
}

// ---------------------------------------------------------------------------
// ABRIR NA UNIDADE (K2) — para onde cada aba leva, e o caminho de volta
// ---------------------------------------------------------------------------

export const ORIGENS_DA_REDE = ["painel", "recebiveis-da-rede", "consolidado"] as const;
export type OrigemDaRede = (typeof ORIGENS_DA_REDE)[number];

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O relatório da unidade sobre o MESMO assunto e o MESMO período da aba.
 * Lista fechada: o destino nunca vem montado do navegador.
 */
export function destinoNaUnidade(aba: NetworkTab, de: string, ate: string): string {
  const periodo = DATA.test(de) && DATA.test(ate) ? `?de=${de}&ate=${ate}` : "";
  switch (aba) {
    case "pagar":
      return "/financeiro/contas-a-pagar";
    // ⚠️ SEM período: lá `de`/`ate` filtram a lista pelo VENCIMENTO, e
    // levar o mês escondia o que venceu antes dele — justamente o atrasado.
    case "receber":
      return "/financeiro/recebiveis";
    case "caixa":
      return `/financeiro/fluxo-de-caixa${periodo}`;
    case "dre":
      return `/financeiro/dre${periodo}`;
    case "visao":
      return "/financeiro";
  }
}

/** Para onde o "voltar para a rede" leva, de volta à mesma aba e ao mesmo período. */
export function voltaParaRede(
  origem: OrigemDaRede,
  aba: NetworkTab,
  de: string,
  ate: string
): string {
  const datas = DATA.test(de) && DATA.test(ate);
  switch (origem) {
    case "recebiveis-da-rede":
      return "/financeiro/recebiveis-da-rede";
    case "consolidado":
      return datas ? `/financeiro/consolidado?de=${de}&ate=${ate}` : "/financeiro/consolidado";
    case "painel": {
      const q = new URLSearchParams({ aba });
      if (datas) {
        q.set("ano", String(Number(de.slice(0, 4))));
        q.set("mes", String(Number(de.slice(5, 7))));
      }
      return `/financeiro/painel-da-rede?${q}`;
    }
  }
}

/**
 * A marca "vim da rede", guardada num cookie: `unidade|origem|aba|de|ate|rede`.
 * `rede` é a franqueadora de onde se saiu — pode haver mais de uma (o treino
 * tem duas), e voltar para "a primeira da lista" levaria para a errada.
 * Lida de volta com desconfiança — qualquer pedaço fora do lugar e a marca não
 * vale (a faixa simplesmente não aparece).
 */
export const MARCA_DA_REDE_COOKIE = "risarte_veio_da_rede";

export type MarcaDaRede = {
  clinicId: string;
  /** A franqueadora em que a pessoa estava ao abrir a unidade. */
  redeId: string;
  origem: OrigemDaRede;
  aba: NetworkTab;
  de: string;
  ate: string;
};

export function escreverMarca(m: MarcaDaRede): string {
  return [m.clinicId, m.origem, m.aba, m.de, m.ate, m.redeId].join("|");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerMarca(v: string | undefined | null): MarcaDaRede | null {
  if (!v) return null;
  const [clinicId, origem, aba, de, ate, redeId] = v.split("|");
  if (!UUID.test(clinicId ?? "") || !UUID.test(redeId ?? "")) return null;
  if (!ORIGENS_DA_REDE.includes(origem as OrigemDaRede)) return null;
  if (!NETWORK_TABS.some((t) => t.key === aba)) return null;
  if (!DATA.test(de ?? "") || !DATA.test(ate ?? "")) return null;
  return { clinicId, redeId, origem: origem as OrigemDaRede, aba: aba as NetworkTab, de, ate };
}
