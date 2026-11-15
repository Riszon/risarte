// LEVANTAMENTO DE DÍVIDAS — FASE 7: "E SE EU PAGAR ESTA PROPOSTA À VISTA?"
//
// Um cenário calculado SÓ NA TELA, nunca gravado: o fluxo de caixa oficial não
// é tocado (plano 1.3, ajuste 3). Parte do mesmo fluxo da tela de Fluxo de
// caixa (`cash_balance_before` + `cash_flow_series`, o previsto) e compara:
//   * sem acordo — o caixa como está projetado hoje;
//   * pagando à vista — sai o valor da proposta na data escolhida, e deixam
//     de sair os títulos da dívida que venceriam dentro da janela (o
//     pagamento à vista os substitui).
// Título já vencido não está no previsto (o fluxo não projeta vencido), então
// não volta nada por ele: o cenário não inventa dinheiro.

export type DiaPrevisto = { dia: string; entradaCents: number; saidaCents: number };
export type TituloDaDividaNoCaixa = { vencimento: string; faltaCents: number };

export type PontoDoCenario = { dia: string; semCents: number; comCents: number };

export type Cenario = {
  pontos: PontoDoCenario[];
  /** Os títulos da dívida que deixam de sair dentro da janela. */
  substituidosCents: number;
  sem: { menorCents: number; diaDoMenor: string; finalCents: number };
  com: { menorCents: number; diaDoMenor: string; finalCents: number };
  /** O primeiro dia em que o caixa fica negativo pagando à vista (nulo = não fica). */
  negativoEm: string | null;
  /** O primeiro dia em que ele já fica negativo SEM pagar (o problema não é a proposta). */
  negativoSemEm: string | null;
};

function somarDias(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

export function cenarioDeQuitacao(input: {
  hoje: string;
  dias: number;
  /** Saldo de hoje (o que já virou dinheiro até o fim do dia). */
  saldoHojeCents: number;
  previstos: DiaPrevisto[];
  titulos: TituloDaDividaNoCaixa[];
  pagamento: { dia: string; valorCents: number };
}): Cenario {
  const fim = somarDias(input.hoje, input.dias);
  const porDia = new Map<string, number>();
  for (const p of input.previstos) {
    if (p.dia < input.hoje || p.dia > fim) continue;
    porDia.set(p.dia, (porDia.get(p.dia) ?? 0) + p.entradaCents - p.saidaCents);
  }
  const volta = new Map<string, number>();
  let substituidos = 0;
  for (const t of input.titulos) {
    if (t.vencimento < input.hoje || t.vencimento > fim || t.faltaCents <= 0) continue;
    volta.set(t.vencimento, (volta.get(t.vencimento) ?? 0) + t.faltaCents);
    substituidos += t.faltaCents;
  }

  const pontos: PontoDoCenario[] = [];
  let sem = input.saldoHojeCents;
  let com = input.saldoHojeCents;
  for (let i = 0; i <= input.dias; i++) {
    const dia = somarDias(input.hoje, i);
    const mov = porDia.get(dia) ?? 0;
    sem += mov;
    com += mov + (volta.get(dia) ?? 0) - (dia === input.pagamento.dia ? input.pagamento.valorCents : 0);
    pontos.push({ dia, semCents: sem, comCents: com });
  }
  // Pagamento antes de hoje (data já passou): sai hoje.
  if (input.pagamento.dia < input.hoje) {
    for (const p of pontos) p.comCents -= input.pagamento.valorCents;
  }

  const menor = (k: "semCents" | "comCents") =>
    pontos.reduce((m, p) => (p[k] < m.v ? { v: p[k], dia: p.dia } : m), { v: pontos[0][k], dia: pontos[0].dia });
  const ms = menor("semCents");
  const mc = menor("comCents");
  return {
    pontos,
    substituidosCents: substituidos,
    sem: { menorCents: ms.v, diaDoMenor: ms.dia, finalCents: pontos[pontos.length - 1].semCents },
    com: { menorCents: mc.v, diaDoMenor: mc.dia, finalCents: pontos[pontos.length - 1].comCents },
    negativoEm: pontos.find((p) => p.comCents < 0)?.dia ?? null,
    negativoSemEm: pontos.find((p) => p.semCents < 0)?.dia ?? null,
  };
}
