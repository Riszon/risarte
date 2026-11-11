// Repasse, Etapa 5 (0401) — AS VISÕES.
//
// A conta de cada linha mora no banco (`_payout_lines`): produção, repasse,
// desconto, pago, programado, esperando. Aqui ficam os tipos, as somas por mês
// e por dentista, o período pedido no endereço e a planilha — puro e testado.

import { formatIsoMonthBr } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import type { RelatorioPronto } from "./relatorio";

/** Uma linha do histórico: um dentista num mês, numa unidade. */
export type HistoryRow = {
  /** AAAA-MM-01 */
  month: string;
  providerId: string;
  providerName: string;
  levelName: string | null;
  procedures: number;
  producedCents: number;
  /** Procedimentos de plano sem preço para ler (a produção fica a menos). */
  producedMissing: number;
  /** Manutenções de Ortodontia: repasse sem produção (não se aplica). */
  orthoCount: number;
  payoutCents: number;
  /** Negativo: desconto por falha do dentista. */
  discountCents: number;
  paidCents: number;
  scheduledCents: number;
  waitingCents: number;
};

export type HistoryRowDb = {
  month: string;
  provider_id: string;
  provider_name: string | null;
  level_name: string | null;
  procedures: number | null;
  produced_cents: number | string | null;
  produced_missing: number | null;
  ortho_count: number | null;
  payout_cents: number | string | null;
  discount_cents: number | string | null;
  paid_cents: number | string | null;
  scheduled_cents: number | string | null;
  waiting_cents: number | string | null;
};

const num = (v: number | string | null | undefined) => Number(v ?? 0);
/** "2026-11-01T00:00:00…" ou "2026-11-01" → "2026-11-01". */
const dia = (v: string) => String(v).slice(0, 10);

export function historyFromDb(r: HistoryRowDb): HistoryRow {
  return {
    month: dia(r.month),
    providerId: r.provider_id,
    providerName: r.provider_name ?? "—",
    levelName: r.level_name,
    procedures: num(r.procedures),
    producedCents: num(r.produced_cents),
    producedMissing: num(r.produced_missing),
    orthoCount: num(r.ortho_count),
    payoutCents: num(r.payout_cents),
    discountCents: num(r.discount_cents),
    paidCents: num(r.paid_cents),
    scheduledCents: num(r.scheduled_cents),
    waitingCents: num(r.waiting_cents),
  };
}

export type Totais = Omit<HistoryRow, "month" | "providerId" | "providerName" | "levelName">;

const ZERO: Totais = {
  procedures: 0,
  producedCents: 0,
  producedMissing: 0,
  orthoCount: 0,
  payoutCents: 0,
  discountCents: 0,
  paidCents: 0,
  scheduledCents: 0,
  waitingCents: 0,
};

export function somar(rows: Totais[]): Totais {
  const t = { ...ZERO };
  for (const r of rows) {
    for (const k of Object.keys(ZERO) as (keyof Totais)[]) t[k] += r[k];
  }
  return t;
}

/** Líquido = repasse + desconto (o desconto é negativo). */
export const liquido = (t: Totais) => t.payoutCents + t.discountCents;

/**
 * Quanto o repasse representa da produção, em %. `null` quando não há
 * produção para comparar (Ortodontia só, ou sem preço).
 */
export function percentualDoRepasse(t: Pick<Totais, "producedCents" | "payoutCents">): number | null {
  if (t.producedCents <= 0) return null;
  return Math.round((t.payoutCents / t.producedCents) * 1000) / 10;
}

export function textoDoPercentual(p: number | null): string {
  return p === null ? "—" : `${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Os meses de `de` a `ate` (AAAA-MM), em ordem, como AAAA-MM-01. */
export function mesesDoPeriodo(de: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = de.split("-").map(Number);
  const [af, mf] = ate.split("-").map(Number);
  let guarda = 0;
  while ((a < af || (a === af && m <= mf)) && guarda < 60) {
    out.push(`${a}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    guarda += 1;
  }
  return out;
}

