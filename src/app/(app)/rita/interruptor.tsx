"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ligarDesligarRita } from "./actions";

/**
 * O botão de ligar ou desligar. Desligar pede o motivo (vai para o registro e
 * para o aviso de quem precisa saber). Ligar pede só a confirmação; o banco
 * recusa se faltar algo, e a mensagem diz o quê.
 */
export function InterruptorDaRita({
  clinicId,
  nome,
  ligada,
  podeLigar,
  podeDesligar,
}: {
  /** Nulo = a rede inteira. */
  clinicId: string | null;
  nome: string;
  ligada: boolean;
  podeLigar: boolean;
  podeDesligar: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();

  const pode = ligada ? podeDesligar : podeLigar;
  if (!pode) return null;

  function confirmar() {
    iniciar(async () => {
      const r = await ligarDesligarRita(clinicId, !ligada, motivo);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível concluir.");
        return;
      }
      toast.success(ligada ? `Rita desligada em ${nome}.` : `Rita ligada em ${nome}.`);
      setAberto(false);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant={ligada ? "outline" : "default"}
        size="sm"
        onClick={() => setAberto(true)}
      >
        {ligada ? <PowerOff className="size-4" /> : <Power className="size-4" />}
        {ligada ? "Desligar" : "Ligar"}
      </Button>
      <Dialog open={aberto} onOpenChange={(o) => !o && !pendente && setAberto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ligada ? `Desligar a Rita em ${nome}` : `Ligar a Rita em ${nome}`}</DialogTitle>
            <DialogDescription>
              {ligada
                ? "Ela para na hora. Quem precisa saber recebe o aviso no sino (você não)."
                : clinicId === null
                  ? "Ligar a rede não liga nenhuma unidade: cada uma é ligada à parte, quando estiver completa."
                  : "Só liga se nada faltar. Enquanto a Rita não tem o canal do WhatsApp, ela não fala com ninguém."}
            </DialogDescription>
          </DialogHeader>
          {ligada && (
            <div className="space-y-1">
              <Label htmlFor="rita-motivo">Motivo (obrigatório)</Label>
              <textarea
                id="rita-motivo"
                rows={3}
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent p-2 text-sm"
                placeholder="Ex.: a recepção está sem ninguém hoje"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={pendente}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={pendente || (ligada && motivo.trim().length < 3)}>
              {pendente ? "Gravando…" : ligada ? "Desligar" : "Ligar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
