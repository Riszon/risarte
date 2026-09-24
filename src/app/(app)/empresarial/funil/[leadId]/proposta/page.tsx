import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate, startOfDayInBrazil, todayInBrazil } from "@/lib/dates";
import { maskDocument } from "@/lib/empresarial/documents";
import { DEFAULT_ADHESION_PRICING } from "@/lib/empresarial/pricing";
import {
  faltaParaProposta,
  simularProposta,
  type BillingBasis,
} from "@/lib/empresarial/proposta";
import { rotuloDaFaixa } from "@/lib/empresarial/condicoes-da-proposta";
import {
  comoSeraCobrado,
  comparacaoComOAtual,
  quemPagaOQue,
  validadeDaProposta,
} from "@/lib/empresarial/documento-da-proposta";
import type { BenefitType, PaymentModel } from "@/lib/empresarial/constants";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDoBeneficio,
  rotuloDoUso,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";
import { createClient } from "@/lib/supabase/server";
import { BotaoImprimir } from "../botao-imprimir";

export const metadata: Metadata = { title: "Proposta · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  consultant_id: string | null;
};

type QualRow = {
  dental_plan_monthly_cents: number | null;
  payment_model: PaymentModel | null;
  subsidy_type: "PERCENT" | "AMOUNT" | null;
  subsidy_value: number | null;
  employee_count: number | null;
  includes_dependents: boolean | null;
  dependents_estimate: number | null;
  billing_model: "unico" | "por_cnpj" | null;
  billing_basis: BillingBasis | null;
  holder_fee_cents: number | null;
  dependent_fee_cents: number | null;
  fixed_monthly_cents: number | null;
  implantation_per_employee_cents: number | null;
  legal_name: string | null;
  responsible_name: string | null;
  responsible_role: string | null;
  proposal_valid_days: number | null;
  company_grace_days: number | null;
  employee_grace_days: number | null;
  min_adhesions: number | null;
  max_adhesions: number | null;
  adhesion_limit_target: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
  implantation_mode: "PER_ADHESION" | "FIXED" | null;
  implantation_fixed_cents: number | null;
  dependent_mode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependent_family_fee_cents: number | null;
  dependent_family_extra_fee_cents: number | null;
  dependent_family_size: number | null;
  holders_with_dependents: number | null;
};

type BeneficioRow = {
  procedure_id: string;
  benefit_type: BenefitType;
  benefit_value: number | null;
  usage_limit_count: number | null;
  usage_period_months: number | null;
  grace_period_months: number;
  max_installments: number | null;
  for_holder: boolean;
  for_dependent: boolean;
};

type PropostaTemplateRow = {
  lead_id: string | null;
  sections: { titulo: string; corpo: string }[];
  valid_days: number;
};

/**
 * A PROPOSTA COMERCIAL COMO DOCUMENTO (OC-00083, Bloco F).
 *
 * Até aqui o sistema calculava os números na tela e o consultor montava a
 * proposta por fora — cada um do seu jeito, com os valores redigitados à mão.
 * Redigitar valor é como a proposta passa a divergir do que o sistema cobra
 * depois, e ninguém descobre até a primeira fatura.
 *
 * ⚠️ O DOCUMENTO NÃO GUARDA NADA. Ele é desenhado a partir do levantamento
 * salvo, toda vez. Congelar uma cópia exigiria decidir quando ela envelhece —
 * e proposta velha impressa com cara de atual é pior que nenhuma. Quem congela
 * valor é o contrato, no bloco seguinte.
 *
 * ⚠️ NADA DE NOTA INTERNA ENTRA AQUI: interesse, chance de fechar e as
 * observações do consultor ficam na ficha. É o que se pensa da empresa, não o
 * que foi combinado com ela.
 */
