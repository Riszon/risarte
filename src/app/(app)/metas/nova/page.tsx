import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { canViewMetas, podeCriarMeta, podeEditarMeta } from "@/lib/metas/access";
import { lerMeta } from "@/lib/metas/dados";
import { dadosParaEditar, opcoesDoAssistente } from "@/lib/metas/opcoes";
import { AssistenteDaMeta } from "../assistente";

export const metadata: Metadata = { title: "Nova meta — Metas" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NovaMetaPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const session = await getSessionContext();
  if (!canViewMetas(session) || !podeCriarMeta(session)) redirect("/metas");
  const db = await createClient();
  const { de } = await searchParams;
  // M5 (Duplicar): só quem pode criar uma meta igual (mesma abrangência).
  const original = de && UUID.test(de) ? await lerMeta(db, de) : null;
  const podeCopiar = original && podeEditarMeta(session, original) && original.status !== "draft";
  const [opcoes, copia] = await Promise.all([
    opcoesDoAssistente(db, session),
    podeCopiar ? dadosParaEditar(db, original) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Metas"
        icone={Target}
        titulo={copia && original ? `Duplicar: ${original.name}` : "Nova meta"}
        descricao={
          copia
            ? "Um rascunho igual à meta original, com o período seguinte. Revise o alvo: ao lado dele aparece a sugestão pelo histórico mais recente."
            : "Cinco passos, um para cada letra do SMART. A frase da meta é montada enquanto você preenche."
        }
        voltar={copia && original ? { href: `/metas/${original.id}`, rotulo: "Voltar à meta" } : { href: "/metas", rotulo: "Metas" }}
      />
      <AssistenteDaMeta opcoes={opcoes} inicial={null} copia={copia} />
    </div>
  );
}
