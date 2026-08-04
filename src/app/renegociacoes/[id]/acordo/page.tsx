import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Termo de renegociação" };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  cartao_parcelado: "Cartão parcelado",
  credito_recorrente: "Recorrência no cartão",
  deposito_avista: "Depósito",
  dinheiro: "Dinheiro",
};

/**
 * FIN2.4 — o termo de renegociação, para imprimir e colher a assinatura.
 * Enquanto o core não tem ZapSign, é este documento que vai ao cliente
 * (decisão do dono, 04/08/2026).
 */
export default async function RenegotiationAgreementPage(
  props: PageProps<"/renegociacoes/[id]/acordo">
) {
  await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: r } = await supabase
    .from("payment_renegotiations")
    .select(
      "id, code, created_at, status, original_principal_cents, original_benefit_cents, original_fee_cents, original_interest_cents, original_total_cents, discount_cents, discount_percent, new_total_cents, monthly_interest_percent, financed_interest_cents, reason, source_installment_ids, clinic:clinics!payment_renegotiations_clinic_id_fkey ( name ), client:clients!payment_renegotiations_client_id_fkey ( full_name, cpf )"
    )
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const clinic = one<{ name: string }>(
    r.clinic as { name: string } | { name: string }[] | null
  );
  const client = one<{ full_name: string; cpf: string | null }>(
    r.client as
      | { full_name: string; cpf: string | null }
      | { full_name: string; cpf: string | null }[]
      | null
  );

  // As cobranças NOVAS do acordo (as que o cliente vai pagar).
  const { data: novas } = await supabase
    .from("payment_installments")
    .select("seq, kind, due_date, amount_cents, payment_method")
    .eq("renegotiation_id", id)
    .order("seq")
    .returns<
      {
        seq: number;
        kind: string;
        due_date: string;
        amount_cents: number;
        payment_method: string | null;
      }[]
    >();

  // As cobranças SUBSTITUÍDAS (o que estava em aberto) e de que venda vieram.
  const { data: antigas } = await supabase
    .from("payment_installments")
    .select(
      "seq, kind, due_date, amount_cents, negotiation_id, direct_sale_id"
    )
    .in("id", (r.source_installment_ids as string[]) ?? [])
    .order("due_date")
    .returns<
      {
        seq: number;
        kind: string;
        due_date: string;
        amount_cents: number;
        negotiation_id: string | null;
        direct_sale_id: string | null;
      }[]
    >();

  // As VENDAS de origem: o cliente precisa reconhecer o que está renegociando.
  const negIds = [
    ...new Set(
      (antigas ?? [])
        .map((i) => i.negotiation_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const saleIds = [
    ...new Set(
      (antigas ?? [])
        .map((i) => i.direct_sale_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  type OriginSale = {
    id: string;
    code: string | null;
    kind: "negotiation" | "direct_sale";
    createdAt: string;
    totalCents: number;
    items: { description: string; quantity: number; finalCents: number }[];
  };
  const origins: OriginSale[] = [];

  if (negIds.length > 0) {
    const { data: negs } = await supabase
      .from("plan_negotiations")
      .select("id, code, created_at, final_cents, option_id")
      .in("id", negIds)
      .returns<
        {
          id: string;
          code: string | null;
          created_at: string;
          final_cents: number;
          option_id: string;
        }[]
      >();
    const { data: negItems } = await supabase
      .from("plan_negotiation_items")
      .select(
        "negotiation_id, included, program_discount_cents, treatment_plan_option_items ( option_id, description, quantity, unit_price_cents, sort_order )"
      )
      .in("negotiation_id", negIds)
      .returns<
        {
          negotiation_id: string;
          included: boolean;
          program_discount_cents: number | null;
          treatment_plan_option_items: {
            option_id: string;
            description: string;
            quantity: number;
            unit_price_cents: number;
            sort_order: number;
          } | null;
        }[]
      >();
    for (const n of negs ?? []) {
      origins.push({
        id: n.id,
        code: n.code,
        kind: "negotiation",
        createdAt: n.created_at,
        totalCents: n.final_cents,
        items: (negItems ?? [])
          .filter(
            (i) =>
              i.negotiation_id === n.id &&
              i.included &&
              i.treatment_plan_option_items?.option_id === n.option_id
          )
          .sort(
            (a, b) =>
              (a.treatment_plan_option_items?.sort_order ?? 0) -
              (b.treatment_plan_option_items?.sort_order ?? 0)
          )
          .map((i) => {
            const it = i.treatment_plan_option_items!;
            return {
              description: it.description,
              quantity: it.quantity,
              finalCents: Math.max(
                0,
                it.quantity * it.unit_price_cents -
                  (i.program_discount_cents ?? 0)
              ),
            };
          }),
      });
    }
  }

  if (saleIds.length > 0) {
    const { data: sales } = await supabase
      .from("direct_sales")
      .select("id, code, created_at, final_cents")
      .in("id", saleIds)
      .returns<
        {
          id: string;
          code: string | null;
          created_at: string;
          final_cents: number;
        }[]
      >();
    const { data: saleItems } = await supabase
      .from("direct_sale_items")
      .select("sale_id, description, quantity, final_cents")
      .in("sale_id", saleIds)
      .returns<
        {
          sale_id: string;
          description: string;
          quantity: number;
          final_cents: number;
        }[]
      >();
    for (const s of sales ?? []) {
      origins.push({
        id: s.id,
        code: s.code,
        kind: "direct_sale",
        createdAt: s.created_at,
        totalCents: s.final_cents,
        items: (saleItems ?? [])
          .filter((i) => i.sale_id === s.id)
          .map((i) => ({
            description: i.description,
            quantity: i.quantity,
            finalCents: i.final_cents,
          })),
      });
    }
  }
  origins.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));

  const codeOf = (i: { negotiation_id: string | null; direct_sale_id: string | null }) =>
    origins.find((o) => o.id === (i.negotiation_id ?? i.direct_sale_id))?.code ??
    null;

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <p className="text-xs text-neutral-500">
          Imprima ou salve em PDF para colher a assinatura do cliente.
        </p>
        <PrintButton />
      </div>

      <header className="mb-6 border-b pb-4">
        <h1 className="text-xl font-semibold">
          Termo de renegociação de dívida
        </h1>
        <p className="mt-1 text-xs text-neutral-600">
          {clinic?.name ?? "Risarte Odontologia"} · Documento{" "}
          <strong>{r.code ?? "—"}</strong> · Emitido em{" "}
          {fmtDate(r.created_at as string)}
        </p>
      </header>

      <section className="mb-5">
        <h2 className="mb-1 text-sm font-semibold">Cliente</h2>
        <p>{client?.full_name ?? "—"}</p>
        {client?.cpf && <p className="text-xs">CPF {client.cpf}</p>}
      </section>

      <section className="mb-5">
        <h2 className="mb-1 text-sm font-semibold">
          Dívida apurada em {fmtDate(r.created_at as string)}
        </h2>
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="py-0.5">Valor em aberto das cobranças</td>
              <td className="py-0.5 text-right">
                {formatBRL(r.original_principal_cents as number)}
              </td>
            </tr>
            {(r.original_benefit_cents as number) > 0 && (
              <tr>
                <td className="py-0.5">
                  Benefício perdido por falta de pontualidade
                </td>
                <td className="py-0.5 text-right">
                  {formatBRL(r.original_benefit_cents as number)}
                </td>
              </tr>
            )}
            {(r.original_fee_cents as number) > 0 && (
              <tr>
                <td className="py-0.5">Multa por atraso</td>
                <td className="py-0.5 text-right">
                  {formatBRL(r.original_fee_cents as number)}
                </td>
              </tr>
            )}
            {(r.original_interest_cents as number) > 0 && (
              <tr>
                <td className="py-0.5">Juros por atraso</td>
                <td className="py-0.5 text-right">
                  {formatBRL(r.original_interest_cents as number)}
                </td>
              </tr>
            )}
            <tr className="border-t font-semibold">
              <td className="py-1">Total devido</td>
              <td className="py-1 text-right">
                {formatBRL(r.original_total_cents as number)}
              </td>
            </tr>
            {(r.discount_cents as number) > 0 && (
              <tr>
                <td className="py-0.5">
                  Desconto concedido ({String(r.discount_percent)}%)
                </td>
                <td className="py-0.5 text-right">
                  − {formatBRL(r.discount_cents as number)}
                </td>
              </tr>
            )}
            {(r.financed_interest_cents as number) > 0 && (
              <tr>
                <td className="py-0.5">
                  Juros do parcelamento ({String(r.monthly_interest_percent)}%
                  ao mês)
                </td>
                <td className="py-0.5 text-right">
                  + {formatBRL(r.financed_interest_cents as number)}
                </td>
              </tr>
            )}
            <tr className="border-t text-base font-bold">
              <td className="py-1">Total renegociado</td>
              <td className="py-1 text-right">
                {formatBRL(r.new_total_cents as number)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {origins.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold">
            Vendas de origem ({origins.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-600">
            A dívida acima vem {origins.length === 1 ? "da" : "das"} venda
            {origins.length === 1 ? "" : "s"} abaixo.
          </p>
          {origins.map((o) => (
            <div key={o.id} className="mb-3 border-l-2 border-neutral-300 pl-3">
              <p className="text-xs font-semibold">
                {o.code ?? "—"} ·{" "}
                {o.kind === "direct_sale"
                  ? "Venda direta"
                  : "Plano de tratamento"}{" "}
                · {fmtDate(o.createdAt)}
              </p>
              <ul className="text-xs">
                {o.items.map((it, n) => (
                  <li key={n} className="flex justify-between py-0.5">
                    <span>
                      {it.quantity > 1 && `${it.quantity}× `}
                      {it.description}
                    </span>
                    <span>{formatBRL(it.finalCents)}</span>
                  </li>
                ))}
                {o.items.length === 0 && (
                  <li className="py-0.5 text-neutral-500">
                    Sem procedimentos lançados.
                  </li>
                )}
                <li className="flex justify-between border-t py-0.5 font-semibold">
                  <span>Total da venda</span>
                  <span>{formatBRL(o.totalCents)}</span>
                </li>
              </ul>
            </div>
          ))}
        </section>
      )}

      {(antigas ?? []).length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold">
            Cobranças substituídas por este acordo
          </h2>
          <ul className="text-xs">
            {(antigas ?? []).map((i, n) => (
              <li key={n} className="flex justify-between border-b py-0.5">
                <span>
                  {codeOf(i) && (
                    <span className="mr-1 font-semibold">{codeOf(i)}</span>
                  )}
                  {i.kind === "entrada" ? "Entrada" : `Parcela ${i.seq}`} ·
                  vencimento {fmtDate(i.due_date)}
                </span>
                <span>{formatBRL(i.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold">
          Novo plano de pagamento ({(novas ?? []).length} cobrança
          {(novas ?? []).length === 1 ? "" : "s"})
        </h2>
        <ul className="text-xs">
          {(novas ?? []).map((i, n) => (
            <li key={n} className="flex justify-between border-b py-0.5">
              <span>
                {i.kind === "entrada" ? "Entrada" : `Parcela ${i.seq}`} ·
                vencimento {fmtDate(i.due_date)}
                {i.payment_method &&
                  ` · ${METHOD_LABELS[i.payment_method] ?? i.payment_method}`}
              </span>
              <span>{formatBRL(i.amount_cents)}</span>
            </li>
          ))}
        </ul>
        {r.reason && (
          <p className="mt-2 text-xs">
            <strong>Observação:</strong> {r.reason as string}
          </p>
        )}
      </section>

      <section className="mb-8 text-xs leading-relaxed">
        <p>
          O cliente reconhece a dívida acima e se compromete a pagá-la no plano
          descrito. O atraso de qualquer cobrança deste acordo sujeita o valor
          a multa e juros na forma contratada, e faz o cliente perder, naquela
          cobrança, os benefícios condicionados ao pagamento pontual.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-8 pt-10 text-center text-xs">
        <div className="border-t pt-1">
          {client?.full_name ?? "Cliente"}
          <br />
          Cliente
        </div>
        <div className="border-t pt-1">
          {clinic?.name ?? "Risarte Odontologia"}
          <br />
          Responsável pela unidade
        </div>
      </section>
    </main>
  );
}