/** Os totais de cada mês do período — mês sem nada aparece zerado. */
export function porMes(rows: HistoryRow[], meses: string[]): { month: string; t: Totais }[] {
  return meses.map((month) => ({ month, t: somar(rows.filter((r) => r.month === month)) }));
}

/** Os totais de cada dentista no período, em ordem de NOME (sem ranking). */
export function porDentista(
  rows: HistoryRow[]
): { providerId: string; providerName: string; levelName: string | null; t: Totais }[] {
  const ids = [...new Set(rows.map((r) => r.providerId))];
  return ids
    .map((id) => {
      const dele = rows.filter((r) => r.providerId === id);
      return {
        providerId: id,
        providerName: dele[0].providerName,
        levelName: dele[dele.length - 1].levelName,
        t: somar(dele),
      };
    })
    .sort((a, b) => a.providerName.localeCompare(b.providerName, "pt-BR"));
}

/**
 * O período do endereço (`de`/`ate` em AAAA-MM). Sem ele, ou fora do lugar:
 * os últimos 12 meses até o mês de hoje. Nunca mais de 36 meses (o banco
 * também recusa), nunca no futuro.
 */
export function periodoDoEndereco(
  de: string | undefined,
  ate: string | undefined,
  hoje: string
): { de: string; ate: string } {
  const mesHoje = hoje.slice(0, 7);
  const valido = (v: string | undefined) => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v <= mesHoje;
  const fim = valido(ate) ? (ate as string) : mesHoje;
  const padrao = mesesDoPeriodo(subtrairMeses(fim, 11), fim)[0].slice(0, 7);
  let ini = valido(de) && (de as string) <= fim ? (de as string) : padrao;
  if (mesesDoPeriodo(ini, fim).length > 36) ini = subtrairMeses(fim, 35);
  return { de: ini, ate: fim };
}

export function subtrairMeses(mes: string, n: number): string {
  let [a, m] = mes.split("-").map(Number);
  m -= n;
  while (m < 1) {
    m += 12;
    a -= 1;
  }
  return `${a}-${String(m).padStart(2, "0")}`;
}

/** O último dia do mês AAAA-MM, como data (para o `p_to` do banco). */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(ultimo).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// A rede (Franqueadora)
// -----------------------------------------------------------------------------
export type NetworkPayoutRow = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  dentists: number;
  procedures: number;
  producedCents: number;
  payoutCents: number;
  discountCents: number;
  paidCents: number;
  scheduledCents: number;
  waitingCents: number;
  overdueCents: number;
  openFailures: number;
  reportsInReview: number;
};

export type NetworkPayoutRowDb = {
  clinic_id: string;
  clinic_name: string;
  ownership: string | null;
  dentists: number | null;
  procedures: number | null;
  produced_cents: number | string | null;
  payout_cents: number | string | null;
  discount_cents: number | string | null;
  paid_cents: number | string | null;
  scheduled_cents: number | string | null;
  waiting_cents: number | string | null;
  overdue_cents: number | string | null;
  open_failures: number | null;
  reports_in_review: number | null;
};

export function networkFromDb(r: NetworkPayoutRowDb): NetworkPayoutRow {
  return {
    clinicId: r.clinic_id,
    nome: r.clinic_name,
    ownership: r.ownership === "own" ? "own" : "franchised",
    dentists: num(r.dentists),
    procedures: num(r.procedures),
    producedCents: num(r.produced_cents),
    payoutCents: num(r.payout_cents),
    discountCents: num(r.discount_cents),
    paidCents: num(r.paid_cents),
    scheduledCents: num(r.scheduled_cents),
    waitingCents: num(r.waiting_cents),
    overdueCents: num(r.overdue_cents),
    openFailures: num(r.open_failures),
    reportsInReview: num(r.reports_in_review),
  };
}

export type FarolRepasse = "vermelho" | "amarelo" | "verde" | "sem_dado";

/**
 * A cor da unidade e a frase: conta do repasse VENCIDA sem pagar é vermelho;
 * ocorrência de falha esperando decisão ou relatório parado na aprovação é
 * amarelo; o resto verde; sem repasse no mês, sem dado.
 */
