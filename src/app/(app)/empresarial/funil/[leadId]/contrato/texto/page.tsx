import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
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
    .select("id, company_name")
    .eq("id", leadId)
    .maybeSingle<{ id: string; company_name: string }>();
  if (!lead) notFound();

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
        {modelos.daEmpresa && <VoltarAoModelo leadId={leadId} />}
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

      {modelos.erro || !modelo ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          {modelos.erro
            ? "Não foi possível ler o modelo de contrato. Ele depende da migração 1027 — confirme se ela foi aplicada neste banco."
            : "Ainda não há modelo de contrato cadastrado para a rede."}
        </p>
      ) : (
        <EditorDoContrato
          // Refaz o editor quando o texto SALVO muda (depois de salvar).
          key={JSON.stringify(modelo)}
          modelo={modelo}
          acao={saveContractText.bind(null, leadId)}
          rotuloDoSalvar="Salvar o texto desta empresa"
          mensagemDeSucesso="Texto do contrato desta empresa salvo."
        />
      )}
    </div>
  );
}
