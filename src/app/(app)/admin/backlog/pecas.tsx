"use client";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COR_DA_PRIORIDADE,
  COR_DA_SITUACAO,
  PRIORIDADE_ROTULO,
  SITUACAO_ROTULO,
  type Prioridade,
  type SituacaoDoItem,
} from "@/lib/backlog";

/** Peças comuns da lista e do detalhe do backlog. */

export function SeloDePrioridade({ prioridade }: { prioridade: Prioridade }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        COR_DA_PRIORIDADE[prioridade]
      )}
    >
      {PRIORIDADE_ROTULO[prioridade]}
    </span>
  );
}

export function SeloDeSituacao({ situacao }: { situacao: SituacaoDoItem }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        COR_DA_SITUACAO[situacao]
      )}
    >
      {SITUACAO_ROTULO[situacao]}
    </span>
  );
}

export function Escolha({
  rotulo,
  itens,
  valor,
  aoMudar,
  className,
  name,
}: {
  rotulo: string;
  itens: { value: string; label: string }[];
  valor: string;
  aoMudar: (v: string) => void;
  className?: string;
  /** Com `name`, o valor também vai no formulário (campo escondido). */
  name?: string;
}) {
  return (
    <>
      <Select items={itens} value={valor} onValueChange={(v) => aoMudar(v ?? itens[0]?.value ?? "")}>
        <SelectTrigger aria-label={rotulo} className={cn("h-9 min-w-36", className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {itens.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {name && <input type="hidden" name={name} value={valor} />}
    </>
  );
}
