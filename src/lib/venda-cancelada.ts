// AP63 (decisão do dono, 03/11/2026): depois de cancelar, o cliente compra de
// novo por uma NOVA VERSÃO do plano, com negociação nova — e o histórico tem de
// mostrar que houve uma venda cancelada.
//
// A fonte é a linha do tempo do plano (`treatment_plan_events`), que Planner,
// Coordenador e Consultor já leem:
//   * `venda_cancelada` (0208) — a venda DESTE plano foi cancelada;
//   * `venda_cancelada_anterior` (0354) — a versão nova nasceu depois de uma
//     venda cancelada de um plano anterior do cliente.
// Puro: testável sem banco.

import type { PlanEvent } from "@/lib/planning";

export type VendaCancelada = {
  /** "deste_plano": o plano aberto é o da venda cancelada. */
  tipo: "deste_plano" | "anterior";
  texto: string;
  em: string;
};

export function vendasCanceladas(eventos: PlanEvent[]): VendaCancelada[] {
  return eventos
    .filter((e) => e.type === "venda_cancelada" || e.type === "venda_cancelada_anterior")
    .map((e) => ({
      tipo: e.type === "venda_cancelada" ? ("deste_plano" as const) : ("anterior" as const),
      texto: e.description ?? "Venda cancelada",
      em: e.at,
    }));
}

/**
 * O plano mais novo tem a venda cancelada? Então não vai ao Comercial: a
 * compra nova sai de uma versão nova. Recebe os tipos de evento do plano.
 */
export function planoTemVendaCancelada(tiposDeEvento: string[]): boolean {
  return tiposDeEvento.includes("venda_cancelada");
}

export const MENSAGEM_ENVIO_COM_VENDA_CANCELADA =
  "A venda deste plano foi cancelada. Para vender de novo, crie uma nova versão do plano, aprove e envie a versão nova ao Comercial.";
