import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canViewEmpresarial, canWorkOnCompanies, isProgramManager } from "@/lib/empresarial/access";
import { empresarialDb } from "@/lib/empresarial/db";
import { diferencasDosTermos, type TermosDoContrato } from "@/lib/empresarial/revisao-do-contrato";
import { createClient } from "@/lib/supabase/server";
import { formatBrDateTime } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RevisaoDoContrato } from "./revisao-form";

export const metadata: Metadata = {
  title: "Revisão do contrato · Risarte Empresarial",
};

type RevisaoRow = {
  id: string;
  company_id: string;
  code: string;
  status: "RASCUNHO" | "APLICADA" | "CANCELADA";
  reason: string;
  terms_before: TermosDoContrato;
  terms_after: TermosDoContrato;
  applied_terms_before: TermosDoContrato | null;
  document_file_id: string | null;
  created_by: string | null;
  created_at: string;
  applied_by: string | null;
  applied_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

/**
 * REVISAR CONTRATO (1050; plano REVISAR-CONTRATO-PLANO.md). A revisão nasce
 * com a foto das regras, recebe as alterações, exige o aditivo assinado (R2)
 * e é aplicada pelo gestor (R6). Vale da próxima cobrança gerada (R3).
 */
export default async function RevisaoPage({
  params,
}: {
  params: Promise<{ companyId: string; revisaoId: string }>;
}) {
  const { companyId, revisaoId } = await params;
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!canWorkOnCompanies(session)) redirect(`/empresarial/${companyId}`);

  const db = await empresarialDb();
  const { data: rev } = await db
    .from("contract_revisions")
    .select("*")
    .eq("id", revisaoId)
    .eq("company_id", companyId)
    .maybeSingle<RevisaoRow>();
  if (!rev) notFound();

  const [{ data: empresa }, { data: arquivo }] = await Promise.all([
    db
      .from("companies")
      .select("legal_name, trade_name")
      .eq("id", companyId)
      .maybeSingle<{ legal_name: string | null; trade_name: string | null }>(),
    rev.document_file_id
      ? db
          .from("company_files")
          .select("file_name, storage_path")
          .eq("id", rev.document_file_id)
          .maybeSingle<{ file_name: string; storage_path: string }>()
      : Promise.resolve({ data: null }),
  ]);
  if (!empresa) notFound();

  const pessoas = [rev.created_by, rev.applied_by, rev.cancelled_by].filter(Boolean) as string[];
  const nomes = new Map<string, string>();
  if (pessoas.length) {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", pessoas);
    for (const p of data ?? []) nomes.set(p.id, p.full_name ?? "—");
  }
  const quem = (id: string | null) => (id ? (nomes.get(id) ?? "—") : "—");

  // Aplicada: o "antes" é a foto do instante de aplicar.
  const antes = rev.status === "APLICADA" && rev.applied_terms_before ? rev.applied_terms_before : rev.terms_before;
  const mudancas = diferencasDosTermos(antes, rev.terms_after);
  const razao = empresa.legal_name || empresa.trade_name || "Empresa";
  const rascunho = rev.status === "RASCUNHO";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href={`/empresarial/${companyId}?aba=regras`} className="text-sm text-muted-foreground hover:underline">
          ← {razao} · Regras combinadas
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          Revisão do contrato {rev.code}{" "}
          <span className="ml-1 rounded bg-muted px-2 py-0.5 align-middle text-xs font-normal text-muted-foreground">
            {rascunho ? "Em revisão" : rev.status === "APLICADA" ? "Aplicada" : "Cancelada"}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aberta por {quem(rev.created_by)} em {formatBrDateTime(rev.created_at)}.
          {rev.applied_at && ` Aplicada por ${quem(rev.applied_by)} em ${formatBrDateTime(rev.applied_at)}.`}
          {rev.cancelled_at && ` Cancelada por ${quem(rev.cancelled_by)} em ${formatBrDateTime(rev.cancelled_at)}: ${rev.cancel_reason}.`}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">O que muda</CardTitle>
        </CardHeader>
        <CardContent>
          {mudancas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {rascunho ? "Nada ainda. Altere as regras abaixo e salve." : "Nenhuma regra mudou."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3 font-normal">Regra</th>
                    <th className="py-1 pr-3 font-normal">Antes</th>
                    <th className="py-1 font-normal">Depois</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {mudancas.map((m) => (
                    <tr key={m.rotulo} className="align-top">
                      <td className="py-1.5 pr-3 text-muted-foreground">{m.rotulo}</td>
                      <td className="py-1.5 pr-3 line-through decoration-muted-foreground/50">{m.de}</td>
                      <td className="py-1.5 font-medium">{m.para}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <RevisaoDoContrato
        revisaoId={rev.id}
        companyId={companyId}
        rascunho={rascunho}
        motivo={rev.reason}
        termos={rev.terms_after}
        temMudancas={mudancas.length > 0}
        aditivo={arquivo ? { nome: arquivo.file_name, caminho: arquivo.storage_path } : null}
        podeAplicar={isProgramManager(session)}
      />
    </div>
  );
}
