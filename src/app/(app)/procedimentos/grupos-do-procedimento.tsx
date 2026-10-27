"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vincularAoGrupo } from "./grupos/actions";

export type GrupoParaVincular = {
  id: string;
  nome: string;
  ativo: boolean;
  procedureIds: string[];
};

/**
 * Os GRUPOS de um procedimento, no cartão dele (pedido do dono, 27/10/2026):
 * em quais grupos ele está e um botão rápido para pôr ou tirar, sem abrir o
 * editor do grupo. Quem entra vai para o FIM do grupo, com quantidade 1 — a
 * ordem se ajusta em Procedimentos → Grupos. Quem pode: Admin Master e
 * Planner (GP1), pela mesma porta do editor.
 */
export function GruposDoProcedimento({
  procedureId,
  procedimentoAtivo,
  grupos,
  podeVincular,
}: {
  procedureId: string;
  procedimentoAtivo: boolean;
  /** Nulo = não deu para ler os grupos (o banco sem a 0324). */
  grupos: GrupoParaVincular[] | null;
  podeVincular: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);

  if (grupos === null) return null;
  const meus = grupos.filter((g) => g.procedureIds.includes(procedureId));

  function alternar(g: GrupoParaVincular, vincular: boolean) {
    startTransition(async () => {
      const r = await vincularAoGrupo({ grupoId: g.id, procedureId, vincular });
      if (r.ok) {
        toast.success(vincular ? `Entrou no grupo "${g.nome}" (no fim da lista).` : `Saiu do grupo "${g.nome}".`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível mudar o grupo.");
      }
    });
  }

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5">
          <Layers className="size-3.5 shrink-0 text-gold-tinta" />
          <span className="font-medium">Grupos:</span>
          {meus.length === 0 ? (
            <span className="text-muted-foreground">nenhum</span>
          ) : (
            meus.map((g) => (
              <span
                key={g.id}
                className={`rounded bg-gold/15 px-1.5 py-0.5 font-medium text-gold-tinta ${g.ativo ? "" : "opacity-60 line-through"}`}
                title={g.ativo ? undefined : "Grupo inativo"}
              >
                {g.nome}
              </span>
            ))
          )}
        </p>
        {podeVincular && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => setAberto((a) => !a)}
            disabled={!procedimentoAtivo}
            title={procedimentoAtivo ? undefined : "Procedimento inativo não entra em grupo."}
          >
            {aberto ? "Fechar" : "Vincular a grupo"}
          </Button>
        )}
      </div>
      {aberto && podeVincular && (
        <div className="mt-2 space-y-1 border-t pt-2">
          {grupos.filter((g) => g.ativo || g.procedureIds.includes(procedureId)).length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum grupo ainda.{" "}
              <Link href="/procedimentos/grupos" className="underline">
                Criar em Procedimentos → Grupos
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1">
              {grupos
                .filter((g) => g.ativo || g.procedureIds.includes(procedureId))
                .map((g) => {
                  const marcado = g.procedureIds.includes(procedureId);
                  return (
                    <li key={g.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={isPending}
                          onChange={(e) => alternar(g, e.target.checked)}
                        />
                        <span>
                          {g.nome}
                          {!g.ativo && <span className="text-muted-foreground"> (inativo)</span>}
                          <span className="text-muted-foreground"> · {g.procedureIds.length} procedimentos</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground">
            Marcar põe o procedimento no <strong>fim</strong> do grupo, com quantidade 1 — a ordem
            e a quantidade se ajustam em{" "}
            <Link href="/procedimentos/grupos" className="underline">
              Procedimentos → Grupos
            </Link>
            . Desmarcar tira; um grupo precisa de pelo menos 2 procedimentos.
          </p>
        </div>
      )}
    </div>
  );
}
