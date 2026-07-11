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

export const metadata: Metadata = {
  title: "Configurações · Risarte Empresarial",
};

const TABS = [
  { key: "adesao", label: "Preços de adesão" },
  { key: "split", label: "Split de pagamento" },
  { key: "beneficios", label: "Benefícios" },
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

  const [{ pricing }, { split }, benefits] = await Promise.all([
    loadPricing(db, null),
    loadSplit(db, null),
    loadBenefits(db, null, procedureNames),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <Link
          href="/empresarial"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Configurações do programa
        </h1>
        <p className="text-sm text-muted-foreground">
          Padrão da rede. Cada empresa pode ter regras próprias na sua tela.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            size="sm"
            nativeButton={false}
            className={cn(
              "rounded-b-none border-b-2 border-transparent",
              aba === t.key && "border-gold font-medium text-gold"
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
              Dados de colaboradores que saíram há mais de 5 anos são
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
