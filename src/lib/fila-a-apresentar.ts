import { addDaysIso, isoDateIn } from "@/lib/dates";

/**
 * A FILA "A APRESENTAR" DO COMERCIAL (relato OC-00169, 04/11/2026).
 *
 * "Os casos em A APRESENTAR estão em ordem alfabética. A ordem ideal é por data
 * de agendamento. Cliente que chegou entra em cima, por ter prioridade por já
 * estar presente." E filtros: Hoje, Próximos 3 dias, Sem agendamento.
 *
 * Conta pura (sem tela, sem banco), para o teste prender a regra.
 */

export type CartaoDaFila = {
  fullName: string;
  /** Próxima apresentação marcada; nulo = nada agendado. */
  presentationAt: string | null;
  /** Estado na sala de espera da recepção (`waiting`, `in_service`…). */
  atendimento: string | null;
  esperandoDesde: string | null;
};

export const FILTROS_DA_FILA = ["todos", "hoje", "3dias", "sem"] as const;
export type FiltroDaFila = (typeof FILTROS_DA_FILA)[number];

export const ROTULO_DO_FILTRO: Record<FiltroDaFila, string> = {
  todos: "Todos",
  hoje: "Hoje",
  "3dias": "Próximos 3 dias",
  sem: "Sem agendamento",
};

/** Já está na clínica (a recepção registrou a chegada) ou já está sendo atendido. */
export function chegou(c: CartaoDaFila): boolean {
  return c.atendimento === "waiting" || c.atendimento === "in_service";
}

/**
 * A ordem: quem CHEGOU primeiro (pela hora da chegada); depois quem tem
 * apresentação marcada, da mais próxima para a mais distante; por último quem
 * está sem agendamento, pelo nome.
 */
export function ordenarFila<T extends CartaoDaFila>(cards: T[]): T[] {
  const grupo = (c: CartaoDaFila) => (chegou(c) ? 0 : c.presentationAt ? 1 : 2);
  return [...cards].sort((a, b) => {
    const ga = grupo(a);
    const gb = grupo(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const ea = a.esperandoDesde ?? a.presentationAt ?? "";
      const eb = b.esperandoDesde ?? b.presentationAt ?? "";
      if (ea !== eb) return ea < eb ? -1 : 1;
    }
    if (ga === 1 && a.presentationAt !== b.presentationAt) {
      return (a.presentationAt ?? "") < (b.presentationAt ?? "") ? -1 : 1;
    }
    return a.fullName.localeCompare(b.fullName, "pt-BR");
  });
}

/**
 * O filtro, no dia BRASILEIRO. "Hoje" e "Próximos 3 dias" incluem quem já
 * chegou (está na clínica agora, seja de que dia for o horário).
 */
export function filtrarFila<T extends CartaoDaFila>(
  cards: T[],
  filtro: FiltroDaFila,
  agora: Date = new Date()
): T[] {
  if (filtro === "todos") return cards;
  if (filtro === "sem") return cards.filter((c) => !c.presentationAt && !chegou(c));
  const hoje = isoDateIn(agora);
  const ate = filtro === "hoje" ? hoje : addDaysIso(hoje, 2);
  return cards.filter((c) => {
    if (chegou(c)) return true;
    if (!c.presentationAt) return false;
    const dia = isoDateIn(new Date(c.presentationAt));
    return dia <= ate;
  });
}
