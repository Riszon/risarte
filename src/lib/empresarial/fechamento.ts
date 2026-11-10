import "server-only";
import type { empresarialDb } from "./db";
import { DEFAULT_ADHESION_PRICING } from "./pricing";
import { carregarVantagensDaProposta } from "./vantagens-servidor";

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
      // 1032: a escolha "individual × plano familiar" passa a chegar à
      // cobrança. Antes ela ficava na proposta, e o boleto cobrava sempre o
      // pacote a partir de 2 dependentes.
      dependent_mode:
        qual.dependent_mode === "PER_DEPENDENT" ? "PER_DEPENDENT" : "FAMILY_PACKAGE",
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

  // 5) AS OUTRAS VANTAGENS VIRAM COMPROMISSOS (1033, decisão do dono). O nome
  //    e o detalhe são COPIADOS: o que a empresa assinou não muda quando
  //    alguém renomeia a vantagem no catálogo depois.
  const vantagens = await carregarVantagensDaProposta(db, leadId);
  if (vantagens === null) {
    naoCopiado.push("as outras vantagens");
  } else if (vantagens.length > 0) {
    const { error } = await db.from("company_perks").insert(
      vantagens.map((v, i) => ({
        company_id: companyId,
        perk_id: v.perkId,
        name: v.nome,
        detail: v.detalhe ?? v.descricao,
        origin_lead_id: leadId,
        sort_order: i,
      }))
    );
    if (error) {
      console.error("fechamento (vantagens):", error.message);
      naoCopiado.push("as outras vantagens");
    }
  }

  return { naoCopiado };
}

/**
 * A PROPOSTA REASSINADA VAI PARA A EMPRESA (1041, decisão do dono 09/11/2026).
 *
 * Mesmo caminho de `copiarPropostaParaEmpresa`, mas sobre um cadastro que já
 * existe: o que a empresa assinou de novo passa a valer. Cobranças já geradas
 * NÃO mudam (o mês cobrado é fato); a próxima já sai com os valores novos.
 *
 * ⚠️ NÃO MEXE em CNPJ, nome fantasia, observações e "quantos colaboradores a
 * empresa tem": são da ficha da empresa, editáveis lá, e a proposta não manda
 * neles depois do fechamento.
 *
 * Benefício que saiu da proposta sai da empresa; o uso já registrado fica (a
 * ligação com o benefício vira nula, o procedimento continua no histórico).
 */
