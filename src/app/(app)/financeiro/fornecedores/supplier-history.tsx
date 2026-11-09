"use client";

import { useEffect, useState } from "react";
import { formatBrDateTime } from "@/lib/dates";
import { formatCep, formatCnpj, formatCpf, formatPhone } from "@/lib/masks";
import {
  camposDaAlteracao,
  quemFez,
  type Alteracao,
  type Autor,
} from "@/lib/auditoria-alteracoes";
import { loadSupplierHistory, type SupplierHistoryRow } from "./actions";

/** Campos que não dizem nada na ficha: quem/quando já aparece na linha. */
const RUIDO = new Set(["updated_at", "updated_by", "created_at", "created_by", "id", "supplier_id"]);

const doc = (v: string) => (v.length > 11 ? formatCnpj(v) : formatCpf(v));

/**
 * O histórico da ficha do fornecedor (0371): a trilha da auditoria geral
 * (`audit_changes`, 0288), só dos registros deste fornecedor.
 */
export function SupplierHistory({
  supplierId,
  nomesDasUnidades,
  rotuloDoTipo,
  contas,
}: {
  supplierId: string;
  nomesDasUnidades: Map<string, string>;
  rotuloDoTipo: Map<string, string>;
  contas: Map<string, string>;
}) {
  const [estado, setEstado] = useState<{
    carregando: boolean;
    erro: string | null;
    linhas: SupplierHistoryRow[];
  }>({ carregando: true, erro: null, linhas: [] });

  useEffect(() => {
    let vivo = true;
    loadSupplierHistory(supplierId).then((r) => {
      if (vivo) setEstado({ carregando: false, erro: r.ok ? null : (r.error ?? "Erro."), linhas: r.rows });
    });
    return () => {
      vivo = false;
    };
  }, [supplierId]);

  if (estado.carregando) return <p className="py-4 text-sm text-muted-foreground">Carregando o histórico…</p>;
  if (estado.erro) return <p className="py-4 text-sm text-destructive">{estado.erro}</p>;
  if (estado.linhas.length === 0)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Nenhuma alteração registrada. O registro automático começou em 09/10/2026: o
        que aconteceu antes disso não aparece aqui.
      </p>
    );

  // Traduz códigos para o que a pessoa lê, antes da formatação comum.
  const traduz = (campo: string, v: unknown): unknown => {
    if (typeof v !== "string" || !v) return v;
    if (campo === "kind") return rotuloDoTipo.get(v) ?? v;
    if (campo === "default_account_code") return contas.get(v) ?? v;
    if (campo === "phone" || campo === "whatsapp") return formatPhone(v);
    if (campo === "document" || campo === "account_holder_document") return doc(v);
    if (campo === "address_zip") return formatCep(v);
    return v;
  };

  const nomes = {
    usuarios: new Map(
      estado.linhas.filter((l) => l.userId && l.userName).map((l) => [l.userId as string, l.userName as string])
    ),
    unidades: nomesDasUnidades,
  };

  return (
    <ol className="space-y-3 py-2 text-sm">
      {estado.linhas.map((l) => {
        const quando = formatBrDateTime(l.occurredAt);
        const quem = quemFez({ user_id: l.userId, actor: l.actor as Autor }, nomes);

        if (l.tableName === "supplier_clinics") {
          const unidade = nomesDasUnidades.get(String(l.changes?.clinic_id ?? "")) ?? "uma unidade";
          return (
            <li key={l.id} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{quando} · {quem}</p>
              <p>{l.op === "D" ? `Deixou de valer em ${unidade}` : `Passou a valer em ${unidade}`}</p>
            </li>
          );
        }

        const mudancas: Record<string, unknown> = {};
        for (const [campo, v] of Object.entries(l.changes ?? {})) {
          if (RUIDO.has(campo)) continue;
          mudancas[campo] =
            l.op === "U" && v && typeof v === "object" && "antes" in v && "depois" in v
              ? {
                  antes: traduz(campo, (v as { antes: unknown }).antes),
                  depois: traduz(campo, (v as { depois: unknown }).depois),
                }
              : traduz(campo, v);
        }
        const a: Alteracao = {
          id: l.id,
          occurred_at: l.occurredAt,
          user_id: l.userId,
          actor: l.actor as Autor,
          auth_session_id: null,
          schema_name: "public",
          table_name: "suppliers",
          op: l.op,
          row_id: null,
          row_label: null,
          clinic_id: null,
          client_id: null,
          changes: mudancas,
          tx: null,
        };
        const campos = camposDaAlteracao(a, nomes);
        if (l.op === "U" && campos.length === 0) return null;
        return (
          <li key={l.id} className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">{quando} · {quem}</p>
            <p className="font-medium">
              {l.op === "I" ? "Cadastrou o fornecedor" : l.op === "D" ? "Apagou o fornecedor" : "Alterou"}
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
