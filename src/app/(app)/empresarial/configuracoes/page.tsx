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
import { BenefitsEditor, type MargemDaLinha } from "./benefits-editor";
import { custosDaRede } from "@/lib/empresarial/custos-da-rede";
import {
  avisoDaMargem,
  margemComBeneficio,
} from "@/lib/empresarial/margem-do-beneficio";
import { loadBenefits, loadPricing, loadProcedures, loadSplit } from "./data";
import { RetentionButton } from "./retention-button";
import { PropostaDaRede, type Bloco } from "./proposta-da-rede";
import { ContratoDaRede } from "./contrato-da-rede";
import {
  lerContratada,
  lerModelosDoContrato,
} from "@/lib/empresarial/contrato-dados";
import { GruposDeBeneficios, type GrupoView } from "./grupos-de-beneficios";
import { VantagensDaRede } from "./vantagens-da-rede";
import type { Vantagem } from "@/lib/empresarial/vantagens";
import { Settings } from "lucide-react";
import type { BenefitType } from "@/lib/empresarial/constants";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";

export const metadata: Metadata = {
  title: "Configurações · Risarte Empresarial",
};

// 26/10/2026 (dono): "Benefícios" e "Grupos de benefícios" viraram UMA aba —
// os grupos são combinações dos benefícios, e estavam a duas abas de distância.
const TABS = [
  { key: "adesao", label: "Preços de adesão" },
  { key: "split", label: "Split de pagamento" },
  { key: "beneficios", label: "Benefícios e grupos" },
  { key: "proposta", label: "Proposta comercial" },
  { key: "contrato", label: "Contrato" },
] as const;

// As três partes da aba Benefícios e grupos — uma por vez (27/10/2026).
const BLOCOS = [
  { key: "procedimentos", label: "Procedimentos" },
  { key: "vantagens", label: "Outras vantagens" },
  { key: "grupos", label: "Grupos" },
] as const;

