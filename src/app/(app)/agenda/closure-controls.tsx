"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { StaffOption } from "@/lib/appointments";
import type { AgendaClosure } from "@/lib/closures";
import { CloseAgendaDialog } from "./close-agenda-dialog";
import { deleteAgendaClosure } from "./actions";

/** Edit + remove (with confirmation) controls for a single agenda closure (GR3). */
export function ClosureControls({
  closure,
  clinicId,
  rooms,
  staff,
}: {
  closure: AgendaClosure;
  clinicId: string;
  rooms: { id: string; name: string }[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteAgendaClosure(closure.id);
      if (result.ok) {
        toast.success("Fechamento removido. Período reaberto para agendamento.");
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <CloseAgendaDialog
        clinicId={clinicId}
        rooms={rooms}
        staff={staff}
        closure={closure}
        trigger={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-0.5 px-1.5 text-[11px]"
          >
            <Pencil className="size-3" />
            Editar
          </Button>
        }
      />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-0.5 border-red-300 px-1.5 text-[11px] text-red-700"
            >
              <X className="size-3" />
              Remover
            </Button>
          }
        />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reabrir este período?</DialogTitle>
            <DialogDescription>
              Remover o fechamento reabre o período para novos agendamentos. Tem
              certeza?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={remove} disabled={isPending}>
              {isPending ? "Removendo..." : "Sim, remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
