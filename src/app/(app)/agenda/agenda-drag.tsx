"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgendaAppointment } from "./week-grid";

/** Onde um card soltou: coluna (dia ou sala), rótulo e horário encaixado. */
export type DropTarget = {
  colKey: string;
  colLabel: string;
  dateIso: string;
  time: string;
};

/**
 * Verdadeiro se a data/hora local já passou. Fica no nível do módulo (fora do
 * render) porque lê o relógio (`Date.now`) — assim não viola a regra de pureza.
 */
export function isSlotInPast(dateIso: string, time: string): boolean {
  return new Date(`${dateIso}T${time}:00`).getTime() < Date.now();
}

/**
 * Arrastar-para-remarcar (H4.14) baseado em ponteiro — funciona com mouse E
 * toque, e é mais suave que o drag nativo. Um clique curto continua funcionando
 * (só vira "arrastar" depois de mover ~5px), então abrir a ficha / editar / ver
 * informações segue normal. O card segue o cursor e o alvo (dia/sala + horário)
 * aparece durante o arrasto. Quem usa o hook decide o que fazer ao soltar
 * (aqui: abrir a confirmação antes de gravar).
 */
export function useCardDrag(opts: {
  resolve: (clientX: number, clientY: number) => DropTarget | null;
  onDrop: (appt: AgendaAppointment, target: DropTarget) => void;
}) {
  const resolveRef = useRef(opts.resolve);
  const onDropRef = useRef(opts.onDrop);
  useEffect(() => {
    resolveRef.current = opts.resolve;
    onDropRef.current = opts.onDrop;
  });

  const [dragAppt, setDragAppt] = useState<AgendaAppointment | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  const startRef = useRef<{
    x: number;
    y: number;
    appt: AgendaAppointment;
  } | null>(null);
  const draggingRef = useRef(false);
  const targetRef = useRef<DropTarget | null>(null);

  useEffect(() => {
    function move(e: PointerEvent) {
      const st = startRef.current;
      if (!st) return;
      if (!draggingRef.current) {
        // Só considera "arrasto" depois de um movimento mínimo (preserva o clique).
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5) return;
        draggingRef.current = true;
        setDragAppt(st.appt);
        document.body.style.userSelect = "none";
      }
      e.preventDefault();
      setPointer({ x: e.clientX, y: e.clientY });
      const t = resolveRef.current(e.clientX, e.clientY);
      targetRef.current = t;
      setTarget(t);
    }
    function finish() {
      const wasDragging = draggingRef.current;
      const st = startRef.current;
      const t = targetRef.current;
      startRef.current = null;
      draggingRef.current = false;
      targetRef.current = null;
      document.body.style.userSelect = "";
      setDragAppt(null);
      setPointer(null);
      setTarget(null);
      if (wasDragging) {
        // Engole o clique que o navegador dispara ao soltar, para não navegar
        // pela ficha nem abrir o "agendar rápido" ao terminar um arrasto.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener("click", swallow, true);
        };
        window.addEventListener("click", swallow, true);
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        if (st && t) onDropRef.current(st.appt, t);
      }
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);

  const startDrag = useCallback(
    (appt: AgendaAppointment, e: React.PointerEvent) => {
      // Só o botão principal do mouse; toque/caneta sempre.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY, appt };
      draggingRef.current = false;
    },
    []
  );

  return {
    dragging: dragAppt !== null,
    dragAppt,
    pointer,
    target,
    startDrag,
  };
}

/** Prévia flutuante do card que acompanha o cursor durante o arrasto. */
export function DragPreview({
  appt,
  pointer,
}: {
  appt: AgendaAppointment | null;
  pointer: { x: number; y: number } | null;
}) {
  if (!appt || !pointer || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[100] max-w-[190px] -translate-y-1/2 translate-x-3 rounded-md border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-lg"
      style={{ left: pointer.x, top: pointer.y }}
    >
      <span className="flex items-center gap-1">
        <CalendarClock className="size-3 shrink-0" />
        <span className="truncate">
          {appt.clients?.full_name ?? "Agendamento"}
        </span>
      </span>
    </div>,
    document.body
  );
}

/** Confirmação rápida (decisão do dono) antes de gravar a remarcação. */
export function RescheduleConfirmDialog({
  data,
  error,
  pending,
  onConfirm,
  onCancel,
}: {
  data: {
    clientName: string;
    fromLabel: string;
    toLabel: string;
    isPast: boolean;
  } | null;
  error: string | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={data !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {data && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remarcar agendamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Mover <span className="font-medium">{data.clientName}</span>:
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
              <span className="text-muted-foreground">{data.fromLabel}</span>
              <MoveRight className="size-4 shrink-0 text-primary" />
              <span className="font-medium text-foreground">{data.toLabel}</span>
            </div>
            {data.isPast && (
              <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
                Esse horário já passou — escolha um horário futuro.
              </p>
            )}
            {error && (
              <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirm} disabled={pending || data.isPast}>
              {pending ? "Remarcando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
