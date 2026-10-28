"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SmilePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { PlanOptionOrtho } from "@/lib/planning";
import {
  ORTHO_KINDS,
  ORTHO_KIND_LABELS,
  ORTHO_RETAINER_KINDS,
  ORTHO_RETAINER_KIND_LABELS,
  type OrthoKind,
  type OrthoRetainerKind,
} from "@/lib/ortodontia/constants";
import { removePlanOptionOrtho, savePlanOptionOrtho } from "./planning-actions";

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * ORTO7 (R3/R5): a PROPOSTA ORTODÔNTICA da opção do plano. O Planner define
 * as características do caso (tipo de aparelho, meses previstos — uma
 * referência —, intervalo das manutenções, contenção final); o Coordenador
 * aprova junto com a opção; o Comercial fecha preço, contenção cobrada ou não,
 * descontos e forma (ORTO8). Aparece para todos que veem a opção; edita só o
 * Planner com o plano em rascunho/devolvido.
 */
export function OrthoProposalBlock({
  optionId,
  ortho,
  canEdit,
  suggested,
}: {
  optionId: string;
  ortho: PlanOptionOrtho | null;
  /** O Planner, com o plano ainda editável. */
  canEdit: boolean;
  /** A opção tem procedimento de Ortodontia: a proposta é esperada. */
  suggested: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<OrthoKind>(ortho?.treatmentKind ?? "aparelho_fixo");
  const [months, setMonths] = useState<number>(ortho?.plannedMonths ?? 24);
  const [interval, setInterval] = useState<number>(ortho?.maintenanceIntervalDays ?? 30);
  const [retainer, setRetainer] = useState<OrthoRetainerKind>(ortho?.retainerKind ?? "a_definir");
  const [notes, setNotes] = useState(ortho?.notes ?? "");

  if (!ortho && !canEdit) return null;
  if (!ortho && canEdit && !suggested && !editing) {
    return (
      <div className="mt-2">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
          <SmilePlus className="mr-1 size-3.5" /> Adicionar proposta ortodôntica
        </Button>
      </div>
    );
  }

  function save() {
    startTransition(async () => {
      const r = await savePlanOptionOrtho(optionId, {
        treatmentKind: kind,
        plannedMonths: months,
        maintenanceIntervalDays: interval,
        retainerKind: retainer,
        notes,
      });
      if (r.ok) {
        toast.success("Proposta ortodôntica salva.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  const showEditor = canEdit && (editing || !ortho);

  return (
    <div className="mt-2 rounded-lg border border-gold/50 bg-gold/5 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <SmilePlus className="size-4 text-gold-foreground" /> Proposta ortodôntica
        </p>
        {canEdit && ortho && !editing && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={isPending}>
                  <X className="mr-1 size-3.5" /> Remover
                </Button>
              }
              title="Remover a proposta ortodôntica desta opção?"
              description="A opção continua; só as características do caso ortodôntico saem."
              confirmLabel="Remover"
              successMessage="Proposta ortodôntica removida."
              destructive
              onConfirm={async () => {
                const r = await removePlanOptionOrtho(optionId);
                if (r.ok) router.refresh();
                return r;
              }}
            />
          </div>
        )}
      </div>
      {!showEditor && ortho && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Aparelho: <strong>{ORTHO_KIND_LABELS[ortho.treatmentKind]}</strong>
          </span>
          <span>
            Previsão: <strong>{ortho.plannedMonths} meses</strong> (referência)
          </span>
          <span>
            Manutenções a cada <strong>{ortho.maintenanceIntervalDays} dias</strong>
          </span>
          <span>
            Contenção final: <strong>{ORTHO_RETAINER_KIND_LABELS[ortho.retainerKind]}</strong>
          </span>
          {ortho.notes && <span className="basis-full whitespace-pre-wrap text-muted-foreground">{ortho.notes}</span>}
        </div>
      )}
      {showEditor && (
        <div className="mt-2 space-y-2">
          {suggested && !ortho && (
            <p className="text-muted-foreground">
              Esta opção tem procedimento de Ortodontia: defina as características do caso. O Coordenador aprova
              junto com a opção; o Comercial fecha o acordo (mensalidade, contenção cobrada ou não, forma).
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`ortho-kind-${optionId}`}>Tipo de aparelho</Label>
              <select id={`ortho-kind-${optionId}`} className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as OrthoKind)} disabled={isPending}>
                {ORTHO_KINDS.map((k) => (
                  <option key={k} value={k}>{ORTHO_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ortho-retainer-${optionId}`}>Contenção final</Label>
              <select id={`ortho-retainer-${optionId}`} className={selectClass} value={retainer} onChange={(e) => setRetainer(e.target.value as OrthoRetainerKind)} disabled={isPending}>
                {ORTHO_RETAINER_KINDS.map((k) => (
                  <option key={k} value={k}>{ORTHO_RETAINER_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ortho-months-${optionId}`}>Meses previstos (referência)</Label>
              <Input id={`ortho-months-${optionId}`} type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={isPending} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ortho-interval-${optionId}`}>Manutenção a cada (dias)</Label>
              <Input id={`ortho-interval-${optionId}`} type="number" min={7} max={180} value={interval} onChange={(e) => setInterval(Number(e.target.value))} disabled={isPending} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`ortho-notes-${optionId}`}>Observações (opcional)</Label>
              <Input id={`ortho-notes-${optionId}`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: extração dos 4 pré-molares antes da instalação" disabled={isPending} />
            </div>
          </div>
          <p className="text-muted-foreground">
            O prazo é uma referência para o paciente, não um compromisso de data — o termo diz isso.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar proposta"}
            </Button>
            {ortho && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={isPending}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
