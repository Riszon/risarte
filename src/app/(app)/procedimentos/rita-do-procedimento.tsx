"use client";

// "Assistente virtual" no cartão do procedimento (0369 — Rita, 0A.5): o que
// a Rita pode oferecer, com que papel e com que nome para o paciente. Só o
// Admin Master edita (decisão 39). A Rita nunca informa preço de tratamento.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAPEIS_DA_RITA,
  ROTULO_DO_PAPEL,
  resumoDaRita,
  type PapelDaRita,
  type RitaDoProcedimento as Rita,
  podeEntrarNoRol,
  RECUSA_DA_URGENCIA_NO_ROL,
} from "@/lib/rita-procedimento";
import { salvarRitaDoProcedimento } from "./rita-actions";

export function RitaDoProcedimento({
  procedureId,
  rita,
  podeEditar,
}: {
  procedureId: string;
  rita: Rita;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState({
    canOffer: rita.canOffer,
    role: rita.role,
    patientName: rita.patientName ?? "",
  });

  function salvar() {
    start(async () => {
      const r = await salvarRitaDoProcedimento(procedureId, v);
      if (r.ok) {
        toast.success("Assistente virtual: salvo.");
        setAberto(false);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Assistente virtual:</span>
        <span>{resumoDaRita(rita)}</span>
        {podeEditar && !aberto && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAberto(true)}>
            Alterar
          </Button>
        )}
      </div>
      {aberto && (
        <div className="mt-2 space-y-2">
          {podeEntrarNoRol(v.role) ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.canOffer} onChange={(e) => setV((x) => ({ ...x, canOffer: e.target.checked }))} />
              A assistente virtual pode oferecer este procedimento
            </label>
          ) : (
            <p className="text-sm">{RECUSA_DA_URGENCIA_NO_ROL}</p>
          )}
          <div>
            <Label htmlFor={`rita-papel-${procedureId}`}>Papel</Label>
            <select
              id={`rita-papel-${procedureId}`}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={v.role ?? ""}
              onChange={(e) => {
                const role = (e.target.value || null) as PapelDaRita | null;
                // AP132: ao virar urgência, sai do rol.
                setV((x) => ({ ...x, role, canOffer: podeEntrarNoRol(role) ? x.canOffer : false }));
              }}
            >
              <option value="">Nenhum (procedimento comum)</option>
              {PAPEIS_DA_RITA.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_DO_PAPEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`rita-nome-${procedureId}`}>Nome para o paciente</Label>
            <Input
              id={`rita-nome-${procedureId}`}
              value={v.patientName}
              placeholder="vazio = o nome do catálogo"
              onChange={(e) => setV((x) => ({ ...x, patientName: e.target.value }))}
            />
          </div>
          <p className="text-muted-foreground">
            A assistente só informa o valor da avaliação e da consulta — nunca o
            de tratamento.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={salvar}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
