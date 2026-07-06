"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { addPlanningSupplement } from "./planning-actions";

export type PlanningSupplement = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  seenAt: string | null;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * H3.11: espaço para o Coordenador enviar informações complementares ao Centro
 * de Planejamento depois de já ter enviado o caso. Notifica o Planner e
 * sinaliza "nova informação" na fila até ele abrir o cockpit.
 */
export function PlanningSupplements({
  clientId,
  canAdd,
  supplements,
}: {
  clientId: string;
  /** Coordenador Clínico (ou Admin) pode enviar. */
  canAdd: boolean;
  supplements: PlanningSupplement[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState("");

  function send() {
    startTransition(async () => {
      const result = await addPlanningSupplement(clientId, body);
      if (result.ok) {
        toast.success("Informação enviada ao Centro de Planejamento.");
        setBody("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  if (!canAdd && supplements.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="size-4 text-primary" />
          Informações complementares ao Centro de Planejamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canAdd && (
          <div className="space-y-2">
            <Label htmlFor="supplement">
              Enviar mais informações/observações ao Dentista Planner
            </Label>
            <textarea
              id="supplement"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Ex.: chegou um novo exame; o cliente relatou algo importante depois da avaliação..."
              className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Para enviar arquivos (fotos, exames), use a Avaliação clínica
              acima; escreva aqui uma nota avisando o Planner.
            </p>
            <Button
              size="sm"
              disabled={isPending || !body.trim()}
              onClick={send}
            >
              <Send className="mr-1 size-3.5" />
              Enviar ao Planejamento
            </Button>
          </div>
        )}

        {supplements.length > 0 && (
          <ul className="space-y-1.5">
            {supplements.map((s) => (
              <li key={s.id} className="rounded-md border p-2 text-sm">
                <p className="whitespace-pre-wrap">{s.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt(s.createdAt)}
                  {s.authorName ? ` · ${s.authorName}` : ""}
                  {s.seenAt ? " · visto pelo Planner" : " · aguardando o Planner"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