export async function atualizarEmpresaComProposta(
  db: Db,
  leadId: string,
  companyId: string,
  empresa: Record<string, unknown>,
  qual: Record<string, unknown> | null
): Promise<{ naoCopiado: string[] }> {
  const naoCopiado: string[] = [];
  const n = (chave: string): number | null => {
    const v = qual?.[chave];
    return typeof v === "number" ? v : null;
  };

  // 0) Os campos comerciais do cadastro.
  {
    const { error } = await db.from("companies").update(empresa).eq("id", companyId);
    if (error) {
      console.error("reassinatura (cadastro):", error.message);
      naoCopiado.push("os dados comerciais do cadastro");
    }
  }

  // 1) Os preços de adesão (uma linha por empresa).
  if (qual) {
    const { error } = await db.from("adhesion_pricing").upsert(
      {
        company_id: companyId,
        holder_fee_cents: n("holder_fee_cents") ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
        dependent_individual_fee_cents:
          n("dependent_fee_cents") ?? DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
        dependent_family_fee_cents:
          n("dependent_family_fee_cents") ?? DEFAULT_ADHESION_PRICING.dependentFamilyFeeCents,
        dependent_family_extra_fee_cents:
          n("dependent_family_extra_fee_cents") ??
          DEFAULT_ADHESION_PRICING.dependentFamilyExtraFeeCents,
        dependent_family_size: n("dependent_family_size") ?? 3,
        dependent_mode:
          qual.dependent_mode === "PER_DEPENDENT" ? "PER_DEPENDENT" : "FAMILY_PACKAGE",
      },
      { onConflict: "company_id" }
    );
    if (error) {
      console.error("reassinatura (preços):", error.message);
      naoCopiado.push("os preços de adesão");
    }
  }

  // 2) As faixas: as da proposta substituem as da empresa.
  {
    const { data: faixas, error: eLer } = await db
      .from("lead_price_tiers")
      .select("min_quantity, price_cents")
      .eq("lead_id", leadId);
    const { error: eApagar } = eLer
      ? { error: eLer }
      : await db.from("company_price_tiers").delete().eq("company_id", companyId);
    const { error: eGravar } =
      eLer || eApagar || !faixas?.length
        ? { error: null }
        : await db.from("company_price_tiers").insert(
            faixas.map((f) => ({
              company_id: companyId,
              min_quantity: f.min_quantity,
              price_cents: f.price_cents,
            }))
          );
    if (eLer || eApagar || eGravar) {
      console.error("reassinatura (faixas):", (eLer ?? eApagar ?? eGravar)?.message);
      naoCopiado.push("as faixas de preço");
    }
  }

  // 3) As unidades da parceria.
  {
    const { data: unidades, error: eLer } = await db
      .from("lead_clinics")
      .select("clinic_id")
      .eq("lead_id", leadId);
    const { error: eApagar } = eLer
      ? { error: eLer }
      : await db.from("company_clinics").delete().eq("company_id", companyId);
    const { error: eGravar } =
      eLer || eApagar || !unidades?.length
        ? { error: null }
        : await db
            .from("company_clinics")
            .insert(unidades.map((u) => ({ company_id: companyId, clinic_id: u.clinic_id })));
    if (eLer || eApagar || eGravar) {
      console.error("reassinatura (unidades):", (eLer ?? eApagar ?? eGravar)?.message);
      naoCopiado.push("as unidades da parceria");
    }
  }

  // 4) Os benefícios: atualiza pelo procedimento; o que saiu da proposta sai.
  {
    const { data: beneficios, error: eLer } = await db
      .from("lead_benefits")
      .select(
        "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent, clinic_ids"
      )
      .eq("lead_id", leadId);
    let erro = eLer;
    if (!erro && beneficios?.length) {
      ({ error: erro } = await db
        .from("procedure_benefits")
        .upsert(
          beneficios.map((b) => ({ company_id: companyId, ...b })),
          { onConflict: "company_id,procedure_id" }
        ));
    }
    if (!erro) {
      const manter = (beneficios ?? []).map((b) => b.procedure_id as string);
      let q = db.from("procedure_benefits").delete().eq("company_id", companyId);
      if (manter.length) q = q.not("procedure_id", "in", `(${manter.join(",")})`);
      ({ error: erro } = await q);
    }
    if (erro) {
      console.error("reassinatura (benefícios):", erro.message);
      naoCopiado.push("os benefícios");
    }
  }

  // 5) As outras vantagens vindas desta proposta.
  {
    const vantagens = await carregarVantagensDaProposta(db, leadId);
    if (vantagens === null) {
      naoCopiado.push("as outras vantagens");
    } else {
      const { error: eApagar } = await db
        .from("company_perks")
        .delete()
        .eq("company_id", companyId)
        .eq("origin_lead_id", leadId);
      const { error: eGravar } =
        eApagar || vantagens.length === 0
          ? { error: null }
          : await db.from("company_perks").insert(
              vantagens.map((v, i) => ({
                company_id: companyId,
                perk_id: v.perkId,
                name: v.nome,
                detail: v.detalhe ?? v.descricao,
                origin_lead_id: leadId,
                sort_order: i,
              }))
            );
      if (eApagar || eGravar) {
        console.error("reassinatura (vantagens):", (eApagar ?? eGravar)?.message);
        naoCopiado.push("as outras vantagens");
      }
    }
  }

  return { naoCopiado };
}
