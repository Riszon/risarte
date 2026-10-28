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
import { carregarVantagensDaProposta } from "@/lib/empresarial/vantagens-servidor";
import {
  lerMetas,
  participaDoSocial,
  rotuloDaMeta,
  textoDoPagamento,
} from "@/lib/empresarial/riso-social";
import {
  calculoDaProposta,
  estimativaDaProposta,
  lerQuadro,
  pricingDaProposta,
} from "@/lib/empresarial/dependentes-da-proposta";
import { comparacaoComOPadrao } from "@/lib/empresarial/padrao-da-proposta";
import { loadPricing } from "../../../configuracoes/data";
import {
  comoOColaboradorPaga,
  comoSeraCobrado,
  comparacaoComOAtual,
  nomeDoArquivo,
  quemPagaOQue,
  relatorioMensal,
  validadeDaProposta,
} from "@/lib/empresarial/documento-da-proposta";
import type { BenefitType, PaymentModel } from "@/lib/empresarial/constants";
import {
  descontoNoAnexo,
  frasesDoResumo,
  ordenarParaOAnexo,
  paraQuemVale,
  resumoDosBeneficios,
  rotuloDasUnidades,
  rotuloDaCarencia,
  rotuloDoUso,
  type BeneficioDoAnexo,
} from "@/lib/empresarial/beneficios-da-proposta";
import { createClient } from "@/lib/supabase/server";
import { BotaoImprimir } from "../botao-imprimir";

