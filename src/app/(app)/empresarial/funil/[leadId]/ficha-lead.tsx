"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type CompanyCategory,
} from "@/lib/empresarial/documents";
import {
  BILLING_BASES,
  BILLING_BASIS_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  faltaParaContrato,
  faltaParaProposta,
  rotuloDaEconomia,
  simularProposta,
  type BillingBasis,
  type InterestLevel,
} from "@/lib/empresarial/proposta";
import { saveQualification } from "./actions";

export type QualificacaoView = {
  hasDentalPlan: boolean | null;
  dentalPlanName: string | null;
  dentalPlanMonthlyCents: number | null;
  otherBenefits: string | null;
  socialProjects: boolean | null;
  socialProjectsNote: string | null;
  interestLevel: InterestLevel | null;
  successChance: number | null;
  paymentModel: PaymentModel | null;
  subsidyType: "PERCENT" | "AMOUNT" | null;
  subsidyValue: number | null;
  employeeCount: number | null;
  includesDependents: boolean | null;
  dependentsEstimate: number | null;
  billingModel: "unico" | "por_cnpj" | null;
  billingBasis: BillingBasis | null;
  holderFeeCents: number;
  dependentFeeCents: number;
  fixedMonthlyCents: number | null;
  implantationPerEmployeeCents: number | null;
  legalName: string | null;
  category: CompanyCategory | null;
  responsibleName: string | null;
  responsibleRole: string | null;
  responsibleCpf: string | null;
  responsibleEmail: string | null;
  responsiblePhone: string | null;
  notes: string | null;
  temLevantamento: boolean;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Centavos → "39,90" para o campo de digitar. */
const emReais = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/** "39,90" → 3990. Espelha a conversão do servidor. */
function paraCentavos(valor: string): number {
  const n = Number.parseFloat(
    valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const TRI = [
  { value: "", label: "— não perguntei —" },
  { value: "SIM", label: "Sim" },
  { value: "NAO", label: "Não" },
];
const triValor = (v: boolean | null) => (v == null ? "" : v ? "SIM" : "NAO");

export function FichaDoLead({
  leadId,
  cnpj,
  qualificacao,
}: {
  leadId: string;
  cnpj: string | null;
  qualificacao: QualificacaoView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // O simulador precisa recalcular enquanto a pessoa digita, então estes
  // campos vivem em estado. O resto é formulário comum.
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
      ? qualificacao.subsidyValue?.toString() ?? ""
      : ""
  );
  const [subsidyAmount, setSubsidyAmount] = useState(
    qualificacao.subsidyType === "AMOUNT"
      ? emReais(qualificacao.subsidyValue)
      : ""
  );
  const [planoAtual, setPlanoAtual] = useState(
    emReais(qualificacao.dentalPlanMonthlyCents)
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
    currentPlanMonthlyCents: planoAtual ? paraCentavos(planoAtual) : null,
  });

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
      const r = await saveQualification(leadId, formData);
      if (r.ok) {
        toast.success("Levantamento salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!qualificacao.temLevantamento && (
        <Card className="border-gold/40 bg-gold/5">
          <CardContent className="p-4 text-sm">
            Este levantamento ainda não foi feito. Os preços já vêm preenchidos
            com o <strong>padrão da rede</strong> — troque se esta empresa tiver
            condição própria.
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      <Secao titulo="O que a empresa tem hoje">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="has_dental_plan" rotulo="Já tem convênio odontológico?">
            <select
              id="has_dental_plan"
              name="has_dental_plan"
              defaultValue={triValor(qualificacao.hasDentalPlan)}
              className={selectClass}
            >
              {TRI.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="dental_plan_name" rotulo="Qual convênio">
            <Input
              id="dental_plan_name"
              name="dental_plan_name"
              defaultValue={qualificacao.dentalPlanName ?? ""}
            />
          </Campo>
          <Campo
            id="dental_plan_monthly"
            rotulo="Quanto paga hoje por mês (R$)"
            ajuda="É contra este valor que a economia é calculada. Em branco, a proposta diz que não sabemos — e não finge economia."
          >
            <Input
              id="dental_plan_monthly"
              name="dental_plan_monthly"
              value={planoAtual}
              onChange={(e) => setPlanoAtual(e.target.value)}
              placeholder="0,00"
            />
          </Campo>
          <Campo id="other_benefits" rotulo="Outros benefícios que a empresa paga">
            <Input
              id="other_benefits"
              name="other_benefits"
              defaultValue={qualificacao.otherBenefits ?? ""}
              placeholder="vale-refeição, plano de saúde..."
            />
          </Campo>
          <Campo
            id="social_projects"
            rotulo="Participa de ações ou projetos sociais?"
            ajuda="É o diferencial do programa frente a um convênio comum: a empresa pode ampliar a responsabilidade social."
          >
            <select
              id="social_projects"
              name="social_projects"
              defaultValue={triValor(qualificacao.socialProjects)}
              className={selectClass}
            >
              {TRI.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="social_projects_note" rotulo="Quais ações">
            <Input
              id="social_projects_note"
              name="social_projects_note"
              defaultValue={qualificacao.socialProjectsNote ?? ""}
            />
          </Campo>
        </div>
      </Secao>

      {/* ---------------------------------------------------------------- */}
      <Secao
        titulo="Leitura do consultor"
        descricao="Isto é percepção, não medição — e o painel vai tratá-la como tal."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="interest_level" rotulo="Nível de interesse da empresa">
            <select
              id="interest_level"
              name="interest_level"
              defaultValue={qualificacao.interestLevel ?? ""}
              className={selectClass}
            >
              <option value="">— não avaliado —</option>
              {INTEREST_LEVELS.map((n) => (
                <option key={n} value={n}>
                  {INTEREST_LEVEL_LABELS[n]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="success_chance" rotulo="Chance de fechar (0 a 100)">
            <Input
              id="success_chance"
              name="success_chance"
              type="number"
              min={0}
              max={100}
              defaultValue={qualificacao.successChance ?? ""}
            />
          </Campo>
        </div>
      </Secao>

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
                <option value="AMOUNT">Valor fixo por colaborador</option>
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
            <Campo id="subsidy_amount" rotulo="Quanto a empresa paga por colaborador (R$)">
              <Input
                id="subsidy_amount"
                name="subsidy_amount"
                value={subsidyAmount}
                onChange={(e) => setSubsidyAmount(e.target.value)}
                placeholder="0,00"
              />
            </Campo>
          )}

          <Campo id="employee_count" rotulo="Quantos colaboradores entram *">
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

          <Campo
            id="billing_model"
            rotulo="Uma empresa ou um conjunto de CNPJs?"
          >
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
              <Campo id="holder_fee" rotulo="Mensalidade por colaborador (R$)">
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
            rotulo="Implantação por colaborador (R$)"
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
      <SimuladorDaProposta
        proposta={proposta}
        basis={basis}
        faltaProposta={faltaProposta}
        faltaContrato={faltaContrato}
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
        <Campo id="notes" rotulo="Observações do levantamento">
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={qualificacao.notes ?? ""}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </Campo>
      </Secao>

      <div className="flex justify-end gap-2 pb-6">
        <Button type="submit" disabled={isPending}>
          Salvar levantamento
        </Button>
      </div>
    </form>
  );
}

function SimuladorDaProposta({
  proposta,
  basis,
  faltaProposta,
  faltaContrato,
}: {
  proposta: ReturnType<typeof simularProposta>;
  basis: BillingBasis;
  faltaProposta: string[];
  faltaContrato: string[];
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
          <Numero rotulo="Mensalidade" valor={formatBRL(proposta.mensalidadeCents)} destaque />
          <Numero
            rotulo="Por colaborador"
            valor={
              proposta.porColaboradorCents == null
                ? "—"
                : formatBRL(proposta.porColaboradorCents)
            }
          />
          <Numero rotulo="Empresa paga" valor={formatBRL(proposta.empresaPagaCents)} />
          <Numero
            rotulo="Colaborador paga"
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
            <p className="text-sm text-muted-foreground">{rotuloDaEconomia(proposta)}</p>
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
      </CardContent>
    </Card>
  );
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">{titulo}</p>
          {descricao && (
            <p className="text-xs text-muted-foreground">{descricao}</p>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Campo({
  id,
  rotulo,
  ajuda,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      <p className={destaque ? "text-lg font-semibold" : "text-sm"}>{valor}</p>
    </div>
  );
}
