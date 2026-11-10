import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { formatBrDate } from "@/lib/dates";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { Button } from "@/components/ui/button";
import { lerModelosDoContrato } from "@/lib/empresarial/contrato-dados";
import { EditorDoContrato } from "../../../../configuracoes/contrato-editor";
import { saveContractText } from "../../actions";
import { VoltarAoModelo } from "./voltar-ao-modelo";

export const metadata: Metadata = {
  title: "Texto do contrato · Risarte Empresarial",
};

/**
 * O TEXTO DO CONTRATO DE UMA EMPRESA (1027).
 *
 * É para o caso em que a proposta não cabe no modelo: valor fixo por empresa,
 * preço por quantidade, um combinado que precisa virar cláusula. A tela parte
 * do modelo da rede; salvar cria o texto próprio desta empresa e o modelo da
 * rede continua valendo para as outras.
 */
export default async function TextoDoContratoPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_name, contract_signed_at")
    .eq("id", leadId)
    .maybeSingle<{ id: string; company_name: string; contract_signed_at: string | null }>();
  if (!lead) notFound();
  // 1041: assinado, o texto só se lê (o banco também recusa salvar).
  const assinadoEm = lead.contract_signed_at;

  const modelos = await lerModelosDoContrato(db, leadId);
  const modelo = modelos.daEmpresa ?? modelos.daRede;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/empresarial/funil/${leadId}/contrato`} />}
        >
          ← Voltar ao contrato
        </Button>
        {modelos.daEmpresa && !assinadoEm && <VoltarAoModelo leadId={leadId} />}
      </div>

      <div>
        <h1 className="text-xl font-semibold">
          Texto do contrato — {lead.company_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {modelos.daEmpresa
            ? "Esta empresa tem texto próprio. O que você mudar aqui vale só para ela."
            : "Esta empresa usa o modelo da rede. Ao salvar, ela passa a ter texto próprio — e deixa de acompanhar as mudanças futuras do modelo da rede."}
        </p>
      </div>

      {assinadoEm && (
        <p className="rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
          <strong>Contrato assinado em {formatBrDate(assinadoEm)} — travado.</strong>{" "}
          Para alterar, use <strong>Alterar proposta e contrato</strong> na ficha
          da empresa (Admin ou gestor do programa).
        </p>
      )}

      {modelos.erro || !modelo ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          {modelos.erro
            ? "Não foi possível ler o modelo de contrato. Ele depende da migração 1027 — confirme se ela foi aplicada neste banco."
            : "Ainda não há modelo de contrato cadastrado para a rede."}
        </p>
      ) : (
        <fieldset disabled={Boolean(assinadoEm)} className="min-w-0 disabled:opacity-80">
        <EditorDoContrato
          // Refaz o editor quando o texto SALVO muda (depois de salvar).
          key={JSON.stringify(modelo)}
          modelo={modelo}
          acao={saveContractText.bind(null, leadId)}
          rotuloDoSalvar="Salvar o texto desta empresa"
          mensagemDeSucesso="Texto do contrato desta empresa salvo."
        />
        </fieldset>
      )}
    </div>
  );
}
