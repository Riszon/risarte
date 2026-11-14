// ASA3, entrega 3 (4010) — REPASSES DA FRANQUIA (spec 18.8).
//
// Puro e testado: nada de banco, nada de React. A página e a planilha leem
// daqui. Os números vêm prontos de `franchise_payouts_read`, que já decide quem
// vê o quê (Admin e Financeiro da Franqueadora, a rede; Gerente e Franqueado, a
// própria unidade; nasce só com o Admin).
//
// ⚠️ "Repasses" no riSZon é o pagamento aos DENTISTAS (Financeiro → Análise).
// Esta tela é "Repasses da franquia": as taxas da rede que a unidade paga.
import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";
import { podeComPapeis } from "@/lib/permissions";
import type { ColunaDoRelatorio, RelatorioPronto } from "@/lib/finance/relatorio";

/** O TETO (o banco tem o mesmo, `_gateway_cap_ceiling`): fora daqui, nunca. */
const TETO: UserRole[] = ["unit_manager", "franchisee", "finance_franchisor"];

export function podeVerRepassesDaFranquia(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  const papeis = Object.values(session.rolesByClinic)
    .flat()
    .filter((r) => TETO.includes(r));
  return podeComPapeis(session.permissoes, "modulo.repasses_franquia", papeis);
}

// --- o que o banco devolve -----------------------------------------------------

export type LinhaDoResumo = {
  clinic_id: string;
  name: string;
  devido: number;
  pago_no_split: number;
  a_receber: number;
  foi_para_conta_a_pagar: number;
  conta_a_pagar_aberta: number;
  conta_a_pagar_vencida: number;
};
export type LinhaRecebido = {
  clinic_id: string;
  categoria: Categoria;
  n: number;
  recebido: number;
  devido: number;
  pago_no_split: number;
  conta_a_pagar: number;
  percentual: number | null;
};
export type LinhaTaxa = {
  clinic_id: string;
  fee: string;
  devido_liquidadas: number | null;
  liquidado: number | null;
  a_receber: number | null;
  fora_do_split: number | null;
  absorvidas: number;
  mensageria: number;
  divergentes: number;
};
export type LinhaCobranca = {
  charge_id: string;
  clinic_id: string;
  client_id: string | null;
  cliente: string | null;
  codigo: string | null;
  meio: string;
  pago_em: string;
  credito_previsto: string | null;
  carteira: string | null;
  taxa: string;
  devido: number;
  liquidado: number | null;
  liquidado_em: string | null;
  situacao: Situacao;
};
export type LinhaAReceber = {
  charge_id: string;
  clinic_id: string;
  client_id: string | null;
  cliente: string | null;
  codigo: string | null;
  meio: string;
  pago_em: string;
  previsto: string | null;
  atrasado: boolean | null;
  taxa: string;
  valor: number;
  bloqueado: boolean;
};
export type LinhaLiquidada = { clinic_id: string; fee: string; liquidado: number; cobrancas: number };
export type LinhaDivergencia = {
  clinic_id: string;
  charge_id: string | null;
  client_id: string | null;
  cliente: string | null;
  codigo: string | null;
  data: string | null;
  tipo: TipoDeDivergencia;
  valor: number | null;
  detalhe: string | null;
  autor: string | null;
  motivo: string | null;
};
export type LinhaDispensa = {
  clinic_id: string;
  id: string;
  data: string;
  tipo: string | null;
  principal: number;
  beneficio: number;
  multa: number;
  juros: number;
  total: number;
  autor: string | null;
  motivo: string | null;
  client_id: string | null;
  cliente: string | null;
  codigo: string | null;
};
export type Saldo = {
  conta: string;
  saldo_cents: number | null;
  conferido_em: string | null;
  minimo_cents: number | null;
  alerta: "negativo" | "abaixo_do_minimo" | null;
} | null;

