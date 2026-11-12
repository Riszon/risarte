"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mudarAvisosDeCobranca } from "./avisos-de-cobranca-actions";

export function BotoesDosAvisos({
  clientId,
  naoRecebe,
  podeDesligar,
  podeReligar,
}: {
  clientId: string;
  naoRecebe: boolean;
  podeDesligar: boolean;
  podeReligar: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, start] = useTransition();
  const pode = naoRecebe ? podeReligar : podeDesligar;
  if (!pode) return null;

  if (!aberto) {
    return (
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAberto(true)}>
        {naoRecebe ? "Voltar a receber avisos" : "Não receber avisos"}
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await mudarAvisosDeCobranca(clientId, !naoRecebe, motivo);
          if (!r.ok) {
            toast.error(r.error ?? "Não foi possível gravar.");
            return;
          }
          toast.success(
            naoRecebe
              ? "Registrado. Os avisos voltam a valer no Asaas em até 10 minutos."
              : "Registrado. Os avisos são desligados no Asaas em até 10 minutos."
          );
          setAberto(false);
          setMotivo("");
          router.refresh();
        });
      }}
    >
      <Input
        autoFocus
        className="h-8 w-full text-xs sm:w-64"
        value={motivo}
        maxLength={300}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={naoRecebe ? "Motivo (ex.: o paciente pediu de volta)" : "Motivo (ex.: o paciente pediu por telefone)"}
        aria-label="Motivo"
      />
      <Button size="sm" className="h-8 text-xs" type="submit" disabled={pendente || motivo.trim().length < 3}>
        {pendente ? "Gravando…" : "Confirmar"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs" type="button" disabled={pendente} onClick={() => setAberto(false)}>
        Cancelar
      </Button>
    </form>
  );
}