export function farolRepasse(u: NetworkPayoutRow): { farol: FarolRepasse; motivo: string } {
  if (u.overdueCents > 0) {
    return { farol: "vermelho", motivo: `${formatBRL(u.overdueCents)} de repasse vencido sem pagar` };
  }
  if (u.openFailures > 0 || u.reportsInReview > 0) {
    const partes: string[] = [];
    if (u.reportsInReview > 0) {
      partes.push(`${u.reportsInReview} relatório${u.reportsInReview === 1 ? "" : "s"} em aprovação`);
    }
    if (u.openFailures > 0) {
      partes.push(`${u.openFailures} ocorrência${u.openFailures === 1 ? "" : "s"} de falha sem decisão`);
    }
    return { farol: "amarelo", motivo: partes.join(" · ") };
  }
  if (u.payoutCents === 0 && u.discountCents === 0) return { farol: "sem_dado", motivo: "sem repasse no período" };
  return { farol: "verde", motivo: "em dia" };
}

export function totaisDaRede(us: NetworkPayoutRow[]): NetworkPayoutRow {
  const t: NetworkPayoutRow = {
    clinicId: "rede",
    nome: "Rede",
    ownership: "own",
    dentists: 0,
    procedures: 0,
    producedCents: 0,
    payoutCents: 0,
    discountCents: 0,
    paidCents: 0,
    scheduledCents: 0,
    waitingCents: 0,
    overdueCents: 0,
    openFailures: 0,
    reportsInReview: 0,
  };
  for (const u of us) {
    for (const k of Object.keys(t) as (keyof NetworkPayoutRow)[]) {
      if (typeof t[k] === "number") (t[k] as number) += u[k] as number;
    }
  }
  return t;
}

/** Na ordem de atenção: vermelho, amarelo, verde, sem dado; depois o nome. */
export function porAtencaoRepasse(a: NetworkPayoutRow, b: NetworkPayoutRow): number {
  const ordem: Record<FarolRepasse, number> = { vermelho: 0, amarelo: 1, verde: 2, sem_dado: 3 };
  const d = ordem[farolRepasse(a).farol] - ordem[farolRepasse(b).farol];
  return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
}

// -----------------------------------------------------------------------------
// O dentista (Meus repasses): o próprio repasse, sem produção
// -----------------------------------------------------------------------------
export type MyEvolutionRow = {
  month: string;
  clinicId: string;
  clinicName: string;
  procedures: number;
  payoutCents: number;
  discountCents: number;
  paidCents: number;
};

export type MyEvolutionRowDb = {
  month: string;
  clinic_id: string;
  clinic_name: string;
  procedures: number | null;
  payout_cents: number | string | null;
  discount_cents: number | string | null;
  paid_cents: number | string | null;
};

export function myEvolutionFromDb(r: MyEvolutionRowDb): MyEvolutionRow {
  return {
    month: dia(r.month),
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    procedures: num(r.procedures),
    payoutCents: num(r.payout_cents),
    discountCents: num(r.discount_cents),
    paidCents: num(r.paid_cents),
  };
}

