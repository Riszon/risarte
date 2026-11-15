// LEVANTAMENTO DE DÍVIDAS — FASE 6: o Painel (cards e gráficos da 3.10).
//
// Regras puras: a tela entrega as linhas da lista (já com o saldo da regra
// única do banco, `debt_positions`), os acordos e a fotografia mensal
// (`debt_month_positions`, 0407); aqui só se soma. Nada é gravado.
//
// ⚠️ O PASSADO VEM DA FOTOGRAFIA, NUNCA DE RECONSTRUÇÃO (plano 4.5): o mês
// fechado é o que estava gravado no dia 1º; o mês corrente é calculado ao vivo
// pelas linhas. Sem foto, o gráfico diz "sem histórico" — não inventa.
//
// Plano: docs/Financeiro/DIVIDAS-PLANO.md (3, 4.2, 4.3, 4.5; D17; sugestão 4).

import { faixaDeAtraso, diasEmAtraso, totaisDaLista, valorDevido, AGING_BANDS, AGING_LABELS, type AgingBand, type DebtListRow, type DebtStatus } from "./dividas";

// ------------------------------------------------------------ os filtros

export type FiltroDoPainel = {
  /** Vazio = rede consolidada. */
  devedor: string;
  /** Vazio = todas. */
  etiqueta: string;
  /** D17: tirar contestadas e judiciais dos números (padrão: entram, com subtotal). */
  semContestadas: boolean;
};

export const FILTRO_INICIAL: FiltroDoPainel = { devedor: "", etiqueta: "", semContestadas: false };

const CONTESTADAS: DebtStatus[] = ["contestada", "judicial"];

/** As dívidas que o painel conta: não baixadas, e o filtro da tela. */
export function linhasDoPainel(rows: DebtListRow[], f: FiltroDoPainel): DebtListRow[] {
  return rows.filter(
    (r) =>
      r.status !== "baixada" &&
      (!f.devedor || r.clinicId === f.devedor) &&
      (!f.etiqueta || r.tagIds.includes(f.etiqueta)) &&
      (!f.semContestadas || !CONTESTADAS.includes(r.status))
  );
}

// -------------------------------------------------------------- os cards

export type AcordoDoPainel = {
  clinicId: string;
  situacao: string;
  /** As dívidas que o acordo cobre (para o filtro de etiqueta). */
  dividas: string[];
  descontoCents: number;
  /** Parcelas em aberto: falta pagar e vencimento. */
  abertas: { faltaCents: number; vencimento: string }[];
};

export type ContaComValor = { quantidade: number; valorCents: number };

export type IndicadoresDoPainel = {
  totais: ReturnType<typeof totaisDaLista>;
  emAtraso: ContaComValor;
  inadimplentes: ContaComValor;
  negativadas: ContaComValor;
  protestadas: ContaComValor;
  judiciais: ContaComValor;
  acordos: { quantidade: number; saldoCents: number; proximos30Cents: number; quebrados: number };
  quitadoCents: number;
  /** Desconto dos acordos que valem ou foram cumpridos (o quebrado e o restabelecido não contam). */
  economiaObtidaCents: number;
  /** Sugestão 4: CNPJs com negativação, protesto ou ação judicial. */
  cnpjsComRestricao: { clinicId: string; nome: string; negativadas: number; protestadas: number; judiciais: number }[];
};

const soma = (rows: DebtListRow[]): ContaComValor => ({
  quantidade: rows.length,
  valorCents: rows.reduce((t, r) => t + valorDevido(r), 0),
});

