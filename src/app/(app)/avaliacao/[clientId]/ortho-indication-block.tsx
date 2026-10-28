"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBrDateTime } from "@/lib/dates";
import { setOrthoIndication } from "../../prontuarios/[id]/clinical-actions";

export type OrthoIndicationState = {
  indicated: boolean;
  note: string | null;
  at: string | null;
  byName: string | null;
  /** "Avaliação 1", "Reavaliação 2"… — a rodada em que foi marcada. */
  roundLabel: string | null;
  /** A rodada já teve o diagnóstico finalizado: não muda mais. */
  locked: boolean;
};

/**
 * ORTO7 (R3): "Indicar ortodontia" — o Coordenador sugere, na avaliação ou na
 * reavaliação, que o paciente precisa de tratamento ortodôntico. O Planner vê
 * a indicação no cockpit dele e decide no plano. Quem aprova é o Coordenador,
 * junto com a opção do plano — nada muda nesse caminho.
 */
export function OrthoIndicationBlock({
  clientId,
  current,
}: {
  clientId: string;
  current: OrthoIndicationState;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [indicated, setIndicated] = useState(current.indicated);
  const [note, setNote] = useState(current.note ?? "");
  const dirty = indicated !== current.indicated || (indicated && note.trim() !== (current.note ?? "").trim());

  function save() {
    startTransition(async () => {
      const r = await setOrthoIndication(clientId, indicated, note);
      if (r.ok) {
        toast.success(indicated ? "Indicação de ortodontia registrada." : "Indicação de ortodontia desfeita.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <SmilePlus className="size-4 text-gold-foreground" />
        Ortodontia — indicar o tratamento?
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        A sua indicação é uma SUGESTÃO para o Dentista Planner, que define as características do caso no plano
        (tipo de aparelho, meses previstos, contenção). Você aprova depois, junto com a opção do plano.
      </p>
      {current.indicated && (
        <p className="mb-2 rounded-md border border-gold/60 bg-gold/10 px-2 py-1 text-xs">
          Indicada{current.roundLabel ? ` na ${current.roundLabel}` : ""}
          {current.at ? ` em ${formatBrDateTime(current.at)}` : ""}
          {current.byName ? ` por ${current.byName}` : ""}.
        </p>
      )}
      {current.locked ? (
        <p className="text-xs text-muted-foreground">
          O diagnóstico desta rodada já foi finalizado: a indicação não muda mais. Numa nova rodada você indica de novo.
        </p>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={indicated}
              onChange={(e) => setIndicated(e.target.checked)}
              disabled={isPending}
            />
            Indicar tratamento ortodôntico para este paciente
          </label>
          {indicated && (
            <div className="space-y-1">
              <Label htmlFor="ortho-indication-note" className="text-xs">
                Por quê / o que você observou (opcional)
              </Label>
              <Input
                id="ortho-indication-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: apinhamento inferior, mordida cruzada do lado direito"
                disabled={isPending}
              />
            </div>
          )}
          <Button size="sm" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Salvando…" : "Salvar indicação"}
          </Button>
        </div>
      )}
    </div>
  );
}