export type Repasses = {
  de: string;
  ate: string;
  hoje: string;
  rede: boolean;
  tolerancia_cents: number;
  resumo: LinhaDoResumo[];
  recebido: LinhaRecebido[];
  media_rede: Partial<Record<Categoria, number>>;
  motivos_sem_split: { clinic_id: string; motivo: string; n: number; recebido: number }[];
  taxas: LinhaTaxa[];
  cobrancas: LinhaCobranca[];
  a_receber: LinhaAReceber[];
  liquidado_no_periodo: LinhaLiquidada[];
  divergencias: LinhaDivergencia[];
  dispensas: LinhaDispensa[];
  unidades: Record<string, string>;
  saldo: Saldo;
};

// --- os rótulos -----------------------------------------------------------------

export type Categoria = "split" | "asaas_sem_split" | "dinheiro" | "cartao" | "deposito_pix" | "externa" | "estornado";
export const CATEGORIAS: { valor: Categoria; rotulo: string }[] = [
  { valor: "split", rotulo: "Asaas com split" },
  { valor: "asaas_sem_split", rotulo: "Asaas sem split" },
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "cartao", rotulo: "Maquininha e outros cartões" },
  { valor: "deposito_pix", rotulo: "Depósito e Pix manual" },
  { valor: "externa", rotulo: "Cobrança externa" },
  { valor: "estornado", rotulo: "Estornado (taxa mantida)" },
];
export const rotuloDaCategoria = (c: string) => CATEGORIAS.find((x) => x.valor === c)?.rotulo ?? c;

export const MOTIVO_SEM_SPLIT: Record<string, string> = {
  antes_do_split: "emitida antes do split",
  franqueadora: "cobrança da franqueadora",
  split_nao_habilitado: "split não habilitado na conta",
  sem_carteira: "carteira de destino indisponível",
  carteira_propria: "destino é a própria conta",
  sem_taxa: "nenhuma taxa vigente",
  sem_tarifa: "tarifa do Asaas desconhecida",
  teto: "split não cabia no líquido",
};
export const rotuloDoMotivo = (m: string) => MOTIVO_SEM_SPLIT[m] ?? m;

export const TAXAS: Record<string, string> = {
  royalty: "Royalty",
  fundo: "Fundo de propaganda",
  planejamento: "Centro de planejamento",
  comercial: "Comercial",
  sistema: "Taxa de sistema e suporte",
  sdr: "SDR",
};
export const rotuloDaTaxa = (f: string) => TAXAS[f] ?? f;

export type Situacao =
  | "a_receber"
  | "ok"
  | "absorvida"
  | "mensageria"
  | "conta_a_pagar"
  | "a_maior"
  | "cancelado"
  | "estornado";
export const SITUACAO: Record<Situacao, string> = {
  a_receber: "a receber",
  ok: "conferido",
  absorvida: "diferença absorvida",
  mensageria: "provável mensageria",
  conta_a_pagar: "falta foi para a conta a pagar",
  a_maior: "repasse a maior",
  cancelado: "split cancelado",
  estornado: "estornada",
};
export const rotuloDaSituacao = (s: string) => SITUACAO[s as Situacao] ?? s;

export type TipoDeDivergencia =
  | "conta_a_pagar"
  | "mensageria"
  | "a_maior"
  | "cancelado"
  | "bloqueado"
  | "estorno"
  | "dispensa_taxa";
export const DIVERGENCIA: Record<TipoDeDivergencia, string> = {
  conta_a_pagar: "Falta acima da tolerância (foi para a conta a pagar)",
  mensageria: "Provável mensageria (nota, não divergência)",
  a_maior: "Repasse a maior",
  cancelado: "Split cancelado ou recusado",
  bloqueado: "Split bloqueado pelo Asaas",
  estorno: "Estorno (a taxa continua devida)",
  dispensa_taxa: "Taxa dispensada depois do estorno",
};
export const rotuloDaDivergencia = (t: string) => DIVERGENCIA[t as TipoDeDivergencia] ?? t;

export const MEIO: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão" };
export const rotuloDoMeio = (m: string) => MEIO[m] ?? m;

// --- o período ------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Filtros = { de: string; ate: string; mes: string | null; unidade: string | null };

