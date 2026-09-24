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
import {
  avisoDoValorMinimo,
  avisosDosLimites,
} from "@/lib/empresarial/condicoes-da-proposta";
import { CondicoesComerciais, type CondicoesView } from "./condicoes-editor";

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
  podeCriarGrupo,
  condicoes,
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
  podeCriarGrupo: boolean;
  /** H3: limites, valor mínimo, faixas, implantação e dependentes. */
  condicoes: CondicoesView;
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
  const [fixedMonthly, setFixedMonthly] = useState(
    emReais(qualificacao.fixedMonthlyCents)
  );
  const [implantation, setImplantation] = useState(
    emReais(qualificacao.implantationPerEmployeeCents)
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

  const proposta = simularProposta({
    basis,
    employeeCount: Number.parseInt(employeeCount || "0", 10) || 0,
    holderFeeCents: paraCentavos(holderFee),
    includeDependents: includeDeps === "SIM",
    dependentsCount: Number.parseInt(depsCount || "0", 10) || 0,
    dependentFeeCents: paraCentavos(depFee),
    fixedMonthlyCents: paraCentavos(fixedMonthly),
    implantationPerEmployeeCents: paraCentavos(implantation),
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
    precoDoDependente:
      condicoes.dependentMode === "FAMILY_PACKAGE"
        ? {
            modo: "FAMILY_PACKAGE",
            individualCents: paraCentavos(depFee),
            familiaCents: condicoes.dependentFamilyFeeCents ?? 0,
            extraCents: condicoes.dependentFamilyExtraFeeCents ?? 0,
            tamanhoDaFamilia: condicoes.dependentFamilySize ?? 3,
          }
        : undefined,
    titularesComDependentes: condicoes.holdersWithDependents,
    implantationMode: condicoes.implantationMode,
    implantationFixedCents: condicoes.implantationFixedCents ?? 0,
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
      includeDeps === "SIM" ? Number.parseInt(depsCount || "0", 10) || 0 : 0
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

      <form onSubmit={onSubmit} className="space-y-4">
        {/* ---------------------------------------------------------------- */}
        <Secao titulo="Como a proposta será montada">
          <div className="grid gap-3 sm:grid-cols-2">
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
            {includeDeps === "SIM" && (
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
            )}

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
                {includeDeps === "SIM" && (
                  <Campo id="dependent_fee" rotulo="Mensalidade por dependente (R$)">
                    <Input
                      id="dependent_fee"
                      name="dependent_fee"
                      value={depFee}
                      onChange={(e) => setDepFee(e.target.value)}
                    />
                  </Campo>
                )}
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
            <Campo
              id="implantation_per_employee"
              rotulo="Implantação por titular (R$)"
            >
              <Input
                id="implantation_per_employee"
                name="implantation_per_employee"
                value={implantation}
                onChange={(e) => setImplantation(e.target.value)}
                placeholder="0,00"
              />
            </Campo>
          </div>
        </Secao>

        {/* ---------------------------------------------------------------- */}
        <Secao
          titulo="Prazo e carência"
          descricao="O que foi combinado na negociação. A carência viaja para o cadastro da empresa quando o negócio fecha — antes disso era redigitada, e podia sair diferente do que foi vendido."
        >
          <div className="grid gap-3 sm:grid-cols-3">
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

        {/* ---------------------------------------------------------------- */}
        <SimuladorDaProposta
          proposta={proposta}
          basis={basis}
          faltaProposta={faltaProposta}
          faltaContrato={faltaContrato}
          linkDaProposta={`/empresarial/funil/${leadId}/proposta`}
          avisos={avisos}
        />

        {/* ---------------------------------------------------------------- */}
        <Secao
          titulo="Dados para gerar a proposta e o contrato"
          descricao="Estes campos viajam para o cadastro da empresa quando o negócio é fechado — ninguém digita duas vezes."
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
                id="responsible_phone"
                name="responsible_phone"
                defaultValue={qualificacao.responsiblePhone ?? ""}
                onChange={(e) => (e.target.value = formatPhone(e.target.value))}
              />
            </Campo>
          </div>
        </Secao>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isPending}>
            Salvar proposta
          </Button>
        </div>
      </form>

      {/* Fora do formulário acima de propósito: <form> dentro de <form> não
          funciona, e cada um tem o seu próprio salvar. */}
      {!semMigracao && (
        <CondicoesComerciais
          leadId={leadId}
          condicoes={condicoes}
          porTitular={basis === "PER_EMPLOYEE"}
        />
      )}

      {!semMigracao && (
        <BeneficiosDaProposta
          leadId={leadId}
          procedimentos={procedimentos}
          grupos={grupos}
          iniciais={beneficios}
          podeCriarGrupo={podeCriarGrupo}
        />
      )}

      {!semMigracao && (
        <TextoDaProposta
          leadId={leadId}
          blocos={blocos}
          personalizado={textoPersonalizado}
        />
      )}
    </div>
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
  avisos,
}: {
  proposta: ReturnType<typeof simularProposta>;
  basis: BillingBasis;
  faltaProposta: string[];
  faltaContrato: string[];
  linkDaProposta: string;
  avisos: { gravidade: "avisa" | "bloqueia"; texto: string }[];
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            Titulares {formatBRL(proposta.titularesCents)} · dependentes{" "}
            {formatBRL(proposta.dependentesCents)} · implantação{" "}
            {formatBRL(proposta.implantacaoCents)}
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
        {proposta.dependentesEstimados && (
          <p className="text-xs text-muted-foreground">
            Dependentes: {proposta.explicacaoDosDependentes}
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
          <span className="text-xs text-muted-foreground">
            {faltaProposta.length > 0
              ? "Preencha o que falta acima para gerar o documento."
              : "Abre em outra aba, com os dados SALVOS — salve antes, se acabou de mudar algo."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
