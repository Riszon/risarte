"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { formatCpf, formatPhone } from "@/lib/masks";
import {
  PAYMENT_MODELS,
  PAYMENT_MODEL_LABELS,
  type PaymentModel,
} from "@/lib/empresarial/constants";
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_LABELS,
} from "@/lib/empresarial/documents";
import {
  BILLING_BASES,
  BILLING_BASIS_LABELS,
  INTEREST_LEVEL_LABELS,
  faltaParaContrato,
  faltaParaProposta,
  rotuloDaEconomia,
  simularProposta,
  type BillingBasis,
} from "@/lib/empresarial/proposta";
import {
  Campo,
  Numero,
  Secao,
  TRI,
  emReais,
  paraCentavos,
  selectClass,
  triValor,
} from "./campos";
import type { QualificacaoView } from "./ficha-lead";
import { resetProposalText, saveProposal, saveProposalText } from "./actions";
import type { Bloco } from "./apresentacao-editor";
import {
  BeneficiosDaProposta,
  type GrupoDeBeneficios,
  type Procedimento,
} from "./beneficios-editor";
import type { BeneficioDaProposta } from "@/lib/empresarial/beneficios-da-proposta";
import type { Vantagem, VantagemEscolhida } from "@/lib/empresarial/vantagens";
import {
  avisoDoValorMinimo,
  avisosDosLimites,
} from "@/lib/empresarial/condicoes-da-proposta";
import {
  avisoDoQuadro,
  dependentesDoQuadro,
  estimativaDosDependentes,
  lerQuadro,
  pricingDaProposta,
  problemasDoQuadro,
  type CalculoDosDependentes,
  type EstimativaDosDependentes,
} from "@/lib/empresarial/dependentes-da-proposta";
import type { DependentMode } from "@/lib/empresarial/pricing";
import { CondicoesComerciais, type CondicoesView } from "./condicoes-editor";
import { UnidadesDaParceria, type Unidade } from "./unidades-editor";
import { PainelDoPasso, TrilhaDaProposta } from "./passos-da-proposta";
import {
  resumoDosPassos,
  type PassoDaProposta,
} from "@/lib/empresarial/passos-da-proposta";

/**
 * A ABA DA PROPOSTA (OC-00083, 23/09/2026).
 *
 * Pedido do dono depois da primeira entrega: *"deve ter uma aba específica
 * para se tratar da proposta (configuração, personalização, detalhamento,
 * carência, prazo da proposta e etc). Agora a proposta está misturada com o
 * levantamento e ainda fica confuso."*
 *
 * A divisão é entre **atos**, não entre telas: no levantamento se registra o
 * que a empresa disse; aqui se DECIDE o que oferecer a ela. Por isso os dados
 * do contrato vieram junto — razão social e quem assina são o que o documento
 * precisa para existir, não o que se descobre numa entrevista.
 *
 * ⚠️ O LEVANTAMENTO ENTRA EM POP-UP, não em outra aba. Configurar a oferta sem
 * o que a empresa disse é configurar no escuro, e mandar a pessoa trocar de
 * aba para consultar é o mesmo problema de antes com outra roupa.
 */