export default async function EmpresarialConfigPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  if (!isProgramManager(session)) redirect("/empresarial");

  const searchParams = await props.searchParams;
  // Endereço antigo da aba de grupos (favoritos, links do manual) cai na aba
  // nova, que é onde os grupos moram agora.
  const abaPedida = typeof searchParams.aba === "string" ? searchParams.aba : "adesao";
  const abaParam = abaPedida === "grupos" ? "beneficios" : abaPedida;
  const aba = TABS.some((t) => t.key === abaParam) ? abaParam : "adesao";
  // O endereço antigo de grupos (`aba=grupos`) abre direto na parte Grupos.
  const blocoPedido =
    typeof searchParams.bloco === "string" ? searchParams.bloco : abaPedida === "grupos" ? "grupos" : "";
  const bloco = BLOCOS.some((b) => b.key === blocoPedido)
    ? (blocoPedido as (typeof BLOCOS)[number]["key"])
    : "procedimentos";

  const db = await empresarialDb();
  const procedures = await loadProcedures();
  const procedureNames = new Map(procedures.map((p) => [p.id, p.name]));

  // O modelo de proposta da rede (1014) — a linha com lead_id nulo.
  const { data: modeloDaRede } = await db
    .from("proposal_templates")
    .select("sections, valid_days")
    .is("lead_id", null)
    .maybeSingle<{ sections: Bloco[]; valid_days: number }>();

  // 1027: o contrato — só quando a aba é a dele (são dados pessoais do
  // representante; não há por que carregá-los nas outras abas).
  const contrato =
    aba === "contrato"
      ? {
          modelos: await lerModelosDoContrato(db, null),
          contratada: await lerContratada(db),
        }
      : null;

  // H2 (1016): os grupos de benefícios da rede, com os itens de cada um.
  const [
    { data: gruposRows },
    { data: itensRows },
    { data: vantagensRows },
    { data: vantagensDosGruposRows },
  ] = await Promise.all([
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
    // 1033: as outras vantagens da rede, e as de cada grupo.
    db
      .from("perks")
      .select("id, name, description, is_active")
      .order("name")
      .returns<{ id: string; name: string; description: string | null; is_active: boolean }[]>(),
    db
      .from("benefit_group_perks")
      .select("group_id, perk_id, detail")
      .returns<{ group_id: string; perk_id: string; detail: string | null }[]>(),
  ]);
  const vantagens: Vantagem[] = (vantagensRows ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    isActive: v.is_active,
  }));
  const nomeDaVantagem = new Map(vantagens.map((v) => [v.id, v.name]));
  const grupos: GrupoView[] = (gruposRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    isActive: g.is_active,
    vantagens: (vantagensDosGruposRows ?? [])
      .filter((v) => v.group_id === g.id)
      .map((v) => ({
        perkId: v.perk_id,
        detail: v.detail,
        nome: nomeDaVantagem.get(v.perk_id) ?? "(vantagem)",
      })),
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

  // I2: a margem de cada procedimento, na média da rede.
  const custos = await custosDaRede();
  const margens = new Map<string, MargemDaLinha>();

  const [{ pricing }, { split }, benefits] = await Promise.all([
    loadPricing(db, null),
    loadSplit(db, null),
    loadBenefits(db, null, procedureNames),
  ]);

  // ⚠️ Procedimento SEM PREÇO cadastrado fica de fora do mapa, e a tela diz
  // "sem preço cadastrado" em vez de mostrar margem sobre zero — que seria
  // sempre 100% negativa e não significaria nada.
  for (const b of benefits) {
    const custo = custos.get(b.procedureId);
    if (!custo || custo.precoCents <= 0) continue;
    const m = margemComBeneficio(custo, {
      benefitType: b.benefitType,
      benefitValue: b.benefitValue,
    });
    margens.set(b.procedureId, {
      precoCheioCents: m.precoCheioCents,
      precoComBeneficioCents: m.precoComBeneficioCents,
      margemComBeneficioCents: m.margemComBeneficioCents,
      margemPercent: m.margemPercent,
      custoDoBeneficioCents: m.custoDoBeneficioCents,
      negativa: m.negativa,
      aviso: avisoDaMargem(m),
    });
  }

  const contagem: Record<(typeof BLOCOS)[number]["key"], number> = {
    procedimentos: benefits.length,
    vantagens: vantagens.length,
    grupos: grupos.length,
  };

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

      {aba === "contrato" && contrato && (
        <ContratoDaRede
          contratada={contrato.contratada.contratada}
          modelo={contrato.modelos.daRede}
        />
      )}

      {/* Uma aba, três partes, na ordem em que se monta: o que cada
          procedimento ganha, as vantagens que não são procedimento, e as
          combinações prontas das duas coisas. Desde 27/10/2026 (dono: "lista
          muito longa") aparece UMA parte por vez; o endereço guarda qual. */}
      {aba === "beneficios" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Parte da aba">
            {BLOCOS.map((b) => (
              <Button
                key={b.key}
                size="sm"
                variant={bloco === b.key ? "default" : "outline"}
                nativeButton={false}
                aria-current={bloco === b.key ? "page" : undefined}
                render={
                  <Link
                    href={{
                      pathname: "/empresarial/configuracoes",
                      query: { aba: "beneficios", bloco: b.key },
                    }}
                  />
                }
              >
                {b.label} ({contagem[b.key]})
              </Button>
            ))}
          </div>
          {bloco === "procedimentos" && (
            <BenefitsEditor
              companyId={null}
              procedures={procedures}
              benefits={benefits}
              margens={margens}
              scopeLabel="padrão da rede"
            />
          )}
          {bloco === "vantagens" && <VantagensDaRede vantagens={vantagens} />}
          {bloco === "grupos" && (
            <GruposDeBeneficios
              grupos={grupos}
              procedimentos={procedures}
              vantagens={vantagens}
            />
          )}
        </div>
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
