"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { saveProgressNote } from "./clinical-progress-actions";

export type ProgressNoteItem = {
  id: string;
  body: string;
  authorName: string | null;
  clinicName: string | null;
  createdAt: string;
  updatedAt: string | null;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** H4.6 A2: Desenvolvimento Clínico — o dentista escreve as anotações do
 * atendimento com salvamento automático; abaixo, a linha do tempo de todas as
 * anotações (visível aos dentistas/coordenadores/planner). */
export function ClinicalProgressSection({
  clientId,
  clinicId,
  canWrite,
  notes,
}: {
  clientId: string;
  clinicId: string;
  canWrite: boolean;
  notes: ProgressNoteItem[];
}) {
  const router = useRouter();
  const [noteId, setNoteId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Refs atualizados apenas em handlers (nunca no render) para o save com debounce
  // enxergar sempre o valor mais recente do texto e do id da anotação.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef("");
  const noteIdRef = useRef<string | null>(null);

  async function doSave() {
    const id = noteIdRef.current;
    const b = bodyRef.current;
    if (!id && b.trim() === "") {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    const res = await saveProgressNote({ id, clientId, clinicId, body: b });
    if (res.ok) {
      if (res.id && !noteIdRef.current) {
        noteIdRef.current = res.id;
        setNoteId(res.id);
      }
      if (res.savedAt) setSavedAt(res.savedAt);
      // Se o usuário voltou a digitar durante o save, não sobrescreve o "idle".
      setStatus((s) => (s === "saving" ? "saved" : s));
    } else {
      setStatus("error");
    }
  }

  function onChange(value: string) {
    bodyRef.current = value;
    setBody(value);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void doSave();
    }, 1200);
  }

  function startNew() {
    if (timer.current) clearTimeout(timer.current);
    noteIdRef.current = null;
    bodyRef.current = "";
    setNoteId(null);
    setBody("");
    setSavedAt(null);
    setStatus("idle");
    // Recarrega para a anotação recém-salva aparecer na linha do tempo.
    router.refresh();
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Desenvolvimento Clínico</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="space-y-1.5">
            <textarea
              value={body}
              onChange={(e) => onChange(e.target.value)}
              rows={6}
              placeholder="Descreva o que foi feito no atendimento, observações e o que fica para a próxima sessão…"
              className="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {status === "saving" && (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> Salvando…
                  </span>
                )}
                {status === "saved" && savedAt && (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Check className="size-3" /> Salvo às {fmtTime(savedAt)}
                  </span>
                )}
                {status === "error" && (
                  <span className="text-red-600">
                    Erro ao salvar — tente novamente
                  </span>
                )}
                {status === "idle" && body.trim() !== "" && (
                  <span>Alterações não salvas…</span>
                )}
              </span>
              {noteId && (
                <Button variant="outline" size="sm" onClick={startNew}>
                  <PencilLine className="mr-1 size-3" /> Nova anotação
                </Button>
              )}
            </div>
          </div>
        )}

        {notes.length > 0 ? (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {n.authorName ?? "—"}
                  </span>
                  {n.clinicName && <span>· {n.clinicName}</span>}
                  <span>· {fmtDateTime(n.createdAt)}</span>
                  {n.updatedAt &&
                    new Date(n.updatedAt).getTime() -
                      new Date(n.createdAt).getTime() >
                      60000 && (
                      <span className="italic">
                        (editado {fmtTime(n.updatedAt)})
                      </span>
                    )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {canWrite
              ? "Nenhum desenvolvimento clínico registrado ainda. Comece a escrever acima."
              : "Nenhum desenvolvimento clínico registrado ainda."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
