// ASA2, entrega 2 (4006) — O PAINEL DE COBRANÇAS (spec 16.8.1 e 17.2).
//
// Puro e testado: nada de banco, nada de React. A página e a planilha leem
// daqui. As linhas vêm de `gateway_receivables_due` ("A receber do Asaas") e
// `gateway_charges_list` ("Cobranças emitidas"), que já decidem quem vê o quê.
import { ROTULO_DA_SITUACAO, type SituacaoDaCobranca } from "@/lib/cobrancas";
import type { ColunaDoRelatorio, RelatorioPronto } from "@/lib/finance/relatorio";

export type LinhaAReceber = {
  charge_id: string;
  clinic_id: string;
  clinic_name: string;
  client_id: string | null;
  client_name: string | null;
  billing_type: string;
  paid_on: string | null;
  credit_date: string | null;
  paid_cents: number | null;
  fee_cents: number | null;
  net_cents: number | null;
};

export type LinhaEmitida = {
  charge_id: string;
  clinic_id: string;
  clinic_name: string;
  client_id: string | null;
  client_name: string | null;
  installment_seq: number | null;
  billing_type: string;
  status: string;
  is_overdue_reissue: boolean;
  issued_at: string | null;
  due_date: string | null;
  value_cents: number | null;
  paid_cents: number | null;
  paid_on: string | null;
  credit_date: string | null;
  fee_cents: number | null;
  net_cents: number | null;
  invoice_url: string | null;
};

/** Os meios na ordem da tela. Cartão parcelado, recorrente e Pix Automático chegam nas fases seguintes. */
export const MEIOS_DO_PAINEL: { valor: string; rotulo: string; aPartirDe?: string }[] = [
  { valor: "BOLETO", rotulo: "Boleto" },
  { valor: "PIX", rotulo: "Pix" },
  { valor: "CREDIT_CARD", rotulo: "Cartão à vista" },
  { valor: "CREDIT_CARD_INSTALLMENT", rotulo: "Cartão parcelado", aPartirDe: "ASA4" },
  { valor: "CREDIT_CARD_RECURRING", rotulo: "Cartão recorrente", aPartirDe: "fase do recorrente" },
  { valor: "PIX_AUTOMATIC", rotulo: "Pix Automático", aPartirDe: "fase do Pix Automático" },
];

export function rotuloDoMeio(valor: string): string {
  return MEIOS_DO_PAINEL.find((m) => m.valor === valor)?.rotulo ?? valor;
}

export function rotuloDaSituacao(valor: string): string {
  return ROTULO_DA_SITUACAO[valor as SituacaoDaCobranca] ?? valor;
}

type Soma = { qtd: number; bruto: number; taxa: number; liquido: number };
const zero = (): Soma => ({ qtd: 0, bruto: 0, taxa: 0, liquido: 0 });

function somar(s: Soma, l: LinhaAReceber): void {
  const bruto = Number(l.paid_cents ?? 0);
  const liquido = l.net_cents == null ? bruto - Number(l.fee_cents ?? 0) : Number(l.net_cents);
  s.qtd += 1;
  s.bruto += bruto;
  s.liquido += liquido;
  s.taxa += bruto - liquido;
}

function maisDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type AgendaDoAReceber = {
  total: Soma;
  /** Até hoje (inclusive, e o que já passou da data prevista), 7, 30, 60 dias e depois. */
  faixas: { chave: string; rotulo: string; soma: Soma }[];
  porMeio: { valor: string; rotulo: string; aPartirDe?: string; soma: Soma }[];
  porDia: { data: string | null; soma: Soma }[];
  porUnidade: { clinicId: string; nome: string; soma: Soma }[];
};

/**
 * A agenda do que o Asaas ainda vai creditar. As faixas são CUMULATIVAS
 * ("nos próximos 7 dias" inclui o de hoje), como o dono pediu: hoje, próximos
 * 7, 30 e 60 dias. A data prevista que já passou conta em "hoje" — o dinheiro
 * está atrasado, não some.
 */
