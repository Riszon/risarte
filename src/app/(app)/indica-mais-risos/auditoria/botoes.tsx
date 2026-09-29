"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rodarConferencia, tratarAlerta } from "./actions";

export function RodarConferencia() {
  const router = useRouter();
  const [rodando, rodar] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={rodando}
      onClick={() =>
        rodar(async () => {
          const r = await rodarConferencia();
          if (r.ok) {
            toast.success(r.mensagem ?? "Conferência feita.");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {rodando ? "Conferindo…" : "Rodar conferência agora"}
    </Button>
  );
}

export function DecidirAlerta({ id, status, bloqueia }: { id: string; status: string; bloqueia: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [gravando, gravar] = useTransition();
  const fazer = (novo: "em_analise" | "procedente" | "improcedente") =>
    gravar(async () => {
      const r = await tratarAlerta(id, novo, motivo);
      if (r.ok) {
        toast.success(novo === "em_analise" ? "Alerta em análise." : "Alerta decidido.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "aberto" && (
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => fazer("em_analise")}>
          Em análise
        </Button>
      )}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogTrigger render={<Button size="sm" className="h-7 text-xs">Decidir</Button>} />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decidir o alerta</DialogTitle>
            <DialogDescription>
              Procedente = a suspeita se confirmou (tome a providência: ajuste, suspender o Embaixador).
              Improcedente = estava tudo certo.
              {bloqueia ? " Enquanto este alerta estiver aberto, os resgates do Embaixador ficam segurados." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`motivo-${id}`}>O que foi apurado *</Label>
              <Input id={`motivo-${id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={gravando} onClick={() => fazer("improcedente")}>Improcedente</Button>
              <Button disabled={gravando} onClick={() => fazer("procedente")}>Procedente</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
