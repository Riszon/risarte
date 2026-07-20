"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  RichTextEditor,
  RICH_TEXT_CLASS,
  type RichTextEditorHandle,
} from "@/components/rich-text-editor";
import { saveClinicalGuidance } from "./actions";

/** Editor de uma orientação (por tipo) na tela do admin. */
export function GuidanceEditor({
  kind,
  label,
  content,
}: {
  kind: "avaliacao" | "reavaliacao";
  label: string;
  content: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const editorRef = useRef<RichTextEditorHandle>(null);

  function save() {
    const html = editorRef.current?.getHTML() ?? "";
    const isEmpty =
      html.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/gi, "").trim() === "";
    startTransition(async () => {
      const r = await saveClinicalGuidance(kind, isEmpty ? "" : html);
      if (r.ok) {
        toast.success("Orientação salva.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <RichTextEditor
            ref={editorRef}
            initialHtml={content ?? ""}
            placeholder="Escreva a orientação para os coordenadores clínicos..."
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : content?.trim() ? (
        <div
          className={RICH_TEXT_CLASS}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma orientação cadastrada. Clique em Editar para escrever.
        </p>
      )}
    </div>
  );
}
