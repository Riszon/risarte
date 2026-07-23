"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mic, Save, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveCommercialPresentation } from "./actions";

export type PresentationData = {
  meetLink: string | null;
  recordingUrl: string | null;
  summary: string | null;
  notes: string | null;
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * COM2 — mesa de apresentação do Consultor: videochamada, gravação (início ao
 * fim, via gravação do Meet — manual-primeiro: colar o link), RESUMO (vai no
 * contrato do cliente no fechamento) e considerações.
 */
export function PresentationWorkspace({
  clientId,
  data,
  canEdit,
}: {
  clientId: string;
  data: PresentationData | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [meetLink, setMeetLink] = useState(data?.meetLink ?? "");
  const [recordingUrl, setRecordingUrl] = useState(data?.recordingUrl ?? "");
  const [summary, setSummary] = useState(data?.summary ?? "");
  const [notes, setNotes] = useState(data?.notes ?? "");

  function save() {
    startTransition(async () => {
      const r = await saveCommercialPresentation(clientId, {
        meetLink,
        recordingUrl,
        summary,
        notes,
      });
      if (r.ok) {
        toast.success("Apresentação salva.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Video className="size-4" />
          Apresentação
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Grave a apresentação <strong>do início ao fim</strong> pelo Meet e cole
          o link da gravação aqui. O resumo entra no documento que o cliente
          assina no fechamento.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              Link da videochamada (Google Meet)
            </span>
            <div className="flex gap-2">
              <input
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                disabled={!canEdit}
                placeholder="https://meet.google.com/..."
                className={inputClass}
              />
              {meetLink.trim() && (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href={meetLink.trim()}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Abrir
                </Button>
              )}
            </div>
          </label>
          <label className="block text-sm">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mic className="size-3" /> Link da gravação (início ao fim)
            </span>
            <div className="flex gap-2">
              <input
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="link da gravação do Meet/Drive"
                className={inputClass}
              />
              {recordingUrl.trim() && (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href={recordingUrl.trim()}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Abrir
                </Button>
              )}
            </div>
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            Resumo da apresentação (será inserido no contrato)
          </span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={!canEdit}
            placeholder="O que foi apresentado, o que o cliente entendeu e aceitou, condições combinadas..."
            className="mt-1 min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">
            Considerações do Consultor sobre a apresentação
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit}
            placeholder="Percepções, objeções, próximos passos..."
            className="mt-1 min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        </label>

        {canEdit && (
          <Button size="sm" disabled={isPending} onClick={save}>
            <Save className="mr-1 size-3.5" />
            {isPending ? "Salvando..." : "Salvar apresentação"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
