/**
 * COBRANÇAS DO ASAAS NA TELA (ASA1, entrega 2) — arquivo PURO (cliente e
 * servidor): rótulos, mensagens dos códigos do banco e o texto do WhatsApp.
 * Regras de quem pode e do valor estão no BANCO (4004); aqui só se mostra.
 */

export type MeioDaCobranca = "BOLETO" | "PIX" | "CREDIT_CARD";

export const MEIOS_DA_COBRANCA: { valor: MeioDaCobranca; rotulo: string }[] = [
  { valor: "BOLETO", rotulo: "Boleto" },
  { valor: "PIX", rotulo: "Pix" },
  { valor: "CREDIT_CARD", rotulo: "Cartão à vista (pela fatura do Asaas)" },
];

/** O meio da cobrança que já vem marcado, a partir do meio gravado na parcela. */
export function meioInicial(metodoDaParcela: string | null | undefined): MeioDaCobranca {
  if (metodoDaParcela === "pix") return "PIX";
  if (metodoDaParcela === "cartao") return "CREDIT_CARD";
  return "BOLETO";
}

/** Meios da parcela que NÃO emitem cobrança na ASA1. */
export const METODOS_SEM_COBRANCA_NA_ASA1 = new Set(["cartao_parcelado", "credito_recorrente", "deposito_avista"]);

export type SituacaoDaCobranca =
  | "emitindo"
  | "emitida"
  | "paga"
  | "liquidada"
  | "vencida"
  | "cancelada"
  | "estornada"
  | "em_contestacao"
  | "erro_emissao"
  | "externa";

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCobranca, string> = {
  emitindo: "Emitindo…",
  emitida: "Cobrança emitida",
  paga: "Paga no Asaas",
  liquidada: "Liquidada",
  vencida: "Cobrança vencida",
  cancelada: "Cancelada",
  estornada: "Estornada",
  em_contestacao: "Em contestação",
  erro_emissao: "Erro na emissão",
  externa: "Cobrada fora do riSZon",
};

/** As situações em que a cobrança está ATIVA (a parcela fica travada). */
export const SITUACOES_ATIVAS = new Set<SituacaoDaCobranca>(["emitindo", "emitida", "vencida", "erro_emissao", "externa"]);

const MENSAGEM_DO_BANCO: Record<string, string> = {
  NOT_ALLOWED: "Você não tem permissão para esta ação nesta unidade.",
  INSTALLMENT_NOT_FOUND: "Parcela não encontrada.",
  INSTALLMENT_CLOSED: "A parcela não está em aberto.",
  METHOD_NOT_SUPPORTED:
    "Parcelas de cartão parcelado, crédito recorrente ou depósito à vista ainda não são cobradas pelo Asaas.",
  BILLING_TYPE_INVALID: "Escolha boleto, Pix ou cartão à vista.",
  GRACE_NOT_SUPPORTED: "Parcela com carência não é cobrada pelo Asaas.",
  CHARGE_ALREADY_ACTIVE: "Esta parcela já tem uma cobrança ativa.",
  CONTRACT_NOT_SIGNED: "O contrato desta venda ainda não foi assinado.",
  UNIT_NOT_READY: "A unidade ainda não está pronta para cobrar pelo Asaas (veja a Central de Configuração).",
  CLIENT_NOT_FOUND: "Paciente não encontrado.",
  PAYER_REQUIRED: "Paciente menor de idade: marque o responsável financeiro no cadastro antes de cobrar.",
  PAYER_CPF_INVALID_GUARDIAN: "O CPF do responsável financeiro está vazio ou inválido. Corrija o cadastro antes de cobrar.",
  PAYER_CPF_INVALID_CLIENT: "O CPF do paciente está vazio ou inválido. Corrija o cadastro antes de cobrar.",
  REISSUE_DATE_OUT_OF_RANGE:
    "Data fora do limite. Para a parcela vencida, escolha de hoje até o limite da rede; acima disso, faça a renegociação.",
  NOTHING_TO_CHARGE: "Não há saldo a cobrar nesta parcela.",
  CHARGE_NOT_FOUND: "Cobrança não encontrada.",
  CHARGE_NOT_RETRYABLE: "Esta cobrança não pode ser tentada de novo agora. Aguarde dois minutos.",
  CHARGE_NOT_CANCELLABLE: "Esta cobrança não pode mais ser cancelada.",
  CHARGE_NOT_EXTERNAL: "Esta cobrança não é uma marcação de cobrança externa.",
  NOTE_REQUIRED: "Diga onde a parcela foi cobrada.",
  CHARGE_ACTIVE: "A parcela tem cobrança ativa: cancele a cobrança antes de alterar a parcela.",
  CHARGE_IN_GATEWAY:
    "A parcela tem cobrança ativa no Asaas. Para receber no balcão, use “Recebeu no balcão”: a cobrança é cancelada e a baixa abre em seguida.",
  REASON_REQUIRED: "Escreva o motivo da quitação por valor menor.",
  INSTALLMENT_SETTLED: "Esta parcela já está quitada.",
  AMOUNT_OVER_BALANCE: "O valor é maior que o saldo da parcela.",
  INVALID_AMOUNT: "Informe um valor maior que zero.",
  SALE_NOT_CLOSED: "A venda ainda não foi fechada; a baixa só entra depois do fechamento.",
  SURPLUS_NOT_FOUND: "Pagamento em duplicidade não encontrado.",
  SURPLUS_ALREADY_RESOLVED: "Este pagamento em duplicidade já foi resolvido.",
  INSTALLMENT_OF_OTHER_CLIENT: "Escolha uma parcela deste mesmo paciente.",
  NOTHING_TO_WAIVE: "Esta baixa não tem taxa da rede mantida para dispensar.",
};

