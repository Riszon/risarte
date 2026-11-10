// Risarte Empresarial — PROPOSTA TRAVADA E O 1º PAGAMENTO NO FUNIL (1041).
//
// Pedido do dono (09/11/2026): *"quando é feito a assinatura de um contrato no
// empresarial, não pode ser possível alterar a proposta. se for necessário
// fazer alguma alteração deve ter algum recurso para fazer alterações de
// proposta e contrato. [...] No funil deve ser registrado o primeiro pagamento
// ou implantação."*
//
// ⚠️ QUEM TRAVA É O BANCO (gatilho `guard_lead_proposal` nas 7 tabelas da
// proposta). Estas regras só dizem à TELA o que mostrar — a tela travada é
// cortesia; sem ela, salvar seria recusado com PROPOSAL_LOCKED.

export type Reabertura = {
  id: string;
  motivo: string;
  reabertaEm: string;
  reabertaPor: string | null;
  assinadaAntesEm: string;
  levadaParaEmpresaEm: string | null;
};

export type SituacaoDaProposta =
  /** Sem assinatura: edita à vontade. */
  | { tipo: "livre" }
  /** Destravada para alteração, esperando a nova assinatura. */
  | { tipo: "em_alteracao"; reabertura: Reabertura }
  /** Assinada: só leitura. */
  | { tipo: "travada"; assinadaEm: string }
  /** Reassinada depois de alterada, e a empresa ainda não recebeu. */
  | { tipo: "levar_para_empresa"; assinadaEm: string; reabertura: Reabertura };

export function situacaoDaProposta(d: {
  contractSignedAt: string | null;
  companyId: string | null;
  /** A reabertura mais recente, se houver. */
  ultima: Reabertura | null;
}): SituacaoDaProposta {
  const u = d.ultima;
  if (!d.contractSignedAt) {
    return u && !u.levadaParaEmpresaEm ? { tipo: "em_alteracao", reabertura: u } : { tipo: "livre" };
  }
  if (
    u &&
    !u.levadaParaEmpresaEm &&
    d.companyId &&
    new Date(d.contractSignedAt).getTime() >= new Date(u.reabertaEm).getTime()
  ) {
    return { tipo: "levar_para_empresa", assinadaEm: d.contractSignedAt, reabertura: u };
  }
  return { tipo: "travada", assinadaEm: d.contractSignedAt };
}

/** Travada = a tela não deixa editar (o banco também não). */
export function propostaTravada(s: SituacaoDaProposta): boolean {
  return s.tipo === "travada" || s.tipo === "levar_para_empresa";
}

// -----------------------------------------------------------------------------
// O 1º pagamento (implantação)
// -----------------------------------------------------------------------------

export const FORMAS_DA_IMPLANTACAO = ["BOLETO", "PIX", "CARD", "TRANSFER", "CASH"] as const;
export type FormaDaImplantacao = (typeof FORMAS_DA_IMPLANTACAO)[number];
export const FORMA_DA_IMPLANTACAO_ROTULO: Record<FormaDaImplantacao, string> = {
  BOLETO: "Boleto",
  PIX: "Pix",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  CASH: "Dinheiro",
};

export type PagamentoLido =
  | { ok: true; data: string; valorCents: number; forma: FormaDaImplantacao }
  | { ok: false; erro: string };

/** Confere o que veio da tela. `hoje` = "YYYY-MM-DD" no Brasil. */
export function lerPagamentoDaImplantacao(
  e: { data: string | null; valorCents: number | null; forma: string | null },
  hoje: string
): PagamentoLido {
  if (!e.data || !/^\d{4}-\d{2}-\d{2}$/.test(e.data)) {
    return { ok: false, erro: "Informe a data do pagamento." };
  }
  if (e.data > hoje) return { ok: false, erro: "A data do pagamento não pode ser no futuro." };
  if (e.valorCents == null || e.valorCents <= 0) {
    return { ok: false, erro: "Informe o valor pago." };
  }
  if (!e.forma || !(FORMAS_DA_IMPLANTACAO as readonly string[]).includes(e.forma)) {
    return { ok: false, erro: "Escolha a forma de pagamento." };
  }
  return { ok: true, data: e.data, valorCents: e.valorCents, forma: e.forma as FormaDaImplantacao };
}

/** As recusas do banco da 1041, ditas para quem está na tela. */
export function recusaDaAlteracao(mensagem: string | null | undefined): string | null {
  const m = mensagem ?? "";
  if (m.includes("PROPOSAL_LOCKED")) {
    return "O contrato já foi assinado: a proposta está travada. Para alterar, use \"Alterar proposta e contrato\" (Admin ou gestor do programa).";
  }
  if (m.includes("CONTRACT_SIGNED_LOCKED")) {
    return "A assinatura só se desfaz por \"Alterar proposta e contrato\", com o motivo.";
  }
  if (m.includes("IMPLANTATION_IN_FINANCE")) {
    return "O pagamento já está nas cobranças da empresa. Para desfazer, o Financeiro estorna a cobrança lá.";
  }
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo da alteração (pelo menos 10 letras).";
  if (m.includes("NOT_SIGNED_AGAIN")) {
    return "O contrato alterado ainda não foi assinado de novo.";
  }
  if (m.includes("NO_PAYMENT")) return "Registre o pagamento (data e valor) antes.";
  if (m.includes("NO_COMPANY")) return "A empresa ainda não foi criada.";
  if (m.includes("NOT_SIGNED")) return "Este contrato não está assinado.";
  if (m.includes("NOT_ALLOWED")) return "Sem permissão.";
  return null;
}

/**
 * Os campos de `camposDaEmpresa` que a proposta reassinada ATUALIZA. CNPJ,
 * nome fantasia, observações e "quantos colaboradores a empresa tem" são da
 * ficha da empresa depois do fechamento — a proposta não manda mais neles.
 */
export function camposComerciaisDaEmpresa<
  T extends { cnpj: unknown; trade_name: unknown; notes: unknown; employee_count: unknown },
>(campos: T): Omit<T, "cnpj" | "trade_name" | "notes" | "employee_count"> {
  const copia: Partial<T> = { ...campos };
  delete copia.cnpj;
  delete copia.trade_name;
  delete copia.notes;
  delete copia.employee_count;
  return copia as Omit<T, "cnpj" | "trade_name" | "notes" | "employee_count">;
}
