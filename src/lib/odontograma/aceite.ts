// OD4: o odontograma da APRESENTAÇÃO, do ACEITE e do ORÇAMENTO. Puro —
// testável sem banco. O desenho mora em `desenho.ts`; o lugar do item, em
// `plano.ts`.

import type { Denticao, MarcaNoDente } from "@/lib/odontograma/desenho";
import type { SituacaoDoDente } from "@/lib/odontograma/diagnostico";
import { marcasDoPlano, rotuloDoLocal, type RegraDoPlano } from "@/lib/odontograma/plano";

/** O que a tela do cliente precisa para desenhar a boca — sem os achados em
 *  si (quem sugeriu, quando): só as marcas já definidas pelo Planner. */
export type OdontoDaApresentacao = {
  nomes: Record<string, string>;
  faces: Record<string, string[]>;
  denticao: Denticao;
  motivoDaDenticao: string;
  situacoes: SituacaoDoDente[];
  regras: Record<string, RegraDoPlano>;
  regioes: { code: string; name: string }[];
  /** Diagnóstico DEFINIDO (azul; vermelho o que é "a tratar"). */
  existentes: MarcaNoDente[];
};

export type ItemComLocal = {
  id: string;
  description: string;
  procedureId?: string | null;
  toothCode?: string | null;
  faceCodes?: string[] | null;
  regionCode?: string | null;
};

const local = (i: ItemComLocal) => ({
  toothCode: i.toothCode ?? null,
  faceCodes: i.faceCodes ?? [],
  regionCode: i.regionCode ?? null,
});

/** "16 (O)" / "Dente 46" / "Arcada superior" — ou nulo (item sem lugar). */
export function localDoItem(i: ItemComLocal, regioes: { code: string; name: string }[] = []): string | null {
  return rotuloDoLocal(local(i), (c) => regioes.find((r) => r.code === c)?.name);
}

/**
 * O desenho do aceite: o que o cliente aceitou em VERMELHO (a realizar); o que
 * ficou de fora em cinza-claro tracejado; e, por baixo, o diagnóstico. A
 * ordem importa: na mesma face vale a primeira marca — o plano vem antes.
 */
export function marcasDoAceite(
  itens: ItemComLocal[],
  excluidos: Iterable<string>,
  odonto: Pick<OdontoDaApresentacao, "regras" | "situacoes" | "existentes">
): MarcaNoDente[] {
  const fora = new Set(excluidos);
  const doPlano = (lista: ItemComLocal[]) =>
    marcasDoPlano(
      lista.map((i) => ({ ...local(i), procedureId: i.procedureId ?? null, description: i.description })),
      odonto.regras,
      odonto.situacoes
    );
  return [
    ...doPlano(itens.filter((i) => !fora.has(i.id))),
    ...doPlano(itens.filter((i) => fora.has(i.id))).map((m) => ({ ...m, situacao: "fora" as const })),
    ...odonto.existentes,
  ];
}

/** Os itens que estão NESTE dente. */
export function itensDoDente(itens: ItemComLocal[], dente: string): string[] {
  return itens.filter((i) => i.toothCode === dente).map((i) => i.id);
}

/**
 * Tocar no dente: se algum item dele está aceito, tira TODOS os do dente; se
 * nenhum está, devolve todos. Dente sem item não muda nada.
 */
export function alternarDente(itens: ItemComLocal[], excluidos: string[], dente: string): string[] {
  const doDente = itensDoDente(itens, dente);
  if (doDente.length === 0) return excluidos;
  const fora = new Set(excluidos);
  const algumAceito = doDente.some((id) => !fora.has(id));
  for (const id of doDente) {
    if (algumAceito) fora.add(id);
    else fora.delete(id);
  }
  return [...fora];
}

/**
 * A lista "por dente" do slide e do orçamento: dente em ordem FDI (11, 12…
 * 48), depois as regiões, por fim o que não tem lugar — cada um com o rótulo.
 */
export function porDente<T extends ItemComLocal>(
  itens: T[],
  regioes: { code: string; name: string }[] = []
): { item: T; local: string | null }[] {
  const chave = (i: T) => (i.toothCode ? `0${i.toothCode}` : i.regionCode ? `1${i.regionCode}` : "2");
  return [...itens]
    .map((item, ordem) => ({ item, ordem, local: localDoItem(item, regioes) }))
    .sort((a, b) => chave(a.item).localeCompare(chave(b.item)) || a.ordem - b.ordem)
    .map(({ item, local }) => ({ item, local }));
}

/**
 * O plano da NEGOCIAÇÃO (OD4): o aprovado mais novo que vale. Plano
 * substituído só conta se foi vendido (aceita ou cancelada depois de
 * fechada) — o que foi vendido vale; o resto recomeça na versão nova.
 */
export function planoDaNegociacao(
  planos: { id: string; createdAt: string; supersededAt: string | null; negociacao: string | null }[]
): string | null {
  const vendido = (s: string | null) => s === "aceita" || s === "cancelada";
  return (
    [...planos]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .find((p) => !p.supersededAt || vendido(p.negociacao))?.id ?? null
  );
}
