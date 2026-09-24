import "server-only";
import type { empresarialDb } from "./db";
import { DEFAULT_ADHESION_PRICING } from "./pricing";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

/**
 * O QUE FOI VENDIDO VIRA O QUE SERÁ COBRADO (OC-00083, H4 / 1018).
 *
 * Pedido do dono: *"o que for gerado na proposta da empresa e aprovada e
 * realizado o fechamento deve se tornar as informações da ficha da empresa. e
 * todos os benefícios deve ir para os Beneficiários que fazem parte da empresa
 * e estão cadastrados no programa."*
 *
 * ⚠️ MORA AQUI, E NÃO DENTRO DA ACTION, por um motivo prático: dentro da
 * action esta regra só seria exercitada por um clique, e ninguém conferiria
 * sem fechar um negócio de verdade. É a mesma razão de `camposDaEmpresa` ser
 * função à parte.
 *
 * ⚠️ NADA AQUI DERRUBA O FECHAMENTO. Quando isto roda, a empresa já existe e
 * o negócio já foi fechado — desfazer seria pior que seguir. O que não der
 * para copiar volta na lista `naoCopiado`, para a tela contar a quem fechou.
 */
export async function copiarPropostaParaEmpresa(
  db: Db,
  leadId: string,
  companyId: string,
  qual: Record<string, unknown> | null
): Promise<{ naoCopiado: string[] }> {
  const naoCopiado: string[] = [];
  const n = (chave: string): number | null => {
    const v = qual?.[chave];
    return typeof v === "number" ? v : null;
  };

  // 1) Os preços de adesão negociados.
  if (qual) {
    const { error } = await db.from("adhesion_pricing").insert({
      company_id: companyId,
      holder_fee_cents: n("holder_fee_cents") ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
      dependent_individual_fee_cents:
        n("dependent_fee_cents") ?? DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
      dependent_family_fee_cents:
        n("dependent_family_fee_cents") ??
        DEFAULT_ADHESION_PRICING.dependentFamilyFeeCents,
      dependent_family_extra_fee_cents:
        n("dependent_family_extra_fee_cents") ??
        DEFAULT_ADHESION_PRICING.dependentFamilyExtraFeeCents,
      dependent_family_size: n("dependent_family_size") ?? 3,
    });
    if (error) {
      console.error("fechamento (preços):", error.message);
      naoCopiado.push("os preços de adesão");
    }
  }

  // 2) As faixas de preço por quantidade.
  //
  // Elas viram faixas DA EMPRESA, não um preço congelado: a mensalidade é
  // recalculada todo mês com a quantidade daquele momento, que é o que a
  // empresa comprou ("cresça e pague menos").
  const { data: faixas } = await db
    .from("lead_price_tiers")
    .select("min_quantity, price_cents")
    .eq("lead_id", leadId);
  if (faixas?.length) {
    const { error } = await db.from("company_price_tiers").insert(
      faixas.map((f) => ({
        company_id: companyId,
        min_quantity: f.min_quantity,
        price_cents: f.price_cents,
      }))
    );
    if (error) {
      console.error("fechamento (faixas):", error.message);
      naoCopiado.push("as faixas de preço");
    }
  }

  // 3) AS UNIDADES DA PARCERIA (1019). Sem elas no cadastro, a restrição
  //    combinada na proposta se perderia no fechamento — e o motor de
  //    orçamento passaria a liberar o benefício em qualquer unidade.
  const { data: unidades } = await db
    .from("lead_clinics")
    .select("clinic_id")
    .eq("lead_id", leadId);
  if (unidades?.length) {
    const { error } = await db.from("company_clinics").insert(
      unidades.map((u) => ({ company_id: companyId, clinic_id: u.clinic_id }))
    );
    if (error) {
      console.error("fechamento (unidades):", error.message);
      naoCopiado.push("as unidades da parceria");
    }
  }

  // 4) OS BENEFÍCIOS — o pedido literal. Eles alcançam todo mundo da empresa
  //    porque `procedure_benefits` é por EMPRESA, e é essa tabela que o motor
  //    consulta no orçamento de cada pessoa (titular ou dependente, conforme
  //    o "para quem vale" que veio da proposta).
  const { data: beneficios } = await db
    .from("lead_benefits")
    .select(
      "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent, clinic_ids"
    )
    .eq("lead_id", leadId);
  if (beneficios?.length) {
    const { error } = await db
      .from("procedure_benefits")
      .insert(beneficios.map((b) => ({ company_id: companyId, ...b })));
    if (error) {
      console.error("fechamento (benefícios):", error.message);
      naoCopiado.push("os benefícios");
    }
  }

  return { naoCopiado };
}
