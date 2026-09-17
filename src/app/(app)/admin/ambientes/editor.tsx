"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AmbienteConfigurado } from "@/lib/ambientes-db";
import { salvarEnderecoDoAmbiente } from "./actions";

export function EditorDeAmbientes({
  ambientes,
}: {
  ambientes: AmbienteConfigurado[];
}) {
  return (
    <div className="space-y-3">
      {ambientes.map((a) => (
        <Linha key={a.key} ambiente={a} />
      ))}
    </div>
  );
}

function Linha({ ambiente }: { ambiente: AmbienteConfigurado }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState(ambiente.url ?? "");
  const mudou = url.trim() !== (ambiente.url ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await salvarEnderecoDoAmbiente(ambiente.key, url);
          if (r.ok) {
            toast.success(
              url.trim()
                ? `Endereço do ${ambiente.label} salvo.`
                : `${ambiente.label} ficou sem endereço — o atalho some do Início.`
            );
            router.refresh();
          } else {
            toast.error(r.error ?? "Algo deu errado.");
          }
        });
      }}
      className="space-y-2 rounded-xl border bg-card p-4"
    >
      <div>
        <p className="text-sm font-semibold">{ambiente.label}</p>
        {ambiente.descricao && (
          <p className="text-xs text-muted-foreground">{ambiente.descricao}</p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor={`url-${ambiente.key}`} className="text-xs">
            Endereço
          </Label>
          <Input
            id={`url-${ambiente.key}`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (vazio = sem atalho no Início)"
            inputMode="url"
          />
        </div>
        <Button type="submit" variant="outline" disabled={isPending || !mudou}>
          Salvar
        </Button>
      </div>
      {ambiente.key === "sistema" && (
        <p className="text-xs text-muted-foreground">
          Este é o endereço do sistema real. Serve para o atalho de VOLTA que
          aparece no Início de dentro do treino — aqui na produção ele não é
          mostrado (ninguém precisa de atalho para onde já está).
        </p>
      )}
    </form>
  );
}
