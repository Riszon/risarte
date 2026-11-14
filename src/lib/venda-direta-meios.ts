// ASA4 (4011, spec 19.11): os meios da VENDA DIRETA NOVA — regras puras.
//
// Venda direta nova = `direct_sales.method_rule = 'asa4'` (toda venda criada
// depois da 4011). Cada parcela diz COMO PAGA:
//   - pelo Asaas: Pix, boleto ou cartão à vista;
//   - dinheiro;
//   - permuta (só o Gerente da unidade ou o Admin Master);
//   - provisório: cartão parcelado na maquininha, enquanto a chave da rede
//     estiver ligada (até a entrega 2, cartão parcelado pelo Asaas).
// À vista (1×): Pix, dinheiro ou permuta. O dinheiro à vista tem exatamente o
// desconto que o "depósito à vista" tinha (19.11 ajuste B); a permuta não tem
// desconto à vista automático.
// O BANCO confere tudo isso (gatilhos da 4011); aqui é para a tela oferecer só
// o que vai passar.

export const METODOS_VENDA_NOVA = ["pix", "boleto", "cartao", "dinheiro", "permuta", "cartao_parcelado"] as const;
export type MetodoVendaNova = (typeof METODOS_VENDA_NOVA)[number];

export const ROTULO_METODO_VENDA_NOVA: Record<MetodoVendaNova, string> = {
  pix: "Pix pelo Asaas",
  boleto: "Boleto pelo Asaas",
  cartao: "Cartão à vista pelo Asaas",
  dinheiro: "Dinheiro",
  permuta: "Permuta",
  cartao_parcelado: "Cartão parcelado (maquininha)",
};

/** Rótulo de qualquer meio (antigos e novos), para listas e extratos. */
export function rotuloDoMeio(m: string | null | undefined): string {
  if (!m) return "—";
  const novos: Record<string, string> = {
    pix: "PIX",
    boleto: "Boleto",
    cartao: "Cartão",
    cartao_parcelado: "Cartão de crédito parcelado",
    credito_recorrente: "Crédito recorrente",
    deposito_avista: "Depósito à vista",
    dinheiro: "Dinheiro",
    permuta: "Permuta",
  };
  return novos[m] ?? m;
}

export function ehVendaNova(methodRule: string | null | undefined): boolean {
  return methodRule === "asa4";
}

/**
 * Os meios que a venda direta nova oferece.
 * - `allowed`: os meios da regra comercial (null = todos). O dinheiro segue o
 *   "depósito à vista" da regra (é o mesmo pagamento, com o mesmo desconto);
 *   a permuta não depende da regra (é decisão do Gerente).
 */
export function meiosDaVendaNova(opts: {
  installments: number;
  isManager: boolean;
  cardMachine: boolean;
  allowed: readonly string[] | null;
}): MetodoVendaNova[] {
  const permitido = (m: MetodoVendaNova) => {
    if (m === "permuta") return opts.isManager;
    if (m === "cartao_parcelado") return opts.cardMachine && (opts.allowed === null || opts.allowed.includes("cartao_parcelado"));
    const naRegra = m === "dinheiro" ? "deposito_avista" : m;
    return opts.allowed === null || opts.allowed.includes(naRegra) || (m === "dinheiro" && opts.allowed.includes("pix"));
  };
  const base: MetodoVendaNova[] =
    opts.installments <= 1 ? ["pix", "dinheiro", "permuta"] : ["boleto", "pix", "cartao", "dinheiro", "permuta", "cartao_parcelado"];
  return base.filter(permitido);
}

/** O meio que a REGRA COMERCIAL enxerga (limites, parcela mínima). */
export function meioParaARegra(m: string | null): string | null {
  if (m === "dinheiro") return "deposito_avista";
  if (m === "permuta") return null;
  return m;
}

/** À vista (1×) com desconto automático: Pix ou dinheiro, nunca permuta. */
export function temDescontoAVista(m: string | null, installments: number): boolean {
  return installments <= 1 && (m === "pix" || m === "dinheiro" || m === "deposito_avista");
}

/** Erro da venda nova para o meio escolhido, ou null. */
export function erroDoMeioDaVendaNova(m: string | null, installments: number, isManager: boolean): string | null {
  if (!m) return null;
  if (m === "deposito_avista" || m === "credito_recorrente")
    return "Na venda direta, o pagamento é pelo Asaas (Pix, boleto ou cartão), em dinheiro ou em permuta.";
  if (installments <= 1 && !["pix", "dinheiro", "permuta"].includes(m))
    return "À vista (1×) o pagamento é por Pix, dinheiro ou permuta.";
  if (m === "permuta" && !isManager) return "Só o Gerente da unidade ou o Admin Master registram permuta.";
  return null;
}

/**
 * Os meios da BAIXA À MÃO numa parcela de venda direta nova: dinheiro; a
 * permuta só na parcela que é de permuta e só para o Gerente/Admin; o cartão
 * parcelado só na parcela de cartão parcelado (maquininha).
 */
export function meiosDaBaixaVendaNova(metodoDaParcela: string | null, isManager: boolean): string[] {
  const out = ["dinheiro"];
  if (metodoDaParcela === "permuta" && isManager) out.push("permuta");
  if (metodoDaParcela === "cartao_parcelado") out.push("cartao_parcelado");
  return out;
}

/** Para quais meios a parcela pode ser trocada (troca de meio, 19.11 ajuste C). */
export function trocasPossiveis(metodoAtual: string | null, isManager: boolean): MetodoVendaNova[] {
  const alvo: MetodoVendaNova[] = ["pix", "boleto", "cartao", "dinheiro"];
  if (isManager) alvo.push("permuta");
  return alvo.filter((m) => m !== metodoAtual);
}

/** Parcela pelo Asaas (vira cobrança). */
export function ehPeloAsaas(m: string | null): boolean {
  return m === "pix" || m === "boleto" || m === "cartao";
}

/** Os erros do banco da 4011, em português. */
export function mensagemDoErroDeMeio(msg: string): string | null {
  if (msg.includes("CASH_METHOD_ONLY")) return "À vista (1×) o pagamento é por Pix, dinheiro ou permuta.";
  if (msg.includes("PERMUTA_NOT_ALLOWED")) return "Só o Gerente da unidade ou o Admin Master registram permuta.";
  if (msg.includes("PERMUTA_DESCRIPTION_REQUIRED")) return "Descreva a permuta: o que foi trocado e com quem.";
  if (msg.includes("PERMUTA_NEEDS_METHOD_CHANGE"))
    return "Esta parcela não é de permuta. Troque o meio da parcela para permuta antes (Gerente ou Admin Master).";
  if (msg.includes("RECEIPT_METHOD_NOT_ALLOWED"))
    return "Nesta venda direta, a baixa à mão é só em dinheiro ou permuta. Pix, boleto e cartão são pagos pelo Asaas.";
  if (msg.includes("CONTRACT_NOT_SIGNED")) return "Assine o contrato da venda antes de receber.";
  if (msg.includes("METHOD_NOT_ALLOWED"))
    return "Meio não aceito na venda direta: use Asaas (Pix, boleto ou cartão), dinheiro ou permuta.";
  if (msg.includes("METHOD_NOT_SUPPORTED")) return "Parcela em dinheiro ou permuta não vira cobrança no Asaas.";
  if (msg.includes("NOT_NEW_RULE")) return "A troca de meio vale só para venda direta feita depois da ASA4.";
  return null;
}
