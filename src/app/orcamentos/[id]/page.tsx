import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext, hasRoleWithScopeForClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBRL, formatSessions } from "@/lib/pricing";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/commercial";
import { todayInBrazil } from "@/lib/dates";
import { carregarOdontoDaApresentacao } from "@/lib/odontograma/carregar";
import { marcasDoAceite, porDente } from "@/lib/odontograma/aceite";
import {
  diaBr,
  numerosDoOrcamento,
  somarDias,
  validadeDoOrcamento,
  type ItemDoOrcamento,
} from "@/lib/orcamento";
import { Odontograma } from "@/components/odontograma/odontograma";
import { PrintButton } from "@/app/renegociacoes/[id]/acordo/print-button";
import { LinhasDoPacote } from "@/components/linhas-do-pacote";
import { pacoteDosItens } from "@/lib/procedimentos/grupos-db";
import { pacotesDaOpcao } from "@/lib/procedimentos/grupos";

export const metadata: Metadata = { title: "Orçamento" };

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** O aviso que vai NO PAPEL quando a negociação não está em condição de assinar. */
const AVISO_DA_SITUACAO: Record<string, string> = {
  aguardando_autorizacao:
    "Aguardando a autorização do Gerente da unidade: os valores ainda podem mudar. Não colher assinatura antes da autorização.",
  perdida: "Negociação encerrada como perdida — este orçamento não vale.",
  cancelada: "Venda cancelada — este orçamento não vale mais. O acerto está no termo de cancelamento.",
  substituida:
    "O plano ganhou uma versão nova antes do aceite — este orçamento não vale. A negociação recomeça na versão nova.",
};

/**
 * OD4 — o ORÇAMENTO IMPRESSO: o papel que o cliente leva e assina (G3: por
 * enquanto, só o orçamento; o contrato com cláusulas vem do modelo do dono).
 *
 * Lê o que está SALVO na negociação — nunca a tela do Consultor. Quem abre é
 * quem negocia ou fecha (Consultor, Assistente comercial, Gerente), o Planner
 * e o Admin: o preço item a item não é para o Coordenador (D7/F4).
 */
