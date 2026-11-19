import type { Metadata } from "next";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { formatIsoMonthBr } from "@/lib/dates";
import type { CompanyReport } from "@/app/(app)/empresarial/[companyId]/relatorio/data";
import { ReportView } from "@/app/(app)/empresarial/[companyId]/relatorio/report-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Titulares e dependentes do mês · Risarte Empresarial",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * /relatorio-do-mes/[código] — ASA5 (4023, decisão 6): o "Relatório detalhado"
 * da empresa COMO ESTAVA quando a mensalidade foi gerada (a foto guardada), pelo
 * link que vai na descrição da cobrança do Asaas. Sem login: o código de 64
 * caracteres decide, e só o servidor lê (`_corporate_report_by_code`). Fora dos
 * buscadores e sem cache. A empresa pode imprimir em PDF ou baixar a planilha.
 */
export default async function RelatorioDoMesPage(props: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await props.params;
  type Lido = { data: CompanyReport; reference_month: string | null };
  let lido: Lido | null = null;
  if (/^[0-9a-f]{64}$/.test(codigo) && isAdminClientConfigured()) {
    const { data } = await createAdminClient().rpc("_corporate_report_by_code", { p_code: codigo });
    lido = (data as Lido | null) ?? null;
  }

  if (!lido?.data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm">
        <h1 className="text-lg font-semibold">Link não encontrado</h1>
        <p className="mt-2 text-muted-foreground">
          Confira o endereço que veio na cobrança. Se ele estiver certo, fale com a Risarte.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {lido.reference_month && (
        <p className="no-print mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          Titulares e dependentes da mensalidade de <strong>{formatIsoMonthBr(lido.reference_month)}</strong>, como
          estavam no dia em que a cobrança foi gerada.
        </p>
      )}
      <ReportView report={lido.data} />
    </div>
  );
}
