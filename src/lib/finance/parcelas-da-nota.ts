// AS PARCELAS DE UMA NOTA FISCAL IMPORTADA (OC-00109, decisão do dono
// 16/10/2026). O XML traz as duplicatas do fornecedor — e elas continuam sendo
// o ponto de partida. Mas quem importa pode trocar: pagou à vista, ou combinou
// outro parcelamento. A soma SEMPRE fecha com o total da nota: a última
// parcela absorve os centavos (mesma regra das parcelas de venda).

export type Parcela = { dueDate: string; amountCents: number };

export type ModoDasParcelas = "nota" | "avista" | "vezes";

export const ROTULO_DO_MODO: Record<ModoDasParcelas, string> = {
  nota: "Como veio na nota",
  avista: "À vista",
  vezes: "Em várias vezes",
};

/** Data ISO (aaaa-mm-dd) que existe no calendário? */
function dataValida(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, me - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === me - 1 && x.getUTCDate() === d;
}

/**
 * O mesmo dia, N meses depois. Dia que não existe no mês de chegada (31 em
 * fevereiro) vira o último dia daquele mês — o vencimento não pode pular mês.
 */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  const mm = String(alvo.getUTCMonth() + 1).padStart(2, "0");
  return `${alvo.getUTCFullYear()}-${mm}-${String(dia).padStart(2, "0")}`;
}

export type PedidoDeParcelas = {
  modo: ModoDasParcelas;
  /** Total da nota, em centavos. */
  totalCents: number;
  /** As duplicatas do XML. */
  daNota: Parcela[];
  /** À vista: o dia do pagamento. Em vezes: o 1º vencimento. */
  data: string;
  /** Em vezes: quantas. */
  vezes: number;
};

export function montarParcelas(p: PedidoDeParcelas): { ok: true; parcelas: Parcela[] } | { ok: false; erro: string } {
  if (!Number.isInteger(p.totalCents) || p.totalCents <= 0) {
    return { ok: false, erro: "A nota não tem total para parcelar." };
  }
  if (p.modo === "nota") {
    if (p.daNota.length === 0) return { ok: false, erro: "A nota não trouxe parcelas." };
    return { ok: true, parcelas: p.daNota };
  }
  if (!dataValida(p.data)) {
    return {
      ok: false,
      erro: p.modo === "avista" ? "Informe a data do pagamento." : "Informe o 1º vencimento.",
    };
  }
  if (p.modo === "avista") {
    return { ok: true, parcelas: [{ dueDate: p.data, amountCents: p.totalCents }] };
  }
  if (!Number.isInteger(p.vezes) || p.vezes < 2 || p.vezes > 60) {
    return { ok: false, erro: "Em quantas vezes? De 2 a 60." };
  }
  const base = Math.floor(p.totalCents / p.vezes);
  const parcelas: Parcela[] = [];
  for (let i = 0; i < p.vezes; i++) {
    parcelas.push({
      dueDate: somarMeses(p.data, i),
      // A última absorve os centavos: a soma fecha com o total da nota.
      amountCents: i === p.vezes - 1 ? p.totalCents - base * (p.vezes - 1) : base,
    });
  }
  return { ok: true, parcelas };
}

/** A soma confere com o total da nota? (O banco não confere — a tela, sim.) */
export function somaFecha(parcelas: Parcela[], totalCents: number): boolean {
  return parcelas.reduce((s, x) => s + x.amountCents, 0) === totalCents;
}
