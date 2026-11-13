// ASA3, entrega 1 — A CONTA DO SPLIT (spec 18.2). Puro: sem banco, sem Asaas.
//
// O Asaas transfere a cada carteira `fixedValue + netValue × percentualValue / 100`,
// e o netValue é o pago MENOS a tarifa (T = a × V + b). Para o repasse fechar
// em p × V (o percentual da taxa sobre o valor PAGO, D4), cada carteira vai com
//
//   percentualValue = q = p ÷ (1 − a)      arredondado PARA BAIXO em 4 casas
//   fixedValue      = F = q × b            arredondado PARA BAIXO no centavo
//
// e então F + q × (V − aV − b) = p × V para QUALQUER valor pago (com desconto,
// multa ou juros). Com tarifa fixa (Pix, boleto) a = 0: q = p e F = p × tarifa
// (S1). Os dois arredondamentos são para baixo: o erro é de até 1 centavo por
// carteira (2 em parcelas grandes, pelo corte das 4 casas) e SEMPRE a favor da unidade — o repasse nunca passa do percentual.
//
// Tarifa (S2 e proteção contra repasse a maior): entre a emissão e o
// vencimento, de TODAS as tarifas vigentes (início ou fim de promoção) e, no
// boleto, também as do Pix (o pagador pode usar o QR Code), vale a MENOR parte
// percentual e a MENOR parte fixa. Tarifa maior no pagamento = repasse um
// pouco menor (a favor da unidade); a fila da entrega 2 corrige quando muda.

export type MeioDoSplit = "PIX" | "BOLETO" | "CREDIT_CARD";

/** Uma tarifa de `acquirer_rates` (só o que a conta usa). */
export type TarifaVigente = {
  modality: string;
  fee_percent: number; // em %, ex.: 2.99
  fixed_fee_cents: number;
  valid_from: string | null; // AAAA-MM-DD; nulo = desde sempre
  valid_to: string | null; // AAAA-MM-DD; nulo = sem fim
  min_installments?: number | null;
};

/** A tarifa da conta: a = fração (0,0299), b = centavos fixos. */
export type TarifaDoSplit = { a: number; bCents: number };

/** Quais modalidades o pagador pode usar em cada meio emitido. */
export function modalidadesDoMeio(meio: MeioDoSplit): string[] {
  if (meio === "PIX") return ["pix"];
  if (meio === "BOLETO") return ["boleto", "pix"];
  return ["credito_avista"];
}

const dia = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);

/** As tarifas das modalidades do meio que valem em algum dia de [de, ate]. */
export function tarifasNaJanela(
  tarifas: TarifaVigente[],
  meio: MeioDoSplit,
  de: string,
  ate: string
): TarifaVigente[] {
  const mods = new Set(modalidadesDoMeio(meio));
  return tarifas.filter((t) => {
    if (!mods.has(t.modality)) return false;
    if (t.modality === "credito_avista" && t.min_installments != null && t.min_installments > 1) return false;
    const ini = dia(t.valid_from);
    const fim = dia(t.valid_to);
    return (ini == null || ini <= ate) && (fim == null || fim >= de);
  });
}

export class SemTarifa extends Error {
  constructor(meio: MeioDoSplit) {
    super(`Sem tarifa do Asaas para ${meio} na conta da unidade.`);
    this.name = "SemTarifa";
  }
}

/** A MENOR parte percentual e a MENOR parte fixa da janela (proteção contra repasse a maior). */
export function tarifaParaOSplit(tarifas: TarifaVigente[], meio: MeioDoSplit, de: string, ate: string): TarifaDoSplit {
  const ok = tarifasNaJanela(tarifas, meio, de, ate);
  if (!ok.length) throw new SemTarifa(meio);
  return {
    a: Math.min(...ok.map((t) => Number(t.fee_percent) / 100)),
    bCents: Math.min(...ok.map((t) => Math.round(Number(t.fixed_fee_cents)))),
  };
}

/** A MAIOR parte percentual e a MAIOR parte fixa da janela (o pior caso do teto). */
export function tarifaMaxima(tarifas: TarifaVigente[], meio: MeioDoSplit, de: string, ate: string): TarifaDoSplit {
  const ok = tarifasNaJanela(tarifas, meio, de, ate);
  if (!ok.length) throw new SemTarifa(meio);
  return {
    a: Math.max(...ok.map((t) => Number(t.fee_percent) / 100)),
    bCents: Math.max(...ok.map((t) => Math.round(Number(t.fixed_fee_cents)))),
  };
}

