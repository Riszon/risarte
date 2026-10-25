import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { canViewMetas, podeCriarMetaDaRede } from "@/lib/metas/access";
import { lerModelos } from "@/lib/metas/opcoes";
import { EditorDeModelos } from "./editor";

export const metadata: Metadata = { title: "Modelos de meta — Metas" };

/**
 * M5 (R3): os modelos do assistente, editados pelo Admin e pela Franqueadora
 * (a mesma régua de criar meta da rede). A barreira de verdade é o banco
 * (`goal_template_save`, 0322).
 */
export default async function ModelosDeMetaPage() {
  const session = await getSessionContext();
  if (!canViewMetas(session) || !podeCriarMetaDaRede(session)) redirect("/metas");
  const db = await createClient();
  const [{ modelos, doBanco }, especialidades] = await Promise.all([
    lerModelos(db, true),
    db.from("specialties").select("name").eq("is_active", true).order("sort_order").order("name").limit(500),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Metas"
        icone={Target}
        titulo="Modelos de meta"
        descricao="Os modelos aparecem no alto do passo S da Nova meta e preenchem o indicador, o recorte, o período e os textos. O alvo não vem do modelo: é sugerido pelo histórico de cada unidade."
        voltar={{ href: "/metas", rotulo: "Metas" }}
      />
      <EditorDeModelos
        modelos={modelos}
        doBanco={doBanco}
        especialidades={(especialidades.data ?? []).map((e) => e.name as string)}
      />
    </div>
  );
}
