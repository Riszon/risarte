"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
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
import { openPlanComplement } from "./planning-actions";

/**
 * AP64 (0355): o Coordenador Clínico abre o PLANO COMPLEMENTAR de um plano
 * vendido, com o cliente em tratamento. Ele escreve as informações clínicas;
 * o Planner monta o plano depois. Quando não pode, mostra o motivo em vez de
 * esconder o caminho.
 */
export function AbrirComplemento({
  clientId,
  abertura,
}: {
  clientId: string;
  abertura: { pode: true; baseId: string } | { pode: false; motivo: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notas, setNotas] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!abertura.pode) {
    return abertura.motivo ? (
      <p className="text-xs text-muted-foreground">{abertura.motivo}</p>
    ) : null;
  }
  const baseId = abertura.baseId;

  function abrir() {
    startTransition(async () => {
      const r = await openPlanComplement(clientId, baseId, notas);
      if (r.ok) {
        toast.success("Plano complementar aberto. Os Planners foram avisados para montar.");
        setOpen(false);
        setNotas("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível abrir o plano complementar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <FilePlus2 className="mr-1 size-3.5" />
            Abrir plano complementar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Abrir plano complementar</DialogTitle>
          <DialogDescription>
            Para acrescentar um tratamento que não foi contratado, sem tirar o
            cliente da Fase 5. O plano vendido continua valendo. O Planner monta
            o complemento, você aprova e o Consultor apresenta ao cliente.
          </DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">
            Informações clínicas: o que você viu, o que indica e por quê
          </span>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ex.: enquanto aguarda o tempo do enxerto, adiantar as restaurações do lado esquerdo."
            className="mt-1 min-h-28 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
        </label>
        <DialogFooter>
          <Button disabled={isPending || !notas.trim()} onClick={abrir}>
            Abrir e avisar o Planner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