function somarDias(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

export function indicadoresDoPainel(
  rows: DebtListRow[],
  acordos: AcordoDoPainel[],
  hoje: string
): IndicadoresDoPainel {
  // Quitada não deve nada e não entra nas contagens de restrição: já resolveu.
  const vivas = rows.filter((r) => r.status !== "quitada_pendencias" && r.status !== "quitada_encerrada");
  const ids = new Set(rows.map((r) => r.id));
  const doFiltro = acordos.filter((a) => a.dividas.some((d) => ids.has(d)));
  const valendo = doFiltro.filter((a) => a.situacao === "em_andamento" || a.situacao === "quebrado");
  const em30 = somarDias(hoje, 30);

  const porCnpj = new Map<string, IndicadoresDoPainel["cnpjsComRestricao"][number]>();
  for (const r of vivas) {
    if (!r.negativada && !r.protestada && !r.judicial) continue;
    const c = porCnpj.get(r.clinicId) ?? { clinicId: r.clinicId, nome: r.clinicName, negativadas: 0, protestadas: 0, judiciais: 0 };
    if (r.negativada) c.negativadas++;
    if (r.protestada) c.protestadas++;
    if (r.judicial) c.judiciais++;
    porCnpj.set(r.clinicId, c);
  }

  return {
    totais: totaisDaLista(vivas),
    emAtraso: soma(vivas.filter((r) => r.status === "em_atraso")),
    inadimplentes: soma(vivas.filter((r) => r.status === "inadimplente")),
    negativadas: soma(vivas.filter((r) => r.negativada)),
    protestadas: soma(vivas.filter((r) => r.protestada)),
    judiciais: soma(vivas.filter((r) => r.judicial)),
    acordos: {
      quantidade: valendo.length,
      saldoCents: valendo.reduce((t, a) => t + a.abertas.reduce((x, p) => x + p.faltaCents, 0), 0),
      proximos30Cents: valendo.reduce(
        (t, a) => t + a.abertas.filter((p) => p.vencimento <= em30).reduce((x, p) => x + p.faltaCents, 0),
        0
      ),
      quebrados: valendo.filter((a) => a.situacao === "quebrado").length,
    },
    quitadoCents: rows.reduce((t, r) => t + (r.pagoCents ?? 0), 0),
    economiaObtidaCents: doFiltro
      .filter((a) => a.situacao === "em_andamento" || a.situacao === "cumprido")
      .reduce((t, a) => t + a.descontoCents, 0),
    cnpjsComRestricao: [...porCnpj.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

// ---------------------------------------------------------- distribuições

export type Fatia = { chave: string; rotulo: string; valorCents: number; quantidade: number };

/**
 * Soma o devido por uma chave (credor, categoria, natureza, devedor), do maior
 * para o menor. Passou de `maximo`, o resto vira UMA fatia "Outros" — nunca
 * uma cor nova a mais.
 */
export function distribuicao(
  rows: DebtListRow[],
  chave: (r: DebtListRow) => string | null,
  rotulo: (k: string) => string,
  maximo = 8
): Fatia[] {
  const m = new Map<string, Fatia>();
  for (const r of rows) {
    const v = valorDevido(r);
    if (v <= 0) continue;
    const k = chave(r) ?? "";
    const f = m.get(k) ?? { chave: k, rotulo: k ? rotulo(k) : "Sem classificação", valorCents: 0, quantidade: 0 };
    f.valorCents += v;
    f.quantidade += 1;
    m.set(k, f);
  }
  const todas = [...m.values()].sort((a, b) => b.valorCents - a.valorCents || a.rotulo.localeCompare(b.rotulo));
  if (todas.length <= maximo) return todas;
  const resto = todas.slice(maximo - 1);
  return [
    ...todas.slice(0, maximo - 1),
    {
      chave: "__outros",
      rotulo: `Outros (${resto.length})`,
      valorCents: resto.reduce((t, f) => t + f.valorCents, 0),
      quantidade: resto.reduce((t, f) => t + f.quantidade, 0),
    },
  ];
}

/** Aging (4.3): pelo título mais antigo em aberto (no acordo, a parcela). */
export function aging(rows: DebtListRow[], hoje: string): { faixa: AgingBand; rotulo: string; valorCents: number; quantidade: number }[] {
  const out = AGING_BANDS.map((faixa) => ({ faixa, rotulo: AGING_LABELS[faixa], valorCents: 0, quantidade: 0 }));
  for (const r of rows) {
    const v = valorDevido(r);
    if (v <= 0) continue;
    const faixa = faixaDeAtraso(diasEmAtraso(r.vencimentoAberto ?? r.dueDate, hoje));
    if (!faixa) continue;
    const o = out.find((x) => x.faixa === faixa)!;
    o.valorCents += v;
    o.quantidade += 1;
  }
  return out;
}

// ------------------------------------------------------ a evolução mensal

/** Uma linha da fotografia mensal (`debt_month_positions`). */
export type FotoDoMes = {
  mes: string; // aaaa-mm-01
  debtId: string;
  clinicId: string;
  status: string;
  categoryId: string | null;
  tagIds: string[];
  saldoCents: number;
  pagoNoMesCents: number;
  novaNoMes: boolean;
  atualizadoCents: number | null;
};

export type PontoDoMes = {
  mes: string;
  saldoCents: number;
  /** Nulo no mês corrente: o pago do mês fecha na fotografia do dia 1º. */
  pagoCents: number | null;
  novasCents: number;
  /** Mês corrente, calculado ao vivo. */
  aoVivo: boolean;
};

export function fotosDoFiltro(fotos: FotoDoMes[], f: FiltroDoPainel): FotoDoMes[] {
  return fotos.filter(
    (x) =>
      x.status !== "baixada" &&
      (!f.devedor || x.clinicId === f.devedor) &&
      (!f.etiqueta || x.tagIds.includes(f.etiqueta)) &&
      (!f.semContestadas || (x.status !== "contestada" && x.status !== "judicial"))
  );
}

/**
 * A série mês a mês: os meses fechados vêm da fotografia; o mês corrente,
 * das linhas de agora (`rows` já filtradas). Meses sem foto no meio ficam de
 * fora (não se inventa ponto).
 */
export function evolucaoMensal(fotos: FotoDoMes[], rows: DebtListRow[], mesAtual: string): PontoDoMes[] {
  const m = new Map<string, PontoDoMes>();
  for (const x of fotos) {
    if (x.mes >= mesAtual) continue;
    const p = m.get(x.mes) ?? { mes: x.mes, saldoCents: 0, pagoCents: 0, novasCents: 0, aoVivo: false };
    p.saldoCents += x.saldoCents;
    p.pagoCents = (p.pagoCents ?? 0) + x.pagoNoMesCents;
    if (x.novaNoMes) p.novasCents += x.atualizadoCents ?? x.saldoCents;
    m.set(x.mes, p);
  }
  const passados = [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  const atual: PontoDoMes = {
    mes: mesAtual,
    saldoCents: rows.reduce((t, r) => t + valorDevido(r), 0),
    pagoCents: null,
    novasCents: rows
      .filter((r) => (r.criadaEm ?? "").slice(0, 7) === mesAtual.slice(0, 7))
      .reduce((t, r) => t + (r.updatedCents ?? r.originalCents ?? 0), 0),
    aoVivo: true,
  };
  return [...passados, atual];
}

/**
 * Evolução por categoria (a principal): as `maximo − 1` maiores de agora e
 * "Outras". Cada série guarda o saldo de cada mês da `evolucaoMensal`.
 */
export function evolucaoPorCategoria(
  fotos: FotoDoMes[],
  rows: DebtListRow[],
  mesAtual: string,
  nomeDaCategoria: (id: string) => string,
  maximo = 5
): { meses: string[]; series: { chave: string; rotulo: string; valores: number[] }[] } {
  const meses = [...new Set(fotos.filter((x) => x.mes < mesAtual).map((x) => x.mes))].sort().concat(mesAtual);
  const valor = new Map<string, Map<string, number>>(); // categoria → mês → saldo
  const somar = (cat: string, mes: string, v: number) => {
    const porMes = valor.get(cat) ?? new Map<string, number>();
    porMes.set(mes, (porMes.get(mes) ?? 0) + v);
    valor.set(cat, porMes);
  };
  for (const x of fotos) if (x.mes < mesAtual) somar(x.categoryId ?? "", x.mes, x.saldoCents);
  for (const r of rows) somar(r.categoryId ?? "", mesAtual, valorDevido(r));

  const ordem = [...valor.entries()]
    .map(([cat, porMes]) => ({ cat, agora: porMes.get(mesAtual) ?? 0, total: [...porMes.values()].reduce((a, b) => a + b, 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.agora - a.agora || b.total - a.total);
  const principais = ordem.length <= maximo ? ordem : ordem.slice(0, maximo - 1);
  const outras = ordem.length <= maximo ? [] : ordem.slice(maximo - 1);
  const series = principais.map((c) => ({
    chave: c.cat || "__sem",
    rotulo: c.cat ? nomeDaCategoria(c.cat) : "Sem categoria",
    valores: meses.map((mes) => valor.get(c.cat)?.get(mes) ?? 0),
  }));
  if (outras.length)
    series.push({
      chave: "__outras",
      rotulo: `Outras (${outras.length})`,
      valores: meses.map((mes) => outras.reduce((t, c) => t + (valor.get(c.cat)?.get(mes) ?? 0), 0)),
    });
  return { meses, series };
}
