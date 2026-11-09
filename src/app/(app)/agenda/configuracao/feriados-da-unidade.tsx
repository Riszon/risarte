"use client";

// Feriados da unidade (0368 — Rita, Fase 0A.4): os próximos 12 meses — os
// nacionais, os do estado e os da cidade —, com a decisão de atender ou não.
// A decisão é a MESMA de sempre (`decideHoliday` / `clinic_holiday_decisions`).
// Para a assistente virtual, feriado SEM decisão = unidade fechada (decisão 9).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIsoDateBr } from "@/lib/dates";
import { ROTULO_DO_ESCOPO, type EscopoDoFeriado } from "@/lib/unidade-publica";
import { decideHoliday } from "../actions";
import { adicionarFeriado, removerFeriado } from "./horario-feriados-actions";

export type FeriadoDaUnidade = {
  id: string;
  date: string;
  name: string;
  scope: EscopoDoFeriado;
  /** true = vai atender; false = não vai; null = sem decisão. */
  decisao: boolean | null;
  podeRemover: boolean;
};

export function FeriadosDaUnidade({
  clinicId,
  uf,
  cidade,
  feriados,
}: {
  clinicId: string;
  uf: string | null;
  cidade: string | null;
  feriados: FeriadoDaUnidade[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [novo, setNovo] = useState({ date: "", name: "", scope: (cidade ? "city" : "state") as "state" | "city" });

  const rodar = (fn: () => Promise<{ ok: boolean; error?: string }>, msg?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (msg) toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });

  const semDecisao = feriados.filter((f) => f.decisao === null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Feriados da unidade (próximos 12 meses)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Decida em cada feriado se a unidade vai atender. Para a assistente
          virtual, <strong>feriado sem decisão = unidade fechada</strong>.
          {semDecisao > 0 && ` Faltam ${semDecisao} decisão(ões).`}
        </p>
        {feriados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum feriado nos próximos 12 meses.</p>
        ) : (
          <ul className="divide-y text-sm">
            {feriados.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-24 tabular-nums">{formatIsoDateBr(f.date)}</span>
                <span className="min-w-[10rem] flex-1">
                  {f.name}
                  <span className="ml-2 text-xs text-muted-foreground">{ROTULO_DO_ESCOPO[f.scope]}</span>
                </span>
                <span className="text-xs">
                  {f.decisao === null ? (
                    <span className="font-medium text-amber-700 dark:text-amber-400">sem decisão</span>
                  ) : f.decisao ? (
                    "vai atender"
                  ) : (
                    "não vai atender"
                  )}
                </span>
                <Button
                  size="sm"
                  variant={f.decisao === true ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => rodar(() => decideHoliday(clinicId, f.date, true))}
                >
                  Vai atender
                </Button>
                <Button
                  size="sm"
                  variant={f.decisao === false ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => rodar(() => decideHoliday(clinicId, f.date, false))}
                >
                  Não vai
                </Button>
                {f.podeRemover && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => rodar(() => removerFeriado(f.id), "Feriado removido.")}>
                    Remover
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Cadastrar feriado estadual ou municipal</p>
          {!uf ? (
            <p className="text-xs text-muted-foreground">A unidade não tem estado no cadastro: peça ao Admin para completar o endereço.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="fer-data">Data</Label>
                <Input id="fer-data" type="date" value={novo.date} onChange={(e) => setNovo((n) => ({ ...n, date: e.target.value }))} />
              </div>
              <div className="min-w-[10rem] flex-1">
                <Label htmlFor="fer-nome">Nome</Label>
                <Input id="fer-nome" value={novo.name} onChange={(e) => setNovo((n) => ({ ...n, name: e.target.value }))} placeholder="Ex.: Aniversário da cidade" />
              </div>
              <div>
                <Label htmlFor="fer-escopo">Vale para</Label>
                <select
                  id="fer-escopo"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={novo.scope}
                  onChange={(e) => setNovo((n) => ({ ...n, scope: e.target.value as "state" | "city" }))}
                >
                  <option value="city" disabled={!cidade}>
                    {cidade ? `A cidade (${cidade})` : "A cidade (sem cidade no cadastro)"}
                  </option>
                  <option value="state">O estado ({uf})</option>
                </select>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  rodar(async () => {
                    const r = await adicionarFeriado({ ...novo, state: uf, city: cidade });
                    if (r.ok) setNovo({ date: "", name: "", scope: novo.scope });
                    return r;
                  }, "Feriado cadastrado.")
                }
              >
                Cadastrar
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Os feriados nacionais já vêm cadastrados. A decisão de atender ou
            não também vale para a agenda da equipe naquele dia.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
