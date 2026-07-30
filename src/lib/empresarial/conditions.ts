import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "./db";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/commercial";

/**
 * J5: condições de PAGAMENTO do Risarte Empresarial aplicadas ao tratamento.
 *
 * A empresa parceira já tinha isso configurado (`companies.payment_methods` e
 * `companies.default_max_installments`, telas de /empresarial), mas a
 * configuração só era usada na mensalidade do programa — a venda do tratamento
 * continuava presa à regra da unidade (por isso o boleto não aparecia). Aqui a
 * condição da empresa é lida e passa a valer, do mesmo jeito que o plano do
 * PPR+ já valia.
 */
export type EmpresarialConditions = {
  companyId: string;
  companyName: string | null;
  /** Parcelas liberadas pela empresa (soma-se ao máximo da unidade). */
  maxInstallments: number;
  /** Formas de pagamento liberadas pela empresa (já nos nomes do sistema). */
  allowedMethods: PaymentMethod[];
};

/**
 * O Empresarial fala em BOLETO/PIX/CARD; o resto do sistema tem meios mais
 * detalhados. "CARD" cobre cartão à vista e parcelado.
 */
const METHOD_MAP: Record<string, PaymentMethod[]> = {
  BOLETO: ["boleto"],
  PIX: ["pix"],
  CARD: ["cartao", "cartao_parcelado"],
};

function mapMethods(raw: string[] | null): PaymentMethod[] {
  const out = new Set<PaymentMethod>();
  for (const m of raw ?? []) {
    for (const mapped of METHOD_MAP[m] ?? []) out.add(mapped);
  }
  return [...out].filter((m) =>
    (PAYMENT_METHODS as readonly string[]).includes(m)
  );
}

type CompanyRow = {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  status: string;
  payment_methods: string[] | null;
  default_max_installments: number | null;
};

/**
 * Condições do Empresarial de vários clientes de uma vez (listas). Clientes sem
 * programa ativo ficam fora do mapa.
 */
export async function loadEmpresarialConditionsForClients(
  clientIds: string[]
): Promise<Map<string, EmpresarialConditions>> {
  const out = new Map<string, EmpresarialConditions>();
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, empresarial_company_id, empresarial_active")
    .in("id", ids);

  const companyByClient = new Map<string, string>();
  for (const c of clientRows ?? []) {
    const companyId = c.empresarial_company_id as string | null;
    if (companyId && c.empresarial_active !== false) {
      companyByClient.set(c.id as string, companyId);
    }
  }
  if (companyByClient.size === 0) return out;

  const db = await empresarialDb();
  const { data: companyRows } = await db
    .from("companies")
    .select(
      "id, legal_name, trade_name, status, payment_methods, default_max_installments"
    )
    .in("id", [...new Set(companyByClient.values())])
    .returns<CompanyRow[]>();

  const companies = new Map<string, EmpresarialConditions>();
  for (const co of companyRows ?? []) {
    // Empresa suspensa/encerrada não concede condição diferenciada.
    if (co.status !== "ACTIVE") continue;
    companies.set(co.id, {
      companyId: co.id,
      companyName: co.trade_name ?? co.legal_name ?? null,
      maxInstallments: Math.max(1, co.default_max_installments ?? 1),
      allowedMethods: mapMethods(co.payment_methods),
    });
  }

  for (const [clientId, companyId] of companyByClient) {
    const conditions = companies.get(companyId);
    if (conditions) out.set(clientId, conditions);
  }
  return out;
}

/** Condições do Empresarial de UM cliente (null = sem programa ativo). */
export async function loadEmpresarialConditions(
  clientId: string
): Promise<EmpresarialConditions | null> {
  const map = await loadEmpresarialConditionsForClients([clientId]);
  return map.get(clientId) ?? null;
}
