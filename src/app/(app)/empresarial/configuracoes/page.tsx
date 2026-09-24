import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AdhesionPricingForm, SplitRulesForm } from "./pricing-forms";
import { BenefitsEditor } from "./benefits-editor";
import { loadBenefits, loadPricing, loadProcedures, loadSplit } from "./data";
import { RetentionButton } from "./retention-button";
import { PropostaDaRede, type Bloco } from "./proposta-da-rede";
import { GruposDeBeneficios, type GrupoView } from "./grupos-de-beneficios";
import { Settings } from "lucide-react";
import type { BenefitType } from "@/lib/empresarial/constants";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";

export const metadata: Metadata = {
  title: "Configurações · Risarte Empresarial",
};

const TABS = [
  { key: "adesao", label: "Preços de adesão" },
  { key: "split", label: "Split de pagamento" },
  { key: "beneficios", label: "Benefícios" },
  { key: "proposta", label: "Proposta comercial" },
  { key: "grupos", label: "Grupos de benefícios" },
] as const;

export default async function EmpresarialConfigPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  if (!isProgramManager(session)) redirect("/empresarial");

  const searchParams = await props.searchParams;
  const abaParam =
    typeof searchParams.aba === "string" ? searchParams.aba : "adesao";
  const aba = TABS.some((t) => t.key === abaParam) ? abaParam : "adesao";

  const db = await empresarialDb();
  const procedures = await loadProcedures();
  const procedureNames = new Map(procedures.map((p) => [p.id, p.name]));

  // O modelo de proposta da rede (1014) — a linha com lead_id nulo.
  const { data: modeloDaRede } = await db
    .from("proposal_templates")
    .select("sections, valid_days")
    .is("lead_id", null)
    .maybeSingle<{ sections: Bloco[]; valid_days: number }>();

  // H2 (1016): os grupos de benefícios da rede, com os itens de cada um.
  const [{ data: gruposRows }, { data: itensRows }] = await Promise.all([
    db
      .from("benefit_groups")
      .select("id, name, description, is_active")
      .order("name")
      .returns<
        { id: string; name: string; description: string | null; is_active: boolean }[]
      >(),
    db
      .from("benefit_group_items")
      .select(
        "group_id, procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments, for_holder, for_dependent"
      )
      .returns<
        {
          group_id: string;
          procedure_id: string;
          benefit_type: BenefitType;
          benefit_value: number | null;
          usage_limit_count: number | null;
          usage_period_months: number | null;
          grace_period_months: number;
          max_installments: number | null;
          for_holder: boolean;
          for_dependent: boolean;
        }[]
      >(),
  ]);
  const grupos: GrupoView[] = (gruposRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    isActive: g.is_active,
    itens: (itensRows ?? [])
      .filter((i) => i.group_id === g.id)
      .map((i) => ({
        nome: procedureNames.get(i.procedure_id) ?? "(procedimento)",
        procedureId: i.procedure_id,
        benefitType: i.benefit_type,
        benefitValue: i.benefit_value,
        usageLimitCount: i.usage_limit_count,
        usagePeriodMonths: i.usage_period_months,
        gracePeriodMonths: i.grace_period_months,
        maxInstallments: i.max_installments,
        forHolder: i.for_holder,
        forDependent: i.for_dependent,
      }))
      .sort((a, z) => a.nome.localeCompare(z.nome, "pt-BR")),
  }));

  const [{ pricing }, { split }, benefits] = await Promise.all([
    loadPricing(db, null),
    loadSplit(db, null),
    loadBenefits(db, null, procedureNames),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={Settings}
        titulo="Configurações do programa"
        descricao="Padrão da rede. Cada empresa pode ter regras próprias na sua tela."
        voltar={{ href: "/empresarial", rotulo: "Empresas" }}
      />

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            size="sm"
            nativeButton={false}
            className={cn(
              "rounded-b-none border-b-2 border-transparent",
              aba === t.key && "border-gold font-medium text-gold-tinta"
            )}
            render={
              <Link
                href={{
                  pathname: "/empresarial/configuracoes",
                  query: { aba: t.key },
                }}
              />
            }
          >
            {t.label}
          </Button>
        ))}
      </div>

      {aba === "adesao" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preços de adesão — padrão da rede
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AdhesionPricingForm companyId={null} pricing={pricing} />
          </CardContent>
        </Card>
      )}

      {aba === "split" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Split de pagamento — padrão da rede
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SplitRulesForm companyId={null} split={split} />
          </CardContent>
        </Card>
      )}

      {aba === "proposta" && (
        <PropostaDaRede
          validDays={modeloDaRede?.valid_days ?? 15}
          blocos={modeloDaRede?.sections ?? []}
        />
      )}

      {aba === "grupos" && <GruposDeBeneficios grupos={grupos} />}

      {aba === "beneficios" && (
        <BenefitsEditor
          companyId={null}
          procedures={procedures}
          benefits={benefits}
          scopeLabel="padrão da rede"
        />
      )}

      {session.isAdminMaster && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retenção de dados (LGPD)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Dados de titulares que saíram há mais de 5 anos são
              anonimizados automaticamente (rotina mensal). Você também pode rodar
              agora.
            </p>
            <RetentionButton />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
