// AP107 (decisões do dono, 04/11/2026; K1–K3 em docs/comercial/AP63-AP64-PLANO.md
// §7): o cancelamento é POR VENDA (plano original ou complemento N). Cancelar
// uma venda só leva o cliente à Fase 6/7 quando não sobra OUTRA venda em
// tratamento. Espelho de `public._outra_venda_em_tratamento` (0360) — mudou um,
// muda o outro (régua em `cancelar-por-venda.test.ts`). Puro: testável sem banco.

export type VendaDoCliente = {
  negociacaoId: string;
  planoId: string | null;
  codigo: string | null;
  situacao: string;
  fechada: boolean;
  cancelada: boolean;
  /** "Plano original" ou "Complemento 1". */
  rotulo: string;
};

/**
 * Outra venda segue em tratamento? Outra venda aceita, fechada, não cancelada,
 * com sessão ainda por fazer (pendente ou agendada).
 */
export function outraVendaEmTratamento(
  vendas: readonly VendaDoCliente[],
  negociacaoId: string,
  planosComSessaoAberta: ReadonlySet<string>
): boolean {
  return vendas.some(
    (v) =>
      v.negociacaoId !== negociacaoId &&
      v.situacao === "aceita" &&
      v.fechada &&
      !v.cancelada &&
      v.planoId != null &&
      planosComSessaoAberta.has(v.planoId)
  );
}
