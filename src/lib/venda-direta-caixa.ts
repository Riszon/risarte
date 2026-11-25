// Venda direta v3 (docs/comercial/VENDA-DIRETA-V3-PLANO.md) — as regras PURAS
// do caixa da recepção. Nada aqui grava nem decide permissão: é para a tela
// oferecer só o que o servidor e o banco vão aceitar. As contas espelham
// `setDirectSaleConditions` (servidor) e `directSaleViolations` — mudou lá,
// muda aqui (régua `venda-direta-caixa.test.ts`).

import {
  automaticDiscountPercent,
  minInstallmentCentsFor,
  type CommercialRule,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  meioParaARegra,
  meiosDaVendaNova,
  type MetodoVendaNova,
} from "@/lib/venda-direta-meios";

/** Rótulos curtos dos botões do caixa (o extrato segue com os rótulos longos). */
export const ROTULO_DO_BOTAO: Record<MetodoVendaNova, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao: "Cartão à vista",
  cartao_parcelado_asaas: "Cartão parcelado",
  cartao_parcelado: "Maquininha",
  boleto: "Boleto",
  permuta: "Permuta",
};

/** A ordem dos botões: o mais usado no balcão primeiro. */
const ORDEM: MetodoVendaNova[] = [
  "pix",
  "dinheiro",
  "cartao",
  "cartao_parcelado_asaas",
  "cartao_parcelado",
  "boleto",
  "permuta",
];

export type AtendimentoDoCaixa = {
  id: string;
  /** Instante do início (ISO). */
  startsAt: string;
  status: string;
};

/**
 * O atendimento que já vem escolhido: o de HOJE (o que começa mais perto de
 * agora); sem atendimento hoje, nenhum — a pessoa escolhe.
 * `diaDe` devolve o dia (YYYY-MM-DD) no relógio brasileiro.
 */
export function atendimentoPadrao(
  atendimentos: AtendimentoDoCaixa[],
  agora: Date,
  diaDe: (instante: Date) => string
): string {
  const hoje = diaDe(agora);
  const deHoje = atendimentos.filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "no_show" &&
      diaDe(new Date(a.startsAt)) === hoje
  );
  if (deHoje.length === 0) return "";
  const distancia = (a: AtendimentoDoCaixa) =>
    Math.abs(new Date(a.startsAt).getTime() - agora.getTime());
  return [...deHoje].sort((a, b) => distancia(a) - distancia(b))[0].id;
}

/**
 * Exceção "atendeu antes de vender" (§7.2): o atendimento já foi CONCLUÍDO ou
 * é de um dia anterior. Atendimento de hoje ainda em andamento não é exceção —
 * o paciente está na clínica e a venda está sendo feita na hora certa.
 */
export function atendidoAntesDaVenda(
  atendimento: AtendimentoDoCaixa | null,
  agora: Date,
  diaDe: (instante: Date) => string
): boolean {
  if (!atendimento) return false;
  if (atendimento.status === "completed") return true;
  return diaDe(new Date(atendimento.startsAt)) < diaDe(agora);
}

export type CondicoesDoPrograma = {
  cashDiscountPercent: number;
  tiers: { upToInstallments: number; discountPercent: number }[];
};

/** % do plano (PPR+) para a quantidade de parcelas escolhida. */
export function percentualDoPlano(
  plano: CondicoesDoPrograma,
  parcelas: number
): number {
  if (parcelas <= 1) return Math.max(0, plano.cashDiscountPercent);
  const faixa = [...plano.tiers]
    .sort((a, b) => a.upToInstallments - b.upToInstallments)
    .find((t) => parcelas <= t.upToInstallments);
  return Math.max(0, faixa?.discountPercent ?? 0);
}

export type EntradaDaPrevia = {
  /** Soma dos itens pelo preço de tabela. */
  subtotalCents: number;
  /** Benefício do programa nos itens (Empresarial / PPR+). */
  programDiscountCents: number;
  /** Valor final dos itens que JÁ têm benefício (não recebem desconto de novo). */
  coveredCents: number;
  rule: Pick<CommercialRule, "cashDiscountPercent" | "maxDiscountPercent">;
  parcelas: number;
  meio: string | null;
  /** Cliente de programa com desconto automático (Empresarial). */
  isProgramMember: boolean;
  /** Plano do PPR+ (faixas por parcelamento) — acima da regra da unidade. */
  plano: CondicoesDoPrograma | null;
  descontoManualCents: number;
  acrescimoCents: number;
};

export type PreviaDoCaixa = {
  discountCents: number;
  surchargeCents: number;
  finalCents: number;
  /** % automático que valeu (0 = nenhum). */
  autoPercent: number;
  /** O desconto mostrado é o automático (plano ou à vista), não o digitado. */
  isAuto: boolean;
  origem: "plano" | "avista" | "manual" | null;
};

