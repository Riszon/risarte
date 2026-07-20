"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Pencil } from "lucide-react";
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

/**
 * Orientação da rede sobre Avaliação/Reavaliação — consulta rápida do
 * coordenador. O Admin Master edita; os demais só leem.
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
  const [draft, setDraft] = useState(content ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await saveClinicalGuidance(kind, draft);
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
      >
        <BookOpen className="size-3.5" />
        Orientação da rede
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Orientação sobre a {FLOW_LABELS[kind]}
            </DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                placeholder="Escreva a orientação da rede sobre este momento (o que observar, dicas, lembretes)..."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
            </div>
          ) : content?.trim() ? (
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
              {content}
            </div>
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
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setDraft(content ?? "");
                    }}
                  >
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