// Arredondamentos PARA BAIXO, à prova de 0,1 + 0,2 (o épsilon só corrige ruído
// binário, nunca sobe um valor de verdade).
const EPS = 1e-9;
export const paraBaixo4 = (x: number) => Math.floor(x * 1e4 + EPS) / 1e4;
export const centavosParaBaixo = (reais: number) => Math.floor(reais * 100 + EPS);

/** Uma carteira com a soma dos percentuais das taxas que vão para ela. */
export type CarteiraDoSplit = { walletId: string; percent: number };

/** A entrada que vai ao Asaas (fixedValue em centavos aqui; reais só no envio). */
export type EntradaDoSplit = { walletId: string; percent: number; percentualValue: number; fixedCents: number };

export function entradasDoSplit(carteiras: CarteiraDoSplit[], tarifa: TarifaDoSplit): EntradaDoSplit[] {
  if (!(tarifa.a >= 0 && tarifa.a < 1)) throw new Error("tarifa percentual inválida");
  return carteiras
    .filter((c) => Number(c.percent) > 0)
    .map((c) => {
      const q = paraBaixo4(Number(c.percent) / (1 - tarifa.a));
      return {
        walletId: c.walletId,
        percent: Number(c.percent),
        percentualValue: q,
        fixedCents: centavosParaBaixo(((q / 100) * tarifa.bCents) / 100),
      };
    });
}

/** O que o Asaas recebe em `splits`. */
export function splitsParaOAsaas(entradas: EntradaDoSplit[]) {
  return entradas.map((e) => ({
    walletId: e.walletId,
    percentualValue: e.percentualValue,
    ...(e.fixedCents > 0 ? { fixedValue: e.fixedCents / 100 } : {}),
  }));
}

/**
 * Quanto o Asaas transferiria a cada carteira se o pago fosse `pagoCents` com a
 * tarifa `tarifa` (para a prova e o teto). O Asaas ARREDONDA PARA BAIXO o
 * percentual × líquido (medido no sandbox em 13/11/2026, spec 18.6).
 */
export function repasseSimulado(entradas: EntradaDoSplit[], pagoCents: number, tarifa: TarifaDoSplit) {
  const tarifaCents = Math.round(tarifa.a * pagoCents + tarifa.bCents);
  const liquido = pagoCents - tarifaCents;
  return entradas.map((e) => ({
    walletId: e.walletId,
    cents: e.fixedCents + Math.floor((liquido * e.percentualValue) / 100 + 1e-9),
    devidoCents: Math.round((pagoCents * e.percent) / 100),
  }));
}

/**
 * TETO DE SEGURANÇA (spec 4, item 6): no pior caso — o menor valor possível
 * (com o maior desconto) e a MAIOR tarifa da janela — a soma dos repasses não
 * pode passar do líquido. Se passar, a cobrança não sai.
 */
export function cabeNoLiquido(entradas: EntradaDoSplit[], valorCents: number, descontoCents: number, tarifaMax: TarifaDoSplit) {
  const menor = Math.max(0, valorCents - Math.max(0, descontoCents));
  const tarifaCents = Math.ceil(tarifaMax.a * menor + tarifaMax.bCents);
  const liquido = menor - tarifaCents;
  const total = entradas.reduce((s, e) => s + e.fixedCents + Math.ceil((Math.max(liquido, 0) * e.percentualValue) / 100), 0);
  return { ok: liquido > 0 && total <= liquido, liquidoCents: liquido, repasseCents: total };
}

/** O plano que o banco devolve (`_charge_split_plan`). */
export type PlanoDoSplit =
  | { elegivel: false; motivo: string }
  | {
      elegivel: true;
      carteiras: { accountId: string; walletId: string; percent: number; fees: Record<string, number> }[];
      tarifas: TarifaVigente[];
      hoje: string;
      vencimento: string;
      valorCents: number;
      descontoCents: number;
      meio: MeioDoSplit;
    };

/** A entrada como o banco grava (`_charge_save_split`). */
export type EntradaParaGravar = EntradaDoSplit & {
  accountId: string;
  fees: Record<string, number>;
  tariffPercent: number;
  tariffFixedCents: number;
  asaasSplitId?: string | null;
};