/**
 * O total que o servidor vai gravar para estas condições:
 * - PPR+: o desconto é o da faixa do plano, sobre o que não tem benefício;
 * - sem programa, à vista e fora da permuta e do cartão: o automático da regra, e o manual
 *   maior prevalece;
 * - parcelado: só o manual.
 */
export function previaDoCaixa(e: EntradaDaPrevia): PreviaDoCaixa {
  const aPagar = Math.max(0, e.subtotalCents - e.programDiscountCents);
  if (e.plano) {
    const pct = percentualDoPlano(e.plano, e.parcelas);
    const base = Math.max(0, aPagar - e.coveredCents);
    const discountCents = Math.round((base * pct) / 100);
    return {
      discountCents,
      surchargeCents: 0,
      finalCents: Math.max(0, aPagar - discountCents),
      autoPercent: pct,
      isAuto: discountCents > 0,
      origem: discountCents > 0 ? "plano" : null,
    };
  }
  let discountCents = Math.max(0, Math.round(e.descontoManualCents));
  const surchargeCents = Math.max(0, Math.round(e.acrescimoCents));
  const autoPercent =
    e.isProgramMember || e.meio === "permuta" || e.meio === "cartao" // 4028: o cartão tem tarifa
      ? 0
      : automaticDiscountPercent(e.rule, e.parcelas);
  const autoCents =
    autoPercent > 0 ? Math.round((aPagar * autoPercent) / 100) : 0;
  const isAuto = autoCents > 0 && autoCents >= discountCents;
  discountCents = Math.max(discountCents, autoCents);
  return {
    discountCents,
    surchargeCents,
    finalCents: Math.max(0, aPagar - discountCents + surchargeCents),
    autoPercent: isAuto ? autoPercent : 0,
    isAuto,
    origem: isAuto ? "avista" : discountCents > 0 ? "manual" : null,
  };
}

export type RegraDoCaixa = Pick<
  CommercialRule,
  "maxInstallments" | "allowedMethods" | "minInstallmentByMethod"
>;

type QuemEOnde = { isManager: boolean; cardMachine: boolean };

/** O meio vale para esta quantidade de parcelas? */
export function meioValeEm(
  meio: MetodoVendaNova,
  parcelas: number,
  regra: RegraDoCaixa,
  q: QuemEOnde
): boolean {
  return meiosDaVendaNova({
    installments: parcelas,
    isManager: q.isManager,
    cardMachine: q.cardMachine,
    allowed: regra.allowedMethods,
  }).includes(meio);
}

/**
 * Os botões de meio do caixa: tudo o que a regra permite, à vista OU
 * parcelado, na ordem do balcão. Meio proibido não aparece.
 */
export function meiosDoCaixa(regra: RegraDoCaixa, q: QuemEOnde): MetodoVendaNova[] {
  return ORDEM.filter(
    (m) => meioValeEm(m, 1, regra, q) || meioValeEm(m, 2, regra, q)
  );
}

/** O meio que já vem marcado: Pix (decisão do dono); sem Pix, o primeiro. */
export function meioInicial(meios: MetodoVendaNova[]): MetodoVendaNova | "" {
  if (meios.includes("pix")) return "pix";
  return meios[0] ?? "";
}

export type OpcaoDeParcela = {
  parcelas: number;
  /** Total da venda nesta quantidade (o desconto muda com as parcelas). */
  totalCents: number;
  /** Valor de cada parcela (a sobra dos centavos fica na última). */
  parcelaCents: number;
};

/**
 * As quantidades de parcelas oferecidas para um meio: só as que o meio aceita,
 * até o máximo da regra e sem furar a parcela mínima. `totalEm(n)` devolve o
 * total da venda em n parcelas (o desconto automático depende de n).
 */
export function parcelasDoMeio(
  meio: MetodoVendaNova,
  regra: RegraDoCaixa,
  q: QuemEOnde,
  totalEm: (parcelas: number) => number
): OpcaoDeParcela[] {
  const teto = Math.max(1, regra.maxInstallments ?? 12);
  const naRegra = meioParaARegra(meio) as PaymentMethod | null;
  const minimo = minInstallmentCentsFor(regra, naRegra);
  const opcoes: OpcaoDeParcela[] = [];
  for (let n = 1; n <= teto; n++) {
    if (!meioValeEm(meio, n, regra, q)) continue;
    // 4028 (OC-00020): o botão "Cartão à vista" é só 1×. Parcelar é o "Cartão
    // parcelado"; o cartão em várias cobranças, mês a mês, fica em "Ajustar parcelas".
    if (meio === "cartao" && n > 1) continue;
    const totalCents = totalEm(n);
    const parcelaCents = Math.ceil(totalCents / n);
    // A parcela mínima só vale no parcelado (mesma regra do fechamento).
    if (n > 1 && minimo && totalCents > 0 && parcelaCents < minimo) continue;
    opcoes.push({ parcelas: n, totalCents, parcelaCents });
  }
  return opcoes;
}

