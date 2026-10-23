import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { canViewMetas, podeEditarMeta } from "@/lib/metas/access";
import { lerMeta } from "@/lib/metas/dados";
import { dadosParaEditar, opcoesDoAssistente } from "@/lib/metas/opcoes";
import { AssistenteDaMeta } from "../../assistente";

export const metadata: Metadata = { title: "Editar meta — Metas" };

export default async function EditarMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!canViewMetas(session)) redirect("/");
  const { id } = await params;
  const db = await createClient();
  const meta = await lerMeta(db, id);
  if (!meta) notFound();
  if (!podeEditarMeta(session, meta) || meta.status === "finished" || meta.status === "cancelled") {
    redirect(`/metas/${id}`);
  }
  const [opcoes, dados] = await Promise.all([opcoesDoAssistente(db, session), dadosParaEditar(db, meta)]);
  // A unidade de uma meta antiga pode ter saído da lista (desativada): mantém
  // o nome dela para o assistente não mostrar uma unidade sem nome.
  const faltam = meta.clinic_ids.filter((c) => !opcoes.unidades.some((u) => u.id === c));
  if (faltam.length) {
    const { data } = await db.from("clinics").select("id, name").in("id", faltam);
    opcoes.unidades = [...opcoes.unidades, ...((data ?? []) as { id: string; name: string }[])];
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu={`Metas · ${meta.code}`}
        icone={Target}
        titulo={`Editar: ${meta.name}`}
        descricao={
          meta.status === "draft"
            ? "Rascunho: tudo pode mudar até publicar."
            : "Meta publicada: toda alteração pede motivo e entra no histórico. Indicador, abrangência e tipo de meta não mudam."
        }
        voltar={{ href: `/metas/${id}`, rotulo: "Voltar à meta" }}
      />
      <AssistenteDaMeta
        opcoes={opcoes}
        inicial={{ id, status: meta.status, comecou: meta.status !== "draft" && meta.starts_on <= opcoes.hoje, dados }}
      />
    </div>
  );
}
