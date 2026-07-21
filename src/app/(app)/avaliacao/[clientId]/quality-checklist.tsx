"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  requestItemScheduling,
  requestQualityScheduling,
  setItemQuality,
  type QualityResolution,
  type ReplanReason,
} from "./quality-actions";

type QStatus = "aprovado" | "revisao" | "reprovado";

export type QualityItem = {
  id: string;
  description: string;
  status: QStatus | null;
  note: string | null;
  executorId: string | null;
  resolution: string | null;
  assignedId: string | null;
  suggestedExecutorId: string | null;
  /** Estado das sessões: só "done" (finalizado) pode ser avaliado. */
  procState: "open" | "scheduled" | "done";
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const RESOLUTIONS: { value: QualityResolution; label: string }[] = [
  { value: "redo_same", label: "O mesmo dentista refaz o procedimento" },
  { value: "redo_other", label: "Indicar outro dentista para refazer" },
  { value: "replan", label: "Incluir no próximo plano (trocar procedimento)" },
];

export function QualityChecklist({
  clientId,
  planId,
  planTitle,
  items,
  locked,
  dentists,
}: {
  clientId: string;
  planId: string;
  planTitle: string;
  items: QualityItem[];
  locked: boolean;
  dentists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reviseItem, setReviseItem] = useState<string | null>(null);
  const [reproveItem, setReproveItem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [executorId, setExecutorId] = useState("");
  const [resolution, setResolution] = useState<QualityResolution>("redo_same");
  const [assignedId, setAssignedId] = useState("");
  const [replanReason, setReplanReason] = useState<ReplanReason | "">("");

  const dentistName = (id: string | null) =>
    id ? (dentists.find((d) => d.id === id)?.name ?? "—") : "—";

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk: () => void,
    okMsg: string
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        onOk();
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function approve(item: QualityItem) {
    run(
      () => setItemQuality(clientId, { itemId: item.id, status: "aprovado" }),
      () => {},
      "Procedimento aprovado."
    );
  }

  function scheduleItem(itemId: string) {
    run(
      () => requestItemScheduling(clientId, itemId),
      () => {},
      "Recepção avisada para agendar."
    );
  }

  function openRevise(item: QualityItem) {
    setReproveItem(null);
    setReviseItem(item.id);
    setNote(item.note ?? "");
    setExecutorId(item.executorId ?? item.suggestedExecutorId ?? "");
  }

  function openReprove(item: QualityItem) {
    setReviseItem(null);
    setNote(item.note ?? "");
    setExecutorId(item.executorId ?? item.suggestedExecutorId ?? "");
    setResolution((item.resolution as QualityResolution) ?? "redo_same");
    setAssignedId(item.assignedId ?? "");
    setReplanReason("");
    setReproveItem(item.id);
  }

  function confirmRevise(itemId: string) {
    run(
      () =>
        setItemQuality(clientId, {
          itemId,
          status: "revisao",
          note,
          executorId: executorId || null,
        }),
      () => setReviseItem(null),
      "Revisão solicitada. O dentista foi avisado."
    );
  }

  function confirmReprove(itemId: string) {
    run(
      () =>
        setItemQuality(clientId, {
          itemId,
          status: "reprovado",
          note,
          executorId: executorId || null,
          resolution,
          assignedId: resolution === "redo_other" ? assignedId || null : null,
          replanReason: resolution === "replan" ? (replanReason || null) : null,
        }),
      () => setReproveItem(null),
      "Reprovação registrada."
    );
  }

  const approvedCount = items.filter((i) => i.status === "aprovado").length;
  const pending = items.filter(
    (i) => i.status === "revisao" || i.status === "reprovado"
  ).length;
  // Refação = revisão ou reprovado-refazer → move o cliente para a Fase 5.
  const redoCount = items.filter(
    (i) =>
      i.status === "revisao" ||
      (i.status === "reprovado" &&
        (i.resolution === "redo_same" || i.resolution === "redo_other"))
  ).length;

  const btn =
    "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Controle de qualidade — {planTitle}</p>
        <span className="text-xs text-muted-foreground">
          {approvedCount}/{items.length} aprovados
        </span>
      </div>

      {locked && (
        <p className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
          <Lock className="size-3.5" />
          Plano 100% aprovado — controle de qualidade concluído. Não pede mais revisão.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-sm">
                {item.status === "aprovado" && (
                  <CheckCircle2 className="mr-1 inline size-3.5 text-emerald-600" />
                )}
                {item.description}
              </span>
              {!locked && item.procState === "done" && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => approve(item)}
                    className={cn(
                      btn,
                      item.status === "aprovado"
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "hover:bg-muted"
                    )}
                  >
                    Aprovado
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => openRevise(item)}
                    className={cn(
                      btn,
                      item.status === "revisao"
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "hover:bg-muted"
                    )}
                  >
                    Revisão
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => openReprove(item)}
                    className={cn(
                      btn,
                      item.status === "reprovado"
                        ? "border-rose-500 bg-rose-500 text-white"
                        : "hover:bg-muted"
                    )}
                  >
                    Reprovado
                  </button>
                </div>
              )}
              {!locked && item.procState !== "done" && (
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {item.procState === "scheduled"
                      ? "Agendado — aguardando realização"
                      : "Em aberto — ainda não realizado"}
                  </span>
                  {item.procState === "open" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => scheduleItem(item.id)}
                      className={cn(btn, "hover:bg-muted")}
                    >
                      Solicitar agendamento
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Resumo do que foi marcado (revisão/reprovado). */}
            {item.status === "revisao" && reviseItem !== item.id && (
              <p className="mt-1 text-xs text-amber-700">
                Revisão com {dentistName(item.executorId)}
                {item.note ? ` · ${item.note}` : ""}
              </p>
            )}
            {item.status === "reprovado" && reproveItem !== item.id && (
              <p className="mt-1 text-xs text-rose-700">
                Reprovado —{" "}
                {item.resolution === "redo_other"
                  ? `refazer com ${dentistName(item.assignedId)}`
                  : item.resolution === "replan"
                    ? "incluir no próximo plano"
                    : `refazer com ${dentistName(item.executorId)}`}
                {item.note ? ` · ${item.note}` : ""}
              </p>
            )}

            {/* Formulário inline de Revisão. */}
            {reviseItem === item.id && (
              <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Motivo da revisão (obrigatório) — orienta o dentista"
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs"
                />
                <label className="block text-xs text-muted-foreground">
                  Dentista que executou (revisa o procedimento):
                </label>
                <select
                  value={executorId}
                  onChange={(e) => setExecutorId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione o dentista</option>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={isPending || !note.trim() || !executorId}
                    onClick={() => confirmRevise(item.id)}
                  >
                    Solicitar revisão
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setReviseItem(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Botão de agendamento (se há revisão/reprovação). */}
      {!locked && pending > 0 && (
        <div className="space-y-1">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () => requestQualityScheduling(clientId, planId),
                () => {},
                "Recepção avisada para agendar a revisão/refação."
              )
            }
          >
            <CalendarClock className="mr-1 size-4" />
            Solicitar agendamento à recepção
          </Button>
          {redoCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {redoCount} procedimento(s) para refazer — a recepção agenda a
              revisão/refação com o profissional.
            </p>
          )}
        </div>
      )}

      {/* Popup de Reprovação. */}
      <Dialog open={reproveItem !== null} onOpenChange={(o) => !o && setReproveItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reprovar procedimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Motivo da reprovação (obrigatório)"
              className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                O que fazer com o procedimento?
              </p>
              {RESOLUTIONS.map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="resolution"
                    checked={resolution === r.value}
                    onChange={() => setResolution(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>

            {resolution !== "replan" && (
              <div>
                <label className="block text-xs text-muted-foreground">
                  Dentista que executou:
                </label>
                <select
                  value={executorId}
                  onChange={(e) => setExecutorId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione o dentista</option>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {resolution === "redo_other" && (
              <div>
                <label className="block text-xs text-muted-foreground">
                  Dentista que vai refazer:
                </label>
                <select
                  value={assignedId}
                  onChange={(e) => setAssignedId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione o dentista</option>
                  {dentists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {resolution === "replan" && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Motivo da troca:
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="replan-reason"
                    checked={replanReason === "inviabilidade"}
                    onChange={() => setReplanReason("inviabilidade")}
                  />
                  Inviabilidade clínica (não é falha do profissional)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="replan-reason"
                    checked={replanReason === "falha"}
                    onChange={() => setReplanReason("falha")}
                  />
                  Falha profissional
                </label>
                <p className="rounded-md border border-gold/40 bg-gold/5 p-2 text-xs">
                  O procedimento e os dados desta reavaliação seguirão ao Centro de
                  Planejamento quando você enviar — o Planner troca por outro.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReproveItem(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                isPending ||
                !note.trim() ||
                (resolution === "redo_other" && !assignedId) ||
                (resolution === "replan" && !replanReason)
              }
              onClick={() => reproveItem && confirmReprove(reproveItem)}
            >
              Confirmar reprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
