import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { loadCompanySheet } from "./data";
import { CompanySheetView } from "./company-sheet-view";

export const metadata: Metadata = {
  title: "Ficha da empresa · Risarte Empresarial",
};

export default async function CompanySheetPage(props: {
  params: Promise<{ companyId: string }>;
}) {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");

  const { companyId } = await props.params;
  const sheet = await loadCompanySheet(companyId);
  if (!sheet) notFound();

  // Trilha LGPD: a ficha reúne dados cadastrais e financeiros da empresa.
  await logAudit({
    action: "export",
    entityType: "empresarial_company_sheet",
    entityId: companyId,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="no-print mb-4">
        <Link
          href={{
            pathname: `/empresarial/${companyId}`,
            query: { aba: "geral" },
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Voltar para a empresa
        </Link>
      </div>
      <CompanySheetView sheet={sheet} />
    </div>
  );
}
