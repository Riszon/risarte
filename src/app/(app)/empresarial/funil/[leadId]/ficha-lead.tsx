"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PaymentModel } from "@/lib/empresarial/constants";
import type { CompanyCategory } from "@/lib/empresarial/documents";
import {
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  type BillingBasis,
  type InterestLevel,
} from "@/lib/empresarial/proposta";
import { Campo, Secao, TRI, selectClass, triValor } from "./campos";
import { saveDiscovery } from "./actions";

/**
 * O que a ficha inteira precisa saber da empresa. Fica aqui porque nasceu
 * aqui; as duas abas (levantamento e proposta) leem o mesmo objeto.
 */
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
  proposalValidDays: number | null;
  companyGraceDays: number | null;
  employeeGraceDays: number | null;
  temLevantamento: boolean;
};

/**
 * O LEVANTAMENTO — a ENTREVISTA, e só ela (OC-00083, 23/09/2026).
 *
 * ⚠️ Esta tela encolheu de propósito. Ela carregava também os valores, os
 * dados do contrato e o simulador, tudo num formulário só com um botão de
 * salvar — e o dono disse o que isso era: *"a proposta está misturada com o
 * levantamento e ainda fica confuso"*. Aqui ficou o que se OUVE da empresa;
 * o que se OFERECE a ela mudou para a aba Proposta.
 *
 * As duas gravam na MESMA linha do banco, cada uma só nas suas colunas — ver
 * `gravarNoLevantamento` em `actions.ts`.
 */
export function FichaDoLead({
  leadId,
  qualificacao,
}: {
  leadId: string;
  qualificacao: QualificacaoView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveDiscovery(leadId, formData);
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
            Este levantamento ainda não foi feito. Registre aqui o que você
            ouviu da empresa; os <strong>valores da oferta</strong> ficam na aba{" "}
            <strong>Proposta</strong>.
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
            ajuda="É contra este valor que a economia é calculada na proposta. Em branco, o documento diz que não sabemos — e não finge economia."
          >
            <Input
              id="dental_plan_monthly"
              name="dental_plan_monthly"
              defaultValue={
                qualificacao.dentalPlanMonthlyCents == null
                  ? ""
                  : (qualificacao.dentalPlanMonthlyCents / 100)
                      .toFixed(2)
                      .replace(".", ",")
              }
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
        descricao="Isto é percepção, não medição — e o painel vai tratá-la como tal. Nada daqui entra no documento que a empresa recebe."
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