export function FichaDaProposta({
  leadId,
  cnpj,
  qualificacao,
  prazoPadraoDaRede,
  blocos,
  textoPersonalizado,
  semMigracao = false,
  procedimentos,
  grupos,
  beneficios,
  beneficiosVieramDaRede,
  beneficiosDaRede,
  podeCriarGrupo,
  vantagens,
  vantagensDaProposta,
  condicoes,
  unidades,
  unidadePrincipal,
  unidadesDaParceria,
}: {
  leadId: string;
  cnpj: string | null;
  qualificacao: QualificacaoView;
  /** Validade padrão da rede, usada quando esta proposta não tem a sua. */
  prazoPadraoDaRede: number;
  blocos: Bloco[];
  /** false = está usando o modelo de texto da rede. */
  textoPersonalizado: boolean;
  /**
   * A migração 1014 ainda não rodou neste banco.
   *
   * Acontece na janela entre o deploy (automático) e o dia em que alguém roda
   * a migração (manual) — ver CLAUDE.md §0b. A tela continua servindo, com o
   * padrão, e avisa em vez de gravar num lugar que não existe.
   */
  semMigracao?: boolean;
  /** H2: os benefícios combinados nesta proposta e os grupos da rede. */
  procedimentos: Procedimento[];
  grupos: GrupoDeBeneficios[];
  beneficios: BeneficioDaProposta[];
  /** Os de cima vieram do padrão da rede e ainda não foram salvos aqui. */
  beneficiosVieramDaRede: boolean;
  /** O padrão da rede, para poder ser reaplicado a qualquer momento. */
  beneficiosDaRede: BeneficioDaProposta[];
  podeCriarGrupo: boolean;
  /** 1033: o catálogo das outras vantagens e as escolhidas nesta proposta. */
  vantagens: Vantagem[];
  vantagensDaProposta: VantagemEscolhida[];
  /** H3: limites, valor mínimo, faixas, implantação e dependentes. */
  condicoes: CondicoesView;
  /** I3: as unidades do sistema, e as desta parceria. */
  unidades: Unidade[];
  unidadePrincipal: string | null;
  unidadesDaParceria: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // O simulador recalcula enquanto a pessoa digita, então estes campos vivem
  // em estado. O resto é formulário comum.
  const [basis, setBasis] = useState<BillingBasis>(
    qualificacao.billingBasis ?? "PER_EMPLOYEE"
  );
  const [employeeCount, setEmployeeCount] = useState(
    qualificacao.employeeCount?.toString() ?? ""
  );
  const [holderFee, setHolderFee] = useState(emReais(qualificacao.holderFeeCents));
  const [includeDeps, setIncludeDeps] = useState(
    triValor(qualificacao.includesDependents)
  );
  const [depsCount, setDepsCount] = useState(
    qualificacao.dependentsEstimate?.toString() ?? ""
  );
  const [depFee, setDepFee] = useState(emReais(qualificacao.dependentFeeCents));
  // Os valores dos dependentes moram AQUI, junto da pergunta "dependentes
  // entram?" (dono, 26/10/2026) — antes metade estava nesta tela e metade nas
  // condições comerciais, e ninguém achava onde configurar o plano familiar.
  // Sem escolha gravada vale o PLANO FAMILIAR: é o que a cobrança sempre fez
  // e o padrão da empresa no banco (1032).
  const [depMode, setDepMode] = useState<DependentMode>(
    condicoes.dependentMode ?? "FAMILY_PACKAGE"
  );
  const [familyFee, setFamilyFee] = useState(emReais(condicoes.dependentFamilyFeeCents));
  const [familySize, setFamilySize] = useState(
    condicoes.dependentFamilySize?.toString() ?? "3"
  );
  const [familyExtra, setFamilyExtra] = useState(
    emReais(condicoes.dependentFamilyExtraFeeCents)
  );
  // 1032: como os dependentes entram na conta, e o quadro titulares × dependentes.
  const [calculo, setCalculo] = useState<CalculoDosDependentes>(
    condicoes.dependentsCalcMode ?? "NONE"
  );
  const [quadro, setQuadro] = useState<{ dependentes: string; titulares: string }[]>(
    condicoes.dependentsDistribution.length > 0
      ? condicoes.dependentsDistribution.map((l) => ({
          dependentes: String(l.dependentes),
          titulares: String(l.titulares),
        }))
      : // Linhas prontas de 0 a 4 — o caso comum — com os titulares em branco.
        [0, 1, 2, 3, 4].map((d) => ({ dependentes: String(d), titulares: "" }))
  );
  const [implantacaoComDeps, setImplantacaoComDeps] = useState(
    condicoes.implantationIncludesDependents ?? false
  );
  const [fixedMonthly, setFixedMonthly] = useState(
    emReais(qualificacao.fixedMonthlyCents)
  );
  const [paymentModel, setPaymentModel] = useState<PaymentModel | "">(
    qualificacao.paymentModel ?? ""
  );
  const [subsidyType, setSubsidyType] = useState<"PERCENT" | "AMOUNT" | "">(
    qualificacao.subsidyType ?? ""
  );
  const [subsidyPercent, setSubsidyPercent] = useState(
    qualificacao.subsidyType === "PERCENT"
      ? (qualificacao.subsidyValue?.toString() ?? "")
      : ""
  );
  const [subsidyAmount, setSubsidyAmount] = useState(
    qualificacao.subsidyType === "AMOUNT" ? emReais(qualificacao.subsidyValue) : ""
  );
  const [legalName, setLegalName] = useState(qualificacao.legalName ?? "");
  const [respName, setRespName] = useState(qualificacao.responsibleName ?? "");
  const [respCpf, setRespCpf] = useState(qualificacao.responsibleCpf ?? "");
  const [respEmail, setRespEmail] = useState(qualificacao.responsibleEmail ?? "");

  // ⚠️ A ESTIMATIVA USA A MESMA RÉGUA DO BOLETO (`custoDosDependentesDoTitular`).
  // Na base fixa o valor da empresa já cobre todo mundo: não há o que somar.
  const incluiDependentes = includeDeps === "SIM";
  const linhasDoQuadro = lerQuadro(quadro);
  const estimativaDeps =
    incluiDependentes && basis === "PER_EMPLOYEE"
      ? estimativaDosDependentes({
          calculo,
          pricing: pricingDaProposta({
            dependent_fee_cents: paraCentavos(depFee),
            dependent_mode: depMode,
            dependent_family_fee_cents: paraCentavos(familyFee),
            dependent_family_extra_fee_cents: paraCentavos(familyExtra),
            dependent_family_size: Number.parseInt(familySize || "0", 10) || null,
          }),
          quadro: linhasDoQuadro,
          dependentes: Number.parseInt(depsCount || "0", 10) || 0,
        })
      : null;
  // No quadro, a quantidade de dependentes é a do quadro — um segundo número
  // digitado à parte poderia discordar dele.
  const dependentesDaProposta =
    calculo === "DISTRIBUTION"
      ? dependentesDoQuadro(linhasDoQuadro)
      : Number.parseInt(depsCount || "0", 10) || 0;

  const proposta = simularProposta({
    basis,
    dependentesEstimadosCents: estimativaDeps?.totalCents ?? null,
    implantacaoComDependentes: implantacaoComDeps && estimativaDeps != null,
    employeeCount: Number.parseInt(employeeCount || "0", 10) || 0,
    holderFeeCents: paraCentavos(holderFee),
    includeDependents: incluiDependentes,
    dependentsCount: dependentesDaProposta,
    dependentFeeCents: paraCentavos(depFee),
    fixedMonthlyCents: paraCentavos(fixedMonthly),
    paymentModel: (paymentModel || "EMPLOYEE_PAYS") as PaymentModel,
    subsidyType: subsidyType || null,
    subsidyValue:
      subsidyType === "PERCENT"
        ? Number.parseInt(subsidyPercent || "0", 10) || 0
        : paraCentavos(subsidyAmount),
    // O que a empresa paga hoje vem do LEVANTAMENTO e não se edita aqui: é o
    // que ela disse, não o que se decide. O pop-up mostra o valor.
    currentPlanMonthlyCents: qualificacao.dentalPlanMonthlyCents,
    // ⚠️ AS CONDIÇÕES SALVAS, e não as que estão sendo digitadas na seção de
    // baixo: elas têm salvar próprio. Misturar faria a simulação mudar com
    // meia condição preenchida, e ninguém saberia qual número acreditar.
    faixas: condicoes.faixas,
  });

  // Os avisos das condições, calculados com o que está sendo digitado acima.
  const avisos = [
    ...avisosDosLimites(
      {
        min: condicoes.minAdhesions,
        max: condicoes.maxAdhesions,
        alvo: condicoes.adhesionLimitTarget,
      },
      Number.parseInt(employeeCount || "0", 10) || 0,
      incluiDependentes ? dependentesDaProposta : 0
    ),
    avisoDoValorMinimo(condicoes.minProposalCents, proposta.mensalidadeCents),
  ].filter((a) => a !== null);

  const dados = {
    employeeCount: Number.parseInt(employeeCount || "0", 10) || null,
    paymentModel: (paymentModel || null) as PaymentModel | null,
    billingBasis: basis,
    legalName,
    responsibleName: respName,
    responsibleCpf: respCpf,
    responsibleEmail: respEmail,
    cnpj,
  };
  const faltaProposta = faltaParaProposta(dados);
  const faltaContrato = faltaParaContrato(dados);

  // A TRILHA. O resumo de cada passo é conta pura e testada
  // (`passos-da-proposta.ts`): a tela só desenha o que ela devolve.
  const [passo, setPasso] = useState<PassoDaProposta>("precos");
  const situacoes = resumoDosPassos({
    titulares: Number.parseInt(employeeCount || "0", 10) || 0,
    mensalidadePorTitularCents: paraCentavos(holderFee) || null,
    valorFixo: basis === "FIXED_PER_COMPANY",
    temQuemPaga: paymentModel !== "",
    faixas: condicoes.faixas.length,
    minAdhesions: condicoes.minAdhesions,
    maxAdhesions: condicoes.maxAdhesions,
    temRegraDeExcedente: condicoes.excessMode != null,
    beneficios: beneficios.length,
    unidades: unidadesDaParceria.length,
    validadeDias: qualificacao.proposalValidDays,
    validadePadraoDaRede: prazoPadraoDaRede,
    carenciaEmpresaDias: qualificacao.companyGraceDays,
    carenciaTitularDias: qualificacao.employeeGraceDays,
    textoPersonalizado,
    faltaContrato,
  });
  // Os três passos que dividem o MESMO formulário. O salvar aparece só neles
  // — nos outros, cada editor tem o seu, e um botão "Salvar proposta" ali
  // faria a pessoa clicar no botão errado achando que salvou as faixas.
  const noFormularioPrincipal =
    passo === "precos" || passo === "prazos" || passo === "contrato";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveProposal(leadId, formData);
      if (r.ok) {
        toast.success("Proposta salva.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-4">
      {semMigracao && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <strong>A atualização do banco ainda não foi aplicada aqui.</strong>{" "}
            Prazo, carência e o detalhamento da proposta só serão gravados
            depois que a migração <strong>1014</strong> rodar. O resto da aba
            funciona normalmente, e o documento sai com o padrão de 15 dias.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Aqui se decide o que oferecer. O que a empresa contou fica no
          levantamento — e cabe neste botão.
        </p>
        <LevantamentoEmPopup qualificacao={qualificacao} />
      </div>

      {/* A TRILHA À ESQUERDA, O TRABALHO NO MEIO, A CONTA SEMPRE À VISTA.
          Antes eram nove blocos numa coluna só — e a simulação ficava no MEIO
          do formulário, com as faixas de preço depois dela: mexer numa faixa
          obrigava a rolar para cima para ver o efeito. */}
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <div className="lg:sticky lg:top-16">
          <TrilhaDaProposta
            ativo={passo}
            aoTrocar={setPasso}
            situacoes={situacoes}
          />
        </div>

        {/* ⚠️ `@container`: daqui para dentro, `@xl:` e `@4xl:` medem ESTA
            COLUNA, não a janela. É o conserto de raiz do amontoado — um
            `sm:grid-cols-4` continuava valendo por causa do tamanho da tela,
            mesmo quando a coluna tinha 650px e os quatro campos não cabiam. */}
        <div className="@container min-w-0 space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <PainelDoPasso visivel={passo === "precos"}>
        <Secao titulo="Como a proposta será montada">
          <div className="grid gap-3 @md:grid-cols-2">
            <Campo id="payment_model" rotulo="Quem paga o programa *">
              <select
                id="payment_model"
                name="payment_model"
                value={paymentModel}
                onChange={(e) => setPaymentModel(e.target.value as PaymentModel | "")}
                className={selectClass}
              >
                <option value="">— a definir —</option>
                {PAYMENT_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_MODEL_LABELS[m]}
                  </option>
                ))}
              </select>
            </Campo>

            {paymentModel === "COMPANY_PARTIAL" && (
              <Campo id="subsidy_type" rotulo="Como a empresa banca a parte dela">
                <select
                  id="subsidy_type"
                  name="subsidy_type"
                  value={subsidyType}
                  onChange={(e) =>
                    setSubsidyType(e.target.value as "PERCENT" | "AMOUNT" | "")
                  }
                  className={selectClass}
                >
                  <option value="">— a definir —</option>
                  <option value="PERCENT">Porcentagem da mensalidade</option>
                  <option value="AMOUNT">Valor fixo por titular</option>
                </select>
              </Campo>
            )}
            {paymentModel === "COMPANY_PARTIAL" && subsidyType === "PERCENT" && (
              <Campo id="subsidy_percent" rotulo="Quanto a empresa paga (%)">
                <Input
                  id="subsidy_percent"
                  name="subsidy_percent"
                  type="number"
                  min={0}
                  max={100}
                  value={subsidyPercent}
                  onChange={(e) => setSubsidyPercent(e.target.value)}
                />
              </Campo>
            )}
            {paymentModel === "COMPANY_PARTIAL" && subsidyType === "AMOUNT" && (
              <Campo
                id="subsidy_amount"
                rotulo="Quanto a empresa paga por titular (R$)"
              >
                <Input
                  id="subsidy_amount"
                  name="subsidy_amount"
                  value={subsidyAmount}
                  onChange={(e) => setSubsidyAmount(e.target.value)}
                  placeholder="0,00"
                />
              </Campo>
            )}

            <Campo id="employee_count" rotulo="Quantos titulares entram *">
              <Input
                id="employee_count"
                name="employee_count"
                type="number"
                min={0}
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
              />
            </Campo>
            <Campo id="includes_dependents" rotulo="Dependentes entram nesta fase?">
              <select
                id="includes_dependents"
                name="includes_dependents"
                value={includeDeps}
                onChange={(e) => setIncludeDeps(e.target.value)}
                className={selectClass}
              >
                {TRI.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>
            {includeDeps === "SIM" &&
              (calculo === "DISTRIBUTION" && basis === "PER_EMPLOYEE" ? (
                // Pelo quadro, a quantidade é a soma do quadro — gravada
                // junto, para limites e documento contarem o mesmo número.
                <Campo
                  id="dependents_estimate"
                  rotulo="Quantos dependentes"
                  ajuda="Somado do quadro abaixo."
                >
                  <Input
                    id="dependents_estimate"
                    name="dependents_estimate"
                    value={String(dependentesDaProposta)}
                    readOnly
                    className="bg-muted/40"
                  />
                </Campo>
              ) : (
                <Campo id="dependents_estimate" rotulo="Quantos dependentes (estimativa)">
                  <Input
                    id="dependents_estimate"
                    name="dependents_estimate"
                    type="number"
                    min={0}
                    value={depsCount}
                    onChange={(e) => setDepsCount(e.target.value)}
                  />
                </Campo>
              ))}

            <Campo id="billing_model" rotulo="Uma empresa ou um conjunto de CNPJs?">
              <select
                id="billing_model"
                name="billing_model"
                defaultValue={qualificacao.billingModel ?? "unico"}
                className={selectClass}
              >
                <option value="unico">Uma empresa (um CNPJ)</option>
                <option value="por_cnpj">Conjunto de CNPJs</option>
              </select>
            </Campo>
            <Campo
              id="billing_basis"
              rotulo="Como será cobrado *"
              ajuda="Valor fixo por empresa é a regra alternativa — existe para sindicato e associação."
            >
              <select
                id="billing_basis"
                name="billing_basis"
                value={basis}
                onChange={(e) => setBasis(e.target.value as BillingBasis)}
                className={selectClass}
              >
                {BILLING_BASES.map((b) => (
                  <option key={b} value={b}>
                    {BILLING_BASIS_LABELS[b]}
                  </option>
                ))}
              </select>
            </Campo>

            {basis === "PER_EMPLOYEE" ? (
              <>
                <Campo id="holder_fee" rotulo="Mensalidade por titular (R$)">
                  <Input
                    id="holder_fee"
                    name="holder_fee"
                    value={holderFee}
                    onChange={(e) => setHolderFee(e.target.value)}
                  />
                </Campo>
              </>
            ) : (
              <Campo id="fixed_monthly" rotulo="Valor fixo mensal da empresa (R$)">
                <Input
                  id="fixed_monthly"
                  name="fixed_monthly"
                  value={fixedMonthly}
                  onChange={(e) => setFixedMonthly(e.target.value)}
                  placeholder="0,00"
                />
              </Campo>
            )}
          </div>
          {incluiDependentes &&
            (basis === "PER_EMPLOYEE" ? (
              <ValoresDosDependentes
                modo={depMode}
                aoTrocarModo={setDepMode}
                individual={depFee}
                aoTrocarIndividual={setDepFee}
                pacote={familyFee}
                aoTrocarPacote={setFamilyFee}
                cobre={familySize}
                aoTrocarCobre={setFamilySize}
                extra={familyExtra}
                aoTrocarExtra={setFamilyExtra}
                calculo={calculo}
                aoTrocarCalculo={setCalculo}
                quadro={quadro}
                aoTrocarQuadro={setQuadro}
                estimativa={estimativaDeps}
                titulares={Number.parseInt(employeeCount || "0", 10) || 0}
                implantacaoComDependentes={implantacaoComDeps}
                aoTrocarImplantacao={setImplantacaoComDeps}
              />
            ) : (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                No <strong>valor fixo por empresa</strong> os dependentes já
                estão dentro do valor combinado — não há preço de dependente a
                configurar.
              </p>
            ))}
          {/* AP18: a implantação não se negocia aqui — é o 1º pagamento. */}
          <p className="text-xs text-muted-foreground">
            A implantação é o <strong>primeiro pagamento</strong>, cobrado ao
            iniciar o programa: o valor dos titulares
            {estimativaDeps ? " — e dos dependentes, se marcado acima" : ""}.
          </p>
        </Secao>

            </PainelDoPasso>

            <PainelDoPasso visivel={passo === "prazos"}>
        <Secao
          titulo="Prazo e carência"
          descricao="O que foi combinado na negociação. A carência viaja para o cadastro da empresa quando o negócio fecha — antes disso era redigitada, e podia sair diferente do que foi vendido."
        >
          <div className="grid gap-3 @xl:grid-cols-3">
            <Campo
              id="proposal_valid_days"
              rotulo="Validade da proposta (dias)"
              ajuda={`Em branco, vale o padrão da rede: ${prazoPadraoDaRede} dias.`}
            >
              <Input
                id="proposal_valid_days"
                name="proposal_valid_days"
                type="number"
                min={1}
                max={365}
                defaultValue={qualificacao.proposalValidDays ?? ""}
                placeholder={String(prazoPadraoDaRede)}
              />
            </Campo>
            <Campo
              id="company_grace_days"
              rotulo="Carência da empresa (dias)"
              ajuda="Contada do início do contrato. 0 = pode usar desde o primeiro dia."
            >
              <Input
                id="company_grace_days"
                name="company_grace_days"
                type="number"
                min={0}
                max={3650}
                defaultValue={qualificacao.companyGraceDays ?? ""}
                placeholder="—"
              />
            </Campo>
            <Campo
              id="employee_grace_days"
              rotulo="Carência do titular (dias)"
              ajuda="Contada da entrada de cada pessoa. Vale a mais longa entre as duas."
            >
              <Input
                id="employee_grace_days"
                name="employee_grace_days"
                type="number"
                min={0}
                max={3650}
                defaultValue={qualificacao.employeeGraceDays ?? ""}
                placeholder="—"
              />
            </Campo>
          </div>
        </Secao>

            </PainelDoPasso>

            <PainelDoPasso visivel={passo === "contrato"}>
        <Secao
          titulo="Dados para gerar a proposta e o contrato"
          descricao="Estes campos viajam para o cadastro da empresa quando o negócio é fechado — ninguém digita duas vezes."
        >
          <div className="grid gap-3 @md:grid-cols-2">
            <Campo id="legal_name" rotulo="Razão social">
              <Input
                id="legal_name"
                name="legal_name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Campo>
            <Campo id="category" rotulo="Tipo de organização">
              <select
                id="category"
                name="category"
                defaultValue={qualificacao.category ?? "empresa_privada"}
                className={selectClass}
              >
                {COMPANY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {COMPANY_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="responsible_name" rotulo="Quem assina pela empresa">
              <Input
                id="responsible_name"
                name="responsible_name"
                value={respName}
                onChange={(e) => setRespName(e.target.value)}
              />
            </Campo>
            <Campo id="responsible_role" rotulo="Cargo">
              <Input
                id="responsible_role"
                name="responsible_role"
                defaultValue={qualificacao.responsibleRole ?? ""}
              />
            </Campo>
            <Campo id="responsible_cpf" rotulo="CPF de quem assina">
              <Input
                id="responsible_cpf"
                name="responsible_cpf"
                value={respCpf}
                onChange={(e) => setRespCpf(formatCpf(e.target.value))}
                placeholder="000.000.000-00"
              />
            </Campo>
            <Campo id="responsible_email" rotulo="E-mail de quem assina">
              <Input
                id="responsible_email"
                name="responsible_email"
                type="email"
                value={respEmail}
                onChange={(e) => setRespEmail(e.target.value)}
              />
            </Campo>
            <Campo id="responsible_phone" rotulo="Telefone">
              <Input
                // Sem telefone salvo aqui, a sugestão é o telefone do cadastro
                // da empresa — que agora pode ser editado na própria ficha.
                // A chave refaz o campo quando a sugestão muda; sem ela ele
                // guardava o número antigo até recarregar a página.
                key={qualificacao.responsiblePhone ?? ""}
                id="responsible_phone"
                name="responsible_phone"
                defaultValue={qualificacao.responsiblePhone ?? ""}
                onChange={(e) => (e.target.value = formatPhone(e.target.value))}
              />
            </Campo>
          </div>
        </Secao>
            </PainelDoPasso>

            {/* O SALVAR SÓ APARECE NOS PASSOS DESTE FORMULÁRIO. Nos outros,
                cada editor tem o seu — e um "Salvar proposta" ali faria a
                pessoa clicar no botão errado achando que gravou as faixas. */}
            {noFormularioPrincipal && (
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  Salva os passos 1, 4 e 6 juntos — são um formulário só.
                </span>
                <Button type="submit" disabled={isPending}>
                  Salvar proposta
                </Button>
              </div>
            )}
          </form>

          {/* Fora do formulário acima de propósito: <form> dentro de <form>
              não funciona, e cada um tem o seu próprio salvar. */}
          <PainelDoPasso visivel={passo === "condicoes"}>
            {semMigracao ? (
              <AguardandoMigracao />
            ) : (
              <CondicoesComerciais
                leadId={leadId}
                condicoes={condicoes}
                porTitular={basis === "PER_EMPLOYEE"}
                titulares={Number.parseInt(employeeCount || "0", 10) || 0}
                aoIrParaDependentes={() => setPasso("precos")}
              />
            )}
          </PainelDoPasso>

          <PainelDoPasso visivel={passo === "beneficios"}>
            {semMigracao ? (
              <AguardandoMigracao />
            ) : (
              <>
                {/* As unidades vêm ANTES dos benefícios de propósito: é a
                    lista delas que o benefício usa para poder restringir. */}
                <UnidadesDaParceria
                  leadId={leadId}
                  unidades={unidades}
                  principal={unidadePrincipal}
                  vinculadas={unidadesDaParceria}
                />
                <BeneficiosDaProposta
                  leadId={leadId}
                  procedimentos={procedimentos}
                  grupos={grupos}
                  iniciais={beneficios}
                  vieramDaRede={beneficiosVieramDaRede}
                  daRede={beneficiosDaRede}
                  podeCriarGrupo={podeCriarGrupo}
                  vantagens={vantagens}
                  vantagensIniciais={vantagensDaProposta}
                  unidadesDaParceria={unidades.filter((u) =>
                    unidadesDaParceria.includes(u.id)
                  )}
                />
              </>
            )}
          </PainelDoPasso>

          <PainelDoPasso visivel={passo === "texto"}>
            {semMigracao ? (
              <AguardandoMigracao />
            ) : (
              <TextoDaProposta
                leadId={leadId}
                blocos={blocos}
                personalizado={textoPersonalizado}
              />
            )}
          </PainelDoPasso>
        </div>

        {/* ⚠️ A CONTA FICA GRUDADA NA TELA (xl), ao lado de qualquer passo.
            Ela é a resposta de toda decisão de preço: longe da pergunta, a
            pessoa muda um valor e não vê o efeito — que era exatamente o
            problema relatado. Em tela menor ela cai abaixo do trabalho, que é
            o melhor lugar possível sem roubar a altura da dobra. */}
        <aside className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-16">
          <SimuladorDaProposta
            proposta={proposta}
            basis={basis}
            faltaProposta={faltaProposta}
            faltaContrato={faltaContrato}
            linkDaProposta={`/empresarial/funil/${leadId}/proposta`}
            linkDoContrato={`/empresarial/funil/${leadId}/contrato`}
            avisos={avisos}
            incluiDependentes={incluiDependentes}
            estimativaDependentes={estimativaDeps}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * O que estes passos mostram enquanto a migração 1014 não rodou.
 *
 * Painel vazio faria a trilha prometer um passo que não existe — pior que o
 * aviso, porque a pessoa procuraria o que fazer ali.
 */
function AguardandoMigracao() {
  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardContent className="p-4 text-sm">
        Este passo só funciona depois que a atualização do banco (migração{" "}
        <strong>1014</strong>) for aplicada aqui. Os demais passos funcionam
        normalmente.
      </CardContent>
    </Card>
  );
}

/**
 * O LEVANTAMENTO EM POP-UP — só leitura.
 *
 * Existe para não mandar a pessoa trocar de aba no meio da configuração. É
 * leitura por decisão: editar aqui daria dois lugares gravando os mesmos
 * campos, e o último a salvar apagaria o outro sem avisar.
 */
function LevantamentoEmPopup({
  qualificacao: q,
}: {
  qualificacao: QualificacaoView;
}) {
  const [aberto, setAberto] = useState(false);
  const sim = (v: boolean | null) => (v == null ? "não perguntado" : v ? "sim" : "não");

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
            <ClipboardList className="mr-1.5 size-3.5" />
            Ver o levantamento
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>O que a empresa contou</DialogTitle>
          <DialogDescription>
            Só leitura. Para mudar algo aqui, use a aba Levantamento.
          </DialogDescription>
        </DialogHeader>

        {!q.temLevantamento ? (
          <p className="text-sm text-muted-foreground">
            O levantamento ainda não foi feito. Sem ele, a proposta não tem com
            o que comparar o convênio atual.
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            <Linha rotulo="Já tem convênio" valor={sim(q.hasDentalPlan)} />
            <Linha rotulo="Qual convênio" valor={q.dentalPlanName ?? "—"} />
            <Linha
              rotulo="Paga hoje por mês"
              valor={
                q.dentalPlanMonthlyCents == null
                  ? "não informado"
                  : formatBRL(q.dentalPlanMonthlyCents)
              }
            />
            <Linha rotulo="Outros benefícios" valor={q.otherBenefits ?? "—"} />
            <Linha rotulo="Projetos sociais" valor={sim(q.socialProjects)} />
            <Linha rotulo="Quais ações" valor={q.socialProjectsNote ?? "—"} />
            <Linha
              rotulo="Interesse"
              valor={q.interestLevel ? INTEREST_LEVEL_LABELS[q.interestLevel] : "—"}
            />
            <Linha
              rotulo="Chance de fechar"
              valor={q.successChance == null ? "—" : `${q.successChance}%`}
            />
            <Linha rotulo="Observações" valor={q.notes ?? "—"} />
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-3 border-b pb-1.5 last:border-0">
      <dt className="w-40 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1 break-words">{valor}</dd>
    </div>
  );
}

/** Os blocos de texto que vão no documento — modelo da rede, ajustável aqui. */
function TextoDaProposta({
  leadId,
  blocos,
  personalizado,
}: {
  leadId: string;
  blocos: Bloco[];
  personalizado: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState<Bloco[]>(blocos);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveProposalText(leadId, formData);
      if (r.ok) {
        toast.success("Texto da proposta salvo para esta empresa.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function restaurar() {
    startTransition(async () => {
      const r = await resetProposalText(leadId);
      if (r.ok) {
        toast.success("Voltou a usar o modelo da rede.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Detalhamento da proposta</p>
            <p className="text-xs text-muted-foreground">
              {personalizado
                ? "Esta empresa tem um texto próprio."
                : "Usando o modelo da rede. Ao salvar, esta empresa passa a ter o seu — o modelo continua valendo para as outras."}
            </p>
          </div>
          {personalizado && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={isPending}
              onClick={restaurar}
            >
              Voltar ao modelo da rede
            </Button>
          )}
        </div>

        <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          ⚠️ Não repita valores aqui. Mensalidade, quem paga, carência e
          implantação são impressos pelo documento a partir dos campos acima —
          escrevê-los no texto criaria um número que envelhece sozinho.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            {lista.map((b, i) => (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    name={`titulo_${i}`}
                    defaultValue={b.titulo}
                    placeholder="Título do bloco"
                    className="h-8 flex-1 text-sm font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    aria-label={`Apagar o bloco ${i + 1}`}
                    onClick={() =>
                      setLista((atual) => atual.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <textarea
                  name={`corpo_${i}`}
                  defaultValue={b.corpo}
                  rows={3}
                  placeholder="O que este bloco diz"
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLista((atual) => [...atual, { titulo: "", corpo: "" }])}
            >
              <Plus className="mr-1 size-3.5" />
              Novo bloco
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar o texto desta empresa
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SimuladorDaProposta({
  proposta,
  basis,
  faltaProposta,
  faltaContrato,
  linkDaProposta,
  linkDoContrato,
  avisos,
  incluiDependentes,
  estimativaDependentes,
}: {
  proposta: ReturnType<typeof simularProposta>;
  basis: BillingBasis;
  faltaProposta: string[];
  faltaContrato: string[];
  linkDaProposta: string;
  linkDoContrato: string;
  avisos: { gravidade: "avisa" | "bloqueia"; texto: string }[];
  /** Há dependentes nesta fase — muda o que a tela precisa explicar. */
  incluiDependentes: boolean;
  /** Estimativa dos dependentes — só tela, nunca vai para a proposta. */
  estimativaDependentes: EstimativaDosDependentes | null;
}) {
  const economia = proposta.economiaMensalCents;
  return (
    <Card className="border-primary/35">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Simulação da proposta</p>
          <p className="text-xs text-muted-foreground">
            A conta acompanha o que você digita acima. Nada aqui é salvo até
            você clicar em salvar.
          </p>
        </div>

        {/* ⚠️ SEMPRE DUAS COLUNAS. Aqui havia `sm:grid-cols-4`, e o `sm:` olha
            a JANELA, não esta coluna: numa tela larga os quatro números eram
            espremidos nos 320px da barra lateral e "MENSALIDADE" escrevia por
            cima de "POR TITULAR". O dono viu antes de mim, na foto que mandou.
            Regra: dentro de coluna estreita, ponto de corte de janela mente. */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Numero
            rotulo="Mensalidade"
            valor={formatBRL(proposta.mensalidadeCents)}
            destaque
          />
          <Numero
            rotulo="Por titular"
            valor={
              proposta.porColaboradorCents == null
                ? "—"
                : formatBRL(proposta.porColaboradorCents)
            }
          />
          <Numero rotulo="Empresa paga" valor={formatBRL(proposta.empresaPagaCents)} />
          <Numero
            rotulo="Titular paga"
            valor={formatBRL(proposta.colaboradorPagaCents)}
          />
        </div>

        {basis === "PER_EMPLOYEE" && (
          <p className="text-xs text-muted-foreground">
            Titulares {formatBRL(proposta.titularesCents)}
            {estimativaDependentes &&
              ` · dependentes (estimado) ${formatBRL(proposta.dependentesCents)}`}{" "}
            · implantação (1º pagamento) {formatBRL(proposta.implantacaoCents)}
          </p>
        )}

        <div className="rounded-md bg-muted/40 p-3">
          {economia == null ? (
            <p className="text-sm text-muted-foreground">
              {rotuloDaEconomia(proposta)}
            </p>
          ) : (
            <p
              className={`text-sm ${economia < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
            >
              <strong>
                {formatBRL(Math.abs(economia))}/mês
                {proposta.economiaAnualCents != null &&
                  ` · ${formatBRL(Math.abs(proposta.economiaAnualCents))}/ano`}
              </strong>{" "}
              — {rotuloDaEconomia(proposta)}
            </p>
          )}
        </div>

        {/* A FAIXA E A ESTIMATIVA APARECEM ONDE O NÚMERO APARECE. Mostrar
            R$ 29,90 sem dizer que veio de uma faixa faria o consultor procurar
            o valor no campo e não achar. */}
        {proposta.faixaAplicada && (
          <p className="text-xs text-muted-foreground">
            Valendo a faixa a partir de {proposta.faixaAplicada.minQuantity} —
            o valor digitado acima não está sendo usado.
          </p>
        )}
        {/* 1032 (dono, 26/10/2026): os dependentes ENTRAM na mensalidade
            quando a proposta escolhe calcular — pelo quadro, com a mesma régua
            do boleto, ou como individual. A tela diz de onde veio o número. */}
        {estimativaDependentes && (
          <p className="text-xs text-muted-foreground">
            Dependentes: {estimativaDependentes.explicacao}. A parte da empresa
            vale só sobre os titulares.
          </p>
        )}
        {incluiDependentes && !estimativaDependentes && basis === "PER_EMPLOYEE" && (
          <p className="text-xs text-muted-foreground">
            Dependentes <strong>não calculados</strong>: a proposta explica a
            tabela de valores, e o total deles sai dos cadastros.
          </p>
        )}
        {incluiDependentes && basis !== "PER_EMPLOYEE" && (
          <p className="text-xs text-muted-foreground">
            No valor fixo, os dependentes já estão dentro do valor da empresa.
          </p>
        )}

        {avisos.map((a) => (
          <p
            key={a.texto}
            className={`text-xs ${a.gravidade === "bloqueia" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}
          >
            {a.gravidade === "bloqueia" ? "⛔" : "⚠️"} {a.texto}
          </p>
        ))}

        {faltaProposta.length > 0 && (
          <p className="text-xs text-destructive">
            Para fechar a proposta ainda falta: {faltaProposta.join(", ")}.
          </p>
        )}
        {faltaProposta.length === 0 && faltaContrato.length > 0 && (
          <p className="text-xs text-muted-foreground">
            A proposta já fecha. Para gerar o <strong>contrato</strong> ainda
            falta: {faltaContrato.join(", ")}.
          </p>
        )}
        {faltaContrato.length === 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Proposta e contrato têm todos os dados necessários.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {faltaProposta.length === 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={linkDaProposta} target="_blank" />}
            >
              <FileText className="mr-1.5 size-4" />
              Ver a proposta
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled>
              <FileText className="mr-1.5 size-4" />
              Ver a proposta
            </Button>
          )}
          {/* O contrato abre SEMPRE: a tela dele diz o que falta e é nela
              que se preenchem o endereço da sede, o RG e o vencimento. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={linkDoContrato} target="_blank" />}
          >
            <FileText className="mr-1.5 size-4" />
            Ver o contrato
          </Button>
          <span className="text-xs text-muted-foreground">
            {faltaProposta.length > 0
              ? "Preencha o que falta acima para gerar a proposta."
              : "Abrem em outra aba, com os dados SALVOS — salve antes, se acabou de mudar algo."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * OS VALORES DOS DEPENDENTES — abrem junto do "Sim" em "dependentes entram?".
 *
 * Pedido do dono (26/10/2026): a configuração estava partida em duas telas, e
 * "um valor por dependente" não deixava claro onde ficava o preço. Agora a
 * escolha é entre dois cartões (individual × familiar) e cada um mostra só os
 * campos que usa.
 *
 * 1032 (mesmo dia): COMO OS DEPENDENTES ENTRAM NA CONTA — pelo quadro
 * "quantos titulares com quantos dependentes", como individual (sem saber a
 * distribuição) ou sem calcular. E a implantação: só titulares, ou titulares
 * e dependentes. As duas escolhas vão para o documento e para a cobrança.
 */
function ValoresDosDependentes({
  modo,
  aoTrocarModo,
  individual,
  aoTrocarIndividual,
  pacote,
  aoTrocarPacote,
  cobre,
  aoTrocarCobre,
  extra,
  aoTrocarExtra,
  calculo,
  aoTrocarCalculo,
  quadro,
  aoTrocarQuadro,
  estimativa,
  titulares,
  implantacaoComDependentes,
  aoTrocarImplantacao,
}: {
  modo: DependentMode;
  aoTrocarModo: (m: DependentMode) => void;
  individual: string;
  aoTrocarIndividual: (v: string) => void;
  pacote: string;
  aoTrocarPacote: (v: string) => void;
  cobre: string;
  aoTrocarCobre: (v: string) => void;
  extra: string;
  aoTrocarExtra: (v: string) => void;
  calculo: CalculoDosDependentes;
  aoTrocarCalculo: (c: CalculoDosDependentes) => void;
  quadro: { dependentes: string; titulares: string }[];
  aoTrocarQuadro: (
    f: (q: { dependentes: string; titulares: string }[]) => { dependentes: string; titulares: string }[]
  ) => void;
  estimativa: EstimativaDosDependentes | null;
  /** Os titulares da proposta — o quadro é conferido contra eles. */
  titulares: number;
  implantacaoComDependentes: boolean;
  aoTrocarImplantacao: (v: boolean) => void;
}) {
  const opcoes = [
    {
      valor: "PER_DEPENDENT" as const,
      titulo: "Individual",
      texto: "Cada dependente paga o mesmo valor por mês.",
    },
    {
      valor: "FAMILY_PACKAGE" as const,
      titulo: "Plano familiar",
      texto:
        "Quem tem 1 dependente paga o avulso; a partir de 2, o pacote; acima do pacote, o extra.",
    },
  ];
  const calculos = [
    {
      valor: "DISTRIBUTION" as const,
      titulo: "Detalhar por titular",
      texto: "Quantos titulares terão quantos dependentes — o cálculo mais próximo.",
    },
    {
      valor: "AS_INDIVIDUAL" as const,
      titulo: "Calcular como individual",
      texto: "Não sei a distribuição: dependentes × o valor individual.",
    },
    {
      valor: "NONE" as const,
      titulo: "Não calcular",
      texto: "A proposta só explica a tabela de valores dos dependentes.",
    },
  ];
  const problemas = problemasDoQuadro(lerQuadro(quadro));
  const aviso = calculo === "DISTRIBUTION" ? avisoDoQuadro(lerQuadro(quadro), titulares) : null;
  // A linha calculada de cada quantidade — para mostrar o preço ao lado.
  const calculadas = new Map(
    (estimativa?.linhas ?? []).map((l) => [l.dependentes, l] as const)
  );

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Valores dos dependentes</p>
        <p className="text-xs text-muted-foreground">
          Estes valores vão para a tabela de dependentes da proposta — e são os
          que a empresa paga depois do fechamento.
        </p>
      </div>

      <div role="radiogroup" className="grid gap-2 @md:grid-cols-2">
        {opcoes.map((o) => (
          <label
            key={o.valor}
            className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${modo === o.valor ? "border-primary bg-primary/5" : ""}`}
          >
            <input
              type="radio"
              name="dependent_mode"
              value={o.valor}
              checked={modo === o.valor}
              onChange={() => aoTrocarModo(o.valor)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{o.titulo}</span>
              <span className="block text-xs text-muted-foreground">{o.texto}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 @md:grid-cols-2">
        <Campo
          id="dependent_fee"
          rotulo={
            modo === "FAMILY_PACKAGE"
              ? "Dependente avulso (R$)"
              : "Valor por dependente (R$)"
          }
          ajuda={
            modo === "FAMILY_PACKAGE"
              ? "Para o titular que leva um dependente só."
              : "Mensalidade de cada dependente."
          }
        >
          <Input
            id="dependent_fee"
            name="dependent_fee"
            value={individual}
            onChange={(e) => aoTrocarIndividual(e.target.value)}
            placeholder="39,90"
          />
        </Campo>
        {modo === "FAMILY_PACKAGE" && (
          <>
            <Campo id="dependent_family_fee" rotulo="Valor do pacote familiar (R$)">
              <Input
                id="dependent_family_fee"
                name="dependent_family_fee"
                value={pacote}
                onChange={(e) => aoTrocarPacote(e.target.value)}
                placeholder="59,90"
              />
            </Campo>
            <Campo
              id="dependent_family_size"
              rotulo="O pacote cobre até (dependentes)"
              ajuda="Por titular."
            >
              <Input
                id="dependent_family_size"
                name="dependent_family_size"
                type="number"
                min={1}
                value={cobre}
                onChange={(e) => aoTrocarCobre(e.target.value)}
                placeholder="3"
              />
            </Campo>
            <Campo
              id="dependent_family_extra_fee"
              rotulo="Cada dependente além do pacote (R$)"
            >
              <Input
                id="dependent_family_extra_fee"
                name="dependent_family_extra_fee"
                value={extra}
                onChange={(e) => aoTrocarExtra(e.target.value)}
                placeholder="19,90"
              />
            </Campo>
          </>
        )}
      </div>

      {/* ---- como os dependentes entram na conta (1032) ---- */}
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Calcular os dependentes na proposta?</p>
        <div role="radiogroup" className="grid gap-2 @xl:grid-cols-3">
          {calculos.map((o) => (
            <label
              key={o.valor}
              className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${calculo === o.valor ? "border-primary bg-primary/5" : ""}`}
            >
              <input
                type="radio"
                name="dependents_calc_mode"
                value={o.valor}
                checked={calculo === o.valor}
                onChange={() => aoTrocarCalculo(o.valor)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{o.titulo}</span>
                <span className="block text-xs text-muted-foreground">{o.texto}</span>
              </span>
            </label>
          ))}
        </div>

        {calculo === "DISTRIBUTION" && (
          <div className="space-y-2 rounded-md bg-muted/30 p-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Titulares</th>
                    <th className="py-1 pr-2 font-medium">com quantos dependentes cada</th>
                    <th className="py-1 pr-2 text-right font-medium">Por titular</th>
                    <th className="py-1 pr-2 text-right font-medium">Subtotal</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {quadro.map((l, i) => {
                    const calc = calculadas.get(Number.parseInt(l.dependentes, 10));
                    return (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <Input
                            name={`dist_tit_${i}`}
                            type="number"
                            min={0}
                            value={l.titulares}
                            aria-label={`Titulares da linha ${i + 1}`}
                            onChange={(e) =>
                              aoTrocarQuadro((q) =>
                                q.map((x, j) => (j === i ? { ...x, titulares: e.target.value } : x))
                              )
                            }
                            placeholder="0"
                            className="h-8 w-20"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            name={`dist_dep_${i}`}
                            type="number"
                            min={0}
                            value={l.dependentes}
                            aria-label={`Dependentes por titular da linha ${i + 1}`}
                            onChange={(e) =>
                              aoTrocarQuadro((q) =>
                                q.map((x, j) => (j === i ? { ...x, dependentes: e.target.value } : x))
                              )
                            }
                            className="h-8 w-20"
                          />
                        </td>
                        <td className="py-1 pr-2 text-right text-muted-foreground">
                          {calc ? formatBRL(calc.porTitularCents) : "—"}
                        </td>
                        <td className="py-1 pr-2 text-right">
                          {calc ? formatBRL(calc.subtotalCents) : "—"}
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            aria-label={`Tirar a linha ${i + 1}`}
                            onClick={() => aoTrocarQuadro((q) => q.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {estimativa && (
                  <tfoot>
                    <tr className="border-t text-sm">
                      <td className="py-1 pr-2" colSpan={3}>
                        {estimativa.dependentes} dependente
                        {estimativa.dependentes === 1 ? "" : "s"} no total
                      </td>
                      <td className="py-1 pr-2 text-right font-medium">
                        {formatBRL(estimativa.totalCents)}/mês
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const maior = quadro.reduce(
                  (m, l) => Math.max(m, Number.parseInt(l.dependentes, 10) || 0),
                  -1
                );
                aoTrocarQuadro((q) => [...q, { dependentes: String(maior + 1), titulares: "" }]);
              }}
            >
              <Plus className="mr-1 size-3.5" />
              Nova linha
            </Button>
            {problemas.map((p) => (
              <p key={p} className="text-xs text-destructive">
                ⛔ {p}
              </p>
            ))}
            {aviso && (
              <p className="text-xs text-amber-700 dark:text-amber-400">⚠️ {aviso}</p>
            )}
          </div>
        )}

        {/* ---- a implantação (1032) — só quando há valor de dependente ---- */}
        {calculo !== "NONE" && (
          <div className="space-y-1">
            <p className="text-sm font-medium">A implantação (1º pagamento) cobra</p>
            <div role="radiogroup" className="grid gap-2 @md:grid-cols-2">
              {[
                { valor: false, titulo: "Só os titulares", texto: "Os dependentes começam a pagar na mensalidade." },
                {
                  valor: true,
                  titulo: "Titulares e dependentes",
                  texto: "Os dependentes estimados entram já no 1º pagamento.",
                },
              ].map((o) => (
                <label
                  key={String(o.valor)}
                  className={`flex cursor-pointer gap-2 rounded-md border p-2 text-sm ${implantacaoComDependentes === o.valor ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="radio"
                    name="implantation_includes_dependents"
                    value={o.valor ? "SIM" : "NAO"}
                    checked={implantacaoComDependentes === o.valor}
                    onChange={() => aoTrocarImplantacao(o.valor)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{o.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{o.texto}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
