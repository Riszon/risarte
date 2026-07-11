import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import {
  computeMonthlyCents,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "@/lib/empresarial/pricing";
import {
  COMPANY_STATUS_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  type CompanyStatus,
  type DependentPlan,
  type LeadStage,
} from "@/lib/empresarial/constants";

export const metadata: Metadata = { title: "Painel · Risarte Empresarial" };

function toPricing(r: {
  holder_fee_cents: number;
  dependent_individual_fee_cents: number;
  dependent_family_fee_cents: number;
  dependent_family_extra_fee_cents: number;
  max_installments: number;
}): AdhesionPricing {
  return {
    holderFeeCents: r.holder_fee_cents,
    dependentIndividualFeeCents: r.dependent_individual_fee_cents,
    dependentFamilyFeeCents: r.dependent_family_fee_cents,
    dependentFamilyExtraFeeCents: r.dependent_family_extra_fee_cents,
    maxInstallments: r.max_installments,
  };
}

export default async function PainelPage() {
  const session = await getSessionContext();
  if (!isProgramManager(session)) redirect("/empresarial");

  const db = await empresarialDb();
  const [
    { data: companies },
    { data: employees },
    { data: dependents },
    { data: pricingRows },
    { data: usage },
    { data: leads },
  ] = await Promise.all([
    db
      .from("companies")
      .select("id, legal_name, trade_name, status")
      .returns<
        { id: string; legal_name: string; trade_name: string | null; status: CompanyStatus }[]
      >(),
    db
      .from("employees")
      .select("id, company_id, dependent_plan, status")
      .eq("status", "ACTIVE")
      .returns<
        { id: string; company_id: string; dependent_plan: DependentPlan; status: "ACTIVE" }[]
      >(),
    db
      .from("dependents")
      .select("employee_id, status")
      .eq("status", "ACTIVE")
      .returns<{ employee_id: string; status: "ACTIVE" }[]>(),
    db
      .from("adhesion_pricing")
      .select(
        "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments"
      )
      .returns<
        ({ company_id: string | null } & Parameters<typeof toPricing>[0])[]
      >(),
    db
      .from("benefit_usage")
      .select("company_id, amount_saved_cents, used_at")
      .returns<
        { company_id: string | null; amount_saved_cents: number | null; used_at: string }[]
      >(),
    db
      .from("commercial_leads")
      .select("stage, estimated_value_cents")
      .returns<{ stage: LeadStage; estimated_value_cents: number | null }[]>(),
  ]);

  const networkPricing =
    (pricingRows ?? [])
      .filter((p) => p.company_id === null)
      .map(toPricing)[0] ?? DEFAULT_ADHESION_PRICING;
  const pricingByCompany = new Map<string, AdhesionPricing>();
  for (const p of pricingRows ?? [])
    if (p.company_id) pricingByCompany.set(p.company_id, toPricing(p));

  const depCountByEmployee = new Map<string, number>();
  for (const d of dependents ?? [])
    depCountByEmployee.set(
      d.employee_id,
      (depCountByEmployee.get(d.employee_id) ?? 0) + 1
    );

  const empByCompany = new Map<string, { dependentPlan: DependentPlan; activeDependentCount: number; status: "ACTIVE" }[]>();
  for (const e of employees ?? []) {
    const list = empByCompany.get(e.company_id) ?? [];
    list.push({
      dependentPlan: e.dependent_plan,
      activeDependentCount: depCountByEmployee.get(e.id) ?? 0,
      status: "ACTIVE",
    });
    empByCompany.set(e.company_id, list);
  }

  const monthlyByCompany = new Map<string, number>();
  let mrr = 0;
  for (const c of companies ?? []) {
    if (c.status !== "ACTIVE") continue;
    const pricing = pricingByCompany.get(c.id) ?? networkPricing;
    const m = computeMonthlyCents(pricing, empByCompany.get(c.id) ?? []);
    monthlyByCompany.set(c.id, m.totalCents);
    mrr += m.totalCents;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let savedTotal = 0;
  let savedMonth = 0;
  const savedByCompany = new Map<string, number>();
  for (const u of usage ?? []) {
    const s = u.amount_saved_cents ?? 0;
    savedTotal += s;
    if (new Date(u.used_at) >= monthStart) savedMonth += s;
    if (u.company_id)
      savedByCompany.set(u.company_id, (savedByCompany.get(u.company_id) ?? 0) + s);
  }

  const activeCompanies = (companies ?? []).filter((c) => c.status === "ACTIVE").length;
  const suspended = (companies ?? []).filter((c) => c.status === "SUSPENDED").length;
  const activeEmployees = employees?.length ?? 0;
  const activeDependents = dependents?.length ?? 0;

  const openLeadValue = (leads ?? [])
    .filter((l) => l.stage !== "CLOSED_WON" && l.stage !== "CLOSED_LOST")
    .reduce((a, l) => a + (l.estimated_value_cents ?? 0), 0);
  const funnelByStage = LEAD_STAGES.map((stage) => {
    const items = (leads ?? []).filter((l) => l.stage === stage);
    return {
      stage,
      count: items.length,
      value: items.reduce((a, l) => a + (l.estimated_value_cents ?? 0), 0),
    };
  });

  const kpis = [
    { label: "Empresas ativas", value: String(activeCompanies) },
    { label: "Suspensas", value: String(suspended) },
    { label: "Colaboradores ativos", value: String(activeEmployees) },
    { label: "Dependentes ativos", value: String(activeDependents) },
    { label: "Mensalidade (MRR)", value: formatBRL(mrr) },
    { label: "Economia gerada (total)", value: formatBRL(savedTotal) },
    { label: "Economia no mês", value: formatBRL(savedMonth) },
    { label: "Funil aberto (valor)", value: formatBRL(openLeadValue) },
  ];

  const companyRows = (companies ?? [])
    .map((c) => ({
      id: c.id,
      name: c.trade_name || c.legal_name,
      status: c.status,
      employees: (empByCompany.get(c.id) ?? []).length,
      monthly: monthlyByCompany.get(c.id) ?? 0,
      saved: savedByCompany.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.monthly - a.monthly);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <Link href="/empresarial" className="text-xs text-muted-foreground hover:underline">
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Painel do programa
        </h1>
        <p className="text-sm text-muted-foreground">
          Visão consolidada da rede.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funil comercial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {funnelByStage.map((f) => (
              <div key={f.stage} className="flex items-center justify-between text-sm">
                <span>{LEAD_STAGE_LABELS[f.stage]}</span>
                <span className="text-muted-foreground">
                  {f.count} · {formatBRL(f.value)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Empresa</th>
                  <th className="px-2 py-1.5 font-medium">Colab.</th>
                  <th className="px-2 py-1.5 font-medium">Mensal</th>
                  <th className="px-2 py-1.5 font-medium">Economia</th>
                </tr>
              </thead>
              <tbody>
                {companyRows.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <Link href={`/empresarial/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                      {c.status !== "ACTIVE" && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({COMPANY_STATUS_LABELS[c.status]})
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{c.employees}</td>
                    <td className="px-2 py-1.5">{formatBRL(c.monthly)}</td>
                    <td className="px-2 py-1.5 text-gold">{formatBRL(c.saved)}</td>
                  </tr>
                ))}
                {companyRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Nenhuma empresa ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