export function agendaDoAReceber(linhas: LinhaAReceber[], hoje: string): AgendaDoAReceber {
  const total = zero();
  const faixas = [
    { chave: "hoje", rotulo: "Hoje", limite: hoje, soma: zero() },
    { chave: "7", rotulo: "Próximos 7 dias", limite: maisDias(hoje, 7), soma: zero() },
    { chave: "30", rotulo: "Próximos 30 dias", limite: maisDias(hoje, 30), soma: zero() },
    { chave: "60", rotulo: "Próximos 60 dias", limite: maisDias(hoje, 60), soma: zero() },
  ];
  const porMeio = MEIOS_DO_PAINEL.map((m) => ({ ...m, soma: zero() }));
  const dias = new Map<string, Soma>();
  const unidades = new Map<string, { nome: string; soma: Soma }>();

  for (const l of linhas) {
    somar(total, l);
    const data = l.credit_date ? l.credit_date.slice(0, 10) : null;
    if (data) for (const f of faixas) if (data <= f.limite) somar(f.soma, l);
    const m = porMeio.find((x) => x.valor === l.billing_type);
    if (m) somar(m.soma, l);
    const chave = data ?? "";
    if (!dias.has(chave)) dias.set(chave, zero());
    somar(dias.get(chave)!, l);
    if (!unidades.has(l.clinic_id)) unidades.set(l.clinic_id, { nome: l.clinic_name, soma: zero() });
    somar(unidades.get(l.clinic_id)!.soma, l);
  }

  return {
    total,
    faixas: faixas.map(({ chave, rotulo, soma }) => ({ chave, rotulo, soma })),
    porMeio,
    porDia: [...dias.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
      .map(([data, soma]) => ({ data: data || null, soma })),
    porUnidade: [...unidades.entries()]
      .map(([clinicId, u]) => ({ clinicId, nome: u.nome, soma: u.soma }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

/** Os filtros da lista, lidos da URL. Nada inválido chega ao banco. */
export type FiltrosDaLista = {
  unidade: string | null;
  situacoes: string[] | null;
  meios: string[] | null;
  data: "emissao" | "vencimento" | "pagamento";
  de: string | null;
  ate: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerFiltros(sp: Record<string, string | string[] | undefined>): FiltrosDaLista {
  const um = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const situacao = um("situacao");
  const meio = um("meio");
  const data = um("data");
  const de = um("de");
  const ate = um("ate");
  const unidade = um("unidade");
  return {
    unidade: unidade && UUID.test(unidade) ? unidade : null,
    situacoes: situacao && situacao in ROTULO_DA_SITUACAO ? [situacao] : null,
    meios: meio && MEIOS_DO_PAINEL.some((m) => m.valor === meio) ? [meio] : null,
    data: data === "vencimento" || data === "pagamento" ? data : "emissao",
    de: de && ISO.test(de) ? de : null,
    ate: ate && ISO.test(ate) ? ate : null,
  };
}

export function argumentosDaLista(f: FiltrosDaLista, exportar: boolean) {
  return {
    p_clinic_id: f.unidade,
    p_statuses: f.situacoes,
    p_billing_types: f.meios,
    p_date_field: f.data,
    p_from: f.de,
    p_to: f.ate,
    p_export: exportar,
  };
}

const COLUNAS: ColunaDoRelatorio[] = [
  { chave: "unidade", titulo: "Unidade", tipo: "texto", largura: 22 },
  { chave: "paciente", titulo: "Paciente", tipo: "texto", largura: 30 },
  { chave: "parcela", titulo: "Parcela", tipo: "numero", largura: 8 },
  { chave: "meio", titulo: "Meio", tipo: "texto", largura: 14 },
  { chave: "situacao", titulo: "Situação", tipo: "texto", largura: 20 },
  { chave: "emitida", titulo: "Emitida em", tipo: "data", largura: 12 },
  { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 12 },
  { chave: "valor", titulo: "Valor", tipo: "dinheiro", somar: true, largura: 14 },
  { chave: "pago", titulo: "Pago", tipo: "dinheiro", somar: true, largura: 14 },
  { chave: "pagoEm", titulo: "Pago em", tipo: "data", largura: 12 },
  { chave: "taxa", titulo: "Taxa do Asaas", tipo: "dinheiro", somar: true, largura: 14 },
  { chave: "liquido", titulo: "Líquido", tipo: "dinheiro", somar: true, largura: 14 },
  { chave: "credito", titulo: "Crédito previsto/efetivo", tipo: "data", largura: 14 },
];

export function relatorioDasCobrancas(args: {
  linhas: LinhaEmitida[];
  filtros: FiltrosDaLista;
  nomeDaUnidade: string | null;
  geradoPor: string;
  agora: string;
}): RelatorioPronto {
  const { linhas, filtros } = args;
  const rotuloData = { emissao: "emissão", vencimento: "vencimento", pagamento: "pagamento" }[filtros.data];
  const periodo =
    filtros.de || filtros.ate
      ? `${filtros.de ?? "início"} a ${filtros.ate ?? "hoje"} (por ${rotuloData})`
      : "Todo o período";
  return {
    titulo: "Cobranças emitidas pelo riSZon",
    subtitulo: "Cobranças criadas direto no painel do Asaas não aparecem.",
    metadados: [
      { rotulo: "Unidade", valor: args.nomeDaUnidade ?? "Todas as que você vê" },
      { rotulo: "Período", valor: periodo },
      { rotulo: "Situação", valor: filtros.situacoes ? rotuloDaSituacao(filtros.situacoes[0]) : "Todas" },
      { rotulo: "Meio", valor: filtros.meios ? rotuloDoMeio(filtros.meios[0]) : "Todos" },
      { rotulo: "Gerado por", valor: `${args.geradoPor} em ${args.agora}` },
    ],
    resumo: [{ rotulo: "Cobranças", valor: String(linhas.length) }],
    situacao: null,
    colunas: COLUNAS,
    linhas: linhas.map((l) => ({
      unidade: l.clinic_name,
      paciente: l.client_name ?? "—",
      parcela: l.installment_seq,
      meio: rotuloDoMeio(l.billing_type),
      situacao: rotuloDaSituacao(l.status) + (l.is_overdue_reissue ? " (nova data)" : ""),
      emitida: l.issued_at ? l.issued_at.slice(0, 10) : null,
      vencimento: l.due_date,
      valor: l.value_cents == null ? null : Number(l.value_cents),
      pago: l.paid_cents == null ? null : Number(l.paid_cents),
      pagoEm: l.paid_on,
      taxa: l.fee_cents == null ? null : Number(l.fee_cents),
      liquido: l.net_cents == null ? null : Number(l.net_cents),
      credito: l.credit_date,
    })),
    notas: [
      "Só as cobranças emitidas pelo riSZon. As criadas direto no painel do Asaas não aparecem.",
      "Taxa e líquido vêm do aviso de pagamento do Asaas; ficam vazios até a cobrança ser paga.",
    ],
    nomeDoArquivo: `cobrancas-${args.agora.slice(0, 10)}`,
  };
}
