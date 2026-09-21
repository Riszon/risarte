"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { devolverAoCoordenador } from "../../jornada/actions";

/**
 * DEVOLVER AO COORDENADOR (0266) — o Planner precisa de mais dados.
 *
 * Antes isso era uma movimentação solta no kanban: o caso voltava e ninguém
 * sabia por quê, então voltava igual — e o tempo perdido aparecia no SLA como
 * lentidão do Coordenador. Agora é um ato com MOTIVO, que vira aviso para quem
 * recebe o caso de volta.
 *
 * Duas saídas, porque são situações diferentes: **faltou dado** volta para a
 * Conversão Clínica (a avaliação continua); **precisa examinar de novo** volta
 * para a Reavaliação.
 */
export function DevolverAoCoordenador({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<"clinical_conversion" | "reevaluation">(
    "clinical_conversion"
  );
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();

  function devolver() {
    startTransition(async () => {
      const r = await devolverAoCoordenador(clientId, destino, motivo);
      if (r.ok) {
        toast.success(`${clientName} devolvido(a) ao Coordenador.`);
        setAberto(false);
        setMotivo("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Undo2 className="mr-1 size-4" />
        Devolver ao Coordenador
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Devolver {clientName} ao Coordenador</DialogTitle>
          <DialogDescription>
            Use quando faltar informação para planejar. O Coordenador recebe um
            aviso com o motivo — sem ele, o caso volta igual.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <Label className="text-xs">Para onde volta</Label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="destino"
                className="mt-1 accent-primary"
                checked={destino === "clinical_conversion"}
                onChange={() => setDestino("clinical_conversion")}
              />
              <span>
                <b>Conversão Clínica</b>
                <span className="block text-xs text-muted-foreground">
                  faltou dado, foto, exame ou consideração — a avaliação continua
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="destino"
                className="mt-1 accent-primary"
                checked={destino === "reevaluation"}
                onChange={() => setDestino("reevaluation")}
              />
              <span>
                <b>Reavaliação</b>
                <span className="block text-xs text-muted-foreground">
                  o caso precisa ser examinado de novo
                </span>
              </span>
            </label>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-devolucao" className="text-xs">
              O que falta? (vai no aviso do Coordenador)
            </Label>
            <textarea
              id="motivo-devolucao"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              minLength={10}
              placeholder="Ex.: faltou a radiografia panorâmica e a foto oclusal superior."
              className="w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button disabled={isPending || motivo.trim().length < 10} onClick={devolver}>
            Devolver com o motivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
