// O HISTÓRICO DE UM LANÇAMENTO do Financeiro (0372) — regras puras.
//
// A trilha vem da auditoria geral (`audit_changes`, 0288) pela porta
// `finance_history(tipo, id)`. Aqui mora só a tradução: o que cada linha da
// trilha QUER DIZER em português ("Registrou pagamento", "Desfez a
// conciliação"), e quais campos não dizem nada para quem lê.

import { PAYABLE_STATUS_LABELS } from "@/lib/finance/payables";

export type TipoDoHistorico = "payable" | "bank_transaction" | "installment";

/** Campos que não acrescentam nada: quem/quando já aparece na linha. */
export const CAMPOS_SEM_INTERESSE = new Set([
  "id",
  "clinic_id",
  "client_id",
  "client_token",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "payable_id",
  "transaction_id",
  "installment_id",
  "dedup_key",
  "fit_id",
  "import_id",
  "bank_account_id",
  "matched_entry_id",
  "entry_id",
  "negotiation_id",
  "direct_sale_id",
  "recurrence_id",
  "stock_purchase_id",
]);

const SITUACAO_DO_EXTRATO: Record<string, string> = {
  pendente: "Pendente",
  conciliado: "Conciliada",
  ignorado: "Ignorada",
};

const SITUACAO_DA_PARCELA: Record<string, string> = {
  em_aberto: "Em aberto",
  parcial: "Paga em parte",
  paga: "Paga",
  cancelada: "Cancelada",
};

/** A situação gravada → o que se lê, conforme a tabela. */
export function situacaoLegivel(tabela: string, valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  if (tabela === "payables")
    return PAYABLE_STATUS_LABELS[valor as keyof typeof PAYABLE_STATUS_LABELS] ?? valor;
  if (tabela === "bank_transactions") return SITUACAO_DO_EXTRATO[valor] ?? valor;
  if (tabela === "payment_installments") return SITUACAO_DA_PARCELA[valor] ?? valor;
  return valor;
}

type Mudanca = { antes?: unknown; depois?: unknown };

function mudouPara(changes: Record<string, unknown> | null, campo: string): unknown {
  const v = changes?.[campo] as Mudanca | undefined;
  return v && typeof v === "object" && "depois" in v ? v.depois : undefined;
}

function mudouDe(changes: Record<string, unknown> | null, campo: string): unknown {
  const v = changes?.[campo] as Mudanca | undefined;
  return v && typeof v === "object" && "antes" in v ? v.antes : undefined;
}

/** O título de uma linha da trilha: o que aconteceu, numa frase curta. */
export function tituloDaLinha(
  tabela: string,
  op: "I" | "U" | "D",
  changes: Record<string, unknown> | null
): string {
  const status = mudouPara(changes, "status");
  switch (tabela) {
    case "payables":
      if (op === "I") return "Lançou a conta";
      if (op === "D") return "Apagou a conta";
      if (status === "cancelada") return "Cancelou a conta";
      if (status === "recusada") return "Recusou a conta";
      if (status === "aberta" && mudouDe(changes, "status") === "aguardando_autorizacao")
        return "Autorizou a conta";
      if (status === "paga") return "Conta ficou paga";
      if (status === "parcial") return "Conta ficou paga em parte";
      return "Alterou a conta";
    case "payable_payments":
      if (op === "I") return changes?.reversal_of ? "Estornou um pagamento" : "Registrou pagamento (baixa)";
      if (mudouPara(changes, "reversed") === true) return "Pagamento marcado como estornado";
      return "Alterou o pagamento";
    case "bank_transactions":
      if (op === "I") return "Linha importada do extrato";
      if (status === "conciliado") return "Casou com o lançamento";
      if (status === "ignorado") return "Ignorou a linha";
      if (status === "pendente") return "Desfez a conciliação";
      return "Alterou a linha do extrato";
    case "bank_transaction_matches":
      if (op === "I") return "Casou com um lançamento (Vários)";
      if (op === "D") return "Desfez um casamento (Vários)";
      return "Alterou o casamento";
    case "payment_installments":
      if (op === "I") return "Parcela criada";
      if (status === "paga") return "Parcela ficou paga";
      if (status === "cancelada") return "Parcela cancelada";
      return "Alterou a parcela";
    case "payment_receipts":
      if (op === "I") return changes?.reversal_of ? "Estornou um recebimento" : "Registrou recebimento (baixa)";
      if (mudouPara(changes, "reversed") === true) return "Recebimento marcado como estornado";
      return "Alterou o recebimento";
    default:
      return op === "I" ? "Incluiu" : op === "D" ? "Apagou" : "Alterou";
  }
}
