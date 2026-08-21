import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  REPORT_FILTER_LABELS,
  REPORT_FILTERS,
  type ReportFilter,
} from "@/lib/empresarial/constants";
import { loadCompanyReport } from "./data";
import { ReportView } from "./report-view";

const FILTERS: readonly ReportFilter[] = REPORT_FILTERS;

export const metadata: Metadata = {
  title: "Relatório da empresa · Risarte Empresarial",
};

export default async function CompanyReportPage(props: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");

  const { companyId } = await props.params;
  const searchParams = await props.searchParams;
  // Padrão: somente os ATIVOS (decisão do dono).
  const raw =
    typeof searchParams.situacao === "string" ? searchParams.situacao : "";
  const filter: ReportFilter = FILTERS.includes(raw as ReportFilter)
    ? (raw as ReportFilter)
    : "ACTIVE";

  const report = await loadCompanyReport(companyId, filter);
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
      <div className="no-print mb-4 space-y-3">
        <Link
          href={{
            pathname: `/empresarial/${companyId}`,
            query: { aba: "colaboradores" },
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Voltar para a empresa
        </Link>
        {/* Filtro por situação — padrão: somente ativos. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase text-muted-foreground">
            Mostrar:
          </span>
          {FILTERS.map((f) => (
            <Button
              key={f}
              variant={filter === f ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 px-2 text-xs", filter === f && "font-medium")}
              nativeButton={false}
              render={
                <Link
                  href={{
                    pathname: `/empresarial/${companyId}/relatorio`,
                    query: { situacao: f },
                  }}
                />
              }
            >
              {REPORT_FILTER_LABELS[f]}
            </Button>
          ))}
        </div>
      </div>
      <ReportView report={report} />
    </div>
  );
}