/**
 * Ao trocar de meio, a quantidade de parcelas fica a mesma se ainda vale; se
 * não, vai para a menor que o meio aceita (ex.: de Pix à vista para Boleto →
 * 2×, porque à vista é só Pix, dinheiro ou permuta).
 */
export function parcelasAoTrocarDeMeio(
  atual: number,
  opcoes: OpcaoDeParcela[]
): number {
  if (opcoes.some((o) => o.parcelas === atual)) return atual;
  return opcoes[0]?.parcelas ?? atual;
}

/**
 * Os atalhos do alto do caixa: os mais vendidos da unidade entre os que ESTA
 * pessoa pode lançar; se faltar, completa pela ordem do catálogo.
 */
export function atalhosDoCaixa<T extends { id: string }>(
  procedimentos: T[],
  vendidos: Record<string, number>,
  quantos = 6
): T[] {
  const comVenda = procedimentos
    .filter((p) => (vendidos[p.id] ?? 0) > 0)
    .sort((a, b) => (vendidos[b.id] ?? 0) - (vendidos[a.id] ?? 0));
  const resto = procedimentos.filter((p) => !(vendidos[p.id] > 0));
  return [...comVenda, ...resto].slice(0, quantos);
}

/** Meio recebido no BALCÃO: a baixa é de quem recebeu, não do Asaas. */
export function recebidoNoBalcao(meio: string | null | undefined): boolean {
  return meio === "dinheiro" || meio === "permuta" || meio === "cartao_parcelado";
}

export type SituacaoDaVenda = {
  cancelled: boolean;
  closed: boolean;
  finalCents: number;
  paymentMethod: string | null;
  contractSigned: boolean;
  paymentConfirmed: boolean;
};

export type EtapaDoCaixa =
  | "cancelada"
  | "concluida"
  /** Falta dizer como paga (venda lançada pelo Coordenador, por exemplo). */
  | "pagamento"
  /** Falta assinar e/ou receber. */
  | "fechamento";

/** Em que ponto a venda parou — é onde a janela abre ao "Continuar". */
export function etapaDoCaixa(v: SituacaoDaVenda): EtapaDoCaixa {
  if (v.cancelled) return "cancelada";
  if (v.closed || (v.contractSigned && v.paymentConfirmed)) return "concluida";
  if (v.finalCents > 0 && !v.paymentMethod) return "pagamento";
  return "fechamento";
}

/** O que falta, em uma frase curta (fila "Para receber" e prontuário). */
export function oQueFalta(v: SituacaoDaVenda): string {
  const etapa = etapaDoCaixa(v);
  if (etapa === "cancelada") return "cancelada";
  if (etapa === "concluida") return "concluída";
  if (etapa === "pagamento") return "falta definir o pagamento";
  if (!v.contractSigned && !v.paymentConfirmed) return "falta assinar e receber";
  if (!v.contractSigned) return "falta assinar";
  return "falta receber";
}

/**
 * O selo da situação da venda, para telas de SERVIDOR (prontuário, listas).
 * ⚠️ Não importar o rótulo de `direct-sale-item.tsx` numa página: ele é um
 * arquivo de navegador, e constante de lá chega vazia ao servidor (o selo saía
 * em branco — visto no teste de 16/11/2026).
 */
export const SELO_DA_VENDA: Record<
  "aguardando_fechamento" | "cobranca_emitida" | "concluida" | "cancelada",
  { rotulo: string; estilo: string }
> = {
  aguardando_fechamento: {
    rotulo: "Aguardando fechamento",
    estilo:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  },
  cobranca_emitida: {
    rotulo: "Fechamento pendente",
    estilo:
      "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200",
  },
  concluida: {
    rotulo: "Concluída",
    estilo:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  },
  cancelada: {
    rotulo: "Cancelada",
    estilo: "border-border bg-muted text-muted-foreground",
  },
};

// ---------------------------------------------------------------------------
// VD3-3 — o pagamento pelo Asaas na janela e o comprovante (regra pura).
// ---------------------------------------------------------------------------

/** O mínimo da parcela que a janela usa (o tipo vem de `asaas/cobrancas-da-venda`). */
export type ParcelaParaJanela = {
  seq: number;
  situacao_parcela: string;
  parcelado?: boolean;
  /** A parcela é cobrada pelo Asaas (Pix, boleto, cartão). */
  pelo_asaas?: boolean;
  /** A cobrança só nasce perto do vencimento (data). */
  agendada_para?: string | null;
  cobranca: { status: string; pix: string | null; link: string | null; linha: string | null; meio: string; valor: number } | null;
};