// -----------------------------------------------------------------------------
// As planilhas (V6) — o mesmo modelo de relatório das outras planilhas
// -----------------------------------------------------------------------------
export function relatorioDoHistorico(args: {
  unidade: string;
  de: string;
  ate: string;
  rows: HistoryRow[];
  geradoPor: string;
  geradoEm: string;
}): RelatorioPronto {
  const t = somar(args.rows);
  return {
    titulo: "Histórico de repasse",
    subtitulo: args.unidade,
    metadados: [
      { rotulo: "Unidade", valor: args.unidade },
      { rotulo: "Período", valor: `${formatIsoMonthBr(`${args.de}-01`)} a ${formatIsoMonthBr(`${args.ate}-01`)}` },
      { rotulo: "Gerado por", valor: args.geradoPor },
      { rotulo: "Gerado em", valor: args.geradoEm },
    ],
    resumo: [
      { rotulo: "Produção", valor: formatBRL(t.producedCents) },
      { rotulo: "Repasse", valor: formatBRL(t.payoutCents) },
      { rotulo: "Descontos", valor: formatBRL(t.discountCents) },
      { rotulo: "Pago", valor: formatBRL(t.paidCents) },
    ],
    situacao: null,
    colunas: [
      { chave: "mes", titulo: "Mês", tipo: "texto", largura: 12 },
      { chave: "dentista", titulo: "Dentista", tipo: "texto", largura: 28 },
      { chave: "nivel", titulo: "Nível", tipo: "texto", largura: 14 },
      { chave: "procedimentos", titulo: "Procedimentos", tipo: "numero", somar: true, largura: 14 },
      { chave: "producao", titulo: "Produção", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "repasse", titulo: "Repasse", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "descontos", titulo: "Descontos", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "liquido", titulo: "Líquido", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "pago", titulo: "Pago", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "programado", titulo: "Programado", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "esperando", titulo: "Esperando", tipo: "dinheiro", somar: true, largura: 14 },
    ],
    linhas: args.rows.map((r) => ({
      mes: formatIsoMonthBr(r.month),
      dentista: r.providerName,
      nivel: r.levelName,
      procedimentos: r.procedures,
      producao: r.producedCents,
      repasse: r.payoutCents,
      descontos: r.discountCents,
      liquido: liquido(r),
      pago: r.paidCents,
      programado: r.scheduledCents,
      esperando: r.waitingCents,
    })),
    notas: [
      "Mês = mês em que o procedimento foi finalizado (competência); o desconto entra no mês em que a falha foi decidida.",
      "Produção = valor vendido do procedimento (preço do plano com o desconto da negociação; na venda direta, o valor final). Ortodontia: não se aplica.",
      "Repasse em \"não pagar\" e \"sem repasse\" fica de fora.",
    ],
    nomeDoArquivo: `historico-de-repasse-${args.de}-a-${args.ate}`,
  };
}

export function relatorioDaRede(args: {
  de: string;
  ate: string;
  unidades: NetworkPayoutRow[];
  geradoPor: string;
  geradoEm: string;
}): RelatorioPronto {
  const t = totaisDaRede(args.unidades);
  return {
    titulo: "Repasse da rede",
    subtitulo: null,
    metadados: [
      { rotulo: "Período", valor: `${formatIsoMonthBr(`${args.de}-01`)} a ${formatIsoMonthBr(`${args.ate}-01`)}` },
      { rotulo: "Gerado por", valor: args.geradoPor },
      { rotulo: "Gerado em", valor: args.geradoEm },
    ],
    resumo: [
      { rotulo: "Repasse", valor: formatBRL(t.payoutCents) },
      { rotulo: "Descontos", valor: formatBRL(t.discountCents) },
      { rotulo: "Pago", valor: formatBRL(t.paidCents) },
      { rotulo: "Vencido sem pagar", valor: formatBRL(t.overdueCents) },
    ],
    situacao: null,
    colunas: [
      { chave: "unidade", titulo: "Unidade", tipo: "texto", largura: 26 },
      { chave: "dentistas", titulo: "Dentistas", tipo: "numero", largura: 10 },
      { chave: "procedimentos", titulo: "Procedimentos", tipo: "numero", somar: true, largura: 14 },
      { chave: "producao", titulo: "Produção", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "repasse", titulo: "Repasse", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "descontos", titulo: "Descontos", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "pago", titulo: "Pago", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "programado", titulo: "Programado", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "esperando", titulo: "Esperando", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "vencido", titulo: "Vencido", tipo: "dinheiro", somar: true, largura: 14 },
    ],
    linhas: args.unidades.map((u) => ({
      unidade: u.nome,
      dentistas: u.dentists,
      procedimentos: u.procedures,
      producao: u.producedCents,
      repasse: u.payoutCents,
      descontos: u.discountCents,
      pago: u.paidCents,
      programado: u.scheduledCents,
      esperando: u.waitingCents,
      vencido: u.overdueCents,
    })),
    notas: [
      "Mês = mês em que o procedimento foi finalizado (competência).",
      "Vencido = repasse em conta a pagar com vencimento passado e ainda não pago.",
    ],
    nomeDoArquivo: `repasse-da-rede-${args.de}-a-${args.ate}`,
  };
}
