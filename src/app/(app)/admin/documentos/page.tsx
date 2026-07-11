import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DocumentKind } from "@/lib/documents";
import { TemplatesManager } from "./templates-manager";

export const metadata: Metadata = { title: "Modelos de Documentos" };

export default async function AdminDocumentosPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const { data } = await supabase
    .from("document_templates")
    .select("id, kind, title, body, is_active")
    .is("clinic_id", null)
    .order("kind")
    .order("title")
    .returns<
      {
        id: string;
        kind: DocumentKind;
        title: string;
        body: string;
        is_active: boolean;
      }[]
    >();

  const templates = (data ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    body: t.body,
    isActive: t.is_active,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Modelos de Documentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Modelos da rede (franqueadora) para prescrições, atestados, declarações
          e orientações. As unidades usam ao emitir documentos no prontuário.
        </p>
      </div>
      <TemplatesManager templates={templates} />
    </div>
  );
}
