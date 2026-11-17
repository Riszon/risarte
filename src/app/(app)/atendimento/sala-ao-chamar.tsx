"use client";

// VD3-4 (0424, decisão A4): ao CHAMAR um atendimento presencial sem sala (o
// encaixe do caixa, ou um agendamento antigo sem sala), quem atende escolhe a
// sala — obrigatório, numa unidade com salas cadastradas. A sala com alguém em
// atendimento agora não serve.

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chamarComSala, salasParaChamar, type SalaParaChamar } from "../agenda/actions";

export type ChamarSemSala = { appointmentId: string; clientName: string; depois: () => void };

export function SalaAoChamarDialog({
  alvo,
  onClose,
}: {
  alvo: ChamarSemSala | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {alvo && <Conteudo key={alvo.appointmentId} alvo={alvo} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({ alvo, onClose }: { alvo: ChamarSemSala; onClose: () => void }) {
  const [salas, setSalas] = useState<SalaParaChamar[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    salasParaChamar(alvo.appointmentId)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setSalas(r.salas);
        else setErro(r.error);
      })
      .catch(() => vivo && setErro("Não foi possível ler as salas."));
    return () => {
      vivo = false;
    };
  }, [alvo.appointmentId]);

  function escolher(roomId: string) {
    startTransition(async () => {
      const r = await chamarComSala(alvo.appointmentId, roomId);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível chamar.");
        return;
      }
      toast.success(`${alvo.clientName} chamado(a).`);
      onClose();
      alvo.depois();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Em qual sala?</DialogTitle>
        <DialogDescription>
          {alvo.clientName} não tem sala marcada. Escolha a sala para chamar.
        </DialogDescription>
      </DialogHeader>
      {erro ? (
        <p className="text-sm text-rose-700">{erro}</p>
      ) : !salas ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Lendo as salas…
        </p>
      ) : (
        <div className="grid gap-1.5">
          {salas.map((s) => (
            <Button
              key={s.id}
              variant={s.ocupada ? "outline" : "default"}
              className="h-10 justify-between"
              disabled={isPending || s.ocupada}
              onClick={() => escolher(s.id)}
            >
              <span>{s.name}</span>
              {s.ocupada && <span className="text-xs">em atendimento</span>}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
