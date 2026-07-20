"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bold,
  BookOpen,
  Italic,
  List,
  ListOrdered,
  Pencil,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FLOW_LABELS, type EvaluationFlowKind } from "@/lib/evaluation-steps";
import { saveClinicalGuidance } from "./actions";

// Estilo dos tags gerados (listas/negrito etc.) — o reset do Tailwind zera listas.
const RICH =
  "text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:underline [&_p]:my-1 [&_b]:font-semibold [&_strong]:font-semibold";

/**
 * Orientações da rede sobre Avaliação/Reavaliação — consulta rápida do
 * coordenador. O Admin Master edita (com formatação: negrito, itálico,
 * sublinhado, listas, parágrafos); os demais só leem.
 */
export function GuidanceDialog({
  kind,
  content,
  canEdit,
}: {
  kind: EvaluationFlowKind;
  content: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const editorRef = useRef<HTMLDivElement>(null);

  function exec(command: string) {
    editorRef.current?.focus();
    // execCommand é depreciado, mas é o caminho simples e sem dependências para
    // formatação básica; funciona nos navegadores atuais.
    document.execCommand(command, false);
  }

  function save() {
    const html = editorRef.current?.innerHTML ?? "";
    // Trata um editor "vazio" (só <br>/espacos) como conteúdo em branco.
    const isEmpty = html.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/gi, "").trim() === "";
    startTransition(async () => {
      const r = await saveClinicalGuidance(kind, isEmpty ? "" : html);
      if (r.ok) {
        toast.success("Orientações salvas.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  const toolbarBtn =
    "inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
      >
        <BookOpen className="size-3.5" />
        Orientações
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Orientações — {FLOW_LABELS[kind]}</DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className={toolbarBtn} onClick={() => exec("bold")} aria-label="Negrito">
                  <Bold className="size-4" />
                </button>
                <button type="button" className={toolbarBtn} onClick={() => exec("italic")} aria-label="Itálico">
                  <Italic className="size-4" />
                </button>
                <button type="button" className={toolbarBtn} onClick={() => exec("underline")} aria-label="Sublinhado">
                  <Underline className="size-4" />
                </button>
                <span className="mx-1 h-5 w-px bg-border" />
                <button type="button" className={toolbarBtn} onClick={() => exec("insertUnorderedList")} aria-label="Lista com marcadores">
                  <List className="size-4" />
                </button>
                <button type="button" className={toolbarBtn} onClick={() => exec("insertOrderedList")} aria-label="Lista numerada">
                  <ListOrdered className="size-4" />
                </button>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: content ?? "" }}
                className={`max-h-[50vh] min-h-40 overflow-y-auto rounded-lg border border-input bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring ${RICH}`}
              />
              <p className="text-xs text-muted-foreground">
                Use os botões acima para negrito, itálico, sublinhado e listas.
              </p>
            </div>
          ) : content?.trim() ? (
            <div
              className={`max-h-[60vh] overflow-y-auto ${RICH}`}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma orientação cadastrada ainda.
              {canEdit ? " Clique em Editar para escrever." : ""}
            </p>
          )}

          <DialogFooter className="gap-2">
            {canEdit &&
              (editing ? (
                <>
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={save} disabled={isPending}>
                    {isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1 size-4" />
                  Editar
                </Button>
              ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
