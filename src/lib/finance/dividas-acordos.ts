// LEVANTAMENTO DE DÍVIDAS — FASE 5 (0408): o acordo e o encerramento. Regras
// puras, para a tela montar e explicar; quem decide é o banco
// (`_debt_agreement_check`, `debt_agreement_save` e companhia). A conferência
// do impacto (S, desconto, encargos, aprovação) vem PRONTA do banco
// (`debt_agreement_preview`): a tela mostra a conta que o banco vai gravar.
//
// Plano: docs/Financeiro/DIVIDAS-PLANO.md (1.3, 3.2, 3.3, 4.7).

export const AGREEMENT_STATUSES = [
  "aguardando_aprovacao",
  "em_andamento",
  "quebrado",
  "restabelecido",
  "cumprido",
  "substituido",
  "desfeito",
  "recusado",
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  em_andamento: "Em andamento",
  quebrado: "Quebrado",
  restabelecido: "Credor restabeleceu a dívida",
  cumprido: "Cumprido",
  substituido: "Substituído por outro acordo",
  desfeito: "Desfeito",
  recusado: "Recusado na aprovação",
};

export const AGREEMENT_STATUS_TONE: Record<AgreementStatus, string> = {
  aguardando_aprovacao: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  em_andamento: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  quebrado: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
  restabelecido: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  cumprido: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  substituido: "bg-muted text-muted-foreground",
  desfeito: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  recusado: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/** Acordo que ainda manda na dívida (o que a situação dela segue). */
export function acordoVigente(s: AgreementStatus): boolean {
  return s === "aguardando_aprovacao" || s === "em_andamento" || s === "quebrado";
}

export const RECOGNITION_LABELS = {
  na_data_do_acordo: "na data do acordo",
  proporcional: "a cada parcela paga (proporcional)",
} as const;
export type Recognition = keyof typeof RECOGNITION_LABELS;

// ------------------------------------------------------------- as parcelas

export type ParcelaDoAcordo = { vencimento: string; valorCents: number; entrada: boolean };

/** Soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02). Datas ISO. */
export function somarMeses(iso: string, n: number): string {
  const ano = +iso.slice(0, 4);
  const mes = +iso.slice(5, 7) - 1 + n;
  const dia = +iso.slice(8, 10);
  const alvoAno = ano + Math.floor(mes / 12);
  const alvoMes = ((mes % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(alvoAno, alvoMes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(alvoAno, alvoMes, Math.min(dia, ultimo)));
  return d.toISOString().slice(0, 10);
}

/** Soma dias corridos a uma data ISO. */
export function somarDias(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/**
 * A tabela de vencimentos sugerida (3.2): entrada (se houver) na data dela e
 * N parcelas mensais iguais a partir do 1º vencimento; a ÚLTIMA absorve o
 * resíduo do arredondamento. A pessoa pode editar cada linha depois.
 */
export function montarParcelas(input: {
  totalCents: number;
  entradaCents: number;
  parcelas: number;
  dataDaEntrada: string;
  primeiroVencimento: string;
}): ParcelaDoAcordo[] {
  const total = Math.max(0, Math.round(input.totalCents));
  const entrada = Math.min(total, Math.max(0, Math.round(input.entradaCents)));
  const n = Math.max(0, Math.floor(input.parcelas));
  const out: ParcelaDoAcordo[] = [];
  if (entrada > 0) out.push({ vencimento: input.dataDaEntrada, valorCents: entrada, entrada: true });
  const resto = total - entrada;
  if (n === 0 || resto === 0) {
    if (resto > 0) out.push({ vencimento: input.primeiroVencimento, valorCents: resto, entrada: false });
    return out;
  }
  const cada = Math.floor(resto / n);
  for (let i = 0; i < n; i++) {
    const valor = i === n - 1 ? resto - cada * (n - 1) : cada;
    out.push({ vencimento: somarMeses(input.primeiroVencimento, i), valorCents: valor, entrada: false });
  }
  return out;
}

export function somaDasParcelas(p: ParcelaDoAcordo[]): number {
  return p.reduce((t, x) => t + x.valorCents, 0);
}

/** O que falta antes de pedir a conferência ao banco (a mesma ordem dele). */
export function faltaNoAcordo(input: {
  data: string;
  hoje: string;
  totalCents: number | null;
  parcelas: ParcelaDoAcordo[];
}): string | null {
  if (!input.data) return "Informe a data do acordo.";
  if (input.data > input.hoje) return "A data do acordo não pode ser futura.";
  if (!input.totalCents || input.totalCents <= 0) return "Informe o total do acordo.";
  if (input.parcelas.length === 0) return "Monte as parcelas do acordo.";
  if (input.parcelas.length > 360) return "No máximo 360 parcelas.";
  if (input.parcelas.some((p) => !p.vencimento || p.valorCents <= 0 || p.vencimento < input.data))
    return "Toda parcela precisa de vencimento (a partir da data do acordo) e de valor.";
  if (somaDasParcelas(input.parcelas) !== input.totalCents) return "A soma das parcelas não fecha com o total.";
  if (input.parcelas.filter((p) => p.entrada).length > 1) return "Só uma parcela pode ser a entrada.";
  return null;
}

/** O que vai para a porta do banco (`debt_agreement_save` / `_preview`). */
export function acordoParaOBanco(f: {
  dividas: string[];
  principal: string;
  data: string;
  totalCents: number;
  parcelas: ParcelaDoAcordo[];
  propostaId: string | null;
  forma: string | null;
  canal: string | null;
  contatoId: string | null;
  toleranciaDiasUteis: number | null;
  observacoes: string;
}) {
  const ordenadas = [...f.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || Number(b.entrada) - Number(a.entrada));
  return {
    debt_ids: f.dividas,
    primary_debt_id: f.principal,
    agreed_on: f.data,
    total_cents: f.totalCents,
    schedule: ordenadas.map((p) => ({ due_date: p.vencimento, amount_cents: p.valorCents, entrada: p.entrada })),
    proposal_id: f.propostaId,
    method: f.forma || null,
    channel: f.canal || null,
    contact_id: f.contatoId || null,
    broken_tolerance_bdays: f.toleranciaDiasUteis,
    notes: f.observacoes.trim() || null,
  };
}

// ---------------------------------------------- a conferência do banco

export type PreviaDoAcordo = {
  problema: string | null;
  dividas: string[];
  /** Dívidas que entraram sozinhas (eram do mesmo acordo quebrado/restabelecido). */
  acrescentadas: string[];
  titulos: number;
  baseCents: number;
  totalCents: number;
  descontoCents: number;
  encargosCents: number;
  reconhecerDesconto: Recognition;
  reconhecerEncargos: Recognition;
  parcelas: number;
  pedeAprovacao: boolean;
  valorDeAprovacaoCents: number | null;
  toleranciaDiasUteis: number;
};

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : []);
const recon = (x: unknown): Recognition => (x === "proporcional" ? "proporcional" : "na_data_do_acordo");

export function previaDoBanco(v: Record<string, unknown> | null | undefined): PreviaDoAcordo {
  const r = v ?? {};
  return {
    problema: typeof r.problem === "string" ? r.problem : null,
    dividas: lista(r.debt_ids),
    acrescentadas: lista(r.added_debt_ids),
    titulos: Number(r.titles ?? 0),
    baseCents: Number(r.base_cents ?? 0),
    totalCents: Number(r.total_cents ?? 0),
    descontoCents: Number(r.discount_cents ?? 0),
    encargosCents: Number(r.surcharge_cents ?? 0),
    reconhecerDesconto: recon(r.discount_recognition),
    reconhecerEncargos: recon(r.surcharge_recognition),
    parcelas: Number(r.installments ?? 0),
    pedeAprovacao: r.needs_approval === true,
    valorDeAprovacaoCents: r.threshold_cents === null || r.threshold_cents === undefined ? null : Number(r.threshold_cents),
    toleranciaDiasUteis: Number(r.tolerance_bdays ?? 3),
  };
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O resumo do impacto (3.2, passo 3), linha a linha, na voz de quem opera. */
export function fraseDoImpactoDoAcordo(p: PreviaDoAcordo, devedor: string): string[] {
  if (p.problema) return [p.problema];
  const linhas = [
    `${p.titulos} título${p.titulos === 1 ? "" : "s"} em aberto no Contas a Pagar de ${devedor} vira${p.titulos === 1 ? "" : "m"} "renegociado" (${brl(p.baseCents)}): sai${p.titulos === 1 ? "" : "em"} do "a pagar", nada se apaga.`,
    `Nasce${p.parcelas === 1 ? "" : "m"} ${p.parcelas} título${p.parcelas === 1 ? "" : "s"} do acordo na conta 5.5.02 (fora da DRE), total ${brl(p.totalCents)}.`,
  ];
  if (p.descontoCents > 0)
    linhas.push(`Desconto obtido de ${brl(p.descontoCents)} na conta 4.1.03 (receita financeira, entra na DRE) — ${RECOGNITION_LABELS[p.reconhecerDesconto]}.`);
  if (p.encargosCents > 0)
    linhas.push(`Encargos da renegociação de ${brl(p.encargosCents)} na conta 4.2.01 (despesa financeira, entra na DRE) — ${RECOGNITION_LABELS[p.reconhecerEncargos]}.`);
  if (p.descontoCents === 0 && p.encargosCents === 0) linhas.push("Sem desconto nem encargos: o total é igual ao que faltava pagar.");
  linhas.push(`Passados ${p.toleranciaDiasUteis} dia${p.toleranciaDiasUteis === 1 ? "" : "s"} úteis de uma parcela vencida sem pagamento, o acordo fica quebrado.`);
  if (p.pedeAprovacao)
    linhas.push(
      `O total passa de ${brl(p.valorDeAprovacaoCents ?? 0)}: o acordo espera a aprovação do Admin Master, e nada disso acontece até lá.`
    );
  return linhas;
}

// ------------------------------------------------------------- os botões

/** Quais ações o acordo oferece (espelho das recusas das portas do banco). */
export function acoesDoAcordo(input: {
  situacao: AgreementStatus;
  temPagamento: boolean;
  podeRenegociar: boolean;
  souAdminMaster: boolean;
  registreiEu: boolean;
}): { aprovar: boolean; desfazer: boolean; restabelecer: boolean; renegociarDeNovo: boolean } {
  const s = input.situacao;
  return {
    aprovar: s === "aguardando_aprovacao" && input.souAdminMaster && !input.registreiEu,
    desfazer: input.podeRenegociar && (s === "aguardando_aprovacao" || ((s === "em_andamento" || s === "quebrado") && !input.temPagamento)),
    restabelecer: input.podeRenegociar && s === "quebrado",
    renegociarDeNovo: input.podeRenegociar && (s === "quebrado" || s === "restabelecido"),
  };
}

// ------------------------------------------------------ o encerramento (3.3)

export const CLOSING_ITEMS = ["quitacao", "baixa_negativacao", "protesto_cancelado", "processo_extinto"] as const;
export type ClosingItem = (typeof CLOSING_ITEMS)[number];

export const CLOSING_ITEM_LABELS: Record<ClosingItem, string> = {
  quitacao: "Termo de quitação (ou comprovante do último pagamento)",
  baixa_negativacao: "Baixa da negativação confirmada",
  protesto_cancelado: "Protesto cancelado (carta de anuência e custas)",
  processo_extinto: "Processo judicial extinto",
};

export const CLOSING_ITEM_HELP: Record<ClosingItem, string> = {
  quitacao: "Guarde o termo ou o comprovante em Anexos e ligue aqui.",
  baixa_negativacao: "O credor tem o prazo da regra (dias úteis depois do pagamento) para tirar o nome. Confira no Serasa/SPC.",
  protesto_cancelado: "Com a carta de anuência do credor, pague as custas no cartório e guarde o comprovante.",
  processo_extinto: "Peça ao advogado o andamento com a extinção do processo.",
};

export type ItemDoEncerramento = {
  id: string;
  item: ClosingItem;
  aplicavel: boolean;
  motivoDeNaoAplicar: string | null;
  prazo: string | null;
  feitoEm: string | null;
  feitoPor: string | null;
  anexoId: string | null;
  observacao: string | null;
};

/** Quantos itens ainda faltam (o "não se aplica" conta como resolvido). */
export function faltamNoEncerramento(itens: ItemDoEncerramento[]): number {
  return itens.filter((i) => i.aplicavel && !i.feitoEm).length;
}