/**
 * O TÍTULO DA PÁGINA É O NOME DO ARQUIVO (dono, 28/10/2026): o navegador
 * sugere o título ao salvar em PDF — inclusive pelo Ctrl+P, sem o botão.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>;
}): Promise<Metadata> {
  const { leadId } = await params;
  const db = await empresarialDb();
  const [{ data: lead }, { data: q }] = await Promise.all([
    db.from("commercial_leads").select("company_name").eq("id", leadId).maybeSingle(),
    db.from("lead_qualification").select("legal_name").eq("lead_id", leadId).maybeSingle(),
  ]);
  const empresa = q?.legal_name || lead?.company_name;
  return {
    title: empresa
      ? { absolute: nomeDoArquivo("Proposta", empresa, todayInBrazil()) }
      : "Proposta · Risarte Empresarial",
  };
}

/** Título de seção: a cor da marca, e nunca sozinho no pé da página. */
const H2 = "break-after-avoid border-l-4 border-gold pl-3 text-lg font-semibold text-primary";

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
  main_clinic_id: string | null;
  // 1032
  dependents_calc_mode: "DISTRIBUTION" | "AS_INDIVIDUAL" | "NONE" | null;
  // 1034
  treatment_payment_methods: string[] | null;
  treatment_max_installments: number | null;
  social_participates: boolean | null;
  social_goals: unknown;
  dependents_distribution: unknown;
  implantation_includes_dependents: boolean | null;
  // 1036: ausente = a migração ainda não rodou (vale o padrão: mostrar).
  show_standard_comparison?: boolean;
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
  clinic_ids: string[] | null;
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
  // 1032: a estimativa dos dependentes sai da MESMA peça que o fechamento usa
  // para congelar o valor — o documento e a cobrança não podem divergir.
  const estimativa = estimativaDaProposta(q);
  const dependentes = estimativa?.dependentes ?? q.dependents_estimate ?? 0;
  const tabelaDeps = pricingDaProposta(q);
  const conta = simularProposta({
    basis,
    dependentesEstimadosCents: estimativa?.totalCents ?? null,
    implantacaoComDependentes: Boolean(q.implantation_includes_dependents) && estimativa != null,
    employeeCount: titulares,
    holderFeeCents: q.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
    includeDependents: Boolean(q.includes_dependents),
    dependentsCount: dependentes,
    dependentFeeCents:
      q.dependent_fee_cents ??
      DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
    fixedMonthlyCents: q.fixed_monthly_cents ?? 0,
    paymentModel: q.payment_model ?? "EMPLOYEE_PAYS",
    subsidyType: q.subsidy_type,
    subsidyValue: q.subsidy_value ?? 0,
    currentPlanMonthlyCents: q.dental_plan_monthly_cents,
    faixas,
  });

  // 1036 (dono, 28/10/2026): a mesma empresa pelo preço padrão da rede. Só
  // vai para o papel quando a proposta sai mais barata e a caixa está marcada.
  const { pricing: precoPadrao } = await loadPricing(db, null);
  const padrao = comparacaoComOPadrao({
    proposta: conta,
    padrao: precoPadrao,
    basis,
    titulares,
    incluiDependentes: Boolean(q.includes_dependents),
    calculo: calculoDaProposta(q),
    quadro: lerQuadro(q.dependents_distribution),
    dependentes: q.dependents_estimate ?? 0,
    implantacaoComDependentes: Boolean(q.implantation_includes_dependents),
  });
  const mostrarPadrao =
    padrao != null && padrao.maisBarata && q.show_standard_comparison !== false;

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
      "procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent, clinic_ids"
    )
    .eq("lead_id", leadId)
    .returns<BeneficioRow[]>();
  if (erroBen) console.error("benefícios da proposta:", erroBen.message);
  // 1033: as outras vantagens (além dos procedimentos).
  const vantagens = (await carregarVantagensDaProposta(db, leadId)) ?? [];
  const metasSociais = lerMetas(q.social_goals);

  const beneficios: BeneficioDoAnexo[] = [];
  if (benRows?.length) {
    const supabaseProc = await createClient();
    const { data: procs } = await supabaseProc
      .from("procedures")
      .select("id, name, default_price_cents")
      .in("id", benRows.map((b) => b.procedure_id))
      .returns<{ id: string; name: string; default_price_cents: number | null }[]>();
    const nomePorId = new Map((procs ?? []).map((x) => [x.id, x.name]));
    // O preço de tabela converte o desconto em reais para % (1036).
    const precoPorId = new Map((procs ?? []).map((x) => [x.id, x.default_price_cents]));
    for (const b of benRows) {
      beneficios.push({
        nome: nomePorId.get(b.procedure_id) ?? "Procedimento",
        precoCents: precoPorId.get(b.procedure_id) ?? null,
        procedureId: b.procedure_id,
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        usageLimitCount: b.usage_limit_count,
        usagePeriodMonths: b.usage_period_months,
        gracePeriodMonths: b.grace_period_months,
        maxInstallments: b.max_installments,
        forHolder: b.for_holder,
        forDependent: b.for_dependent,
        clinicIds: b.clinic_ids ?? [],
      });
    }
  }
  // 1036: no corpo, o resumo; no fim, o anexo do maior desconto ao menor.
  const anexo = ordenarParaOAnexo(beneficios);
  const resumo = frasesDoResumo(resumoDosBeneficios(beneficios));

  // I3 (1019): as unidades da parceria, para o documento dizer ONDE o
  // programa é atendido — e para cada benefício poder dizer a sua exceção.
  const { data: parceriaRows } = await db
    .from("lead_clinics")
    .select("clinic_id")
    .eq("lead_id", leadId)
    .returns<{ clinic_id: string }[]>();
  const idsDaParceria = (parceriaRows ?? []).map((c) => c.clinic_id);
  const nomeDaUnidade = new Map<string, string>();
  if (idsDaParceria.length > 0 || q.main_clinic_id) {
    const supabaseUnidades = await createClient();
    const { data: cls } = await supabaseUnidades
      .from("clinics")
      .select("id, name")
      .in("id", [...new Set([...idsDaParceria, q.main_clinic_id].filter(Boolean))])
      .returns<{ id: string; name: string }[]>();
    for (const c of cls ?? []) nomeDaUnidade.set(c.id, c.name);
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
  const arquivo = nomeDoArquivo("Proposta", razao, hoje);
  const pagaEmpresa = (q.payment_model ?? "EMPLOYEE_PAYS") !== "EMPLOYEE_PAYS";
  // A economia que vai para a barra de cima: a do padrão (quando marcada) ou a
  // do convênio atual. Nenhuma das duas = a barra mostra a validade.
  const economiaEmDestaque = mostrarPadrao && padrao
    ? { rotulo: "Economia por ano", valor: formatBRL(padrao.economiaAnualCents) }
    : conta.economiaAnualCents != null && conta.economiaAnualCents > 0
      ? { rotulo: "Economia por ano", valor: formatBRL(conta.economiaAnualCents) }
      : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:p-0">
      {/* ⚠️ SEM MARGEM DE PÁGINA NO PAPEL. Com margem, o navegador escreve a
          data, o título e o endereço da página no topo e no rodapé — o PDF da
          Cooperativa saiu com "risarte.vercel.app/…" em toda folha. As
          margens passam a ser do próprio documento: o cabeçalho e o rodapé da
          tabela abaixo se repetem em cada página. */}
      <style>{`@media print { @page { margin: 0; } }`}</style>
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
          <BotaoImprimir
            tipo="proposta"
            companyName={lead.company_name}
            nomeDoArquivo={arquivo}
          />
        </div>
      </div>

      <table className="w-full border-collapse">
        {/* Repetem em cada página impressa: o de cima é a margem; o de baixo, a
            margem e o rodapé do documento. Na tela, não existem. */}
        <thead className="hidden print:table-header-group">
          <tr>
            <td>
              <div className="h-[12mm]" />
            </td>
          </tr>
        </thead>
        <tfoot className="hidden print:table-footer-group">
          <tr>
            <td>
              <div className="flex h-[14mm] items-center justify-between border-t mx-[14mm] text-[10px] text-muted-foreground">
                <span>Risarte Empresarial · Proposta comercial para {razao}</span>
                <span>Válida até {validade.texto}</span>
              </div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="align-top print:px-[14mm]">
      <article className="space-y-8">
        <header className="break-inside-avoid overflow-hidden rounded-xl border bg-card [print-color-adjust:exact]">
          <div className="flex items-center justify-between gap-4 bg-primary px-6 py-5 text-primary-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/marca/empresarial-horizontal-branco.svg"
              alt="Risarte Empresarial"
              className="h-8 w-auto"
            />
            <span className="text-[11px] tracking-[0.2em] uppercase opacity-90">
              Proposta comercial
            </span>
          </div>
          <div className="h-1 bg-gold" />
          <div className="space-y-4 px-6 py-5">
            <div>
              <p className="text-xs tracking-wider text-muted-foreground uppercase">
                Preparada para
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-primary">{razao}</h1>
              {lead.cnpj && (
                <p className="text-sm text-muted-foreground">
                  CNPJ {maskDocument("CNPJ", lead.cnpj)}
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Emitida em</dt>
                <dd>{formatBrDate(startOfDayInBrazil(hoje))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Válida até</dt>
                <dd className="font-medium">
                  {validade.texto} ({dias} dias)
                </dd>
              </div>
              {consultor && (
                <div>
                  <dt className="text-xs text-muted-foreground">Consultor</dt>
                  <dd>{consultor}</dd>
                </div>
              )}
            </dl>
          </div>
        </header>

        {/* OS NÚMEROS QUE DECIDEM, antes de qualquer texto: quem lê a proposta
            quer saber quanto custa e quem paga. O detalhe vem depois. */}
        <div className="grid break-inside-avoid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border [print-color-adjust:exact] sm:grid-cols-4">
          <Destaque rotulo="Mensalidade" valor={formatBRL(conta.mensalidadeCents)} />
          <Destaque
            rotulo="A empresa paga"
            valor={pagaEmpresa ? formatBRL(conta.empresaPagaCents) : "—"}
          />
          <Destaque rotulo="O titular paga" valor={formatBRL(conta.colaboradorPagaCents)} />
          {economiaEmDestaque ? (
            <Destaque rotulo={economiaEmDestaque.rotulo} valor={economiaEmDestaque.valor} ouro />
          ) : (
            <Destaque rotulo="Titulares" valor={String(titulares)} />
          )}
        </div>

        <section className="space-y-2">
          <h2 className={H2}>Quem o programa atende</h2>
          <p className="leading-relaxed text-muted-foreground">
            {titulares} titular{titulares === 1 ? "" : "es"}
            {q.includes_dependents
              ? ` e ${dependentes} dependente${dependentes === 1 ? "" : "s"} (estimativa)`
              : ", sem dependentes"}
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className={H2}>Investimento mensal</h2>
          {/* 1032 (dono, 26/10/2026): com os dependentes calculados, o papel
              mostra titulares + dependentes estimados = o total. Separados, e
              com a palavra "estimado", porque o valor real dos dependentes sai
              dos cadastros. */}
          {estimativa && (
            <div className="grid grid-cols-3 gap-4 break-inside-avoid rounded-lg border p-4">
              <Numero rotulo="Titulares" valor={formatBRL(conta.titularesCents)} />
              <Numero
                rotulo="Dependentes (estimado)"
                valor={formatBRL(conta.dependentesCents)}
              />
              <Numero
                rotulo="Total mensal estimado"
                valor={formatBRL(conta.mensalidadeCents)}
                destaque
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 break-inside-avoid rounded-lg border p-4 sm:grid-cols-4">
            <Numero
              rotulo={estimativa ? "Mensalidade (com dependentes)" : "Mensalidade"}
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
            {estimativa &&
              (q.payment_model ?? "EMPLOYEE_PAYS") !== "EMPLOYEE_PAYS" &&
              " A parte da empresa vale sobre os titulares; os dependentes ficam por conta do titular."}
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
              {" — "}o primeiro pagamento, cobrado ao iniciar o programa
              {estimativa
                ? q.implantation_includes_dependents
                  ? ": titulares e dependentes estimados."
                  : ": só os titulares. Os dependentes começam a pagar na mensalidade."
                : ", no mesmo valor da mensalidade."}
            </p>
          )}

          {/* ⚠️ A TABELA DE FAIXAS VAI PARA O PAPEL. Ela é argumento de venda —
              "cresça e pague menos" — e é também o compromisso que a empresa
              vai cobrar depois. Mostrar só o preço de hoje esconderia as duas
              coisas. */}
          {/* A TABELA DOS DEPENDENTES vai sempre: é o compromisso de preço.
              O TOTAL só vai quando a proposta escolheu calcular (1032) — pelo
              quadro, com a mesma régua do boleto, ou como individual. Sem a
              escolha, vale a decisão de 24/09: o papel não inventa total. */}
          {q.includes_dependents && basis === "PER_EMPLOYEE" && (
            <div className="space-y-2 break-inside-avoid rounded-lg border p-4">
              <p className="font-medium">Dependentes</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {tabelaDeps.dependentMode === "PER_DEPENDENT" ? (
                  <li>
                    Cada dependente:{" "}
                    {formatBRL(tabelaDeps.dependentIndividualFeeCents)} por mês
                  </li>
                ) : (
                  <>
                    <li>
                      Titular com um dependente:{" "}
                      {formatBRL(tabelaDeps.dependentIndividualFeeCents)} por mês
                    </li>
                    <li>
                      Pacote familiar (a partir de 2, até{" "}
                      {tabelaDeps.dependentFamilySize ?? 3} dependentes do mesmo
                      titular): {formatBRL(tabelaDeps.dependentFamilyFeeCents)} por
                      mês
                    </li>
                    <li>
                      Cada dependente acima do pacote:{" "}
                      {formatBRL(tabelaDeps.dependentFamilyExtraFeeCents)} por mês
                    </li>
                  </>
                )}
              </ul>

              {estimativa && estimativa.linhas.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 font-medium">Como estimamos</th>
                      <th className="py-1 text-right font-medium">Por titular</th>
                      <th className="py-1 text-right font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimativa.linhas
                      .filter((l) => l.dependentes > 0)
                      .map((l) => (
                        <tr key={l.dependentes} className="border-t">
                          <td className="py-1">
                            {l.titulares} titular{l.titulares === 1 ? "" : "es"} com{" "}
                            {l.dependentes} dependente{l.dependentes === 1 ? "" : "s"}
                          </td>
                          <td className="py-1 text-right">{formatBRL(l.porTitularCents)}</td>
                          <td className="py-1 text-right">{formatBRL(l.subtotalCents)}</td>
                        </tr>
                      ))}
                    <tr className="border-t font-medium">
                      <td className="py-1" colSpan={2}>
                        Dependentes (estimado)
                      </td>
                      <td className="py-1 text-right">{formatBRL(estimativa.totalCents)}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              <p className="text-sm text-muted-foreground">
                {estimativa ? (
                  <>
                    O valor dos dependentes acima é uma{" "}
                    <strong>estimativa</strong>
                    {estimativa.linhas.length > 0
                      ? ", feita com a quantidade de dependentes por titular informada"
                      : ", calculada como dependente individual"}
                    . A cobrança é feita família a família, pelos dependentes
                    efetivamente cadastrados, com a tabela acima.
                  </>
                ) : (
                  <>
                    O <strong>valor mensal acima não inclui dependentes</strong>.
                    Quantos entram, e de quais titulares, só se sabe ao cadastrar
                    — a cobrança deles é feita com a tabela acima, a partir dos
                    cadastros.
                  </>
                )}
              </p>
            </div>
          )}
          {q.includes_dependents && basis !== "PER_EMPLOYEE" && (
            <p className="leading-relaxed text-muted-foreground">
              Os dependentes estão incluídos no valor fixo da empresa.
            </p>
          )}

          {faixas.length > 0 && (
            <div className="space-y-1 break-inside-avoid rounded-lg border p-4">
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

        {mostrarPadrao && padrao && (
          // Seção curta: vai inteira para a página. Partida, a frase ficava
          // sozinha no pé da folha e os números na seguinte.
          <section className="space-y-2 break-inside-avoid">
            <h2 className={H2}>Condição especial para a sua empresa</h2>
            <p className="leading-relaxed text-muted-foreground">
              Esta proposta sai abaixo do preço padrão do programa.
            </p>
            <div className="grid grid-cols-2 gap-4 break-inside-avoid rounded-lg border p-4 sm:grid-cols-4">
              <Numero rotulo="Preço padrão" valor={`${formatBRL(padrao.padraoMensalCents)}/mês`} />
              <Numero
                rotulo="Nossa proposta"
                valor={`${formatBRL(padrao.propostaMensalCents)}/mês`}
              />
              <Numero
                rotulo="Economia por mês"
                valor={formatBRL(padrao.economiaMensalCents)}
                destaque
              />
              <Numero
                rotulo="Economia por ano"
                valor={formatBRL(padrao.economiaAnualCents)}
                destaque
              />
            </div>
            {padrao.propostaPorTitularCents != null &&
              padrao.propostaPorTitularCents < padrao.padraoPorTitularCents && (
                <p className="text-sm text-muted-foreground">
                  Por titular: {formatBRL(padrao.padraoPorTitularCents)} no padrão,{" "}
                  {formatBRL(padrao.propostaPorTitularCents)} nesta proposta.
                </p>
              )}
            {padrao.economiaImplantacaoCents > 0 && (
              <p className="text-sm text-muted-foreground">
                Implantação: {formatBRL(padrao.padraoImplantacaoCents)} no padrão,{" "}
                {formatBRL(padrao.propostaImplantacaoCents)} nesta proposta — economia de{" "}
                {formatBRL(padrao.economiaImplantacaoCents)}.
              </p>
            )}
          </section>
        )}

        {comparacao && (
          <section className="space-y-2">
            <h2 className={H2}>
              Comparado ao que a empresa tem hoje
            </h2>
            <p className="leading-relaxed text-muted-foreground">{comparacao}</p>
            {conta.economiaMensalCents !== null &&
              conta.economiaMensalCents !== 0 && (
                <div className="grid grid-cols-2 gap-4 break-inside-avoid rounded-lg border p-4">
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
            explica como funciona.
            1036 (dono, 28/10/2026): a lista inteira deixava o documento
            comprido demais. Aqui vai o resumo; a relação completa, com para
            quem vale, uso e carência, fica no anexo do fim. */}
        {resumo.length > 0 && (
          <section className="space-y-2">
            <h2 className={H2}>O que está coberto</h2>
            <ul className="space-y-1 break-inside-avoid rounded-lg border p-4">
              {resumo.map((frase) => (
                <li key={frase} className="font-medium">
                  {frase}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              A relação completa está no{" "}
              <strong className="text-foreground">Anexo — Procedimentos e descontos</strong>,
              no fim deste documento.
            </p>
          </section>
        )}

        {/* 1034: como o colaborador paga o tratamento, e o Riso+ Social. */}
        <section className="space-y-2">
          <h2 className={H2}>Como o colaborador paga o tratamento</h2>
          {/* 0.91.0 (dono, 28/10/2026): contrata, recebe o desconto, paga
              pelo meio combinado — e a parcela atrasada perde o desconto. */}
          {comoOColaboradorPaga(
            textoDoPagamento(q.treatment_payment_methods, q.treatment_max_installments)
          ).map((frase) => (
            <p key={frase} className="leading-relaxed text-muted-foreground">
              {frase}
            </p>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className={H2}>Mensalidade e relatório mensal</h2>
          <p className="leading-relaxed text-muted-foreground">
            {relatorioMensal(q.payment_model ?? "EMPLOYEE_PAYS")}
          </p>
        </section>
        {participaDoSocial(q.payment_model) && q.social_participates !== false && (
          <section className="space-y-2">
            <h2 className={H2}>Riso+ Social</h2>
            <p className="leading-relaxed text-muted-foreground">
              A empresa indica pessoas carentes para tratamento na rede Risarte,
              enquanto pagar, integral ou parcialmente, a mensalidade dos
              colaboradores.
              {metasSociais.length > 0
                ? " As indicações são conquistadas por estas metas (em cada uma, todas as condições ao mesmo tempo):"
                : " As indicações são combinadas com a Risarte ao longo do programa."}
            </p>
            {metasSociais.length > 0 && (
              <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                {metasSociais.map((m) => (
                  <li key={m.id}>{rotuloDaMeta(m)}</li>
                ))}
              </ol>
            )}
          </section>
        )}

        {/* 1033: o que o programa oferece além dos procedimentos. */}
        {vantagens.length > 0 && (
          <section className="space-y-2">
            <h2 className={H2}>Outras vantagens</h2>
            <ul className="divide-y rounded-lg border [&>li]:break-inside-avoid">
              {vantagens.map((v) => (
                <li key={v.perkId} className="p-3">
                  <span className="font-medium">{v.nome}</span>
                  {(v.detalhe || v.descricao) && (
                    <span className="block text-sm text-muted-foreground">
                      {v.detalhe ?? v.descricao}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(q.company_grace_days != null || q.employee_grace_days != null) && (
          <section className="space-y-2">
            <h2 className={H2}>Quando o programa começa a valer</h2>
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
          <section key={i} className="space-y-1.5">
            {b.titulo && <h2 className={H2}>{b.titulo}</h2>}
            {b.corpo && (
              <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {b.corpo}
              </p>
            )}
          </section>
        ))}

        {/* ⚠️ ONDE O PROGRAMA É ATENDIDO. A empresa precisa saber para onde
            mandar a equipe, e é este o compromisso que ela vai cobrar. */}
        {idsDaParceria.length > 0 && (
          <section className="space-y-2">
            <h2 className={H2}>Onde o programa é atendido</h2>
            <p className="leading-relaxed text-muted-foreground">
              {q.main_clinic_id && nomeDaUnidade.get(q.main_clinic_id) && (
                <>
                  Unidade principal:{" "}
                  <strong className="text-foreground">
                    {nomeDaUnidade.get(q.main_clinic_id)}
                  </strong>
                  .{" "}
                </>
              )}
              {idsDaParceria.length > 1 ? (
                <>
                  Os beneficiários podem ser atendidos em:{" "}
                  {idsDaParceria
                    .map((id) => nomeDaUnidade.get(id))
                    .filter(Boolean)
                    .join(", ")}
                  .
                </>
              ) : (
                <>O atendimento acontece nesta unidade.</>
              )}
            </p>
          </section>
        )}

        <section className="space-y-2">
          <h2 className={H2}>Como seguir</h2>
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
          <p className="pt-2">Risarte Odontologia · Risarte Empresarial</p>
        </footer>

        {/* ⚠️ O ANEXO COMEÇA EM PÁGINA NOVA na impressão, do maior desconto
            para o menor (sem custo primeiro). Cada linha diz para quem vale —
            a marca feita na proposta sai impressa, senão ela não teria
            consequência nenhuma para quem decide. */}
        {anexo.length > 0 && (
          <section className="space-y-2 print:break-before-page">
            <h2 className={H2}>Anexo — Procedimentos e descontos</h2>
            <p className="text-sm text-muted-foreground">Do maior desconto para o menor.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="w-[44%] py-1.5 pr-3 font-medium">Procedimento</th>
                  <th className="w-[24%] py-1.5 pr-3 font-medium">Desconto</th>
                  <th className="py-1.5 font-medium">Condições</th>
                </tr>
              </thead>
              <tbody>
                {anexo.map((b) => {
                  const uso = rotuloDoUso(b);
                  const carencia = rotuloDaCarencia(b);
                  return (
                    <tr key={b.procedureId} className="break-inside-avoid border-b align-top">
                      <td className="py-1.5 pr-3 break-words">{b.nome}</td>
                      <td className="py-1.5 pr-3 font-medium">
                        {descontoNoAnexo(b)}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {paraQuemVale(b)}
                        {uso ? ` · ${uso}` : ""}
                        {carencia ? ` · ${carencia}` : ""}
                        {/* A exceção de unidade só é escrita quando EXISTE:
                            repetir "em todas as unidades" em cada linha viraria
                            ruído e esconderia justamente a linha restrita. */}
                        {b.clinicIds && b.clinicIds.length > 0 && idsDaParceria.length > 1
                          ? ` · ${rotuloDasUnidades(b.clinicIds, nomeDaUnidade)}`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </article>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Um número da barra de cima. */
function Destaque({
  rotulo,
  valor,
  ouro,
}: {
  rotulo: string;
  valor: string;
  ouro?: boolean;
}) {
  return (
    <div className={ouro ? "bg-gold px-4 py-3 text-gold-foreground" : "bg-card px-4 py-3"}>
      <p className={ouro ? "text-xs opacity-80" : "text-xs text-muted-foreground"}>{rotulo}</p>
      <p className="text-lg font-semibold">{valor}</p>
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
