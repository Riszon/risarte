"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  camposDaAlteracao,
  quemFez,
  type Alteracao,
  type Autor,
} from "@/lib/auditoria-alteracoes";
import {
  CAMPOS_SEM_INTERESSE,
  situacaoLegivel,
  tituloDaLinha,
  type TipoDoHistorico,
} from "@/lib/finance/historico-do-lancamento";
import { quandoFoi } from "@/lib/finance/quem-fez";
import { loadFinanceHistory, type LinhaDoHistorico } from "./historico-actions";

/**
 * O histórico completo de UM lançamento (0372): tudo o que mudou, quem mudou
 * e quando, tirado da auditoria geral. Abre só quando a pessoa pede — ler a
 * trilha de cada linha da lista seria caro e quase nunca necessário.
 */
export function HistoricoDoLancamento({
  tipo,
  id,
  rotulo = "Histórico completo",
}: {
  tipo: TipoDoHistorico;
  id: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mt-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px] text-muted-foreground"
        onClick={() => setAberto((v) => !v)}
      >
        <History className="mr-1 size-3" />
        {aberto ? "Fechar histórico" : rotulo}
      </Button>
      {aberto && <Linhas tipo={tipo} id={id} />}
    </div>
  );
}

function Linhas({ tipo, id }: { tipo: TipoDoHistorico; id: string }) {
  const [estado, setEstado] = useState<{
    carregando: boolean;
    erro: string | null;
    linhas: LinhaDoHistorico[];
  }>({ carregando: true, erro: null, linhas: [] });

  useEffect(() => {
    let vivo = true;
    loadFinanceHistory(tipo, id).then((r) => {
      if (vivo) setEstado({ carregando: false, erro: r.ok ? null : (r.error ?? "Erro."), linhas: r.rows });
    });
    return () => {
      vivo = false;
    };
  }, [tipo, id]);

  if (estado.carregando)
    return <p className="py-2 text-xs text-muted-foreground">Carregando o histórico…</p>;
  if (estado.erro) return <p className="py-2 text-xs text-destructive">{estado.erro}</p>;
  if (estado.linhas.length === 0)
    return (
      <p className="py-2 text-xs text-muted-foreground">
        Nenhuma alteração registrada. O registro automático começou em 09/10/2026: o que
        aconteceu antes disso não aparece aqui.
      </p>
    );

  const nomes = {
    usuarios: new Map(
      estado.linhas
        .filter((l) => l.userId && l.userName)
        .map((l) => [l.userId as string, l.userName as string])
    ),
    unidades: new Map<string, string>(),
  };

  return (
    <ol className="space-y-1.5 py-1 text-xs">
      {estado.linhas.map((l) => {
        const mudancas: Record<string, unknown> = {};
        for (const [campo, v] of Object.entries(l.changes ?? {})) {
          if (CAMPOS_SEM_INTERESSE.has(campo)) continue;
          if (campo === "status") {
            mudancas[campo] =
              l.op === "U" && v && typeof v === "object" && "antes" in v && "depois" in v
                ? {
                    antes: situacaoLegivel(l.tableName, (v as { antes: unknown }).antes),
                    depois: situacaoLegivel(l.tableName, (v as { depois: unknown }).depois),
                  }
                : situacaoLegivel(l.tableName, v);
            continue;
          }
          mudancas[campo] = v;
        }
        const a: Alteracao = {
          id: l.id,
          occurred_at: l.occurredAt,
          user_id: l.userId,
          actor: l.actor as Autor,
          auth_session_id: null,
          schema_name: "public",
          table_name: l.tableName,
          op: l.op,
          row_id: null,
          row_label: null,
          clinic_id: null,
          client_id: null,
          changes: mudancas,
          tx: null,
        };
        const campos = camposDaAlteracao(a, nomes);
        return (
          <li key={l.id} className="rounded-md border px-2 py-1.5">
            <p className="text-[11px] text-muted-foreground">
              {quandoFoi(l.occurredAt)} · {quemFez({ user_id: l.userId, actor: l.actor as Autor }, nomes)}
            </p>
            <p className="font-medium">{tituloDaLinha(l.tableName, l.op, l.changes)}</p>
            {campos.length > 0 && (
              <ul className="mt-0.5 space-y-0.5 text-[11px]">
                {campos.map((c) => (
                  <li key={c.campo}>
                    <span className="text-muted-foreground">{c.rotulo}:</span>{" "}
                    {l.op === "U" ? (
                      <>
                        <span className="line-through opacity-70">{c.antes}</span> → {c.depois}
                      </>
                    ) : (
                      (c.depois ?? c.antes)
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