/**
 * A cobrança que o cliente paga AGORA: a primeira parcela aberta com cobrança
 * viva no Asaas (emitida ou vencida). A parcela do cartão parcelado não conta
 * (paga-se pelo link do parcelamento, no bloco de baixo). Nula = nada a
 * mostrar em destaque (ainda sendo criada, paga, ou fora do Asaas).
 */
export function cobrancaDaVez<P extends ParcelaParaJanela>(parcelas: P[]): P | null {
  const abertas = [...parcelas]
    .filter(
      (p) =>
        !p.parcelado &&
        p.situacao_parcela !== "paga" &&
        p.situacao_parcela !== "cancelada" &&
        p.situacao_parcela !== "renegociada" &&
        !!p.cobranca &&
        ["emitida", "vencida"].includes(p.cobranca.status)
    )
    .sort((a, b) => a.seq - b.seq);
  return abertas[0] ?? null;
}

/** A janela continua conferindo? Enquanto há cobrança sendo criada ou esperando. */
export function esperandoOAsaas(parcelas: ParcelaParaJanela[]): boolean {
  return parcelas.some(
    (p) =>
      !p.parcelado &&
      p.situacao_parcela !== "paga" &&
      !!p.cobranca &&
      ["emitindo", "emitida", "vencida"].includes(p.cobranca.status)
  );
}

/**
 * Logo depois da assinatura, a cobrança ainda está NASCENDO: a parcela é do
 * Asaas, está aberta, não tem cobrança e não está agendada para DEPOIS de
 * hoje (o banco devolve "agendada para hoje" enquanto ela não nasceu). A
 * janela confere por um tempo (o caixa limita) — com a cobrança automática
 * desligada na unidade, ela não nasce e a janela para de perguntar.
 */
export function cobrancaParaNascer(parcelas: ParcelaParaJanela[], hoje: string): boolean {
  return parcelas.some(
    (p) =>
      !p.parcelado &&
      !!p.pelo_asaas &&
      !p.cobranca &&
      // "Agendada" para hoje (ou antes) = nasce agora; para depois = não espera.
      (!p.agendada_para || p.agendada_para.slice(0, 10) <= hoje) &&
      (p.situacao_parcela === "em_aberto" || p.situacao_parcela === "parcial")
  );
}

const MEIO_NO_COMPROVANTE: Record<string, string> = {
  pix: "Pix",
  boleto: "boleto",
  cartao: "cartão de crédito",
  cartao_parcelado_asaas: "cartão de crédito parcelado",
  cartao_parcelado: "cartão (maquininha)",
  dinheiro: "dinheiro",
  permuta: "permuta",
};

/**
 * O COMPROVANTE pelo WhatsApp (decisão D4/P2, texto aprovado pelo dono em
 * 17/11/2026). Sai do balcão, por quem fechou — não é enviado sozinho.
 */
export function comprovanteDaVenda(v: {
  nome: string;
  unidade: string;
  procedimentos: string[];
  totalCents: number;
  meio: string | null;
  parcelas: number;
  /** 'aaaa-mm-dd' ou ISO. */
  data: string;
  codigo: string | null;
}): string {
  const primeiro = (v.nome ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const lista =
    v.procedimentos.length <= 1
      ? (v.procedimentos[0] ?? "Procedimento")
      : `${v.procedimentos.slice(0, -1).join(", ")} e ${v.procedimentos[v.procedimentos.length - 1]}`;
  const total = (v.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const meio = v.totalCents <= 0 ? "sem custo (coberto pelo programa)" : (MEIO_NO_COMPROVANTE[v.meio ?? ""] ?? v.meio ?? "—");
  const forma = v.totalCents > 0 && v.parcelas > 1 ? `${meio}, em ${v.parcelas}×` : meio;
  const [y, m, d] = v.data.slice(0, 10).split("-");
  const pago = v.totalCents <= 0 ? `${forma}` : `pago em ${forma}`;
  return (
    `Olá, ${primeiro}! Sua compra na ${v.unidade} está confirmada. ` +
    `${lista} — total ${total}, ${pago} em ${d}/${m}/${y}.` +
    `${v.codigo ? ` Código ${v.codigo}.` : ""} Obrigado!`
  );
}

// ---------------------------------------------------------------------------
// VD3-4 — o horário do encaixe: o próximo intervalo de 5 minutos, no Brasil
// (o sistema não agenda no passado).
// ---------------------------------------------------------------------------
export function proximoIntervalo(agora: Date): { data: string; time: string } {
  const ms = 5 * 60_000;
  // +1 min de folga: o horário não pode virar "passado" entre a tela e o banco.
  const alvo = new Date(Math.ceil((agora.getTime() + 60_000) / ms) * ms);
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(alvo);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return { data: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}
