import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { loadBenefitsReport } from "./data";
import { BenefitsReportView } from "./benefits-report-view";

export const metadata: Metadata = {
  title: "Extrato de benefícios · Risarte Empresarial",
};

export default async function BenefitsReportPage(props: {
  params: Promise<{ companyId: string }>;
}) {
  const session = await getSessionContext();
  const { companyId } = await props.params;

  // LGPD: este relatório mostra sessões/procedimentos por pessoa (dado clínico).
  // Por isso é restrito à GESTÃO — o Consultor RisLife (comercial) não entra.
  const roles = Object.values(session.rolesByClinic).flat();
  const canView =
    session.isAdminMaster ||
    roles.some((r) =>
      ["franchisor_staff", "unit_manager", "franchisee", "clinical_coordinator"].includes(
        r
      )
    );
  if (!canView) redirect(`/empresarial/${companyId}`);
  const report = await loadBenefitsReport(companyId);
  if (!report) notFound();

  await logAudit({
    action: "export",
    entityType: "empresarial_benefits_report",
    entityId: companyId,
    details: { members: report.members.length },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
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
      <BenefitsReportView report={report} />
    </div>
  );
}
