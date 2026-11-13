// LEVANTAMENTO DE DÍVIDAS (0404) — as regras puras.
//
// O que a REDE deve a terceiros (bancos, fornecedores, tributos…), por CNPJ
// devedor. Não confundir com a inadimplência de pacientes.
//
// ⚠️ A SITUAÇÃO TEM UMA REGRA SÓ, NO BANCO (`_debt_compute_status`, 0404). Esta
// é o espelho, para a tela explicar e filtrar; quem grava é o banco. Mudou uma,
// muda a outra — `dividas.test.ts` prende os casos.
//
// Plano e decisões do dono: docs/Financeiro/DIVIDAS-PLANO.md.

// ----------------------------------------------------------------- situação

export const DEBT_STATUSES = [
  "a_vencer",
  "em_atraso",
  "inadimplente",
  "em_negociacao",
  "acordo_em_andamento",
  "acordo_quebrado",
  "quitada_pendencias",
  "quitada_encerrada",
  "contestada",
  "judicial",
  "baixada",
] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const STATUS_LABELS: Record<DebtStatus, string> = {
  a_vencer: "A vencer",
  em_atraso: "Em atraso",
  inadimplente: "Inadimplente",
  em_negociacao: "Em negociação",
  acordo_em_andamento: "Acordo em andamento",
  acordo_quebrado: "Acordo quebrado",
  quitada_pendencias: "Quitada — pendências de baixa",
  quitada_encerrada: "Quitada — encerrada",
  contestada: "Contestada",
  judicial: "Em discussão judicial",
  baixada: "Baixada/Cancelada",
};