export default async function PropostaPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_name, cnpj, contact_name, consultant_id")
    .eq("id", leadId)
    .maybeSingle<LeadRow>();
  if (!lead) notFound();

  const { data: q } = await db
    .from("lead_qualification")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle<QualRow>();

  const falta = faltaParaProposta({
    employeeCount: q?.employee_count ?? null,
    paymentModel: q?.payment_model ?? null,
    billingBasis: q?.billing_basis ?? null,
    legalName: q?.legal_name ?? null,
    responsibleName: q?.responsible_name ?? null,
    responsibleCpf: null,
    responsibleEmail: null,
    cnpj: lead.cnpj,
  });

  // ⚠️ RÉGUA VAZIA GRITA: sem levantamento, a página imprimiria "R$ 0,00" com
  // cara de proposta — e alguém mandaria isso para a empresa. Ela diz o que
  // falta e aponta o caminho de volta, em vez de gerar documento sem conteúdo.
  if (!q || falta.length > 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">
          A proposta ainda não pode ser gerada
        </h1>
        <p className="mt-2 text-muted-foreground">
          {q
            ? "Faltam dados do levantamento para os números fecharem:"
            : "Esta empresa ainda não tem levantamento preenchido."}
        </p>
        {falta.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
            {falta.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <Button
          className="mt-6"
          nativeButton={false}
          render={<Link href={`/empresarial/funil/${leadId}`} />}
        >
          Voltar ao levantamento
        </Button>
      </div>
    );
  }

  // As faixas desta proposta (1017). Erro aqui não derruba o documento: sem
  // faixa, vale o valor combinado — que é o caso normal.
  const { data: faixasRows, error: erroFaixas } = await db
    .from("lead_price_tiers")
    .select("min_quantity, price_cents")
    .eq("lead_id", leadId)
    .order("min_quantity")
    .returns<{ min_quantity: number; price_cents: number }[]>();
  if (erroFaixas) console.error("faixas da proposta:", erroFaixas.message);
  const faixas = (faixasRows ?? []).map((f) => ({
    minQuantity: f.min_quantity,
    priceCents: f.price_cents,
  }));

  const basis: BillingBasis = q.billing_basis ?? "PER_EMPLOYEE";
  const titulares = q.employee_count ?? 0;
  const dependentes = q.dependents_estimate ?? 0;
  const conta = simularProposta({
    basis,
    employeeCount: titulares,
    holderFeeCents: q.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
    includeDependents: Boolean(q.includes_dependents),
    dependentsCount: dependentes,
    dependentFeeCents:
      q.dependent_fee_cents ??
      DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
    fixedMonthlyCents: q.fixed_monthly_cents ?? 0,
    implantationPerEmployeeCents: q.implantation_per_employee_cents ?? 0,
    paymentModel: q.payment_model ?? "EMPLOYEE_PAYS",
    subsidyType: q.subsidy_type,
    subsidyValue: q.subsidy_value ?? 0,
    currentPlanMonthlyCents: q.dental_plan_monthly_cents,
    faixas,
    implantationMode: q.implantation_mode,
    implantationFixedCents: q.implantation_fixed_cents ?? 0,
  });

  // O TEXTO da proposta (1014), na cascata: o desta empresa, senão o da rede.
  const { data: modelos, error: erroModelo } = await db
    .from("proposal_templates")
    .select("lead_id, sections, valid_days")
    .or(`lead_id.eq.${leadId},lead_id.is.null`)
    .returns<PropostaTemplateRow[]>();
  // ⚠️ A migração viaja à mão e o código viaja sozinho (CLAUDE.md §0b). Entre
  // o deploy e o dia em que a 1014 rodar, o documento sai SEM os blocos de
  // texto — e sair sem texto é melhor que não sair.
  if (erroModelo) console.error("modelo da proposta:", erroModelo.message);
  const daRede = modelos?.find((m) => !m.lead_id);
  const blocos = (modelos?.find((m) => m.lead_id === leadId) ?? daRede)?.sections ?? [];

  // OS BENEFÍCIOS COMBINADOS (1016) e o nome de cada procedimento.
  const { data: benRows, error: erroBen } = await db
    .from("lead_benefits")
    .select(
      "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent"
    )
    .eq("lead_id", leadId)
    .returns<BeneficioRow[]>();
  if (erroBen) console.error("benefícios da proposta:", erroBen.message);

  const beneficios: (BeneficioDaProposta & { nome: string })[] = [];
  if (benRows?.length) {
    const supabaseProc = await createClient();
    const { data: procs } = await supabaseProc
      .from("procedures")
      .select("id, name")
      .in("id", benRows.map((b) => b.procedure_id))
      .returns<{ id: string; name: string }[]>();
    const nomePorId = new Map((procs ?? []).map((x) => [x.id, x.name]));
    for (const b of benRows) {
      beneficios.push({
        nome: nomePorId.get(b.procedure_id) ?? "Procedimento",
        procedureId: b.procedure_id,
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        usageLimitCount: b.usage_limit_count,
        usagePeriodMonths: b.usage_period_months,
        gracePeriodMonths: b.grace_period_months,
        maxInstallments: b.max_installments,
        forHolder: b.for_holder,
        forDependent: b.for_dependent,
      });
    }
    beneficios.sort((a, z) => a.nome.localeCompare(z.nome, "pt-BR"));
  }

  const hoje = todayInBrazil();
  // O prazo desta negociação manda; sem ele, o padrão da rede.
  const dias = q.proposal_valid_days ?? daRede?.valid_days ?? 15;
  const validade = validadeDaProposta(hoje, dias);
  const comparacao = comparacaoComOAtual(conta);

  let consultor: string | null = null;
  if (lead.consultant_id) {
    const supabase = await createClient();
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", lead.consultant_id)
      .maybeSingle();
    consultor = p ? p.full_name || p.email : null;
  }

  const razao = q.legal_name || lead.company_name;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Some na impressão: o PDF que vai para a empresa não leva botões. */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/empresarial/funil/${leadId}`} />}
        >
          ← Voltar à ficha
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Montada com o levantamento salvo
          </span>
          <BotaoImprimir tipo="proposta" companyName={lead.company_name} />
        </div>
      </div>

      <article className="space-y-8">
        <header className="space-y-1 border-b pb-6">
          <p className="text-xs tracking-wider text-muted-foreground uppercase">
            Proposta comercial
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Risarte Empresarial
          </h1>
          <p className="pt-3 text-sm text-muted-foreground">
            Preparada para <strong className="text-foreground">{razao}</strong>
            {lead.cnpj ? <> · CNPJ {maskDocument("CNPJ", lead.cnpj)}</> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            Emitida em {formatBrDate(startOfDayInBrazil(hoje))} · válida até{" "}
            <strong className="text-foreground">{validade.texto}</strong> ({dias}{" "}
            dias)
          </p>
        </header>

        <section className="space-y-2 break-inside-avoid">
          <h2 className="text-lg font-medium">Quem o programa atende</h2>
          <p className="leading-relaxed text-muted-foreground">
            {titulares} titular{titulares === 1 ? "" : "es"}
            {q.includes_dependents
              ? ` e ${dependentes} dependente${dependentes === 1 ? "" : "s"}`
              : ", sem dependentes"}
            .
          </p>
        </section>

        <section className="space-y-3 break-inside-avoid">
          <h2 className="text-lg font-medium">Investimento mensal</h2>
          <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
            <Numero
              rotulo="Mensalidade"
              valor={formatBRL(conta.mensalidadeCents)}
              destaque
            />
            <Numero
              rotulo="Por titular"
              valor={
                conta.porColaboradorCents == null
                  ? "—"
                  : formatBRL(conta.porColaboradorCents)
              }
            />
            <Numero rotulo="Empresa paga" valor={formatBRL(conta.empresaPagaCents)} />
            <Numero
              rotulo="Titular paga"
              valor={formatBRL(conta.colaboradorPagaCents)}
            />
          </div>
          <p className="leading-relaxed text-muted-foreground">
            {quemPagaOQue(
              q.payment_model ?? "EMPLOYEE_PAYS",
              q.subsidy_type,
              q.subsidy_value
            )}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {comoSeraCobrado(q.billing_model, basis)}
          </p>
          {conta.implantacaoCents > 0 && (
            <p className="leading-relaxed text-muted-foreground">
              Implantação:{" "}
              <strong className="text-foreground">
                {formatBRL(conta.implantacaoCents)}
              </strong>
              , cobrada uma única vez no início do programa
              {q.implantation_mode === "FIXED"
                ? ", em valor fixo pela empresa"
                : ""}
              .
            </p>
          )}

          {/* ⚠️ A TABELA DE FAIXAS VAI PARA O PAPEL. Ela é argumento de venda —
              "cresça e pague menos" — e é também o compromisso que a empresa
              vai cobrar depois. Mostrar só o preço de hoje esconderia as duas
              coisas. */}
          {/* ⚠️ A TABELA DOS DEPENDENTES, NÃO O TOTAL DELES (decisão do dono,
              24/09/2026). Na contratação ninguém sabe quantos entram nem como
              se distribuem entre os titulares — e o pacote é por titular. O
              documento mostra quanto CUSTA cada situação e diz quando o total
              vai existir. */}
          {q.includes_dependents && (
            <div className="space-y-1 rounded-lg border p-4">
              <p className="font-medium">Dependentes</p>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>
                  Um dependente:{" "}
                  {formatBRL(
                    q.dependent_fee_cents ??
                      DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents
                  )}{" "}
                  por mês
                </li>
                {q.dependent_mode === "FAMILY_PACKAGE" && (
                  <>
                    <li>
                      Pacote familiar (até {q.dependent_family_size ?? 3}{" "}
                      dependentes do mesmo titular):{" "}
                      {formatBRL(q.dependent_family_fee_cents ?? 0)} por mês
                    </li>
                    <li>
                      Cada dependente acima do pacote:{" "}
                      {formatBRL(q.dependent_family_extra_fee_cents ?? 0)} por mês
                    </li>
                  </>
                )}
              </ul>
              <p className="text-sm text-muted-foreground">
                O <strong>valor mensal acima não inclui dependentes</strong>.
                Quantos entram, e de quais titulares, só se sabe ao cadastrar —
                o total dos dependentes é fechado na implantação, e a cobrança
                deles começa a partir daí.
              </p>
            </div>
          )}

          {faixas.length > 0 && (
            <div className="space-y-1 rounded-lg border p-4">
              <p className="font-medium">Preço por quantidade</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {faixas.map((f) => (
                  <li key={f.minQuantity}>
                    {rotuloDaFaixa(f, basis === "PER_EMPLOYEE")}
                    {conta.faixaAplicada?.minQuantity === f.minQuantity && (
                      <strong className="text-foreground"> — faixa atual</strong>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                A faixa alcançada vale para o total, e não por partes.
              </p>
            </div>
          )}

          {(q.min_adhesions != null || q.max_adhesions != null) && (
            <p className="leading-relaxed text-muted-foreground">
              {q.min_adhesions != null && (
                <>Mínimo de {q.min_adhesions} adesões. </>
              )}
              {q.max_adhesions != null && <>Máximo de {q.max_adhesions} adesões. </>}
              {q.adhesion_limit_target === "DEPENDENTS"
                ? "O limite conta apenas os dependentes."
                : q.adhesion_limit_target === "BOTH"
                  ? "O limite conta titulares e dependentes."
                  : "O limite conta apenas os titulares."}
            </p>
          )}


        </section>

        {comparacao && (
          <section className="space-y-2 break-inside-avoid">
            <h2 className="text-lg font-medium">
              Comparado ao que a empresa tem hoje
            </h2>
            <p className="leading-relaxed text-muted-foreground">{comparacao}</p>
            {conta.economiaMensalCents !== null &&
              conta.economiaMensalCents !== 0 && (
                <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
                  <Numero
                    rotulo={
                      conta.economiaMensalCents > 0 ? "Por mês" : "A mais por mês"
                    }
                    valor={formatBRL(Math.abs(conta.economiaMensalCents))}
                    destaque
                  />
                  <Numero
                    rotulo={
                      conta.economiaMensalCents > 0 ? "Por ano" : "A mais por ano"
                    }
                    valor={formatBRL(Math.abs(conta.economiaAnualCents ?? 0))}
                  />
                </div>
              )}
          </section>
        )}

        {/* ⚠️ OS BENEFÍCIOS SÃO O QUE A EMPRESA COMPRA. Ficam ANTES do texto
            geral do programa: quem lê quer saber o que ganha, e o texto
            explica como funciona. Cada linha diz para quem vale — a marca
            feita na proposta sai impressa, senão ela não teria consequência
            nenhuma para quem decide. */}
        {beneficios.length > 0 && (
          <section className="space-y-2 break-inside-avoid">
            <h2 className="text-lg font-medium">O que está coberto</h2>
            <ul className="divide-y rounded-lg border">
              {beneficios.map((b) => {
                const uso = rotuloDoUso(b);
                const carencia = rotuloDaCarencia(b);
                return (
                  <li key={b.procedureId} className="flex flex-wrap gap-x-3 gap-y-0.5 p-3">
                    <span className="min-w-48 flex-1 font-medium">{b.nome}</span>
                    <span>{rotuloDoBeneficio(b)}</span>
                    <span className="w-full text-sm text-muted-foreground">
                      {paraQuemVale(b)}
                      {uso ? ` · ${uso}` : ""}
                      {carencia ? ` · ${carencia}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {(q.company_grace_days != null || q.employee_grace_days != null) && (
          <section className="space-y-2 break-inside-avoid">
            <h2 className="text-lg font-medium">Quando o programa começa a valer</h2>
            <p className="leading-relaxed text-muted-foreground">
              {q.company_grace_days != null && (
                <>
                  A empresa passa a usar o programa{" "}
                  {q.company_grace_days === 0
                    ? "desde o primeiro dia do contrato"
                    : `${q.company_grace_days} dias após o início do contrato`}
                  .{" "}
                </>
              )}
              {q.employee_grace_days != null && (
                <>
                  Cada titular passa a usar{" "}
                  {q.employee_grace_days === 0
                    ? "desde a entrada dele no programa"
                    : `${q.employee_grace_days} dias após a entrada dele`}
                  .{" "}
                </>
              )}
              {q.company_grace_days != null && q.employee_grace_days != null && (
                <>Vale sempre a data mais distante entre as duas.</>
              )}
            </p>
          </section>
        )}

        {/* O TEXTO — modelo da rede ou o desta empresa. Nunca repete número:
            valores e carência são impressos acima, a partir do que foi
            negociado. */}
        {blocos.map((b, i) => (
          <section key={i} className="space-y-1.5 break-inside-avoid">
            {b.titulo && <h2 className="text-lg font-medium">{b.titulo}</h2>}
            {b.corpo && (
              <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {b.corpo}
              </p>
            )}
          </section>
        ))}

        <section className="space-y-2 break-inside-avoid">
          <h2 className="text-lg font-medium">Como seguir</h2>
          <p className="leading-relaxed text-muted-foreground">
            Aceita a proposta, seguimos para o contrato e a implantação. A equipe
            do Risarte Empresarial cuida do cadastro dos titulares, do
            material de divulgação e do agendamento das primeiras consultas.
          </p>
        </section>

        <footer className="space-y-1 border-t pt-6 text-sm text-muted-foreground">
          {(q.responsible_name || lead.contact_name) && (
            <p>
              Aos cuidados de{" "}
              <strong className="text-foreground">
                {q.responsible_name || lead.contact_name}
              </strong>
              {q.responsible_role ? <> · {q.responsible_role}</> : null}
            </p>
          )}
          {consultor && <p>Consultor responsável: {consultor}</p>}
          <p className="pt-2">Risarte Odontologia · Risarte Empresarial</p>
        </footer>
      </article>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={destaque ? "text-lg font-semibold" : "text-sm"}>{valor}</p>
    </div>
  );
}