function ultimoDia(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * P3: o mês atual por padrão; `mes=AAAA-MM` escolhe outro mês; `de` e `ate`
 * escolhem um intervalo (até 400 dias, como o banco).
 */
export function lerFiltros(sp: Record<string, string | string[] | undefined>, hoje: string): Filtros {
  const um = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const unidade = um("unidade");
  const u = unidade && UUID.test(unidade) ? unidade : null;
  const de = um("de");
  const ate = um("ate");
  if (de && ate && ISO.test(de) && ISO.test(ate) && de <= ate) {
    const dias = (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000;
    if (dias <= 400) return { de, ate, mes: null, unidade: u };
  }
  const mesPedido = um("mes");
  const mes = mesPedido && MES.test(mesPedido) && Number(mesPedido.slice(5)) >= 1 && Number(mesPedido.slice(5)) <= 12 ? mesPedido : hoje.slice(0, 7);
  return { de: `${mes}-01`, ate: ultimoDia(mes), mes, unidade: u };
}

export function rotuloDoPeriodo(f: Filtros): string {
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (f.mes) {
    const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    return `${nomes[Number(f.mes.slice(5)) - 1]} de ${f.mes.slice(0, 4)}`;
  }
  return `${br(f.de)} a ${br(f.ate)}`;
}

// --- as somas da tela -------------------------------------------------------------

export type TotalDoResumo = Omit<LinhaDoResumo, "clinic_id" | "name">;
export function totalDoResumo(linhas: LinhaDoResumo[]): TotalDoResumo {
  const t: TotalDoResumo = { devido: 0, pago_no_split: 0, a_receber: 0, foi_para_conta_a_pagar: 0, conta_a_pagar_aberta: 0, conta_a_pagar_vencida: 0 };
  for (const l of linhas) for (const k of Object.keys(t) as (keyof TotalDoResumo)[]) t[k] += Number(l[k] ?? 0);
  return t;
}

/** Parte 1 por unidade: as categorias na ordem da tela, com a média da rede ao lado (ajuste 2). */
export function recebidoDaUnidade(r: Repasses, clinicId: string) {
  const linhas = r.recebido.filter((x) => x.clinic_id === clinicId);
  return CATEGORIAS.map((c) => {
    const l = linhas.find((x) => x.categoria === c.valor);
    return {
      ...c,
      n: l?.n ?? 0,
      recebido: Number(l?.recebido ?? 0),
      devido: Number(l?.devido ?? 0),
      pago_no_split: Number(l?.pago_no_split ?? 0),
      conta_a_pagar: Number(l?.conta_a_pagar ?? 0),
      percentual: l?.percentual == null ? 0 : Number(l.percentual),
      mediaDaRede: Number(r.media_rede[c.valor] ?? 0),
    };
  }).filter((c) => c.n > 0 || c.mediaDaRede > 0);
}

/** Parte 2: diferença (devido − liquidado) das cobranças JÁ liquidadas (ajuste 1). */
export function diferencaDaTaxa(t: LinhaTaxa): number | null {
  if (t.liquidado == null || t.devido_liquidadas == null) return null;
  return Number(t.devido_liquidadas) - Number(t.liquidado);
}

/** Parte 3: o a receber agrupado por data prevista. */
export function aReceberPorData(linhas: LinhaAReceber[]) {
  const m = new Map<string, { data: string | null; valor: number; atrasado: boolean; cobrancas: Set<string> }>();
  for (const l of linhas) {
    const k = l.previsto ?? "";
    if (!m.has(k)) m.set(k, { data: l.previsto, valor: 0, atrasado: !!l.atrasado, cobrancas: new Set() });
    const g = m.get(k)!;
    g.valor += Number(l.valor);
    g.cobrancas.add(l.charge_id);
  }
  return [...m.values()]
    .sort((a, b) => (a.data ?? "9999").localeCompare(b.data ?? "9999"))
    .map((g) => ({ data: g.data, valor: g.valor, atrasado: g.atrasado, cobrancas: g.cobrancas.size }));
}

// --- a planilha (P6) --------------------------------------------------------------

export const PARTES = ["resumo", "recebido", "taxas", "cobrancas", "a_receber", "divergencias", "dispensas"] as const;
export type Parte = (typeof PARTES)[number];
export const ehParte = (p: unknown): p is Parte => typeof p === "string" && (PARTES as readonly string[]).includes(p);

const TITULO: Record<Parte, string> = {
  resumo: "Resumo por unidade",
  recebido: "Recebido com split × por fora",
  taxas: "Liquidado por unidade e taxa",
  cobrancas: "Conferência por cobrança",
  a_receber: "Repasses a receber",
  divergencias: "Divergências e ocorrências",
  dispensas: "Dispensas do período",
};

const D = (chave: string, titulo: string, somar = true): ColunaDoRelatorio => ({ chave, titulo, tipo: "dinheiro", somar, largura: 15 });
const T = (chave: string, titulo: string, largura = 22): ColunaDoRelatorio => ({ chave, titulo, tipo: "texto", largura });
const DT = (chave: string, titulo: string): ColunaDoRelatorio => ({ chave, titulo, tipo: "data", largura: 12 });
const N = (chave: string, titulo: string): ColunaDoRelatorio => ({ chave, titulo, tipo: "numero", largura: 10 });

export function relatorioDaParte(args: {
  parte: Parte;
  dados: Repasses;
  filtros: Filtros;
  nomeDaUnidade: string | null;
  geradoPor: string;
  agora: string;
}): RelatorioPronto {
  const { parte, dados: r } = args;
  const un = (id: string) => r.unidades[id] ?? "—";
  let colunas: ColunaDoRelatorio[] = [];
  let linhas: RelatorioPronto["linhas"] = [];
  const notas: string[] = [
    "Taxas da rede: royalty, fundo de propaganda, centro de planejamento e comercial.",
    `Tolerância de arredondamento do split: ${(r.tolerancia_cents / 100).toFixed(2).replace(".", ",")} por cobrança.`,
  ];
  switch (parte) {
    case "resumo":
      colunas = [T("unidade", "Unidade"), D("devido", "Taxa devida"), D("pago", "Paga no split"), D("receber", "A receber"), D("pagar", "Foi para a conta a pagar"), D("aberta", "Conta a pagar aberta"), D("vencida", "Conta a pagar vencida")];
      linhas = r.resumo.map((l) => ({ unidade: l.name, devido: l.devido, pago: l.pago_no_split, receber: l.a_receber, pagar: l.foi_para_conta_a_pagar, aberta: l.conta_a_pagar_aberta, vencida: l.conta_a_pagar_vencida }));
      break;
    case "recebido":
      colunas = [T("unidade", "Unidade"), T("categoria", "Como foi recebido", 26), N("n", "Recebimentos"), D("recebido", "Recebido"), { chave: "pct", titulo: "% da unidade", tipo: "numero", largura: 12 }, { chave: "media", titulo: "% média da rede", tipo: "numero", largura: 14 }, D("devido", "Taxa devida"), D("pago", "Paga no split"), D("pagar", "Na conta a pagar")];
      linhas = r.recebido.map((l) => ({ unidade: un(l.clinic_id), categoria: rotuloDaCategoria(l.categoria), n: l.n, recebido: l.recebido, pct: l.percentual == null ? null : Number(l.percentual), media: Number(r.media_rede[l.categoria] ?? 0), devido: l.devido, pago: l.pago_no_split, pagar: l.conta_a_pagar }));
      break;
    case "taxas":
      colunas = [T("unidade", "Unidade"), T("taxa", "Taxa"), D("devido", "Devido (cobranças liquidadas)"), D("liquidado", "Liquidado pelo Asaas"), D("diferenca", "Diferença"), D("receber", "A receber"), N("absorvidas", "Absorvidas"), N("mensageria", "Mensageria"), N("divergentes", "Divergentes")];
      linhas = r.taxas.map((l) => ({ unidade: un(l.clinic_id), taxa: rotuloDaTaxa(l.fee), devido: l.devido_liquidadas, liquidado: l.liquidado, diferenca: diferencaDaTaxa(l), receber: l.a_receber, absorvidas: l.absorvidas, mensageria: l.mensageria, divergentes: l.divergentes }));
      notas.push("Conferência por cobrança: o devido e o liquidado das MESMAS cobranças, pagas no período. O que o Asaas ainda não liquidou está em \"a receber\", não na diferença.");
      break;
    case "cobrancas":
      colunas = [T("unidade", "Unidade"), T("paciente", "Paciente", 30), T("prontuario", "Prontuário", 12), T("meio", "Meio", 10), DT("pago", "Pago em"), T("carteira", "Carteira", 24), T("taxa", "Taxa"), D("devido", "Devido"), D("liquidado", "Liquidado"), DT("liquidadoEm", "Liquidado em"), T("situacao", "Situação", 28)];
      linhas = r.cobrancas.map((l) => ({ unidade: un(l.clinic_id), paciente: l.cliente ?? "—", prontuario: l.codigo ?? "—", meio: rotuloDoMeio(l.meio), pago: l.pago_em, carteira: l.carteira ?? "—", taxa: rotuloDaTaxa(l.taxa), devido: l.devido, liquidado: l.liquidado, liquidadoEm: l.liquidado_em, situacao: rotuloDaSituacao(l.situacao) }));
      break;
    case "a_receber":
      colunas = [T("unidade", "Unidade"), T("paciente", "Paciente", 30), T("prontuario", "Prontuário", 12), T("meio", "Meio", 10), DT("pago", "Pago em"), DT("previsto", "Previsto"), T("taxa", "Taxa"), D("valor", "Valor"), T("obs", "Observação", 16)];
      linhas = r.a_receber.map((l) => ({ unidade: un(l.clinic_id), paciente: l.cliente ?? "—", prontuario: l.codigo ?? "—", meio: rotuloDoMeio(l.meio), pago: l.pago_em, previsto: l.previsto, taxa: rotuloDaTaxa(l.taxa), valor: l.valor, obs: l.bloqueado ? "bloqueado" : l.atrasado ? "atrasado" : "" }));
      notas.push("Todas as pendentes hoje, de qualquer período, pela data prevista de crédito da cobrança.");
      break;
    case "divergencias":
      colunas = [T("unidade", "Unidade"), DT("data", "Data"), T("tipo", "Ocorrência", 40), T("paciente", "Paciente", 30), T("prontuario", "Prontuário", 12), D("valor", "Valor", false), T("detalhe", "Carteira", 22), T("autor", "Quem", 22), T("motivo", "Motivo", 40)];
      linhas = r.divergencias.map((l) => ({ unidade: un(l.clinic_id), data: l.data, tipo: rotuloDaDivergencia(l.tipo), paciente: l.cliente ?? "—", prontuario: l.codigo ?? "—", valor: l.valor, detalhe: l.detalhe ?? "", autor: l.autor ?? "", motivo: l.motivo ?? "" }));
      break;
    case "dispensas":
      colunas = [T("unidade", "Unidade"), DT("data", "Data"), T("paciente", "Paciente", 30), T("prontuario", "Prontuário", 12), T("tipo", "Tipo", 16), D("principal", "Principal"), D("beneficio", "Benefício"), D("multa", "Multa"), D("juros", "Juros"), D("total", "Total"), T("autor", "Quem", 22), T("motivo", "Motivo", 40)];
      linhas = r.dispensas.map((l) => ({ unidade: un(l.clinic_id), data: l.data, paciente: l.cliente ?? "—", prontuario: l.codigo ?? "—", tipo: l.tipo ?? "", principal: l.principal, beneficio: l.beneficio, multa: l.multa, juros: l.juros, total: l.total, autor: l.autor ?? "", motivo: l.motivo ?? "" }));
      break;
  }
  return {
    titulo: `Repasses da franquia — ${TITULO[parte]}`,
    subtitulo: "As taxas da rede pagas pelas unidades: no split do Asaas, a receber e na conta a pagar.",
    metadados: [
      { rotulo: "Unidade", valor: args.nomeDaUnidade ?? (r.rede ? "Todas" : "A sua unidade") },
      { rotulo: "Período", valor: `${rotuloDoPeriodo(args.filtros)} (pela data do pagamento)` },
      { rotulo: "Gerado por", valor: `${args.geradoPor} em ${args.agora}` },
    ],
    resumo: [{ rotulo: "Linhas", valor: String(linhas.length) }],
    situacao: null,
    colunas,
    linhas,
    notas,
    nomeDoArquivo: `repasses-da-franquia-${parte}-${args.filtros.de}-a-${args.filtros.ate}`,
  };
}