/** Classes do selo (com modo escuro). */
export const STATUS_TONE: Record<DebtStatus, string> = {
  a_vencer: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  em_atraso: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  inadimplente: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  em_negociacao: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  acordo_em_andamento: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  acordo_quebrado: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
  quitada_pendencias: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  quitada_encerrada: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  contestada: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
  judicial: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200",
  baixada: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/** O que só gente decide (D10: "em negociação" é marcado à mão). */
export const MANUAL_STAGES = ["em_negociacao", "contestada", "judicial", "baixada"] as const;
export type ManualStage = (typeof MANUAL_STAGES)[number];

/** Etapas que exigem motivo ao entrar ou sair (espelho de `debt_set_stage`). */
export function etapaPedeMotivo(de: ManualStage | null, para: ManualStage | null): boolean {
  if (de === para) return false;
  const pesadas: (ManualStage | null)[] = ["contestada", "judicial", "baixada"];
  return pesadas.includes(para) || pesadas.includes(de);
}

/**
 * Prazo para virar inadimplente: o do TIPO do credor ganha do devedor, que
 * ganha da rede; sem nada, 30 (padrão do pedido). Espelho de
 * `_debt_days_to_default`.
 */
export function prazoDeInadimplencia(regras: {
  doTipoDoCredor?: number | null;
  doDevedor?: number | null;
  daRede?: number | null;
}): number {
  return regras.doTipoDoCredor ?? regras.doDevedor ?? regras.daRede ?? 30;
}

/** Dias corridos desde o vencimento (negativo = ainda vai vencer). */
export function diasEmAtraso(dueDate: string, today: string): number {
  const a = Date.UTC(+dueDate.slice(0, 4), +dueDate.slice(5, 7) - 1, +dueDate.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Espelho de `_debt_compute_status` (fase 1: sem quitação nem acordo). */
export function situacaoDaDivida(input: {
  dueDate: string;
  manualStage: ManualStage | null;
  today: string;
  daysToDefault: number;
}): DebtStatus {
  if (input.manualStage === "baixada") return "baixada";
  if (input.manualStage === "contestada") return "contestada";
  if (input.manualStage === "judicial") return "judicial";
  if (input.manualStage === "em_negociacao") return "em_negociacao";
  const atraso = diasEmAtraso(input.dueDate, input.today);
  if (atraso <= 0) return "a_vencer";
  if (atraso <= input.daysToDefault) return "em_atraso";
  return "inadimplente";
}

// -------------------------------------------------------------- faixa de atraso

export const AGING_BANDS = ["1-30", "31-60", "61-90", "91-180", "181-365", "365+"] as const;
export type AgingBand = (typeof AGING_BANDS)[number];
export const AGING_LABELS: Record<AgingBand, string> = {
  "1-30": "1 a 30 dias",
  "31-60": "31 a 60 dias",
  "61-90": "61 a 90 dias",
  "91-180": "91 a 180 dias",
  "181-365": "181 a 365 dias",
  "365+": "Acima de 365 dias",
};

/** A faixa de atraso do pedido (3.2); nula quando ainda não venceu. */
export function faixaDeAtraso(dias: number): AgingBand | null {
  if (dias <= 0) return null;
  if (dias <= 30) return "1-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  if (dias <= 180) return "91-180";
  if (dias <= 365) return "181-365";
  return "365+";
}

/**
 * Data-limite de 5 anos da negativação, contada do vencimento (CDC, art. 43,
 * §1º). Só informativa — não é prescrição (essa ficou fora até o advogado
 * validar).
 */
export function limiteDaNegativacao(dueDate: string): string {
  const ano = +dueDate.slice(0, 4) + 5;
  const mes = dueDate.slice(5, 7);
  let dia = +dueDate.slice(8, 10);
  // 29/02 + 5 anos cai num ano sem 29/02: vai para 28/02.
  const ultimo = new Date(Date.UTC(ano, +mes, 0)).getUTCDate();
  if (dia > ultimo) dia = ultimo;
  return `${ano}-${mes}-${String(dia).padStart(2, "0")}`;
}

// ------------------------------------------------------------------- origem

export const ORIGINS = ["A", "B", "C"] as const;
export type DebtOrigin = (typeof ORIGINS)[number];
export const ORIGIN_LABELS: Record<DebtOrigin, string> = {
  A: "A — Anterior à implantação (saldo de abertura)",
  B: "B — Nova, ainda não lançada no Financeiro",
  C: "C — Já está no Contas a Pagar",
};
export const ORIGIN_SHORT: Record<DebtOrigin, string> = {
  A: "Saldo de implantação",
  B: "Nova",
  C: "Já no Contas a Pagar",
};

/**
 * A origem que o sistema sugere (D2): a data em que a dívida NASCEU (emissão,
 * senão competência) contra a data de implantação do riSZon no CNPJ — nunca o
 * vencimento. Sem uma das duas datas, não sugere. Espelho de
 * `debt_suggest_origin`.
 */
export function origemSugerida(input: {
  goLiveOn: string | null;
  issueDate: string | null;
  accrualMonth: string | null;
}): "A" | "B" | null {
  const nasceu = input.issueDate || (input.accrualMonth ? `${input.accrualMonth.slice(0, 7)}-01` : null);
  if (!nasceu || !input.goLiveOn) return null;
  return nasceu < input.goLiveOn ? "A" : "B";
}

/** Discordar da sugestão (A ↔ B) exige justificativa; C não. */
export function origemPedeJustificativa(escolhida: DebtOrigin, sugerida: "A" | "B" | null): boolean {
  return sugerida !== null && escolhida !== "C" && escolhida !== sugerida;
}

// ---------------------------------------------------------- listas da dívida

export const DEBT_TYPES = [
  "emprestimo",
  "capital_de_giro",
  "limite_de_conta",
  "antecipacao_recebiveis",
  "boleto_de_compra",
  "fatura",
  "imposto",
  "parcelamento_anterior",
  "outro",
] as const;
export type DebtType = (typeof DEBT_TYPES)[number];
export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  emprestimo: "Empréstimo",
  capital_de_giro: "Capital de giro",
  limite_de_conta: "Limite de conta / cheque especial",
  antecipacao_recebiveis: "Antecipação de recebíveis",
  boleto_de_compra: "Boleto de compra",
  fatura: "Fatura",
  imposto: "Imposto",
  parcelamento_anterior: "Parcelamento anterior",
  outro: "Outro",
};

export const PRIORITIES = ["alta", "media", "baixa"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export const PRIORITY_REASONS = [
  "fornecedor_essencial",
  "trava_credito",
  "risco_protesto_acao",
  "avalista_pf",
  "desconto_alto_prazo_curto",
] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];
export const PRIORITY_REASON_LABELS: Record<PriorityReason, string> = {
  fornecedor_essencial: "Fornecedor essencial para a operação",
  trava_credito: "Trava crédito bancário",
  risco_protesto_acao: "Risco de protesto ou ação",
  avalista_pf: "Envolve avalista pessoa física",
  desconto_alto_prazo_curto: "Desconto alto com prazo curto",
};

export const CONTACT_KINDS = ["credor", "assessoria", "advogado", "cartorio"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  credor: "Atendente do credor",
  assessoria: "Assessoria de cobrança",
  advogado: "Advogado",
  cartorio: "Cartório",
};

// ------------------------------------------------------------------- valores

/** O valor que a tela usa como "devido" nesta fase: o atualizado, senão o original. */
export function valorDevido(d: { updatedCents: number | null; originalCents: number | null }): number {
  return d.updatedCents ?? d.originalCents ?? 0;
}

// --------------------------------------------------------- lista e filtros

export type DebtListRow = {
  id: string;
  code: string;
  clinicId: string;
  clinicName: string;
  supplierId: string;
  supplierName: string;
  supplierKind: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  natureCode: string | null;
  tagIds: string[];
  status: DebtStatus;
  dueDate: string;
  originalCents: number | null;
  updatedCents: number | null;
  priority: Priority | null;
  ownerUserId: string | null;
  origin: DebtOrigin;
  contractNumber: string | null;
  description: string | null;
  installmentLabel: string | null;
  needsSplit: boolean;
  bundledCount: number;
  groupCode: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  // ---- fase 2 (0405) ----
  /** Negativação ativa (sem baixa confirmada e não removida). */
  negativada: boolean;
  /** Protesto ativo (da dívida ou do grupo; não cancelado nem removido). */
  protestada: boolean;
  /** Ação judicial em curso (sem data de encerramento). */
  judicial: boolean;
  /** Proposta ativa: a da dívida, ou a parte dela na proposta do grupo (rateio). */
  propostaCents: number | null;
  propostaValidade: string | null;
  /** Custas para cancelar protestos ativos (a parte da dívida, se do grupo). */
  custasCents: number;
  lastCheckedOn: string | null;
};

export type DebtFilters = {
  busca: string;
  devedor: string;
  credor: string;
  tipoDoCredor: string;
  categoria: string;
  subcategoria: string;
  natureza: string;
  etiqueta: string;
  situacao: string;
  faixa: string;
  prioridade: string;
  responsavel: string;
  vencimentoDe: string;
  vencimentoAte: string;
  /** "negativada" | "protestada" | "judicial" | "alguma" | "nenhuma" */
  restricao: string;
  /** "com" | "sem" | "vencendo" */
  proposta: string;
  /** "1" = só as que pedem conferência */
  conferir: string;
};

export const FILTROS_VAZIOS: DebtFilters = {
  busca: "",
  devedor: "",
  credor: "",
  tipoDoCredor: "",
  categoria: "",
  subcategoria: "",
  natureza: "",
  etiqueta: "",
  situacao: "",
  faixa: "",
  prioridade: "",
  responsavel: "",
  vencimentoDe: "",
  vencimentoAte: "",
  restricao: "",
  proposta: "",
  conferir: "",
};

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Aplica os filtros da 3.9 (os que existem na fase 1). */
export function filtrarDividas(
  rows: DebtListRow[],
  f: DebtFilters,
  today: string,
  prazos: { alertaDaProposta: number; conferencia: number } = { alertaDaProposta: 7, conferencia: 60 }
): DebtListRow[] {
  const termo = semAcento(f.busca.trim());
  return rows.filter((r) => {
    if (f.devedor && r.clinicId !== f.devedor) return false;
    if (f.credor && r.supplierId !== f.credor) return false;
    if (f.tipoDoCredor && r.supplierKind !== f.tipoDoCredor) return false;
    if (f.categoria && r.categoryId !== f.categoria) return false;
    if (f.subcategoria && r.subcategoryId !== f.subcategoria) return false;
    if (f.natureza && r.natureCode !== f.natureza) return false;
    if (f.etiqueta && !r.tagIds.includes(f.etiqueta)) return false;
    if (f.situacao && r.status !== f.situacao) return false;
    if (f.prioridade && r.priority !== f.prioridade) return false;
    if (f.responsavel && r.ownerUserId !== f.responsavel) return false;
    if (f.vencimentoDe && r.dueDate < f.vencimentoDe) return false;
    if (f.vencimentoAte && r.dueDate > f.vencimentoAte) return false;
    if (f.restricao) {
      const alguma = r.negativada || r.protestada || r.judicial;
      if (f.restricao === "negativada" && !r.negativada) return false;
      if (f.restricao === "protestada" && !r.protestada) return false;
      if (f.restricao === "judicial" && !r.judicial) return false;
      if (f.restricao === "alguma" && !alguma) return false;
      if (f.restricao === "nenhuma" && alguma) return false;
    }
    if (f.proposta === "com" && r.propostaCents === null) return false;
    if (f.proposta === "sem" && r.propostaCents !== null) return false;
    if (f.proposta === "vencendo" && !propostaVencendo(r, today, prazos.alertaDaProposta)) return false;
    if (f.conferir === "1" && !pedeConferencia(r.lastCheckedOn, today, prazos.conferencia)) return false;
    if (f.faixa) {
      const faixa = faixaDeAtraso(diasEmAtraso(r.dueDate, today));
      if (f.faixa === "a_vencer" ? faixa !== null : faixa !== f.faixa) return false;
    }
    if (termo) {
      const alvo = semAcento(
        [r.code, r.supplierName, r.clinicName, r.contractNumber, r.description, r.installmentLabel, r.groupCode]
          .filter(Boolean)
          .join(" ")
      );
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

export const ORDENACOES = ["vencimento", "valor", "atraso", "prioridade", "desconto", "codigo"] as const;
export type Ordenacao = (typeof ORDENACOES)[number];
export const ORDENACAO_LABELS: Record<Ordenacao, string> = {
  vencimento: "Vencimento (mais antigo primeiro)",
  valor: "Valor (maior primeiro)",
  atraso: "Atraso (maior primeiro)",
  prioridade: "Prioridade (alta primeiro)",
  desconto: "Desconto da proposta (maior primeiro)",
  codigo: "Código",
};

const PESO_PRIORIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

export function ordenarDividas(rows: DebtListRow[], por: Ordenacao): DebtListRow[] {
  const copia = [...rows];
  const desempate = (a: DebtListRow, b: DebtListRow) => a.code.localeCompare(b.code);
  copia.sort((a, b) => {
    switch (por) {
      case "desconto":
        return (
          (descontoDaProposta(valorDevido(b), b.propostaCents) ?? -1) - (descontoDaProposta(valorDevido(a), a.propostaCents) ?? -1) ||
          desempate(a, b)
        );
      case "valor":
        return valorDevido(b) - valorDevido(a) || desempate(a, b);
      case "atraso":
      case "vencimento":
        return a.dueDate.localeCompare(b.dueDate) || desempate(a, b);
      case "prioridade":
        return (
          (PESO_PRIORIDADE[a.priority ?? ""] ?? 3) - (PESO_PRIORIDADE[b.priority ?? ""] ?? 3) ||
          a.dueDate.localeCompare(b.dueDate) ||
          desempate(a, b)
        );
      default:
        return desempate(a, b);
    }
  });
  return copia;
}

export type TotaisDaLista = {
  quantidade: number;
  originalCents: number;
  devidoCents: number;
  contestadaJudicialCents: number;
  /** Só as dívidas COM proposta ativa (regra 3.9.2). */
  comPropostaDevidoCents: number;
  propostasCents: number;
  /** Devido − proposta, só onde há proposta. Dívida sem proposta NÃO é 100% de desconto. */
  economiaCents: number;
  /** Economia ÷ devido das dívidas com proposta; nulo sem proposta nenhuma. */
  descontoMedio: number | null;
  /** O que ainda não tem proposta: pendência de negociação. */
  semPropostaCents: number;
  /** Proposta, quando há; senão o valor devido (3.9.2). */
  estimadoCents: number;
  custasCents: number;
  /** Estimado + custas de cartório (3.10). */
  custoTotalCents: number;
};

/** Totais do rodapé (respeitam os filtros: recebem a lista já filtrada). */
export function totaisDaLista(rows: DebtListRow[]): TotaisDaLista {
  const t: TotaisDaLista = {
    quantidade: rows.length,
    originalCents: 0,
    devidoCents: 0,
    contestadaJudicialCents: 0,
    comPropostaDevidoCents: 0,
    propostasCents: 0,
    economiaCents: 0,
    descontoMedio: null,
    semPropostaCents: 0,
    estimadoCents: 0,
    custasCents: 0,
    custoTotalCents: 0,
  };
  for (const r of rows) {
    const devido = valorDevido(r);
    t.originalCents += r.originalCents ?? 0;
    t.devidoCents += devido;
    if (r.status === "contestada" || r.status === "judicial") t.contestadaJudicialCents += devido;
    if (r.propostaCents !== null) {
      t.comPropostaDevidoCents += devido;
      t.propostasCents += r.propostaCents;
      t.estimadoCents += r.propostaCents;
    } else {
      t.semPropostaCents += devido;
      t.estimadoCents += devido;
    }
    t.custasCents += r.custasCents;
  }
  t.economiaCents = t.comPropostaDevidoCents - t.propostasCents;
  t.descontoMedio = t.comPropostaDevidoCents > 0 ? t.economiaCents / t.comPropostaDevidoCents : null;
  t.custoTotalCents = t.estimadoCents + t.custasCents;
  return t;
}

// ---------------------------------------------------- propostas e selos (0405)

/** Desconto da proposta sobre o devido (0,25 = 25%); nulo sem proposta ou sem valor. */
export function descontoDaProposta(devidoCents: number, propostaCents: number | null): number | null {
  if (propostaCents === null || devidoCents <= 0) return null;
  return (devidoCents - propostaCents) / devidoCents;
}

/** A proposta vence em até N dias (inclusive hoje)? Sem validade, não. */
export function propostaVencendo(
  r: { propostaCents: number | null; propostaValidade: string | null },
  today: string,
  dias: number
): boolean {
  if (r.propostaCents === null || !r.propostaValidade) return false;
  const faltam = -diasEmAtraso(r.propostaValidade, today);
  return faltam >= 0 && faltam <= dias;
}

/** A dívida pede conferência (nunca conferida ou conferida há mais de N dias)? */
export function pedeConferencia(lastCheckedOn: string | null, today: string, dias: number): boolean {
  if (!lastCheckedOn) return true;
  return diasEmAtraso(lastCheckedOn, today) > dias;
}

/**
 * Reparte um valor entre partes proporcionais aos pesos; a ÚLTIMA parte
 * absorve o resíduo (regra do Financeiro). Proposta e custas de um GRUPO
 * viram a parte de cada dívida, para os totais respeitarem os filtros.
 */
export function ratear(totalCents: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const soma = pesos.reduce((a, b) => a + Math.max(0, b), 0);
  const partes = pesos.map((p) =>
    soma > 0 ? Math.floor((totalCents * Math.max(0, p)) / soma) : Math.floor(totalCents / pesos.length)
  );
  partes[partes.length - 1] += totalCents - partes.reduce((a, b) => a + b, 0);
  return partes;
}

export type Selo = { codigo: string; rotulo: string; tom: string };

const TOM_VERMELHO = "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200";
const TOM_ROXO = "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200";
const TOM_AMBAR = "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
const TOM_CINZA = "bg-muted text-muted-foreground";

/** Os selos da lista (seção 5 do pedido). "Acordo quebrado" chega na fase 5. */
export function selosDaDivida(
  r: DebtListRow,
  today: string,
  prazos: { alertaDaProposta: number; conferencia: number }
): Selo[] {
  const s: Selo[] = [];
  if (r.negativada) s.push({ codigo: "negativada", rotulo: "Negativada", tom: TOM_VERMELHO });
  if (r.protestada) s.push({ codigo: "protestada", rotulo: "Protestada", tom: TOM_VERMELHO });
  if (r.judicial) s.push({ codigo: "judicial", rotulo: "Judicial", tom: TOM_ROXO });
  if (propostaVencendo(r, today, prazos.alertaDaProposta))
    s.push({ codigo: "proposta_vencendo", rotulo: "Proposta vencendo", tom: TOM_AMBAR });
  if (r.needsSplit)
    s.push({ codigo: "desdobrar", rotulo: r.bundledCount > 1 ? `Desdobrar (${r.bundledCount})` : "Desdobrar", tom: TOM_AMBAR });
  if (pedeConferencia(r.lastCheckedOn, today, prazos.conferencia))
    s.push({ codigo: "conferir", rotulo: r.lastCheckedOn ? "Conferir" : "Nunca conferida", tom: TOM_CINZA });
  return s;
}

// Listas da fase 2 ---------------------------------------------------------------

export const BUREAUS = ["serasa", "spc", "boa_vista", "outro"] as const;
export type Bureau = (typeof BUREAUS)[number];
export const BUREAU_LABELS: Record<Bureau, string> = { serasa: "Serasa", spc: "SPC", boa_vista: "Boa Vista", outro: "Outro" };

export const CONSENT_LABELS = { pendente: "Pendente", solicitada: "Solicitada", recebida: "Recebida" } as const;
export type ConsentLetter = keyof typeof CONSENT_LABELS;
export const PROTEST_CANCEL_LABELS = { pendente: "Pendente", em_andamento: "Em andamento", cancelado: "Cancelado" } as const;
export type ProtestCancel = keyof typeof PROTEST_CANCEL_LABELS;

export const PAYMENT_KIND_LABELS = { a_vista: "À vista", parcelado: "Parcelado" } as const;
export type PaymentKind = keyof typeof PAYMENT_KIND_LABELS;
export const PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  boleto: "Boleto",
  debito: "Débito em conta",
  cartao: "Cartão",
  transferencia: "Transferência",
  outro: "Outro",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;
export const PROPOSAL_SOURCE_LABELS = {
  serasa_limpa_nome: "Serasa Limpa Nome",
  credor: "Direto com o credor",
  assessoria: "Assessoria de cobrança",
  feirao: "Feirão",
  advogado: "Advogado",
  outro: "Outro",
} as const;
export type ProposalSource = keyof typeof PROPOSAL_SOURCE_LABELS;
export const PROPOSAL_STATUS_LABELS = {
  ativa: "Ativa",
  substituida: "Substituída",
  aceita: "Aceita",
  expirada: "Expirada",
  recusada: "Recusada",
} as const;
export type ProposalStatus = keyof typeof PROPOSAL_STATUS_LABELS;

export const CHANNEL_LABELS = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  presencial: "Presencial",
  carta: "Carta",
  outro: "Outro",
} as const;
export type Channel = keyof typeof CHANNEL_LABELS;

export const ATTACHMENT_KIND_LABELS = {
  contrato: "Contrato",
  boleto: "Boleto",
  notificacao: "Notificação",
  proposta: "Proposta",
  comprovante: "Comprovante",
  quitacao: "Carta / termo de quitação",
  anuencia: "Carta de anuência",
  termo_acordo: "Termo de acordo",
  custas: "Custas do cartório",
  outro: "Outro",
} as const;
export type AttachmentKind = keyof typeof ATTACHMENT_KIND_LABELS;

/** Arquivos aceitos na pasta `dividas` (igual à 0405). */
export const ANEXO_TIPOS = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A proposta: o que falta para gravar. Alerta (não trava) quando ela é
 * MAIOR que o devido — vem do pedido (3.9.1).
 */
export function faltaNaProposta(p: {
  valor: string;
  tipo: PaymentKind;
  parcelas: string;
  validade: string;
  hoje: string;
}): string | null {
  const v = centavosDoCampo(p.valor);
  if (v === null || Number.isNaN(v) || v <= 0) return "Informe o valor da proposta (use 1.234,56).";
  if (p.tipo === "parcelado") {
    const n = Number(p.parcelas);
    if (!Number.isInteger(n) || n < 1) return "Informe o número de parcelas.";
  }
  if (p.validade && p.validade < p.hoje) return "A validade da proposta já passou.";
  return null;
}

// ------------------------------------------------------------- formulário

export type DebtForm = {
  id: string;
  clinicId: string;
  supplierId: string;
  groupId: string;
  collectionContactId: string;
  debtType: DebtType;
  contractNumber: string;
  installmentLabel: string;
  description: string;
  bundledCount: string;
  needsSplit: boolean;
  hasGuarantor: boolean;
  guarantorName: string;
  realGuarantee: string;
  receivablesAssignment: boolean;
  guaranteeNotes: string;
  categoryId: string;
  subcategoryId: string;
  natureCode: string;
  accountCode: string;
  taxActiveDebt: boolean;
  original: string;
  updated: string;
  updatedRefDate: string;
  interest: string;
  fine: string;
  charges: string;
  contractRatePercent: string;
  accrualMonth: string;
  issueDate: string;
  dueDate: string;
  origin: DebtOrigin;
  originOverrideReason: string;
  priority: "" | Priority;
  priorityReasons: PriorityReason[];
  ownerUserId: string;
  nextAction: string;
  nextActionOn: string;
  notes: string;
  tagIds: string[];
};

export const EMPTY_DEBT: DebtForm = {
  id: "",
  clinicId: "",
  supplierId: "",
  groupId: "",
  collectionContactId: "",
  debtType: "outro",
  contractNumber: "",
  installmentLabel: "",
  description: "",
  bundledCount: "1",
  needsSplit: false,
  hasGuarantor: false,
  guarantorName: "",
  realGuarantee: "",
  receivablesAssignment: false,
  guaranteeNotes: "",
  categoryId: "",
  subcategoryId: "",
  natureCode: "",
  accountCode: "",
  taxActiveDebt: false,
  original: "",
  updated: "",
  updatedRefDate: "",
  interest: "",
  fine: "",
  charges: "",
  contractRatePercent: "",
  accrualMonth: "",
  issueDate: "",
  dueDate: "",
  origin: "A",
  originOverrideReason: "",
  priority: "",
  priorityReasons: [],
  ownerUserId: "",
  nextAction: "",
  nextActionOn: "",
  notes: "",
  tagIds: [],
};

/** "1.234,56" → 123456; vazio → null; inválido → NaN (a tela avisa). */
export function centavosDoCampo(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const limpo = t.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(limpo)) return Number.NaN;
  return Math.round(Number(limpo) * 100);
}

/** "12,5" → 12.5; vazio → null; inválido → NaN. */
export function numeroDoCampo(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const limpo = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpo)) return Number.NaN;
  return Number(limpo);
}

/** O que falta para salvar (os mínimos do pedido: devedor, credor, valor, vencimento). */
export function faltaNoCadastro(f: DebtForm, sugerida: "A" | "B" | null): string | null {
  if (!f.clinicId) return "Escolha o devedor (unidade ou franqueadora).";
  if (!f.supplierId) return "Escolha o credor.";
  if (!f.dueDate) return "Informe a data de vencimento.";
  const campos: [string, string][] = [
    [f.original, "valor original"],
    [f.updated, "valor atualizado"],
    [f.interest, "juros"],
    [f.fine, "multa"],
    [f.charges, "encargos"],
  ];
  for (const [v, nome] of campos) {
    if (Number.isNaN(centavosDoCampo(v))) return `O ${nome} não é um valor válido (use 1.234,56).`;
  }
  if ((centavosDoCampo(f.original) ?? 0) <= 0 && (centavosDoCampo(f.updated) ?? 0) <= 0)
    return "Informe o valor da dívida (original ou atualizado).";
  if (Number.isNaN(numeroDoCampo(f.contractRatePercent))) return "A taxa de juros não é um número válido.";
  if (f.updated.trim() && !f.updatedRefDate) return "Informe a data de referência do valor atualizado.";
  if (f.subcategoryId && !f.categoryId) return "Escolha a categoria da subcategoria.";
  if (origemPedeJustificativa(f.origin, sugerida) && f.originOverrideReason.trim().length < 5)
    return "A origem escolhida difere da sugerida pela data de implantação: escreva a justificativa.";
  if (f.hasGuarantor && !f.guarantorName.trim()) return "Informe o nome do avalista.";
  const qtd = Number(f.bundledCount || "1");
  if (!Number.isInteger(qtd) || qtd < 1) return "A quantidade de dívidas reunidas precisa ser 1 ou mais.";
  return null;
}

/** O formulário no formato da porta `debt_save` (só ids e valores — sem nomes). */
export function debtToPayload(f: DebtForm) {
  return {
    id: f.id || null,
    clinic_id: f.clinicId,
    supplier_id: f.supplierId,
    group_id: f.groupId || null,
    collection_contact_id: f.collectionContactId || null,
    debt_type: f.debtType,
    contract_number: f.contractNumber,
    installment_label: f.installmentLabel,
    description: f.description,
    bundled_count: f.bundledCount || "1",
    needs_split: f.needsSplit,
    has_guarantor: f.hasGuarantor,
    guarantor_name: f.hasGuarantor ? f.guarantorName : "",
    real_guarantee: f.realGuarantee,
    receivables_assignment: f.receivablesAssignment,
    guarantee_notes: f.guaranteeNotes,
    category_id: f.categoryId || null,
    subcategory_id: f.subcategoryId || null,
    nature_code: f.natureCode || null,
    account_code: f.accountCode || null,
    tax_active_debt: f.taxActiveDebt,
    original_cents: centavosDoCampo(f.original),
    updated_cents: centavosDoCampo(f.updated),
    updated_ref_date: f.updatedRefDate || null,
    interest_cents: centavosDoCampo(f.interest),
    fine_cents: centavosDoCampo(f.fine),
    charges_cents: centavosDoCampo(f.charges),
    contract_rate_percent: numeroDoCampo(f.contractRatePercent),
    accrual_month: f.accrualMonth ? `${f.accrualMonth.slice(0, 7)}-01` : null,
    issue_date: f.issueDate || null,
    due_date: f.dueDate,
    origin: f.origin,
    origin_override_reason: f.originOverrideReason,
    priority: f.priority || null,
    priority_reasons: f.priorityReasons,
    owner_user_id: f.ownerUserId || null,
    next_action: f.nextAction,
    next_action_on: f.nextActionOn || null,
    notes: f.notes,
    tag_ids: f.tagIds,
  };
}

/** Centavos → "1.234,56" para o campo do formulário. */
export function campoDeCentavos(c: number | null | undefined): string {
  if (c === null || c === undefined) return "";
  return (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

