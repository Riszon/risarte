// AP24 (decisões do dono, 04/11/2026; I1–I4 em
// docs/indica-mais-risos/AP24-PLANO.md): o PRESENTE DE BOAS-VINDAS do indicado
// e o PRÊMIO INDIVIDUAL da equipe em Riso Coins. Puro: testável sem banco.
//
// ⚠️ Espelhos do banco — mudou um, muda o outro (régua em
// `presente-do-indicado.test.ts`):
//   - `presenteDoIndicadoCents`  ↔ `v_presente` em `evaluate_negotiation_rules` (0363)
//   - `situacaoDoPresente`       ↔ `indica._presente_do_cliente` (2011)
//   - `divisaoDoPremio`          ↔ `indica._premiar_equipe` (2011)

export type SituacaoDoPresente =
  | "disponivel"
  | "aguarda_avaliacao"
  | "vencido"
  | "usado"
  | "encerrado";

export const SITUACAO_DO_PRESENTE: Record<SituacaoDoPresente, string> = {
  disponivel: "disponível",
  aguarda_avaliacao: "vale depois da avaliação",
  vencido: "vencido",
  usado: "já usado",
  encerrado: "não usado no primeiro tratamento",
};

/** O que a negociação precisa saber do presente do cliente. */
export type PresenteDaNegociacao = {
  /** IND-000123 — a indicação de onde o presente vem. */
  codigo: string;
  percentual: number;
  /** ISO; nulo antes do comparecimento à avaliação. */
  validoAte: string | null;
  situacao: SituacaoDoPresente;
  /** Percentual aplicado NESTA negociação (nulo = não aplicado). */
  aplicadoPercentual: number | null;
};

/**
 * I2: o presente sai do que o cliente pagaria depois do benefício do programa,
 * POR FORA da regra comercial (não entra no % do desconto).
 */
export function presenteDoIndicadoCents(pagavelCents: number, percentual: number | null): number {
  if (percentual === null || !Number.isFinite(percentual) || percentual <= 0) return 0;
  return Math.round((Math.max(0, pagavelCents) * percentual) / 100);
}

/** A situação do presente, na mesma ordem de perguntas do banco. */
export function situacaoDoPresente(i: {
  presenteUsadoEm: string | null;
  vendaId: string | null;
  compareceuEm: string | null;
  validoAte: string | null;
  agora: Date;
}): SituacaoDoPresente {
  if (i.presenteUsadoEm) return "usado";
  if (i.vendaId) return "encerrado";
  if (!i.compareceuEm || !i.validoAte) return "aguarda_avaliacao";
  if (i.agora.getTime() > new Date(i.validoAte).getTime()) return "vencido";
  return "disponivel";
}

export type PapelNoPremio = "origem" | "fechamento" | "origem_e_fechamento";

/**
 * I4: o prêmio por conversão em Riso Coins, dividido entre quem pediu e quem
 * fechou. A mesma pessoa nos dois papéis leva tudo; papel sem ninguém não é
 * pago; prêmio desligado (0) não paga ninguém.
 */
export function divisaoDoPremio(i: {
  totalRisoCoins: number;
  percentualOrigem: number;
  origemId: string | null;
  fechamentoId: string | null;
}): { usuarioId: string; papel: PapelNoPremio; risoCoins: number }[] {
  const total = Math.floor(i.totalRisoCoins);
  if (!Number.isFinite(total) || total <= 0) return [];
  if (i.origemId && i.origemId === i.fechamentoId) {
    return [{ usuarioId: i.origemId, papel: "origem_e_fechamento", risoCoins: total }];
  }
  const origem = Math.round((total * i.percentualOrigem) / 100);
  const fechamento = total - origem;
  const out: { usuarioId: string; papel: PapelNoPremio; risoCoins: number }[] = [];
  if (i.origemId && origem > 0) out.push({ usuarioId: i.origemId, papel: "origem", risoCoins: origem });
  if (i.fechamentoId && fechamento > 0) out.push({ usuarioId: i.fechamentoId, papel: "fechamento", risoCoins: fechamento });
  return out;
}
