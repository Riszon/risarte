// 4012 (spec 19.4, 19.5): regras puras da criação automática de cobranças.

export type ResumoDaCriacao = {
  criadas: number;
  falhas: number;
  puladas: number;
  /** Por que parou ou pulou: limite diário, erros seguidos, sem migração. */
  motivo: string | null;
  erros: string[];
};

/**
 * Quantas cobranças ainda dá para criar hoje na conta: o limite diário menos
 * o usado, guardando uma RESERVA para a emissão manual do dia (10% do limite,
 * no mínimo 20). Limite atingido = zero.
 */
export function folgaDoLimite(lim: { limite: number; usado: number; atingido: boolean }): number {
  if (lim.atingido) return 0;
  const reserva = Math.max(20, Math.ceil(lim.limite * 0.1));
  return Math.max(0, lim.limite - lim.usado - reserva);
}

/** A origem gravada na cobrança (aparece em "Cobranças da venda"). */
export function origemDaCobranca(
  origemDaRodada: "vercel" | "banco" | "rodar_agora" | "gatilho",
  origemDaVenda: string,
  especifica?: "restante"
): "assinatura" | "venda_direta" | "rotina" | "rodar_agora" | "restante" {
  if (especifica) return especifica;
  if (origemDaRodada === "gatilho") return origemDaVenda === "venda_direta" ? "venda_direta" : "assinatura";
  if (origemDaRodada === "rodar_agora") return "rodar_agora";
  return "rotina";
}

export const ROTULO_DA_ORIGEM: Record<string, string> = {
  assinatura: "na assinatura do contrato",
  venda_direta: "na venda direta",
  rotina: "pela rotina diária",
  rodar_agora: "pelo \"Rodar agora\"",
  restante: "do restante, depois do dinheiro",
};

export const ROTULO_DO_MOTIVO: Record<string, string> = {
  aguardando_rotina: "Na fila: sai na próxima rodada",
  emitindo: "Sendo criada agora",
  cancelada_a_mao: "Cobrança cancelada à mão (não volta sozinha)",
  unidade_nao_pronta: "A unidade não está pronta na Central",
  limite_diario: "Limite diário de cobranças do Asaas",
};

/** Motivo da lista de pendências em português ("erro:CODIGO" vira o código). */
export function rotuloDoMotivo(m: string): string {
  if (m.startsWith("erro:")) return `Erro: ${m.slice(5)}`;
  return ROTULO_DO_MOTIVO[m] ?? m;
}
