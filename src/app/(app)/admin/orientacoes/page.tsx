import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GuidanceEditor } from "./guidance-editor";

export const metadata: Metadata = { title: "Orientações" };

/**
 * Tela do Admin para escrever as orientações que guiam cada função. Começa pelo
 * Coordenador Clínico (Avaliação/Reavaliação); outras funções entram depois.
 * O texto aparece para o coordenador no cockpit (botão "Orientações").
 */
export default async function OrientacoesPage() {
  await requireAdminMaster();

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("clinical_guidance")
    .select("kind, content")
    .returns<{ kind: string; content: string | null }[]>();
  const byKind = new Map((rows ?? []).map((r) => [r.kind, r.content]));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Orientações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escreva as orientações que guiam cada função. Elas aparecem para o
          usuário na tela de trabalho dele. O texto aceita formatação (negrito,
          itálico, sublinhado, listas).
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Coordenador Clínico
        </h2>
        <GuidanceEditor
          kind="avaliacao"
          label="Orientações da Avaliação (Fase 2)"
          content={byKind.get("avaliacao") ?? null}
        />
        <GuidanceEditor
          kind="reavaliacao"
          label="Orientações da Reavaliação (Fase 6)"
          content={byKind.get("reavaliacao") ?? null}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Em breve: orientações para outras funções (recepção, comercial, dentista
        executor).
      </p>
    </div>
  );
}