export default async function OrcamentoPage(props: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: n } = await supabase
    .from("plan_negotiations")
    .select(
      "id, code, status, plan_id, option_id, client_id, clinic_id, adjustment_cents, final_cents, payment_method, installments, partial_reason, consultant_id, created_by, clinic:clinics!plan_negotiations_clinic_id_fkey ( name ), client:clients!plan_negotiations_client_id_fkey ( full_name, cpf, code, birth_date )"
    )
    .eq("id", id)
    .maybeSingle();
  if (!n) notFound();

  const isPlanner = Object.values(session.rolesByClinic).some((r) => r.includes("planner_dentist"));
  const podeVer =
    session.isAdminMaster ||
    isPlanner ||
    (await hasRoleWithScopeForClinic(session, n.clinic_id as string, [
      "commercial_consultant",
      "commercial_assistant",
      "unit_manager",
    ]));
  if (!podeVer) notFound();

  const clinic = one(n.clinic as { name: string } | { name: string }[] | null);
  const client = one(
    n.client as
      | { full_name: string; cpf: string | null; code: string | null; birth_date: string | null }
      | { full_name: string; cpf: string | null; code: string | null; birth_date: string | null }[]
      | null
  );

  const [{ data: opt }, { data: itemRows }, { data: negItems }, { data: parcelas }, { data: plano }, validade, odonto] =
    await Promise.all([
      supabase.from("treatment_plan_options").select("title").eq("id", n.option_id as string).maybeSingle(),
      supabase
        .from("treatment_plan_option_items")
        .select("id, description, quantity, unit_price_cents, planned_sessions, procedure_id, tooth_code, face_codes, region_code, sort_order")
        .eq("option_id", n.option_id as string)
        .order("sort_order"),
      supabase
        .from("plan_negotiation_items")
        .select("item_id, included, program_discount_cents")
        .eq("negotiation_id", id),
      supabase
        .from("payment_installments")
        .select("seq, kind, due_date, amount_cents")
        .eq("negotiation_id", id)
        .order("seq"),
      supabase.from("treatment_plans").select("version_no").eq("id", n.plan_id as string).maybeSingle(),
      // G2: consulta à parte — sem a 0313 a coluna não existe e vale o padrão (15).
      supabase.from("commercial_rules").select("clinic_id, budget_validity_days"),
      carregarOdontoDaApresentacao(n.client_id as string, client?.birth_date ?? null),
    ]);

  const quemNegociou = (n.consultant_id ?? n.created_by) as string | null;
  const { data: consultor } = quemNegociou
    ? await supabase.from("profiles").select("full_name").eq("id", quemNegociou).maybeSingle()
    : { data: null };

  const naNegociacao = new Map(
    (negItems ?? []).map((i) => [i.item_id as string, i as { included: boolean; program_discount_cents: number | null }])
  );
  const itens: (ItemDoOrcamento & {
    procedureId: string | null;
    toothCode: string | null;
    faceCodes: string[];
    regionCode: string | null;
  })[] = (itemRows ?? []).map((it) => {
    const ni = naNegociacao.get(it.id as string);
    return {
      id: it.id as string,
      description: it.description as string,
      quantity: Number(it.quantity ?? 1),
      unitPriceCents: Number(it.unit_price_cents ?? 0),
      programDiscountCents: Number(ni?.program_discount_cents ?? 0),
      plannedSessions: (it.planned_sessions as number | null) ?? null,
      // Item que não estava no salvamento conta como aceito (o mesmo padrão da tela).
      included: ni ? Boolean(ni.included) : true,
      procedureId: (it.procedure_id as string | null) ?? null,
      toothCode: (it.tooth_code as string | null) ?? null,
      faceCodes: (it.face_codes as string[] | null) ?? [],
      regionCode: (it.region_code as string | null) ?? null,
    };
  });

  const conta = numerosDoOrcamento(itens, {
    adjustmentCents: Number(n.adjustment_cents ?? 0),
    finalCents: Number(n.final_cents ?? 0),
  });
  const regioes = odonto?.regioes ?? [];
  const linhas = porDente(conta.incluidos, regioes);
  // 0325 (GP6): "Pacote X: de … por …" — só dos itens aceitos.
  const pacoteDe = await pacoteDosItens(supabase, conta.incluidos.map((i) => i.id));
  const pacotes = pacotesDaOpcao(
    conta.incluidos.map((i) => ({
      grupo: pacoteDe.get(i.id)?.grupo ?? null,
      quantidade: i.quantity,
      precoCents: i.unitPriceCents,
      precoDeTabelaCents: pacoteDe.get(i.id)?.precoDeTabelaCents ?? null,
    }))
  );
  const fora = porDente(conta.excluidos, regioes);

  const status = n.status as string;
  const aceita = status === "aceita";
  const hoje = todayInBrazil();
  const dias = validadeDoOrcamento(
    validade.error ? [] : ((validade.data ?? []) as { clinic_id: string | null; budget_validity_days: number | null }[]),
    n.clinic_id as string
  );
  const validoAte = somarDias(hoje, dias);
  const aviso = AVISO_DA_SITUACAO[status] ?? null;
  const metodo = n.payment_method ? (PAYMENT_METHOD_LABELS[n.payment_method as PaymentMethod] ?? n.payment_method) : null;

  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-8 text-sm text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href={`/apresentacao/${n.client_id}`} className="text-xs underline">
          ← Voltar à apresentação
        </a>
        <PrintButton />
      </div>

      <header className="mb-5 border-b pb-4">
        <h1 className="text-xl font-bold">
          {aceita ? "Orçamento do plano de tratamento" : "Proposta de plano de tratamento"}
        </h1>
        <p className="mt-1 text-xs">
          {clinic?.name ?? "Risarte Odontologia"} ·{" "}
          {aceita && n.code ? (
            <>
              Documento <strong>{n.code as string}</strong> ·{" "}
            </>
          ) : null}
          Emitido em {diaBr(hoje)}
          {plano?.version_no ? ` · Plano versão ${plano.version_no}` : ""}
        </p>
      </header>

      {aviso && (
        <p className="mb-5 rounded border-2 border-black p-3 font-semibold">{aviso}</p>
      )}
      {!conta.bate && (
        <p className="mb-5 rounded border-2 border-black p-3 font-semibold">
          Os itens mudaram desde o último salvamento da negociação e a conta abaixo não fecha com o
          total salvo. Salve a negociação de novo e reabra o orçamento antes de colher assinatura.
        </p>
      )}

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Paciente</h2>
        <p>
          {client?.full_name ?? "—"}
          {client?.code ? ` · ${client.code}` : ""}
          {client?.cpf ? ` · CPF ${client.cpf}` : ""}
        </p>
      </section>

      {odonto && conta.incluidos.some((i) => i.toothCode) && (
        <section className="avoid-break mb-5">
          <h2 className="mb-1 font-semibold">Odontograma do que foi aceito</h2>
          <Odontograma
            modo="impresso"
            denticaoInicial={odonto.denticao}
            nomes={odonto.nomes}
            faces={odonto.faces}
            marcas={marcasDoAceite(itens, conta.excluidos.map((i) => i.id), odonto)}
            className="mx-auto max-w-xl"
          />
          <p className="mt-1 text-center text-[10px] text-neutral-600">
            Vista de frente (o lado direito do paciente à esquerda). Vermelho: a realizar neste
            orçamento ou achado que pede tratamento
            {fora.length > 0 ? "; cinza tracejado: ficou fora agora" : ""}; azul: o que já existe.
          </p>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 font-semibold">{opt?.title ? `Procedimentos — ${opt.title}` : "Procedimentos"}</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 font-semibold">Procedimento</th>
              <th className="py-1 font-semibold">Dente / região</th>
              <th className="py-1 font-semibold">Sessões</th>
              <th className="py-1 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ item: it, local }) => (
              <tr key={it.id} className="border-b align-top">
                <td className="py-1">
                  {it.quantity > 1 ? `${it.quantity}× ` : ""}
                  {it.description}
                </td>
                <td className="py-1">{local ?? "—"}</td>
                <td className="py-1">{it.plannedSessions ? formatSessions(it.plannedSessions) : "—"}</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(it.quantity * it.unitPriceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <LinhasDoPacote linhas={pacotes} className="mt-3 ml-auto w-fit max-w-full" />
        <table className="mt-3 ml-auto w-72 text-xs">
          <tbody>
            <tr className="border-b">
              <td className="py-1">Subtotal</td>
              <td className="py-1 text-right tabular-nums">{formatBRL(conta.subtotalCents)}</td>
            </tr>
            {conta.beneficioCents > 0 && (
              <tr className="border-b">
                <td className="py-1">Benefício do programa</td>
                <td className="py-1 text-right tabular-nums">−{formatBRL(conta.beneficioCents)}</td>
              </tr>
            )}
            {conta.descontoCents < 0 && (
              <tr className="border-b">
                <td className="py-1">Desconto</td>
                <td className="py-1 text-right tabular-nums">−{formatBRL(-conta.descontoCents)}</td>
              </tr>
            )}
            <tr className="font-bold">
              <td className="py-1">Total</td>
              <td className="py-1 text-right tabular-nums">{formatBRL(conta.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 font-semibold">Pagamento</h2>
        {metodo ? (
          <p className="text-xs">
            {metodo}
            {Number(n.installments ?? 1) > 1 ? `, em ${n.installments}×` : ", à vista"}.
          </p>
        ) : (
          <p className="text-xs">Forma de pagamento ainda não definida.</p>
        )}
        {(parcelas ?? []).length > 0 && (
          <table className="mt-2 w-full text-xs">
            <tbody>
              {(parcelas ?? []).map((p) => (
                <tr key={p.seq as number} className="border-b">
                  <td className="py-0.5">{p.kind === "entrada" ? "Entrada" : `Parcela ${p.seq}`}</td>
                  <td className="py-0.5">vencimento {diaBr(String(p.due_date).slice(0, 10))}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatBRL(Number(p.amount_cents ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {fora.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 font-semibold">Ficou fora deste orçamento</h2>
          <ul className="list-inside list-disc text-xs">
            {fora.map(({ item: it, local }) => (
              <li key={it.id}>
                {it.description}
                {local ? ` — ${local}` : ""}
              </li>
            ))}
          </ul>
          {n.partial_reason && (
            <p className="mt-1 whitespace-pre-wrap text-xs">Motivo: {n.partial_reason as string}</p>
          )}
        </section>
      )}

      <section className="mb-5">
        <p className="rounded border border-black p-2 text-xs">
          Valores válidos até <strong>{diaBr(validoAte)}</strong> ({dias} {dias === 1 ? "dia" : "dias"} a
          partir da emissão).
        </p>
      </section>

      <section className="avoid-break mt-12 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t border-black pt-1 text-center">
          {client?.full_name ?? "Paciente"}
          <br />
          Paciente
        </div>
        <div className="border-t border-black pt-1 text-center">
          {consultor?.full_name ?? "Consultor(a) comercial"}
          <br />
          Consultor(a) comercial · {clinic?.name ?? "Risarte Odontologia"}
        </div>
      </section>
    </div>
  );
}
