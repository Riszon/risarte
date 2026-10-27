import "server-only";
import type { empresarialDb } from "./db";
import { textoDaVantagem } from "./vantagens";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

export type VantagemDaPropostaLida = {
  perkId: string;
  nome: string;
  detalhe: string | null;
  descricao: string | null;
  /** Nome + detalhe (ou a descrição da rede), pronto para o papel. */
  texto: string;
};

/**
 * AS OUTRAS VANTAGENS DE UMA PROPOSTA, com o nome do catálogo (1033).
 *
 * Uma leitura só para o documento, o contrato e o fechamento: três cópias
 * desta consulta seriam como o contrato passaria a listar uma coisa e a
 * proposta outra.
 *
 * `null` quando a leitura falhou — quem chama decide: o documento mostra sem a
 * seção e avisa no log; o fechamento conta em `naoCopiado`.
 */
export async function carregarVantagensDaProposta(
  db: Db,
  leadId: string
): Promise<VantagemDaPropostaLida[] | null> {
  const { data, error } = await db
    .from("lead_perks")
    .select("perk_id, detail, perks ( name, description )")
    .eq("lead_id", leadId)
    .order("sort_order")
    .returns<
      {
        perk_id: string;
        detail: string | null;
        perks: { name: string; description: string | null } | null;
      }[]
    >();
  if (error || !data) {
    if (error) console.error("vantagens da proposta:", error.message);
    return null;
  }
  return data.map((v) => {
    const nome = v.perks?.name ?? "(vantagem)";
    const descricao = v.perks?.description ?? null;
    return {
      perkId: v.perk_id,
      nome,
      detalhe: v.detail,
      descricao,
      texto: textoDaVantagem(nome, v.detail, descricao),
    };
  });
}