export type DecisaoDoSplit =
  | { vai: false; motivo: string; recusar: false }
  | { vai: false; motivo: "teto"; recusar: true; liquidoCents: number; repasseCents: number }
  | { vai: true; entradas: EntradaParaGravar[] };

/**
 * Do plano à decisão: sem split (com o motivo), cobrança RECUSADA pelo teto,
 * ou as entradas a enviar. A janela da tarifa vai de hoje ao vencimento.
 */
export function decidirSplit(plano: PlanoDoSplit): DecisaoDoSplit {
  if (!plano.elegivel) return { vai: false, motivo: plano.motivo, recusar: false };
  const de = plano.hoje;
  const ate = plano.vencimento > plano.hoje ? plano.vencimento : plano.hoje;
  let tarifa: TarifaDoSplit;
  let maxima: TarifaDoSplit;
  try {
    tarifa = tarifaParaOSplit(plano.tarifas, plano.meio, de, ate);
    maxima = tarifaMaxima(plano.tarifas, plano.meio, de, ate);
  } catch (e) {
    if (e instanceof SemTarifa) return { vai: false, motivo: "sem_tarifa", recusar: false };
    throw e;
  }
  const base = entradasDoSplit(
    plano.carteiras.map((c) => ({ walletId: c.walletId, percent: Number(c.percent) })),
    tarifa
  );
  if (!base.length) return { vai: false, motivo: "sem_taxa", recusar: false };
  const teto = cabeNoLiquido(base, Number(plano.valorCents), Number(plano.descontoCents), maxima);
  if (!teto.ok) return { vai: false, motivo: "teto", recusar: true, liquidoCents: teto.liquidoCents, repasseCents: teto.repasseCents };
  const porCarteira = new Map(plano.carteiras.map((c) => [c.walletId, c]));
  return {
    vai: true,
    entradas: base.map((e) => ({
      ...e,
      accountId: porCarteira.get(e.walletId)!.accountId,
      fees: porCarteira.get(e.walletId)!.fees,
      tariffPercent: Math.round(tarifa.a * 100 * 1e4) / 1e4,
      tariffFixedCents: tarifa.bCents,
    })),
  };
}

/** Casa o que o Asaas devolveu com o que foi enviado (pelo walletId). */
export function comIdsDoAsaas(
  entradas: EntradaParaGravar[],
  doAsaas: { id?: string | null; walletId?: string | null }[] | null | undefined
): EntradaParaGravar[] {
  const ids = new Map((doAsaas ?? []).filter((s) => s.walletId).map((s) => [s.walletId as string, s.id ?? null]));
  return entradas.map((e) => ({ ...e, asaasSplitId: ids.get(e.walletId) ?? null }));
}

/** ASA3 (4009): o split refeito é o MESMO que já está no Asaas? (então não chama). */
export function mesmasEntradas(
  a: { walletId: string; percentualValue: number; fixedCents: number }[],
  b: { walletId: string; percentualValue: number; fixedCents: number }[]
): boolean {
  const chave = (x: { walletId: string; percentualValue: number; fixedCents: number }[]) =>
    [...x]
      .map((e) => `${e.walletId}|${Number(e.percentualValue).toFixed(4)}|${Math.round(Number(e.fixedCents))}`)
      .sort()
      .join(";");
  return chave(a) === chave(b);
}

/**
 * ASA3 (4009, U7): o BLOQUEIO por divergência — o split passou do líquido real
 * da cobrança. Reduz cada entrada na mesma proporção, para baixo, até caber
 * (com 1 centavo de folga). A falta em relação ao devido segue a S5.
 */
export function reduzirAoLiquido<T extends { percentualValue: number; fixedCents: number }>(entradas: T[], liquidoCents: number): T[] {
  const total = entradas.reduce((s, e) => s + e.fixedCents + (liquidoCents * e.percentualValue) / 100, 0);
  if (total <= liquidoCents - 1 || total <= 0) return entradas;
  const k = (liquidoCents - 1) / total;
  return entradas.map((e) => ({
    ...e,
    percentualValue: paraBaixo4(e.percentualValue * k),
    fixedCents: Math.floor(e.fixedCents * k + EPS),
  }));
}
