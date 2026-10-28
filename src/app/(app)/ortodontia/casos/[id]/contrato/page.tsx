import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageOrtho, canSettleOrtho, canViewOrtho } from "@/lib/ortodontia/access";
import { loadCase } from "@/lib/ortodontia/db";
import { orthoClauses } from "@/lib/ortodontia/regras";
import { ORTHO_KIND_LABELS } from "@/lib/ortodontia/constants";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { PrintButton } from "@/app/renegociacoes/[id]/acordo/print-button";

export const metadata: Metadata = { title: "Termo do tratamento ortodôntico" };

/**
 * O TERMO DO TRATAMENTO ORTODÔNTICO — para imprimir ou salvar em PDF e colher
 * a assinatura. As cláusulas são as MESMAS da proposta (`orthoClauses`): a
 * regra do dono de que a mensalidade é devida sem comparecimento está aqui.
 * Enquanto não há ZapSign, é este documento que vai ao paciente.
 */
export default async function OrtoContratoPage(props: PageProps<"/ortodontia/casos/[id]/contrato">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  const { id } = await props.params;
  const supabase = await createClient();
  const c = await loadCase(supabase, id);
  if (!c) notFound();
  if (!(canManageOrtho(session, c.clinic_id) || canSettleOrtho(session, c.clinic_id))) notFound();

  const { data: client } = await supabase
    .from("clients")
    .select("full_name, cpf, code, birth_date")
    .eq("id", c.client_id)
    .maybeSingle();

  const clausulas = orthoClauses({
    kind: c.treatment_kind,
    monthlyCents: c.monthly_fee_cents,
    plannedMonths: c.planned_months,
    maintenanceIntervalDays: c.maintenance_interval_days,
    billingDay: c.billing_day,
    installationCents: c.installation_fee_cents,
    retainerCharged: c.retainer_charged,
    retainerFeeCents: c.retainer_fee_cents,
    retainerTerms: c.retainer_terms,
  });
  const hoje = todayInBrazil();

  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href={`/ortodontia/casos/${c.id}`} className="text-xs underline">← Voltar ao caso</a>
        <PrintButton />
      </div>

      <header className="mb-5 border-b pb-4">
        <h1 className="text-xl font-bold">Termo de tratamento ortodôntico</h1>
        <p className="mt-1 text-xs">
          {c.clinic?.name ?? "Risarte Odontologia"} · Caso <strong>{c.code}</strong> · Emitido em {formatIsoDateBr(hoje)}
        </p>
      </header>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Paciente</h2>
        <p>
          {client?.full_name ?? "—"}
          {client?.code ? ` · ${client.code}` : ""}
          {client?.cpf ? ` · CPF ${client.cpf}` : ""}
          {client?.birth_date ? ` · nascimento ${formatIsoDateBr(client.birth_date as string)}` : ""}
        </p>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">O tratamento</h2>
        <table className="w-full text-xs">
          <tbody>
            <tr className="border-b"><td className="py-1">Tipo</td><td className="py-1 text-right">{ORTHO_KIND_LABELS[c.treatment_kind]}</td></tr>
            <tr className="border-b"><td className="py-1">Ortodontista responsável</td><td className="py-1 text-right">{c.orthodontist?.full_name ?? "a definir"}</td></tr>
            <tr className="border-b"><td className="py-1">Início</td><td className="py-1 text-right">{c.start_date ? formatIsoDateBr(c.start_date) : "a definir"}</td></tr>
            <tr className="border-b"><td className="py-1">Duração prevista</td><td className="py-1 text-right">{c.planned_months} meses{c.planned_end_date ? ` (término previsto ${formatIsoDateBr(c.planned_end_date)})` : ""}</td></tr>
            <tr className="border-b"><td className="py-1">Manutenções</td><td className="py-1 text-right">a cada {c.maintenance_interval_days} dias · cada falta prorroga o término em {c.maintenance_interval_days} dias</td></tr>
            <tr className="border-b"><td className="py-1">Contenções (fim do tratamento)</td><td className="py-1 text-right tabular-nums">{c.retainer_charged && c.retainer_fee_cents > 0 ? `${formatBRL(c.retainer_fee_cents)} na entrega${c.retainer_terms ? ` · ${c.retainer_terms}` : ""}` : "incluídas, sem cobrança"}</td></tr>
            {c.installation_fee_cents > 0 && (
              <tr className="border-b"><td className="py-1">Instalação / documentação</td><td className="py-1 text-right tabular-nums">{formatBRL(c.installation_fee_cents)}</td></tr>
            )}
            <tr className="font-bold"><td className="py-1">Mensalidade de tratamento</td><td className="py-1 text-right tabular-nums">{formatBRL(c.monthly_fee_cents)} · vencimento dia {c.billing_day} · até a entrega das contenções</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Condições</h2>
        <ol className="list-inside list-decimal space-y-1 text-xs">
          {clausulas.map((cl, i) => (
            <li key={i}>{cl}</li>
          ))}
        </ol>
      </section>

      <section className="mt-10 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t pt-2 text-center">Paciente ou responsável</div>
        <div className="border-t pt-2 text-center">{c.clinic?.name ?? "Risarte Odontologia"}</div>
      </section>
      <p className="mt-6 text-[10px] text-neutral-600">
        Este termo acompanha a proposta/orçamento do plano de tratamento aceito. A versão assinada fica arquivada na unidade.
      </p>
    </div>
  );
}
