import "server-only";
// AS CONTAS DA COBRANÇA DO EMPRESARIAL — num lugar só (AP18, 27/09/2026).
//
// Moraram dentro de `billing-actions.ts` até o termo de inclusão precisar da
// MESMA conta ("a mensalidade de hoje é o que a empresa paga de verdade" —
// decisão do dono). Duas cópias da conta de dinheiro são como a tela e o
// boleto passam a discordar. Nada da lógica mudou na mudança de endereço.
//
// Não é "use server" de propósito: arquivo de ação exporta ENDPOINTS, e estas
// funções não têm guarda de permissão — quem as chama (a action) é que tem.

import type { empresarialDb } from "./db";
import { carregarFaixasParaCobrar } from "./faixas-da-empresa";
import {
  computeMonthlyCents,
  precoDoTitularComFaixa,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "./pricing";
import type { DependentPlan } from "./constants";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

/**
 * O preço de UM titular na implantação, pela faixa da quantidade dada.
 *
 * ⚠️ AP13: NULO quando não conseguiu ler o preço ou as faixas. Antes, a falha
 * caía no preço padrão da rede SEM avisar — a empresa que negociou outro preço
 * receberia a implantação pelo padrão. Quem chama recusa gerar.
 */
export async function precoPorTitularDaImplantacao(
  db: Db,
  companyId: string,
  quantidadeDaFaixa: number
): Promise<number | null> {
  const { data: pricingRows, error: erroDoPreco } = await db
    .from("adhesion_pricing")
    .select("company_id, holder_fee_cents")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  if (erroDoPreco || !pricingRows) return null;
  const rows = pricingRows as {
    company_id: string | null;
    holder_fee_cents: number;
  }[];
  const escolhido =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const base = escolhido?.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents;

  const faixas = await carregarFaixasParaCobrar(db, companyId);
  if (!faixas) return null;
  return precoDoTitularComFaixa(
    { ...DEFAULT_ADHESION_PRICING, holderFeeCents: base },
    faixas,
    quantidadeDaFaixa
  );
}

/**
 * O valor da implantação pela QUANTIDADE CONTRATADA.
 *
 * ⚠️ SÓ TITULARES, e isso é a mesma lei que vale na proposta (decisão do dono
 * em 24/09/2026, bloco I1): ninguém sabe quantos dependentes entram nem como
 * se distribuem entre as famílias antes dos cadastros. Somá-los aqui seria
 * cobrar por gente que talvez não exista.
 *
 * A faixa é escolhida pela quantidade CONTRATADA — é ela que a empresa
 * negociou. Usar a faixa de "1" porque ainda não há ninguém cadastrado
 * cobraria o preço mais caro justamente de quem fechou volume.
 */
export async function implantacaoPeloContratado(
  db: Db,
  companyId: string,
  contratado: number
): Promise<number | null> {
  const porTitular = await precoPorTitularDaImplantacao(db, companyId, contratado);
  return porTitular === null ? null : porTitular * contratado;
}

/** Mensalidade total e por documento (para o modelo "um boleto por CNPJ"). */
export async function computeMonthlyBreakdown(
  db: Db,
  companyId: string
): Promise<{
  totalCents: number;
  totalEmployees: number;
  byDocument: Map<string, { employees: number; cents: number }>;
} | null> {
  // ⚠️ AP13: QUALQUER leitura que falhe devolve nulo. Antes, cada falha virava
  // um número "razoável": preço padrão no lugar do combinado, ZERO dependentes
  // (a mensalidade saía sem eles), "sem titulares". A cobrança nascia errada
  // e parecia certa.
  const [
    { data: pricingRows, error: erroDoPreco },
    { data: emps, error: erroDosTitulares },
    { data: deps, error: erroDosDependentes },
  ] = await Promise.all([
      db
        .from("adhesion_pricing")
        .select(
          "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments, dependent_family_size"
        )
        .or(`company_id.eq.${companyId},company_id.is.null`),
      db
        .from("employees")
        .select("id, dependent_plan, status, company_document_id")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .returns<
          {
            id: string;
            dependent_plan: DependentPlan;
            status: "ACTIVE";
            company_document_id: string | null;
          }[]
        >(),
      db.from("dependents").select("employee_id, status").eq("status", "ACTIVE"),
    ]);
  if (erroDoPreco || erroDosTitulares || erroDosDependentes || !pricingRows || !emps || !deps) {
    return null;
  }

  const rows = pricingRows as {
    company_id: string | null;
    holder_fee_cents: number;
    dependent_individual_fee_cents: number;
    dependent_family_fee_cents: number;
    dependent_family_extra_fee_cents: number;
    max_installments: number;
  }[];
  const chosen =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const pricing: AdhesionPricing = chosen
    ? {
        holderFeeCents: chosen.holder_fee_cents,
        dependentIndividualFeeCents: chosen.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosen.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents: chosen.dependent_family_extra_fee_cents,
        maxInstallments: chosen.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;

  const depCount = new Map<string, number>();
  for (const d of (deps ?? []) as { employee_id: string }[])
    depCount.set(d.employee_id, (depCount.get(d.employee_id) ?? 0) + 1);

  // ⚠️ A FAIXA É ESCOLHIDA PELO TOTAL, e a soma abaixo é feita um titular por
  // vez (para repartir por CNPJ). Calcular a faixa dentro do laço faria cada
  // chamada ver "1 titular ativo" e cobrar sempre a faixa de 1 — o preço mais
  // caro, em toda empresa que negociou volume.
  const faixas = await carregarFaixasParaCobrar(db, companyId);
  if (!faixas) return null;
  const ativos = emps.filter((e) => e.status === "ACTIVE").length;
  const precoComFaixa = {
    ...pricing,
    holderFeeCents: precoDoTitularComFaixa(pricing, faixas, ativos),
  };

  const byDocument = new Map<string, { employees: number; cents: number }>();
  let totalCents = 0;
  for (const e of emps ?? []) {
    const one = computeMonthlyCents(precoComFaixa, [
      {
        status: "ACTIVE",
        dependentPlan: e.dependent_plan,
        activeDependentCount: depCount.get(e.id) ?? 0,
      },
    ]).totalCents;
    totalCents += one;
    const key = e.company_document_id ?? "__none__";
    const cur = byDocument.get(key) ?? { employees: 0, cents: 0 };
    cur.employees++;
    cur.cents += one;
    byDocument.set(key, cur);
  }

  return { totalCents, totalEmployees: (emps ?? []).length, byDocument };
}
