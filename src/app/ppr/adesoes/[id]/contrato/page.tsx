import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import {
  PPR_RECURRING_METHOD_LABELS,
  type PprRecurringMethod,
} from "@/lib/ppr/constants";
import { PrintButton } from "./print-button";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

export const metadata: Metadata = { title: "Contrato de adesão — PPR+" };

/** Contrato de adesão ao PPR+ — para imprimir e colher a assinatura. */
export default async function PprContractPage(
  props: PageProps<"/ppr/adesoes/[id]/contrato">
) {
  await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: m } = await supabase
    .from("ppr_memberships")
    .select(
      "id, monthly_cents, payment_method, billing_day, created_at, extra_dependents, plan:ppr_plans ( id, name, description, cash_discount_percent, max_installments, grace_period_days ), clinic:clinics!ppr_memberships_clinic_id_fkey ( name ), holder:clients!ppr_memberships_holder_client_id_fkey ( full_name, cpf, birth_date, phone )"
    )
    .eq("id", id)
    .maybeSingle();
  if (!m) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  type PlanEmbed = {
    id: string;
    name: string;
    description: string | null;
    cash_discount_percent: number;
    max_installments: number;
    grace_period_days: number;
  };
  type HolderEmbed = {
    full_name: string;
    cpf: string | null;
    birth_date: string | null;
    phone: string | null;
  };
  const plan = one(m.plan as unknown as PlanEmbed | PlanEmbed[] | null);
  const clinic = one(
    m.clinic as unknown as { name: string } | { name: string }[] | null
  );
  const holder = one(m.holder as unknown as HolderEmbed | HolderEmbed[] | null);

  const [{ data: perkRows }, { data: benRows }] = await Promise.all([
    supabase
      .from("ppr_plan_perks")
      .select("label, sort_order")
      .eq("plan_id", plan?.id ?? "")
      .order("sort_order"),
    supabase
      .from("ppr_beneficiaries")
      .select(
        "role, relationship, card_code, client:clients!ppr_beneficiaries_client_id_fkey ( full_name, cpf, birth_date )"
      )
      .eq("membership_id", id)
      .is("left_at", null),
  ]);

  const perks = (perkRows ?? []) as { label: string }[];
  const beneficiaries = (benRows ?? []) as {
    role: string;
    relationship: string | null;
    card_code: string | null;
    client:
      | { full_name: string; cpf: string | null; birth_date: string | null }
      | { full_name: string; cpf: string | null; birth_date: string | null }[]
      | null;
  }[];

  const today = new Date().toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-[210mm] px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="javascript:history.back()" className="text-sm underline">
          ← Voltar
        </a>
        <PrintButton />
      </div>

      <div className="rounded-md border bg-white p-8 print:border-0 print:p-0">
        <div className="mb-6 border-b pb-3 text-center">
          <p className="text-lg font-semibold">
            {clinic?.name ?? "Risarte Odontologia"}
          </p>
          <p className="text-xs uppercase tracking-wider">
            Programa de Prevenção Riso+ (PPR+)
          </p>
        </div>

        <h1 className="mb-4 text-center text-base font-semibold uppercase">
          Termo de adesão ao {plan?.name ?? "PPR+"}
        </h1>

        {/* Titular ------------------------------------------------------- */}
        <section className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            1. Titular
          </h2>
          <p>
            <strong>{holder?.full_name}</strong>
            {holder?.cpf ? `, CPF ${holder.cpf}` : ""}
            {holder?.birth_date
              ? `, nascido(a) em ${new Date(`${holder.birth_date}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}`
              : ""}
            {holder?.phone ? `, telefone ${holder.phone}` : ""}.
          </p>
        </section>

        {/* Beneficiários -------------------------------------------------- */}
        <section className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            2. Beneficiários
          </h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Nome</th>
                <th className="py-1">Vínculo</th>
                <th className="py-1">CPF</th>
                <th className="py-1">Cartão</th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((b, i) => {
                const c = one(b.client);
                return (
                  <tr key={i} className="border-b">
                    <td className="py-1">{c?.full_name ?? "—"}</td>
                    <td className="py-1">
                      {b.role === "titular"
                        ? "Titular"
                        : (b.relationship ?? "Dependente")}
                    </td>
                    <td className="py-1">{c?.cpf ?? "—"}</td>
                    <td className="py-1 font-mono">{b.card_code ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Benefícios ----------------------------------------------------- */}
        <section className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            3. O que o plano inclui
          </h2>
          <ul className="list-disc pl-5">
            {perks.map((p, i) => (
              <li key={i}>{p.label}</li>
            ))}
          </ul>
          {plan?.description && <p className="mt-1">{plan.description}</p>}
        </section>

        {/* Pagamento ------------------------------------------------------ */}
        <section className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            4. Mensalidade e pagamento
          </h2>
          <p>
            Mensalidade de <strong>{formatBRL(m.monthly_cents as number)}</strong>
            {(m.extra_dependents as number) > 0 &&
              ` (inclui ${m.extra_dependents} dependente(s) extra(s))`}
            , paga por{" "}
            <strong>
              {m.payment_method
                ? PPR_RECURRING_METHOD_LABELS[
                    m.payment_method as PprRecurringMethod
                  ]
                : "forma recorrente"}
            </strong>
            {m.billing_day ? `, todo dia ${m.billing_day}` : ""}.
          </p>
          <p className="mt-1">
            Nos tratamentos, o beneficiário tem{" "}
            <strong>{plan?.cash_discount_percent ?? 0}%</strong> de desconto no
            pagamento à vista e parcelamento em até{" "}
            <strong>{plan?.max_installments ?? 1}×</strong>, com o desconto da
            faixa correspondente.
          </p>
        </section>

        {/* Condições ------------------------------------------------------ */}
        <section className="mb-6">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            5. Condições
          </h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              O plano passa a valer com a <strong>assinatura deste termo</strong>{" "}
              e a <strong>confirmação da primeira mensalidade</strong>.
            </li>
            {(plan?.grace_period_days ?? 0) > 0 && (
              <li>
                Carência de <strong>{plan?.grace_period_days} dia(s)</strong> a
                partir da ativação para o uso dos benefícios.
              </li>
            )}
            <li>
              Os benefícios com frequência definida (por exemplo, a limpeza)
              liberam novamente após o prazo do plano, contado do último uso.
            </li>
            <li>
              A falta de pagamento <strong>suspende</strong> os benefícios de
              todos os beneficiários e, persistindo, <strong>cancela</strong> o
              plano.
            </li>
            <li>
              Cancelado o plano, todos os beneficiários deixam de ter os
              benefícios, permanecendo o registro no histórico do cliente.
            </li>
            <li>
              Os benefícios são pessoais e intransferíveis, válidos nas unidades
              da rede Risarte que participam do programa.
            </li>
          </ol>
        </section>

        <p className="mb-8">
          {clinic?.name ?? "Risarte Odontologia"}, {today}.
        </p>

        <div className="grid grid-cols-2 gap-8 pt-6 text-center text-xs">
          <div>
            <div className="mb-1 border-t border-black pt-1">
              {holder?.full_name}
            </div>
            Titular
          </div>
          <div>
            <div className="mb-1 border-t border-black pt-1">
              {clinic?.name ?? "Risarte Odontologia"}
            </div>
            Unidade Risarte
          </div>
        </div>
      </div>
    </div>
  );
}
