"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RICH_TEXT_CLASS } from "@/components/rich-text-editor";
import { FLOW_LABELS, type EvaluationFlowKind } from "@/lib/evaluation-steps";

/**
 * Orientações da rede sobre Avaliação/Reavaliação — consulta rápida do
 * coordenador (somente leitura). A edição fica na tela do Admin
 * (/admin/orientacoes).
 */
export function GuidanceDialog({
  kind,
  content,
}: {
  kind: EvaluationFlowKind;
  content: string | null;
}) {
  const [open, setOpen] = useState(false);

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
          {content?.trim() ? (
            <div
              className={`max-h-[60vh] overflow-y-auto ${RICH_TEXT_CLASS}`}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma orientação cadastrada ainda.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
