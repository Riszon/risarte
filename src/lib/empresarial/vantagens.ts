// Risarte Empresarial — AS OUTRAS VANTAGENS DO PROGRAMA (1033, dono em 26/10/2026).
//
// Pedido: *"além dos procedimentos deve ter como inserir outras formas de
// benefícios como por exemplo: desconto em parceiros, palestras na empresa,
// publicidade da empresa nas tvs das unidades Risarte que for selecionada como
// principal, criar unidade específica para atendimento da empresa e etc."*
//
// A rede cadastra a vantagem (catálogo); a proposta escolhe e escreve o
// DETALHE daquela empresa; no fechamento ela vira COMPROMISSO acompanhado —
// é promessa de entrega, não desconto em orçamento.
//
// Puro e testado: as telas, o documento, o contrato e o fechamento fazem as
// mesmas perguntas.

/** Uma vantagem do catálogo da rede. */
export type Vantagem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

/** Uma vantagem escolhida numa proposta (ou num grupo). */
export type VantagemEscolhida = {
  perkId: string;
  /** O detalhe DESTA empresa: "2 palestras por ano", "TVs da unidade Cambé". */
  detail: string | null;
};

export const SITUACOES_DO_COMPROMISSO = ["PENDING", "IN_PROGRESS", "DELIVERED"] as const;
export type SituacaoDoCompromisso = (typeof SITUACOES_DO_COMPROMISSO)[number];
export const SITUACAO_ROTULO: Record<SituacaoDoCompromisso, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em andamento",
  DELIVERED: "Entregue",
};

/** Texto vazio vira nulo — "  " não é um detalhe. */
export function limparDetalhe(d: string | null | undefined): string | null {
  const t = (d ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * A vantagem em uma linha, para o documento, o contrato e a lista.
 * O detalhe da empresa vem depois do nome; sem detalhe, a descrição da rede.
 */
export function textoDaVantagem(
  nome: string,
  detalhe: string | null | undefined,
  descricao?: string | null
): string {
  const d = limparDetalhe(detalhe) ?? limparDetalhe(descricao);
  return d ? `${nome} — ${d}` : nome;
}

/**
 * APLICAR AS VANTAGENS DE UM GRUPO sobre as da proposta.
 *
 * Mesma lei dos benefícios por procedimento (`aplicarGrupo`): a vantagem que
 * o grupo traz substitui a mesma vantagem que já estava (com o detalhe do
 * grupo); o que o grupo não menciona fica como está.
 */
export function aplicarVantagensDoGrupo(
  atuais: readonly VantagemEscolhida[],
  grupo: readonly VantagemEscolhida[]
): { lista: VantagemEscolhida[]; incluidas: number; trocadas: number } {
  const porId = new Map(atuais.map((v) => [v.perkId, v]));
  let incluidas = 0;
  let trocadas = 0;
  for (const v of grupo) {
    if (porId.has(v.perkId)) trocadas += 1;
    else incluidas += 1;
    porId.set(v.perkId, { perkId: v.perkId, detail: limparDetalhe(v.detail) });
  }
  return { lista: [...porId.values()], incluidas, trocadas };
}

/** O que impede de salvar as vantagens escolhidas. */
export function problemasDasVantagens(lista: readonly VantagemEscolhida[]): string[] {
  const p: string[] = [];
  const vistas = new Set<string>();
  for (const v of lista) {
    if (vistas.has(v.perkId)) p.push("a mesma vantagem aparece duas vezes");
    vistas.add(v.perkId);
    if ((v.detail ?? "").length > 500) p.push("o detalhe de uma vantagem passa de 500 letras");
  }
  return [...new Set(p)];
}

/** "2 entregues · 1 em andamento · 1 pendente" — só o que existe. */
export function resumoDosCompromissos(
  lista: readonly { status: SituacaoDoCompromisso }[]
): string {
  const c: Record<SituacaoDoCompromisso, number> = { PENDING: 0, IN_PROGRESS: 0, DELIVERED: 0 };
  for (const v of lista) c[v.status] += 1;
  const partes = [
    c.DELIVERED > 0 ? `${c.DELIVERED} entregue${c.DELIVERED === 1 ? "" : "s"}` : null,
    c.IN_PROGRESS > 0 ? `${c.IN_PROGRESS} em andamento` : null,
    c.PENDING > 0 ? `${c.PENDING} pendente${c.PENDING === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : "nenhuma vantagem combinada";
}
