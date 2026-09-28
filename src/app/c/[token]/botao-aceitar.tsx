"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aceitar } from "./actions";

export function BotaoAceitar({ token, termoVersao }: { token: string; termoVersao: string }) {
  const [marcado, setMarcado] = useState(false);
  const [feito, setFeito] = useState<boolean | null>(null);
  const [enviando, enviar] = useTransition();

  if (feito) {
    return (
      <div className="space-y-2 rounded-xl border bg-background p-5 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <p className="font-semibold">Pronto! A unidade vai falar com você pelo WhatsApp.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-background p-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} />
        <span>
          Autorizo a Risarte Odontologia a entrar em contato comigo pelo WhatsApp para agendar uma
          avaliação (termo de contato, versão {termoVersao}).
        </span>
      </label>
      {feito === false && (
        <p className="text-sm text-destructive">Este convite não está mais ativo. Peça um novo a quem te indicou.</p>
      )}
      <Button
        className="w-full"
        disabled={!marcado || enviando}
        onClick={() => enviar(async () => setFeito(await aceitar(token)))}
      >
        {enviando ? "Enviando…" : "Aceito o contato"}
      </Button>
    </div>
  );
}
