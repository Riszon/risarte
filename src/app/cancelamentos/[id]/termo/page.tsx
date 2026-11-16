import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/pricing";
import { PrintButton } from "@/app/renegociacoes/[id]/acordo/print-button";
import { CancellationSteps } from "./cancellation-steps";
import { ChecklistDoDistrato } from "./checklist-do-distrato";
import { DevolucaoDoDistrato } from "./devolucao-do-distrato";
import { lerDistrato, type DistratoLido } from "@/app/(app)/financeiro/cobrancas-automaticas/distrato-actions";

export const metadata: Metadata = { title: "Termo de cancelamento" };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const DESTINATION_LABELS: Record<string, string> = {
  reevaluation: "Reavaliação com o Coordenador Clínico",
  follow_up: "Acompanhamento",
};

/**
 * 0206 — o TERMO DE CANCELAMENTO, para imprimir e colher a assinatura.
 *
 * Cancelar tratamento no meio é a hora mais delicada da relação com o paciente:
 * ele já pagou alguma coisa, já fez alguma coisa, e alguém vai terminar
 * devendo. Este documento existe para que o número seja o mesmo para os dois
 * lados — calculado por uma regra escrita antes da conversa.
 */
export default async function CancellationTermPage(
  props: PageProps<"/cancelamentos/[id]/termo">
) {
  await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("plan_cancellations")
    .select(
      "id, code, created_at, status, reason, notes, destination, follow_up_return_at, contract_cents, executed_cents, pending_cents, penalty_percent, penalty_cents, due_cents, paid_cents, reversed_cents, agreement_paid_cents, agreement_card_pending_cents, client_owes_cents, clinic_refunds_cents, term_signed_at, applied_at, negotiation_id, direct_sale_id, kind, checklist_required, clinic_id, client_id, clinic:clinics!plan_cancellations_clinic_id_fkey ( name ), client:clients!plan_cancellations_client_id_fkey ( full_name, cpf )"
    )
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const clinic = one<{ name: string }>(
    c.clinic as { name: string } | { name: string }[] | null
  );
  const client = one<{ full_name: string; cpf: string | null }>(
    c.client as
      | { full_name: string; cpf: string | null }
      | { full_name: string; cpf: string | null }[]
      | null
  );

  // 4020: o distrato (com a checklist) — do contrato ou da venda direta.
  const distrato = Boolean(c.checklist_required);
  const vendaDireta = c.kind === "venda_direta";
  const lido = distrato ? await lerDistrato(id) : null;
  const d: DistratoLido | null = lido && lido.ok ? lido.d : null;

  // Contrato de origem: o termo AMARRA um documento ao outro.
  const { data: neg } = vendaDireta
    ? { data: null }
    : await supabase
        .from("plan_negotiations")
        .select("code, payment_method, installments, final_cents, plan_id")
        .eq("id", c.negotiation_id as string)
        .maybeSingle();
  const { data: ds } = vendaDireta
    ? await supabase.from("direct_sales").select("code, installments, final_cents, created_at").eq("id", c.direct_sale_id as string).maybeSingle()
    : { data: null };

  const { data: sale } = vendaDireta
    ? { data: null }
    : await supabase
        .from("commercial_sales")
        .select("closed_at, contract_signed_at")
        .eq("negotiation_id", c.negotiation_id as string)
        .maybeSingle();

  // O que foi feito e o que ficou pendente, para o paciente conferir.
  const sessoesQ = supabase
    .from("treatment_sessions")
    .select("procedure_name, status, done_at, session_index, session_total")
    .order("plan_order", { ascending: true, nullsFirst: false });
  const { data: sessions } = vendaDireta
    ? await sessoesQ.eq("direct_sale_id", c.direct_sale_id as string)
    : await sessoesQ.eq("plan_id", neg?.plan_id ?? "");

  const done = (sessions ?? []).filter((s) => s.status === "done");
  const pending = (sessions ?? []).filter(
    (s) => s.status !== "done" && s.status !== "cancelled"
  );

  const owes = Number(c.client_owes_cents ?? 0);
  const refunds = Number(c.clinic_refunds_cents ?? 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href={`/prontuarios/${c.client_id}`} className="text-xs underline">
          ← Voltar ao prontuário
        </a>
        <PrintButton />
      </div>

      <header className="mb-6 border-b pb-4">
        <h1 className="text-xl font-bold">
          {distrato
            ? vendaDireta
              ? "Termo de distrato de venda direta"
              : "Termo de distrato de plano de tratamento"
            : "Termo de cancelamento de plano de tratamento"}
        </h1>
        <p className="mt-1 text-xs">
          {clinic?.name ?? "Risarte Odontologia"} · Documento{" "}
          <strong>{c.code}</strong> · Emitido em {fmtDate(c.created_at as string)}
        </p>
      </header>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Paciente</h2>
        <p>
          {client?.full_name ?? "—"}
          {client?.cpf ? ` · CPF ${client.cpf}` : ""}
        </p>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Contrato de origem</h2>
        {vendaDireta ? (
          <p>
            Venda direta <strong>{ds?.code ?? "—"}</strong>, no valor de{" "}
            <strong>{formatBRL(Number(c.contract_cents ?? 0))}</strong>
            {ds?.installments && Number(ds.installments) > 1 ? `, em ${ds.installments}×` : ""}
            {ds?.created_at ? `, de ${fmtDate(ds.created_at as string)}` : ""}.
          </p>
        ) : (
        <p>
          Plano de tratamento <strong>{neg?.code ?? "—"}</strong>, no valor
          contratado de{" "}
          <strong>{formatBRL(Number(c.contract_cents ?? 0))}</strong>
          {neg?.installments && Number(neg.installments) > 1
            ? `, em ${neg.installments}×`
            : ""}
          {sale?.closed_at
            ? `, fechado em ${fmtDate(sale.closed_at as string)}`
            : ""}
          {sale?.contract_signed_at
            ? ` (contrato assinado em ${fmtDate(sale.contract_signed_at as string)})`
            : ""}
          .
        </p>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Motivo do cancelamento</h2>
        <p className="whitespace-pre-wrap">{c.reason as string}</p>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Tratamento realizado</h2>
        {done.length === 0 ? (
          <p className="text-xs">Nenhum procedimento foi executado.</p>
        ) : (
          <ul className="list-inside list-disc text-xs">
            {done.map((s, i) => (
              <li key={i}>
                {s.procedure_name}
                {Number(s.session_total ?? 1) > 1
                  ? ` (sessão ${s.session_index} de ${s.session_total})`
                  : ""}
                {s.done_at ? ` — ${fmtDate(s.done_at as string)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Tratamento não realizado</h2>
        {pending.length === 0 ? (
          <p className="text-xs">Nada ficou pendente.</p>
        ) : (
          <ul className="list-inside list-disc text-xs">
            {pending.map((s, i) => (
              <li key={i}>
                {s.procedure_name}
                {Number(s.session_total ?? 1) > 1
                  ? ` (sessão ${s.session_index} de ${s.session_total})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 font-semibold">Acerto de contas</h2>
        <table className="w-full text-xs">
          <tbody>
            <tr className="border-b">
              <td className="py-1">Valor do plano contratado</td>
              <td className="py-1 text-right tabular-nums">
                {formatBRL(Number(c.contract_cents ?? 0))}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-1">
                Tratamento realizado
                <span className="ml-1 text-[11px] text-neutral-600">
                  (com o mesmo desconto do contrato)
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatBRL(Number(c.executed_cents ?? 0))}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Não realizado</td>
              <td className="py-1 text-right tabular-nums">
                {formatBRL(Number(c.pending_cents ?? 0))}
              </td>
            </tr>
            {Number(c.penalty_cents ?? 0) > 0 && (
              <tr className="border-b">
                <td className="py-1">
                  Multa de rescisão ({Number(c.penalty_percent)}% sobre o não
                  realizado)
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatBRL(Number(c.penalty_cents))}
                </td>
              </tr>
            )}
            <tr className="border-b font-semibold">
              <td className="py-1">Total devido pelo paciente</td>
              <td className="py-1 text-right tabular-nums">
                {formatBRL(Number(c.due_cents ?? 0))}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Já pago</td>
              <td className="py-1 text-right tabular-nums">
                {formatBRL(Number(c.paid_cents ?? 0))}
              </td>
            </tr>
            {/* 4017a (19.30.3): o pago no acordo de renegociação entra no acerto. */}
            {Number(c.agreement_paid_cents ?? 0) > 0 && (
              <tr className="border-b">
                <td className="py-1 text-[11px] text-neutral-600">
                  Inclui {formatBRL(Number(c.agreement_paid_cents))} pagos no acordo de renegociação desta venda
                  {distrato ? " (a parte desta venda no acordo)." : " (exceção autorizada pelo Financeiro)."}
                  {Number(c.agreement_card_pending_cents ?? 0) > 0 &&
                    ` Parte foi no cartão parcelado: a unidade ainda vai receber ${formatBRL(Number(c.agreement_card_pending_cents))} nos próximos meses.`}
                </td>
                <td />
              </tr>
            )}
            {Number(c.reversed_cents ?? 0) > 0 && (
              <tr className="border-b">
                <td className="py-1 text-[11px] text-neutral-600">
                  Houve estorno anterior de {formatBRL(Number(c.reversed_cents))}{" "}
                  — já considerado no valor pago acima.
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 rounded border-2 border-black p-3">
          {owes > 0 ? (
            <p>
              <strong>O paciente ainda deve {formatBRL(owes)}.</strong> O valor
              será cobrado em uma nova parcela, com vencimento em 15 dias a
              partir da efetivação deste termo.
            </p>
          ) : refunds > 0 ? (
            <p>
              <strong>A clínica devolverá {formatBRL(refunds)} ao paciente.</strong>{" "}
              {distrato
                ? "A devolução será feita por Pix da conta da unidade, depois da efetivação deste termo, e registrada no financeiro da unidade."
                : "A forma de devolução será combinada entre as partes e registrada no financeiro da unidade."}
            </p>
          ) : (
            <p>
              <strong>Nada é devido por nenhuma das partes.</strong> O valor pago
              corresponde exatamente ao tratamento realizado.
            </p>
          )}
        </div>
      </section>

      {distrato && d && d.plano_dos_acordos.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Acordo de renegociação</h2>
          {/* [REVISÃO JURÍDICA] — 19.35.13, item 2: este trecho é revisado pelo jurídico. */}
          <p className="mb-1 text-[10px] font-semibold text-neutral-500">[REVISÃO JURÍDICA]</p>
          <p className="mb-2 text-xs">
            As parcelas deste contrato que estavam num acordo de renegociação ficam assim. Quando o acordo junta outras vendas,
            as parcelas em aberto são reduzidas na proporção desta venda e continuam valendo para as outras; quando o acordo é só
            desta venda, as parcelas em aberto deixam de existir.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Acordo</th>
                <th className="py-1">Parcela</th>
                <th className="py-1">Vencimento</th>
                <th className="py-1 text-right">Antes</th>
                <th className="py-1 text-right">Depois</th>
              </tr>
            </thead>
            <tbody>
              {d.plano_dos_acordos.map((x, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1">
                    {x.codigo} ({x.parte}% desta venda)
                  </td>
                  <td className="py-1">{x.seq ?? "—"}</td>
                  <td className="py-1">{fmtDate(x.vencimento)}</td>
                  <td className="py-1 text-right tabular-nums">{formatBRL(x.antes)}</td>
                  <td className="py-1 text-right tabular-nums">{x.acao === "cancelar" ? "deixa de existir" : formatBRL(x.depois)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1" colSpan={3}>
                  Deixa de ser cobrado
                </td>
                <td className="py-1" />
                <td className="py-1 text-right tabular-nums">
                  {formatBRL(d.plano_dos_acordos.reduce((t, x) => t + (x.antes - x.depois), 0))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[10px] font-semibold text-neutral-500">[/REVISÃO JURÍDICA]</p>
        </section>
      )}

      {distrato && (
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Cobranças em aberto</h2>
          <p className="text-xs">
            As cobranças em aberto continuam valendo até a assinatura deste termo. Depois da efetivação, as que se referem ao
            que foi cancelado são canceladas e deixam de poder ser pagas.
          </p>
        </section>
      )}

      {c.destination && (
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Continuidade do acompanhamento</h2>
          <p className="text-xs">
            O paciente segue para{" "}
            <strong>
              {DESTINATION_LABELS[c.destination as string] ?? c.destination}
            </strong>
            {c.follow_up_return_at
              ? `, com retorno previsto para ${fmtDate(c.follow_up_return_at as string)}`
              : ""}
            . O cancelamento do plano não encerra o vínculo com a clínica.
          </p>
        </section>
      )}

      {c.notes && (
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Observações</h2>
          <p className="whitespace-pre-wrap text-xs">{c.notes as string}</p>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t border-black pt-1 text-center">
          {client?.full_name ?? "Paciente"}
          <br />
          Paciente
        </div>
        <div className="border-t border-black pt-1 text-center">
          {clinic?.name ?? "Risarte Odontologia"}
          <br />
          Responsável pela unidade
        </div>
      </section>

      <p className="mt-6 text-[10px] text-neutral-600">
        Este termo detalha o cancelamento do plano de tratamento identificado
        acima e substitui, quanto ao que ficou pendente, as obrigações do
        contrato de origem. O tratamento já realizado permanece registrado no
        prontuário do paciente.
      </p>

      {distrato && d && (
        <div className="mt-8 space-y-3 print:hidden">
          {c.status !== "efetivado" && c.status !== "descartado" && <ChecklistDoDistrato d={d} />}
          {c.status === "efetivado" && <DevolucaoDoDistrato d={d} clinicId={c.clinic_id as string} />}
        </div>
      )}

      <div className="mt-8 print:hidden">
        <CancellationSteps
          checklistPendente={distrato && d ? 8 - Object.keys(d.checklist).length : 0}
          id={c.id as string}
          clientId={c.client_id as string}
          status={c.status as string}
          signedAt={(c.term_signed_at as string | null) ?? null}
          appliedAt={(c.applied_at as string | null) ?? null}
        />
      </div>
    </div>
  );
}
