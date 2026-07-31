import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { logAudit } from "@/lib/audit";
import { loadCompanyReport } from "./data";
import { ReportView } from "./report-view";

export const metadata: Metadata = {
  title: "Relatório da empresa · Risarte Empresarial",
};

export default async function CompanyReportPage(props: {
  params: Promise<{ companyId: string }>;
}) {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");

  const { companyId } = await props.params;
  const report = await loadCompanyReport(companyId);
  if (!report) notFound();

  // Trilha LGPD: relatório reúne dados pessoais de colaboradores/dependentes.
  await logAudit({
    action: "export",
    entityType: "empresarial_company_report",
    entityId: companyId,
    details: { employees: report.employees.length },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="no-print mb-4">
        <Link
          href={{
            pathname: `/empresarial/${companyId}`,
            query: { aba: "colaboradores" },
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Voltar para a empresa
        </Link>
      </div>
      <ReportView report={report} />
    </div>
  );
}
