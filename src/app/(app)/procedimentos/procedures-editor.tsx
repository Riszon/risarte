"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, type Procedure, type UnitPrice } from "@/lib/pricing";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";
import {
  addProcedure,
  deleteProcedure,
  editProcedure,
  setProcedureActive,
  setUnitPrice,
  type ProcedureInput,
} from "./actions";

export type ProcedureChange = {
  id: string;
  changedAt: string;
  description: string;
  byName: string | null;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function commissionLabel(p: Procedure): string {
  const parts: string[] = [];
  if (p.commissionPercent > 0) parts.push(`${p.commissionPercent}%`);
  if (p.commissionFixedCents > 0) parts.push(formatBRL(p.commissionFixedCents));
  return parts.length > 0 ? parts.join(" + ") : "—";
}

const EMPTY: ProcedureInput = {
  name: "",
  tussCode: "",
  specialty: "",
  pillar: "",
  defaultPrice: "",
  minPrice: "",
  maxPrice: "",
  commissionPercent: "",
  commissionFixed: "",
};

function toInput(p: Procedure): ProcedureInput {
  return {
    name: p.name,
    tussCode: p.tussCode ?? "",
    specialty: p.specialty ?? "",
    pillar: p.pillar ?? "",
    defaultPrice: centsToInput(p.defaultPriceCents),
    minPrice: p.minPriceCents != null ? centsToInput(p.minPriceCents) : "",
    maxPrice: p.maxPriceCents != null ? centsToInput(p.maxPriceCents) : "",
    commissionPercent: p.commissionPercent
      ? String(p.commissionPercent).replace(".", ",")
      : "",
    commissionFixed: p.commissionFixedCents
      ? centsToInput(p.commissionFixedCents)
      : "",
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shared field grid for the add/edit forms. */
function ProcedureFields({
  value,
  onChange,
}: {
  value: ProcedureInput;
  onChange: (patch: Partial<ProcedureInput>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Nome do procedimento *</Label>
        <Input
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Ex.: Restauração em resina"
        />
      </div>
      <div>
        <Label>Código TUSS</Label>
        <Input
          value={value.tussCode}
          onChange={(e) => onChange({ tussCode: e.target.value })}
          placeholder="Ex.: 85100201"
        />
      </div>
      <div>
        <Label>Especialidade</Label>
        <Input
          value={value.specialty}
          onChange={(e) => onChange({ specialty: e.target.value })}
          placeholder="Ex.: Dentística"
        />
      </div>
      <div>
        <Label>Pilar da Metodologia</Label>
        <select
          value={value.pillar}
          onChange={(e) => onChange({ pillar: e.target.value })}
          className={selectClass}
        >
          <option value="">Sem pilar</option>
          {METHODOLOGY_PILLARS.map((p) => (
            <option key={p} value={p}>
              {PILLAR_LABELS[p as MethodologyPillar]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Preço padrão (R$)</Label>
        <Input
          value={value.defaultPrice}
          onChange={(e) => onChange({ defaultPrice: e.target.value })}
          inputMode="decimal"
          placeholder="0,00"
        />
      </div>
      <div>
        <Label>Preço mínimo (R$)</Label>
        <Input
          value={value.minPrice}
          onChange={(e) => onChange({ minPrice: e.target.value })}
          inputMode="decimal"
          placeholder="(opcional)"
        />
      </div>
      <div>
        <Label>Preço máximo (R$)</Label>
        <Input
          value={value.maxPrice}
          onChange={(e) => onChange({ maxPrice: e.target.value })}
          inputMode="decimal"
          placeholder="(opcional)"
        />
      </div>
      <div>
        <Label>Comissão (%)</Label>
        <Input
          value={value.commissionPercent}
          onChange={(e) => onChange({ commissionPercent: e.target.value })}
          inputMode="decimal"
          placeholder="Ex.: 10"
        />
      </div>
      <div>
        <Label>Comissão fixa (R$)</Label>
        <Input
          value={value.commissionFixed}
          onChange={(e) => onChange({ commissionFixed: e.target.value })}
          inputMode="decimal"
          placeholder="(opcional)"
        />
      </div>
    </div>
  );
}

export function ProceduresEditor({
  procedures,
  selectedUnitId,
  unitName,
  overrides,
  changesByProcedure,
}: {
  procedures: Procedure[];
  selectedUnitId: string;
  unitName: string | null;
  overrides: UnitPrice[];
  changesByProcedure: Record<string, ProcedureChange[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const networkMode = selectedUnitId === "";
  const overrideByProc = new Map(overrides.map((o) => [o.procedureId, o.priceCents]));

  const [adding, setAdding] = useState(false);
  const [newProc, setNewProc] = useState<ProcedureInput>(EMPTY);

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        // deleteProcedure returns ok + an info message when it had to deactivate.
        if (result.error) toast.info(result.error);
        else toast.success(msg);
        after?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Novo procedimento (somente no modo "padrão da rede"). */}
      {networkMode && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Novo procedimento</CardTitle>
            <Button
              size="sm"
              variant={adding ? "outline" : "default"}
              onClick={() => setAdding((s) => !s)}
            >
              {adding ? (
                "Fechar"
              ) : (
                <>
                  <Plus className="mr-1 size-4" />
                  Adicionar
                </>
              )}
            </Button>
          </CardHeader>
          {adding && (
            <CardContent className="space-y-3">
              <ProcedureFields
                value={newProc}
                onChange={(patch) => setNewProc((prev) => ({ ...prev, ...patch }))}
              />
              <Button
                size="sm"
                disabled={!newProc.name.trim() || isPending}
                onClick={() =>
                  run(() => addProcedure(newProc), "Procedimento adicionado.", () => {
                    setNewProc(EMPTY);
                    setAdding(false);
                  })
                }
              >
                Salvar procedimento
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {!networkMode && (
        <p className="rounded-md border bg-muted/30 p-2 text-sm text-muted-foreground">
          Editando os preços da unidade <strong>{unitName}</strong>. Deixe em
          branco para a unidade usar o preço padrão da rede.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {procedures.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum procedimento encontrado.
            </p>
          ) : (
            <ul className="divide-y">
              {procedures.map((p) => (
                <ProcedureRow
                  key={p.id}
                  procedure={p}
                  networkMode={networkMode}
                  selectedUnitId={selectedUnitId}
                  overrideCents={overrideByProc.get(p.id) ?? null}
                  changes={changesByProcedure[p.id] ?? []}
                  isPending={isPending}
                  run={run}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProcedureRow({
  procedure: p,
  networkMode,
  selectedUnitId,
  overrideCents,
  changes,
  isPending,
  run,
}: {
  procedure: Procedure;
  networkMode: boolean;
  selectedUnitId: string;
  overrideCents: number | null;
  changes: ProcedureChange[];
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProcedureInput>(() => toInput(p));
  const [showHistory, setShowHistory] = useState(false);
  const [unitPrice, setUnitPriceValue] = useState(
    overrideCents != null ? centsToInput(overrideCents) : ""
  );

  if (editing) {
    return (
      <li className="space-y-3 p-3">
        <ProcedureFields
          value={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => editProcedure(p.id, form), "Procedimento salvo.", () =>
                setEditing(false)
              )
            }
          >
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {p.name}
            {!p.isActive && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                Inativo
              </Badge>
            )}
            {p.pillar && (
              <Badge className="ml-2 bg-gold text-gold-foreground text-[10px]">
                {PILLAR_LABELS[p.pillar]}
              </Badge>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {p.code && <span className="font-mono text-gold">{p.code}</span>}
            {p.tussCode && <span>TUSS {p.tussCode}</span>}
            {p.specialty && <span>{p.specialty}</span>}
            <span>Padrão: {formatBRL(p.defaultPriceCents)}</span>
            {(p.minPriceCents != null || p.maxPriceCents != null) && (
              <span>
                Faixa: {p.minPriceCents != null ? formatBRL(p.minPriceCents) : "—"}
                {" a "}
                {p.maxPriceCents != null ? formatBRL(p.maxPriceCents) : "—"}
              </span>
            )}
            <span>Comissão: {commissionLabel(p)}</span>
          </p>
        </div>

        {networkMode ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Histórico"
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Editar"
              onClick={() => {
                setForm(toInput(p));
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() =>
                run(
                  () => setProcedureActive(p.id, !p.isActive),
                  p.isActive ? "Desativado." : "Reativado."
                )
              }
            >
              {p.isActive ? "Desativar" : "Reativar"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Excluir"
              disabled={isPending}
              onClick={() =>
                run(() => deleteProcedure(p.id), "Procedimento excluído.")
              }
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-sm text-muted-foreground">R$</span>
            <Input
              value={unitPrice}
              onChange={(e) => setUnitPriceValue(e.target.value)}
              inputMode="decimal"
              placeholder={centsToInput(p.defaultPriceCents)}
              className="w-28"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(
                  () => setUnitPrice(selectedUnitId, p.id, unitPrice),
                  "Preço da unidade salvo."
                )
              }
            >
              Salvar
            </Button>
          </div>
        )}
      </div>

      {showHistory && (
        <div className="mt-2 rounded-md bg-muted/30 p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Histórico de alterações
          </p>
          {changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma alteração registrada.</p>
          ) : (
            <ul className="space-y-1">
              {changes.map((c) => (
                <li key={c.id} className="text-xs">
                  {c.description}{" "}
                  <span className="text-muted-foreground">
                    — {fmtDate(c.changedAt)}
                    {c.byName ? ` · ${c.byName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
