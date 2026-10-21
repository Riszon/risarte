// OD6 (J1) — a evolução que TRANCA e o ADENDO. Puro — testável sem banco.
// A mesma régua do banco (`_progress_note_locked`, 0315): se mudar aqui, muda lá.

import { isoDateIn } from "@/lib/dates";

export type LinhaDaEvolucao = {
  id: string;
  appointmentId: string | null;
  createdAt: string;
  /** 0315: a anotação que este adendo corrige (nulo = anotação original). */
  addendumOf: string | null;
};

/** Trancada? Adendo nasce trancado; a original tranca quando o atendimento
 *  dela é concluído; sem atendimento, quando o dia (do Brasil) em que foi
 *  escrita passa. */
export function anotacaoTrancada(
  n: LinhaDaEvolucao,
  atendimentosConcluidos: Set<string>,
  hoje: string
): boolean {
  if (n.addendumOf) return true;
  if (n.appointmentId) return atendimentosConcluidos.has(n.appointmentId);
  return isoDateIn(new Date(n.createdAt)) < hoje;
}

/** Separa as originais dos adendos: cada original leva os seus adendos, em
 *  ordem de criação; adendo cuja original não veio (sem acesso) fica de fora. */
export function agruparAdendos<T extends LinhaDaEvolucao>(
  linhas: T[]
): { original: T; adendos: T[] }[] {
  const adendos = new Map<string, T[]>();
  for (const l of linhas) {
    if (!l.addendumOf) continue;
    adendos.set(l.addendumOf, [...(adendos.get(l.addendumOf) ?? []), l]);
  }
  return linhas
    .filter((l) => !l.addendumOf)
    .map((original) => ({
      original,
      adendos: (adendos.get(original.id) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    }));
}
