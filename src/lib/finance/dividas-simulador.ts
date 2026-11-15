// LEVANTAMENTO DE DÍVIDAS — FASE 8: O SIMULADOR DE QUITAÇÃO (3.12 do pedido).
//
// Escolhem-se várias dívidas na lista; o simulador diz quanto custa quitar o
// conjunto (a proposta, quando há, senão o devido — mais as custas de
// cartório) e a economia, e sugere a ORDEM de quitação:
//   1. prioridade (alta → média → baixa → sem prioridade);
//   2. com restrição (negativada, protestada ou judicial) antes;
//   3. maior desconto da proposta antes (sem proposta vai depois);
//   4. proposta que vence antes, antes.
// Com o valor disponível de cada CNPJ (sugerido: o menor saldo do caixa
// projetado nos próximos 30 dias, para não deixar o caixa negativo), marca o
// que cabe, na ordem — e pula o que não cabe para tentar os menores seguintes.
//
// ⚠️ CADA CNPJ PAGA COM O CAIXA DELE: o dinheiro de uma unidade não quita a
// dívida de outra. Só tela; nada é gravado. Puro e testado.

import { descontoDaProposta, type Priority } from "./dividas";

export type ItemDoSimulador = {
  id: string;
  code: string;
  clinicId: string;
  clinicName: string;
  supplierName: string;
  devidoCents: number;
  propostaCents: number | null;
  propostaValidade: string | null;
  custasCents: number;
  prioridade: Priority | null;
  comRestricao: boolean;
};

export type ItemSimulado = ItemDoSimulador & {
  ordem: number;
  /** Proposta (ou devido) + custas. */
  custoCents: number;
  economiaCents: number;
  desconto: number | null;
  /** Nulo = sem valor disponível informado para o CNPJ. */
  cabe: boolean | null;
  /** Quanto do disponível já foi usado depois desta (só as que cabem). */
  usadoAteAquiCents: number | null;
};

const PESO: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

export function custoDoItem(i: ItemDoSimulador): { custoCents: number; economiaCents: number; desconto: number | null } {
  const comProposta = i.propostaCents !== null;
  return {
    custoCents: (comProposta ? i.propostaCents! : i.devidoCents) + i.custasCents,
    economiaCents: comProposta ? Math.max(0, i.devidoCents - i.propostaCents!) : 0,
    desconto: descontoDaProposta(i.devidoCents, i.propostaCents),
  };
}

/** A ordem sugerida (critérios no cabeçalho). Empate final: pelo código. */
export function ordemSugerida(itens: ItemDoSimulador[]): ItemDoSimulador[] {
  return [...itens].sort((a, b) => {
    const pa = PESO[a.prioridade ?? ""] ?? 3;
    const pb = PESO[b.prioridade ?? ""] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a.comRestricao !== b.comRestricao) return a.comRestricao ? -1 : 1;
    const da = custoDoItem(a).desconto ?? -1;
    const db = custoDoItem(b).desconto ?? -1;
    if (da !== db) return db - da;
    const va = a.propostaValidade ?? "9999-12-31";
    const vb = b.propostaValidade ?? "9999-12-31";
    if (va !== vb) return va.localeCompare(vb);
    return a.code.localeCompare(b.code);
  });
}

export type DevedorSimulado = {
  clinicId: string;
  nome: string;
  disponivelCents: number | null;
  itens: ItemSimulado[];
  custoCents: number;
  /** O que cabe no disponível, na ordem sugerida. */
  cabeCents: number;
  quitaveis: number;
  sobraCents: number | null;
  economiaQueCabeCents: number;
};

export function simularQuitacao(
  itens: ItemDoSimulador[],
  disponivel: Record<string, number | null>
): {
  totais: { devidoCents: number; custoCents: number; custasCents: number; economiaCents: number; semProposta: number };
  devedores: DevedorSimulado[];
} {
  const porDevedor = new Map<string, ItemDoSimulador[]>();
  for (const i of itens) porDevedor.set(i.clinicId, [...(porDevedor.get(i.clinicId) ?? []), i]);

  const devedores: DevedorSimulado[] = [...porDevedor.entries()]
    .map(([clinicId, lista]) => {
      const disp = disponivel[clinicId] ?? null;
      let restante = disp;
      let usado = 0;
      const simulados = ordemSugerida(lista).map((i, k): ItemSimulado => {
        const c = custoDoItem(i);
        let cabe: boolean | null = null;
        if (restante !== null) {
          cabe = c.custoCents <= restante;
          if (cabe) {
            restante -= c.custoCents;
            usado += c.custoCents;
          }
        }
        return { ...i, ...c, ordem: k + 1, cabe, usadoAteAquiCents: disp === null ? null : usado };
      });
      const quem = simulados.filter((x) => x.cabe);
      return {
        clinicId,
        nome: lista[0].clinicName,
        disponivelCents: disp,
        itens: simulados,
        custoCents: simulados.reduce((t, x) => t + x.custoCents, 0),
        cabeCents: quem.reduce((t, x) => t + x.custoCents, 0),
        quitaveis: quem.length,
        sobraCents: restante,
        economiaQueCabeCents: quem.reduce((t, x) => t + x.economiaCents, 0),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    totais: {
      devidoCents: itens.reduce((t, i) => t + i.devidoCents, 0),
      custoCents: devedores.reduce((t, d) => t + d.custoCents, 0),
      custasCents: itens.reduce((t, i) => t + i.custasCents, 0),
      economiaCents: devedores.reduce((t, d) => t + d.itens.reduce((x, i) => x + i.economiaCents, 0), 0),
      semProposta: itens.filter((i) => i.propostaCents === null).length,
    },
    devedores,
  };
}
