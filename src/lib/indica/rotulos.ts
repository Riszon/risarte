/**
 * Rótulos do Indica +Risos em português (IND2). Os valores são os mesmos que o
 * banco aceita nos `check` das tabelas do schema `indica`.
 */

export const RESGATE_STATUS = ["solicitado", "aprovado", "entregue", "recusado", "cancelado"] as const;
export type ResgateStatus = (typeof RESGATE_STATUS)[number];

export const RESGATE_STATUS_LABEL: Record<ResgateStatus, string> = {
  solicitado: "Aguardando aprovação",
  aprovado: "Aprovado — a entregar",
  entregue: "Entregue",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

export const RESGATE_STATUS_COR: Record<ResgateStatus, string> = {
  solicitado: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  aprovado: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  entregue: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  recusado: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelado: "border-zinc-400/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export const ITEM_TIPOS = ["credito_risarte", "voucher_parceiro", "produto", "experiencia", "doacao"] as const;
export type ItemTipo = (typeof ITEM_TIPOS)[number];

export const ITEM_TIPO_LABEL: Record<ItemTipo, string> = {
  credito_risarte: "Crédito Risarte (voucher em tratamento)",
  voucher_parceiro: "Voucher de parceiro",
  produto: "Produto",
  experiencia: "Experiência",
  doacao: "Doação solidária",
};

export const PARCEIRO_TIPOS = ["voucher", "indicador", "ambos"] as const;
export type ParceiroTipo = (typeof PARCEIRO_TIPOS)[number];
export const PARCEIRO_TIPO_LABEL: Record<ParceiroTipo, string> = {
  voucher: "Dá vouchers",
  indicador: "Indica clientes",
  ambos: "Os dois",
};

export const EMBAIXADOR_STATUS = ["ativo", "suspenso", "encerrado"] as const;
export type EmbaixadorStatus = (typeof EMBAIXADOR_STATUS)[number];
export const EMBAIXADOR_STATUS_LABEL: Record<EmbaixadorStatus, string> = {
  ativo: "Ativo",
  suspenso: "Suspenso",
  encerrado: "Encerrado",
};

export const TIPO_LANCAMENTO_LABEL: Record<string, string> = {
  credito: "Crédito",
  pendente: "Pendente",
  carencia: "Em carência",
  liberacao: "Liberação",
  estorno: "Estorno",
  resgate: "Resgate",
  expiracao: "Expiração",
  ajuste: "Ajuste manual",
  devolucao: "Devolução de resgate",
};

export const SALDO_LABEL: Record<string, string> = {
  disponivel: "disponível",
  pendente: "pendente",
  carencia: "carência",
};

export type NivelResumo = { codigo: string; nome: string; ordem: number; criterio: number };

/**
 * Quanto falta para o próximo nível. `conversoes` = fechamentos convertidos na
 * janela (12 meses por padrão). Devolve `null` no último nível.
 */
export function proximoNivel(
  niveis: NivelResumo[],
  ordemAtual: number,
  conversoes: number
): { nivel: NivelResumo; faltam: number; progresso: number } | null {
  const acima = [...niveis].filter((n) => n.ordem > ordemAtual).sort((a, b) => a.ordem - b.ordem);
  const alvo = acima[0];
  if (!alvo) return null;
  const faltam = Math.max(0, alvo.criterio - conversoes);
  const progresso = alvo.criterio <= 0 ? 1 : Math.min(1, conversoes / alvo.criterio);
  return { nivel: alvo, faltam, progresso };
}

/** "Pedi indicação": em que momento a equipe pediu e o que o cliente respondeu. */
export const PEDIDO_MOMENTOS: { valor: string; rotulo: string }[] = [
  { valor: "fechamento", rotulo: "No fechamento do tratamento" },
  { valor: "entrega_etapa", rotulo: "Na entrega de uma etapa" },
  { valor: "elogio", rotulo: "Depois de um elogio" },
  { valor: "retorno", rotulo: "No retorno / manutenção" },
  { valor: "outro", rotulo: "Outro momento" },
];

export const PEDIDO_RESULTADOS: { valor: string; rotulo: string }[] = [
  { valor: "indicou", rotulo: "Indicou alguém" },
  { valor: "vai_pensar", rotulo: "Vai pensar" },
  { valor: "recusou", rotulo: "Não quis indicar" },
  { valor: "pendente", rotulo: "Ainda sem resposta" },
];
