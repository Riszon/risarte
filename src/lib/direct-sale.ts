// Venda direta na unidade (docs/COMERCIAL.md §7) — regras puras.
// Dinheiro SEMPRE em centavos. Diferente da negociação do Consultor, aqui a
// regra comercial NÃO vai para autorização: ela BLOQUEIA o fechamento.

import {
  PAYMENT_METHOD_LABELS,
  discountPercentOf,
  type CommercialRule,
  type PaymentMethod,
} from "@/lib/commercial";
import type { UserRole } from "@/lib/roles";

/** O que o Admin configurou no procedimento (§7.3). */
export type DirectSaleFlags = {
  /** Autorizado para venda direta. */
  directSale: boolean;
  /** A Recepcionista pode lançar. */
  reception: boolean;
  /** A SDR pode lançar. */
  sdr: boolean;
};

/**
 * Quem pode LANÇAR um procedimento na venda direta (§7.4):
 * - Gerente e Coordenador Clínico: todos os autorizados;
 * - Recepcionista: só os liberados para recepção;
 * - SDR: só os liberados para SDR.
 */
export function canLaunchDirectSaleProcedure(
  roles: UserRole[],
  isAdminMaster: boolean,
  flags: DirectSaleFlags
): boolean {
  if (!flags.directSale) return false;
  if (isAdminMaster) return true;
  if (roles.includes("unit_manager")) return true;
  if (roles.includes("clinical_coordinator")) return true;
  if (roles.includes("receptionist") && flags.reception) return true;
  if (roles.includes("sdr") && flags.sdr) return true;
  return false;
}

/**
 * Quem pode FECHAR (assinatura + pagamento) (§7.4):
 * - Gerente e Recepcionista: todos os fechamentos;
 * - SDR: só quando TODOS os procedimentos da venda são liberados para SDR;
 * - Coordenador Clínico: nunca (a venda dele fica aguardando a recepção).
 */
export function canCloseDirectSale(
  roles: UserRole[],
  isAdminMaster: boolean,
  itemFlags: DirectSaleFlags[]
): boolean {
  if (isAdminMaster) return true;
  if (roles.includes("unit_manager")) return true;
  if (roles.includes("receptionist")) return true;
  if (roles.includes("sdr")) {
    return itemFlags.length > 0 && itemFlags.every((f) => f.sdr);
  }
  return false;
}

export type DirectSaleConditions = {
  /** Soma dos itens pelo preço de tabela. */
  subtotalCents: number;
  /** Desconto automático de programa (Empresarial/riso+) — sempre permitido. */
  programDiscountCents: number;
  /** Desconto manual dado no fechamento. */
  discountCents: number;
  /** Acréscimo — só o Gerente pode. */
  surchargeCents: number;
  installments: number;
  paymentMethod: PaymentMethod | null;
};

/** Valor final da venda (nunca negativo). */
export function directSaleFinalCents(c: DirectSaleConditions): number {
  const total =
    c.subtotalCents - c.programDiscountCents - c.discountCents + c.surchargeCents;
  return Math.max(0, total);
}

/**
 * Violações que IMPEDEM o fechamento. Vazio = pode fechar. O desconto de
 * programa não conta como desconto negociado (é benefício configurado).
 */
export function directSaleViolations(
  c: DirectSaleConditions,
  rule: CommercialRule,
  opts: { isManager: boolean }
): string[] {
  const violations: string[] = [];

  // Base do desconto manual = subtotal já sem o benefício do programa.
  const base = Math.max(0, c.subtotalCents - c.programDiscountCents);
  const discountPct = discountPercentOf(base, -c.discountCents);
  if (c.discountCents > 0) {
    if (rule.maxDiscountPercent === null) {
      violations.push(
        "Desconto não permitido na venda direta (a rede não configurou desconto máximo)"
      );
    } else if (discountPct > rule.maxDiscountPercent + 1e-9) {
      violations.push(
        `Desconto de ${discountPct.toFixed(1)}% acima do máximo permitido (${rule.maxDiscountPercent}%)`
      );
    }
  }

  if (c.surchargeCents > 0 && !opts.isManager) {
    violations.push("Só o Gerente da unidade pode aplicar acréscimo no valor");
  }

  if (rule.maxInstallments !== null && c.installments > rule.maxInstallments) {
    violations.push(
      `Parcelamento em ${c.installments}x acima do máximo permitido (${rule.maxInstallments}x)`
    );
  }

  if (
    c.paymentMethod &&
    rule.allowedMethods !== null &&
    !rule.allowedMethods.includes(c.paymentMethod)
  ) {
    violations.push(
      `Meio de pagamento "${PAYMENT_METHOD_LABELS[c.paymentMethod]}" não permitido pela regra comercial`
    );
  }

  return violations;
}

/** Situação do fechamento (regra de ouro em dois passos — §7.8). */
export type DirectSaleClosing = {
  contractSigned: boolean;
  paymentIssued: boolean;
  paymentConfirmed: boolean;
};

export type DirectSaleStatus =
  | "aguardando_fechamento"
  | "cobranca_emitida"
  | "concluida";

/**
 * A venda só é CONCLUÍDA com contrato assinado E pagamento confirmado. Ter só a
 * cobrança emitida é PENDÊNCIA (aparece sinalizado na tela Comercial).
 */
export function directSaleStatusOf(c: DirectSaleClosing): DirectSaleStatus {
  if (c.contractSigned && c.paymentConfirmed) return "concluida";
  if (c.paymentIssued || c.contractSigned) return "cobranca_emitida";
  return "aguardando_fechamento";
}

export const DIRECT_SALE_STATUS_LABELS: Record<DirectSaleStatus, string> = {
  aguardando_fechamento: "Aguardando fechamento",
  cobranca_emitida: "Fechamento pendente",
  concluida: "Concluída",
};

/** Valor zerado por benefício de programa = pagamento já dado como realizado. */
export function isZeroValueSale(finalCents: number): boolean {
  return finalCents <= 0;
}
