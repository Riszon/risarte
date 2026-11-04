import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isRislifeConsultant } from "@/lib/empresarial/access";
import { loadBenefitsReport } from "./data";
import { BenefitsReportView } from "./benefits-report-view";
import { ResumoDoConsultor, type ResumoDoUso } from "./resumo-do-consultor";

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
  if (!canView) {
    // O Consultor RisLife vê o USO, sem dado clínico (AP95, 1039): o banco
    // só responde para a empresa em que ele é o responsável.
    if (!isRislifeConsultant(session)) redirect(`/empresarial/${companyId}`);
    const db = await empresarialDb();
    const [{ data: empresa }, { data: resumo, error }] = await Promise.all([
      db
        .from("companies")
        .select("legal_name, trade_name, cnpj")
        .eq("id", companyId)
        .maybeSingle<{ legal_name: string; trade_name: string | null; cnpj: string }>(),
      db.rpc("consultant_usage_summary", { p_company_id: companyId }),
    ]);
    if (!empresa) notFound();
    if (error || !resumo) {
      if (error) console.error("consultant_usage_summary:", error.message);
      redirect(`/empresarial/${companyId}`);
    }
    const r = resumo as ResumoDoUso;
    await logAudit({
      action: "export",
      entityType: "empresarial_benefits_report",
      entityId: companyId,
      details: { members: r.membros.length, view: "consultant_summary" },
    });
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="no-print mb-4">
          <Link
            href={{ pathname: `/empresarial/${companyId}`, query: { aba: "colaboradores" } }}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Voltar para a empresa
          </Link>
        </div>
        <ResumoDoConsultor
          empresa={{ legalName: empresa.legal_name, tradeName: empresa.trade_name, cnpj: empresa.cnpj }}
          resumo={r}
        />
      </div>
    );
  }
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
