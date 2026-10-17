import "server-only";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { dataDoFiltro } from "@/lib/finance/collection";
import {
  relatorioDeContasPagas,
  type PagamentoDeConta,
} from "@/lib/finance/contas-pagas";
import type { RelatorioPronto } from "@/lib/finance/relatorio";
import { lerPorLotes, lerTodasAsPaginas } from "@/lib/paginar";
import { todayInBrazil } from "@/lib/dates";

/**
 * QUEM CARREGA O RELATÓRIO DE CONTAS PAGAS (OC-00110) — a página de impressão
 * E a planilha chamam daqui, para os dois papéis dizerem a mesma coisa.
 */

export type Filtros = { [k: string]: string | string[] | undefined };

function pick(params: Filtros, k: string): string | null {
  const v = params[k];
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").trim() || null;
}

/** Sem filtro, o mês corrente até hoje. */
export function periodoPadrao(hoje: string): { de: string; ate: string } {
  return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
}

/**
 * `null` = sem permissão. `falhou` = a leitura não veio inteira: o relatório
 * NÃO sai pela metade (um total menor que o real, com cara de oficial).
 */
export type Carga = { relatorio: RelatorioPronto } | { falhou: true } | null;

type Embed<T> = T | T[] | null;
const um = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function carregarRelatorioDeContasPagas(params: Filtros): Promise<Carga> {
  const session = await getSessionContext();
  if (!canViewFinance(session)) return null;
  const unidade = session.activeClinic;
  if (!unidade) return null;
  const supabase = await createClient();

  const padrao = periodoPadrao(todayInBrazil());
  let de = dataDoFiltro(pick(params, "de")) ?? padrao.de;
  let ate = dataDoFiltro(pick(params, "ate")) ?? padrao.ate;
  if (de > ate) [de, ate] = [ate, de];

  const lidos = await lerTodasAsPaginas<Record<string, unknown>>((a, b) =>
    supabase
      .from("payable_payments")
      .select(
        "id, paid_at, amount_cents, fee_cents, interest_cents, discount_cents, payment_method, payable:payables!payable_payments_payable_id_fkey ( description, document_number, account_code, due_date, supplier:suppliers ( name ), account:chart_of_accounts!payables_account_code_fkey ( name ) )"
      )
      .eq("clinic_id", unidade.id)
      // Estorno não é pagamento: sai o original (marcado) e o contra-lançamento.
      .eq("reversed", false)
      .is("reversal_of", null)
      .gte("paid_at", de)
      .lte("paid_at", ate)
      .order("paid_at")
      .order("id")
      .range(a, b)
  );
  if (!lidos.ok) {
    console.error("contas pagas — pagamentos:", lidos.error.message);
    return { falhou: true };
  }

  // Conferido com o banco = o lançamento de caixa do pagamento está conciliado.
  const ids = lidos.linhas.map((p) => p.id as string);
  const caixa = await lerPorLotes<Record<string, unknown>>(ids, (lote, a, b) =>
    supabase
      .from("financial_entries")
      .select("source_id, reconciled_at")
      .eq("source_type", "payable_cash")
      .in("source_id", lote)
      .order("id")
      .range(a, b)
  );
  if (!caixa.ok) {
    console.error("contas pagas — conciliação:", caixa.error.message);
    return { falhou: true };
  }
  const conciliados = new Set(
    caixa.linhas.filter((e) => e.reconciled_at !== null).map((e) => e.source_id as string)
  );

  type Conta = {
    description: string;
    document_number: string | null;
    account_code: string;
    due_date: string | null;
    supplier: Embed<{ name: string }>;
    account: Embed<{ name: string }>;
  };
  const pagamentos: PagamentoDeConta[] = lidos.linhas.map((p) => {
    const conta = um(p.payable as Embed<Conta>);
    return {
      paidAt: p.paid_at as string,
      supplierName: um(conta?.supplier ?? null)?.name ?? null,
      description: conta?.description ?? "",
      documentNumber: conta?.document_number ?? null,
      accountCode: conta?.account_code ?? "",
      accountName: um(conta?.account ?? null)?.name ?? null,
      dueDate: conta?.due_date ?? null,
      amountCents: Number(p.amount_cents),
      chargesCents: Number(p.fee_cents ?? 0) + Number(p.interest_cents ?? 0),
      discountCents: Number(p.discount_cents ?? 0),
      paymentMethod: (p.payment_method as string | null) ?? null,
      reconciled: conciliados.has(p.id as string),
    };
  });

  return {
    relatorio: relatorioDeContasPagas({
      pagamentos,
      unidade: unidade.name,
      de,
      ate,
      quem: session.fullName || session.email || null,
    }),
  };
}
