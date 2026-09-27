import "server-only";
import type { FaixaDePreco } from "./condicoes-da-proposta";
import type { empresarialDb } from "./db";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

/**
 * As faixas de preço combinadas com esta empresa (1018).
 *
 * ⚠️ Fica num lugar só porque CINCO telas calculam a mensalidade — painel,
 * ficha, contrato, cobrança e a tela da empresa. Cada uma carregando do seu
 * jeito é como elas passam a mostrar números diferentes para o mesmo mês.
 *
 * Erro aqui devolve lista vazia, e lista vazia significa "sem faixa": a conta
 * volta a ser a do preço combinado, que é o caso normal. Derrubar a tela da
 * empresa porque uma tabela nova não respondeu seria pior.
 */
export async function carregarFaixasDaEmpresa(
  db: Db,
  companyId: string
): Promise<FaixaDePreco[]> {
  const { data, error } = await db
    .from("company_price_tiers")
    .select("min_quantity, price_cents")
    .eq("company_id", companyId)
    .returns<{ min_quantity: number; price_cents: number }[]>();
  if (error) {
    console.error("faixas da empresa:", error.message);
    return [];
  }
  return (data ?? []).map((f) => ({
    minQuantity: f.min_quantity,
    priceCents: f.price_cents,
  }));
}

/**
 * As faixas, para quem vai GERAR um valor que alguém paga (cobrança, termo,
 * proposta) — AP13.
 *
 * ⚠️ Aqui erro NÃO vira lista vazia. Para uma TELA, "sem faixa" na falha é
 * aceitável (mostra o preço combinado e a ficha abre). Para uma COBRANÇA, é a
 * empresa que negociou volume recebendo o boleto pelo preço de 1 titular —
 * mais caro, e sem ninguém saber por quê. Nulo = "não consegui ler": quem
 * chama recusa gerar.
 */
export async function carregarFaixasParaCobrar(
  db: Db,
  companyId: string
): Promise<FaixaDePreco[] | null> {
  const { data, error } = await db
    .from("company_price_tiers")
    .select("min_quantity, price_cents")
    .eq("company_id", companyId)
    .returns<{ min_quantity: number; price_cents: number }[]>();
  if (error || !data) {
    console.error("faixas da empresa (para cobrar):", error?.message ?? "sem resposta");
    return null;
  }
  return data.map((f) => ({ minQuantity: f.min_quantity, priceCents: f.price_cents }));
}
