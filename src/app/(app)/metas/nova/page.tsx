import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { canViewMetas, podeCriarMeta } from "@/lib/metas/access";
import { opcoesDoAssistente } from "@/lib/metas/opcoes";
import { AssistenteDaMeta } from "../assistente";

export const metadata: Metadata = { title: "Nova meta — Metas" };

export default async function NovaMetaPage() {
  const session = await getSessionContext();
  if (!canViewMetas(session) || !podeCriarMeta(session)) redirect("/metas");
  const db = await createClient();
  const opcoes = await opcoesDoAssistente(db, session);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Metas"
        icone={Target}
        titulo="Nova meta"
        descricao="Cinco passos, um para cada letra do SMART. A frase da meta é montada enquanto você preenche."
        voltar={{ href: "/metas", rotulo: "Metas" }}
      />
      <AssistenteDaMeta opcoes={opcoes} inicial={null} />
    </div>
  );
}
