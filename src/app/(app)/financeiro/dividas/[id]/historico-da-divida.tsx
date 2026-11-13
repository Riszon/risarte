"use client";

import { useEffect, useState } from "react";
import { formatBrDateTime } from "@/lib/dates";
import { camposDaAlteracao, type Alteracao, type Autor } from "@/lib/auditoria-alteracoes";
import { TABELAS } from "@/lib/auditoria-catalogo";
import {
  DEBT_TYPE_LABELS,
  MANUAL_STAGES,
  ORIGIN_SHORT,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type DebtOrigin,
  type DebtStatus,
  type DebtType,
  type Priority,
} from "@/lib/finance/dividas";
import { carregarHistorico, type LinhaDoHistorico } from "../actions";

/** Campos que não dizem nada: quem/quando já aparece na linha. */
const RUIDO = new Set([
  "updated_at", "updated_by", "created_at", "created_by", "id", "status_changed_at", "debt_id",
  "removed_by", "uploaded_by", "uploaded_at", "path", "status_changed_by",
]);

const EVENTOS: Record<string, string> = {
  criada: "Cadastrou a dívida",
  excluida: "Excluiu a dívida",
  situacao: "A situação mudou",
  situacao_automatica: "A situação mudou sozinha (o prazo passou)",
  etapa_manual: "Mudou a situação à mão",
  negativacao: "Lançou uma negativação",
  protesto: "Lançou um protesto",
  acao_judicial: "Lançou uma ação judicial",
  notificacao: "Lançou uma notificação extrajudicial",
  proposta: "Registrou uma proposta",
  proposta_recusada: "Marcou a proposta como recusada",
  proposta_expirada: "A proposta expirou",
  anexo: "Anexou um documento",
  registro_removido: "Removeu um registro lançado por engano",
};

const STAGE_LABEL = (v: unknown) =>
  typeof v === "string" && (MANUAL_STAGES as readonly string[]).includes(v) ? STATUS_LABELS[v as DebtStatus] : "pelo vencimento";

/**
 * A aba Histórico (3.8): a trilha campo a campo do banco (`audit_changes`,
 * imutável) mais os eventos de negócio (`debt_events`, só cresce), em ordem
 * cronológica — pela porta `debt_history`, que confere a permissão.
 */
export function HistoricoDaDivida({ debtId, nomesDe }: { debtId: string; nomesDe: Record<string, Map<string, string>> }) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string | null; linhas: LinhaDoHistorico[] }>({
    carregando: true,
    erro: null,
    linhas: [],
  });

  useEffect(() => {
    let vivo = true;
    carregarHistorico(debtId).then((r) => {
      if (vivo) setEstado({ carregando: false, erro: r.ok ? null : (r.error ?? "Erro."), linhas: r.linhas });
    });
    return () => {
      vivo = false;
    };
  }, [debtId]);

  if (estado.carregando) return <p className="py-4 text-sm text-muted-foreground">Carregando o histórico…</p>;
  if (estado.erro) return <p className="py-4 text-sm text-destructive">{estado.erro}</p>;
  if (estado.linhas.length === 0) return <p className="py-4 text-sm text-muted-foreground">Nada registrado ainda.</p>;

  const traduz = (campo: string, v: unknown): unknown => {
    if (v === null || v === undefined || v === "") return v;
    if (typeof v !== "string") return v;
    if (campo === "status") return STATUS_LABELS[v as DebtStatus] ?? v;
    if (campo === "manual_stage") return STAGE_LABEL(v);
    if (campo === "origin" || campo === "origin_suggested") return ORIGIN_SHORT[v as DebtOrigin] ?? v;
    if (campo === "debt_type") return DEBT_TYPE_LABELS[v as DebtType] ?? v;
    if (campo === "priority") return PRIORITY_LABELS[v as Priority] ?? v;
    const mapa = nomesDe[campo];
    return mapa?.get(v) ?? v;
  };
  const nomes = { usuarios: nomesDe.owner_user_id ?? new Map<string, string>(), unidades: nomesDe.clinic_id ?? new Map<string, string>() };

  return (
    <ol className="space-y-2 py-2 text-sm">
      {estado.linhas.map((l, i) => {
        const quando = formatBrDateTime(l.occurredAt);
        const quem = l.userName ?? (l.actor === "sistema" || l.actor === "servico" ? "Sistema" : "Usuário removido");

        if (l.source === "evento") {
          const de = l.fromStatus ? STATUS_LABELS[l.fromStatus as DebtStatus] ?? l.fromStatus : null;
          const para = l.toStatus ? STATUS_LABELS[l.toStatus as DebtStatus] ?? l.toStatus : null;
          const etapa = l.eventKind === "etapa_manual" && l.changes ? `${STAGE_LABEL(l.changes.de)} → ${STAGE_LABEL(l.changes.para)}` : null;
          return (
            <li key={`e${i}`} className="rounded-md border border-primary/20 bg-primary/5 p-2">
              <p className="text-xs text-muted-foreground">{quando} · {quem}</p>
              <p className="font-medium">{EVENTOS[l.eventKind ?? ""] ?? l.eventKind}</p>
              {(de || para) && <p className="text-xs">{de ?? "—"} → {para ?? "—"}</p>}
              {etapa && <p className="text-xs">{etapa}</p>}
              {l.note && <p className="text-xs text-muted-foreground">Motivo: {l.note}</p>}
            </li>
          );
        }

        if (l.tableName === "debt_tag_links") {
          const tag = nomesDe.tag_id?.get(String(l.changes?.tag_id ?? "")) ?? "uma etiqueta";
          return (
            <li key={`t${i}`} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{quando} · {quem}</p>
              <p>{l.op === "D" ? `Tirou a etiqueta “${tag}”` : `Pôs a etiqueta “${tag}”`}</p>
            </li>
          );
        }

        const mudancas: Record<string, unknown> = {};
        for (const [campo, v] of Object.entries(l.changes ?? {})) {
          if (RUIDO.has(campo)) continue;
          mudancas[campo] =
            l.op === "U" && v && typeof v === "object" && "antes" in v && "depois" in v
              ? { antes: traduz(campo, (v as { antes: unknown }).antes), depois: traduz(campo, (v as { depois: unknown }).depois) }
              : traduz(campo, v);
        }
        const a: Alteracao = {
          id: i,
          occurred_at: l.occurredAt,
          user_id: null,
          actor: l.actor as Autor,
          auth_session_id: null,
          schema_name: "public",
          table_name: l.tableName ?? "debts",
          op: l.op ?? "U",
          row_id: null,
          row_label: null,
          clinic_id: null,
          client_id: null,
          changes: mudancas,
          tx: null,
        };
        const campos = camposDaAlteracao(a, nomes).filter((c) => !(l.op === "I" && (c.depois ?? c.antes) === "—"));
        if (l.op === "U" && campos.length === 0) return null;
        return (
          <li key={`a${i}`} className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">{quando} · {quem}</p>
            <p className="font-medium">
              {l.tableName && l.tableName !== "debts"
                ? `${l.op === "I" ? "Lançou" : l.op === "D" ? "Apagou" : "Alterou"} · ${TABELAS[`public.${l.tableName}`] ?? l.tableName}`
                : l.op === "I" ? "Dados do cadastro" : l.op === "D" ? "Apagou" : "Alterou"}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
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
          </li>
        );
      })}
    </ol>
  );
}