/** A mensagem pt-BR de um erro do banco (procura o código no texto). */
export function mensagemDaCobranca(codigoOuErro: string | null | undefined): string {
  const m = codigoOuErro ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGEM_DO_BANCO)) {
    if (m.includes(codigo)) return texto;
  }
  if (/Could not find the function|does not exist|schema cache/i.test(m)) {
    return "As cobranças pelo Asaas ainda não existem neste banco (falta a migração 4004).";
  }
  return "Não foi possível concluir. Tente de novo; se continuar, avise o Admin Master.";
}

/** O texto do WhatsApp com o link da fatura (sem CPF e sem valor de outra parcela). */
export function mensagemDaCobrancaNoWhatsApp(args: {
  nomeDoPagador: string;
  valorFormatado: string;
  vencimentoFormatado: string;
  link: string;
}): string {
  const primeiro = args.nomeDoPagador.trim().split(/\s+/)[0] ?? "";
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Segue o link para pagamento da parcela de ${args.valorFormatado}, com vencimento em ${args.vencimentoFormatado}:`,
    args.link,
    "Pelo link você escolhe a forma de pagamento indicada. Qualquer dúvida, estamos à disposição.",
  ].join("\n");
}

/**
 * Por que a parcela NÃO oferece "Gerar cobrança" (a tela diz em vez de calar).
 * `null` = o botão aparece; os motivos que dependem da venda e do pagador
 * (contrato, CPF, responsável) aparecem na prévia, ao clicar.
 */
export function motivoSemCobranca(p: {
  status: string;
  paymentMethod: string | null;
  graceDays: number;
  unidadePronta: boolean | null;
  podeEmitir: boolean;
}): string | null {
  if (p.status === "paga") return "Parcela paga: não há o que cobrar.";
  if (p.status === "cancelada") return "Parcela cancelada: não há o que cobrar.";
  if (p.status === "renegociada") return "Parcela renegociada: a cobrança é das parcelas da renegociação.";
  if (METODOS_SEM_COBRANCA_NA_ASA1.has(p.paymentMethod ?? "")) {
    return "Cartão parcelado, crédito recorrente e depósito à vista ainda não são cobrados pelo Asaas.";
  }
  if (p.graceDays > 0) return "Parcela com carência não é cobrada pelo Asaas.";
  if (p.unidadePronta === null) return "As cobranças pelo Asaas ainda não existem neste banco (falta a migração 4004).";
  if (!p.unidadePronta) {
    return "A unidade ainda não está pronta para cobrar pelo Asaas (Central de Configuração › Conta e tarifas).";
  }
  if (!p.podeEmitir) return "Você vê as cobranças, mas a sua permissão não inclui gerar (Cobranças: emitir).";
  return null;
}
