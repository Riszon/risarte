"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, History, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatBRL,
  formatMinutes,
  intervalSummary,
  protocolSummary,
  protocolTotalMinutes,
  SESSION_TIME_OPTIONS,
  type Procedure,
  type ProcedureSession,
  type UnitPrice,
} from "@/lib/pricing";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  type MethodologyPillar,
} from "@/lib/journey";
import {
  addProcedure,
  clearProcedureSessions,
  deleteProcedure,
  editProcedure,
  proposeProtocolChange,
  readjustPrices,
  setCommissionBulk,
  setProcedureActive,
  setProcedureSessions,
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
  estimatedMinutes: "",
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
    estimatedMinutes: p.estimatedMinutes != null ? String(p.estimatedMinutes) : "",
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
  specialties,
}: {
  value: ProcedureInput;
  onChange: (patch: Partial<ProcedureInput>) => void;
  specialties: string[];
}) {
  // Inclui o valor atual (mesmo que seja antigo/desativado) para não se perder.
  const specialtyOptions =
    value.specialty && !specialties.includes(value.specialty)
      ? [value.specialty, ...specialties]
      : specialties;
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
        <select
          value={value.specialty}
          onChange={(e) => onChange({ specialty: e.target.value })}
          className={selectClass}
        >
          <option value="">Sem especialidade</option>
          {specialtyOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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

type SessionDraft = {
  name: string;
  minutes: number;
  intervalDays: number | null;
};

function initSessionDrafts(
  initial: ProcedureSession[],
  fallbackMinutes: number
): SessionDraft[] {
  if (initial.length > 0) {
    return initial.map((s) => ({
      name: s.name ?? "",
      minutes: s.estimatedMinutes,
      intervalDays: s.minIntervalDays ?? null,
    }));
  }
  return [
    {
      name: "",
      minutes: fallbackMinutes > 0 ? fallbackMinutes : 30,
      intervalDays: null,
    },
  ];
}

/** Painel do histórico de alterações (mostrado só ao clicar). */
function ChangeHistory({ changes }: { changes: ProcedureChange[] }) {
  return (
    <div className="mt-2 rounded-md bg-muted/30 p-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Histórico de alterações
      </p>
      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma alteração registrada.
        </p>
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
  );
}

/** Editor do protocolo de sessões de um procedimento (rede ou unidade). */
function SessionProtocolPanel({
  procedureId,
  clinicId,
  initial,
  fallbackMinutes,
  hasOverride = false,
  mode = "apply",
  isPending,
  run,
}: {
  procedureId: string;
  clinicId: string | null;
  initial: ProcedureSession[];
  fallbackMinutes: number;
  /** (Unidade) já existe protocolo próprio? Habilita "remover personalização". */
  hasOverride?: boolean;
  /** "apply" = grava direto (Admin/Coordenador); "propose" = Planner propõe. */
  mode?: "apply" | "propose";
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
}) {
  const isUnit = clinicId !== null;
  const propose = mode === "propose";
  const [note, setNote] = useState("");
  const [sessions, setSessions] = useState<SessionDraft[]>(() =>
    initSessionDrafts(initial, fallbackMinutes)
  );
  const multi = sessions.length > 1;
  const total = protocolTotalMinutes(sessions);

  function patch(i: number, p: Partial<SessionDraft>) {
    setSessions((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/20 p-3">
      {isUnit && (
        <p className="text-xs text-muted-foreground">
          {hasOverride
            ? "Protocolo personalizado desta unidade."
            : "Sem personalização — base: padrão da Rede. Ajuste e salve para personalizar nesta unidade."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Este procedimento é executado em:
        </span>
        <Button
          size="sm"
          variant={multi ? "outline" : "default"}
          onClick={() => setSessions((prev) => [prev[0]])}
        >
          Sessão única
        </Button>
        <Button
          size="sm"
          variant={multi ? "default" : "outline"}
          onClick={() =>
            setSessions((prev) =>
              prev.length > 1
                ? prev
                : [
                    ...prev,
                    { name: "", minutes: prev[0]?.minutes || 30, intervalDays: 7 },
                  ]
            )
          }
        >
          Várias sessões
        </Button>
      </div>

      <ul className="space-y-2">
        {sessions.map((s, i) => {
          const opts = SESSION_TIME_OPTIONS.includes(s.minutes)
            ? SESSION_TIME_OPTIONS
            : [s.minutes, ...SESSION_TIME_OPTIONS].sort((a, b) => a - b);
          return (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                Sessão {i + 1}
              </span>
              {multi && (
                <Input
                  value={s.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder={`Nome da sessão ${i + 1}`}
                  className="max-w-[220px]"
                />
              )}
              <select
                value={s.minutes}
                onChange={(e) => patch(i, { minutes: Number(e.target.value) })}
                className={selectClass.replace("w-full", "w-32")}
              >
                {opts.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </select>
              {multi && i > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  após
                  <Input
                    type="number"
                    min={0}
                    value={s.intervalDays ?? ""}
                    onChange={(e) =>
                      patch(i, {
                        intervalDays:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-16"
                    aria-label={`Intervalo mínimo (dias) antes da sessão ${i + 1}`}
                  />
                  dias
                </span>
              )}
              {multi && sessions.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover sessão"
                  onClick={() =>
                    setSessions((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {multi && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setSessions((prev) => [
              ...prev,
              {
                name: "",
                minutes: prev[prev.length - 1]?.minutes || 30,
                intervalDays: prev[prev.length - 1]?.intervalDays ?? 7,
              },
            ])
          }
        >
          <Plus className="mr-1 size-4" />
          Adicionar sessão
        </Button>
      )}

      <div className="border-t pt-2 text-sm">
        <span>
          <strong>{sessions.length}</strong> sessão{sessions.length > 1 ? "ões" : ""} ·
          tempo total <strong>{formatMinutes(total)}</strong>
          {(() => {
            const iv = intervalSummary(
              sessions.map((s) => ({ minIntervalDays: s.intervalDays }))
            );
            return iv ? <> · {iv}</> : null;
          })()}
        </span>
      </div>

      {propose && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Justificativa (para o {isUnit ? "Coordenador" : "Admin"} avaliar):
          </span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Por que mudar o protocolo?"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!propose && isUnit && hasOverride && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => clearProcedureSessions(procedureId, clinicId!),
                "Personalização removida — voltou ao padrão da Rede."
              )
            }
          >
            Remover personalização
          </Button>
        )}
        {propose ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  proposeProtocolChange(
                    procedureId,
                    clinicId,
                    sessions.map((s) => ({
                      name: s.name,
                      minutes: s.minutes,
                      intervalDays: s.intervalDays,
                    })),
                    note
                  ),
                isUnit
                  ? "Proposta enviada ao Coordenador da unidade."
                  : "Proposta enviada ao Admin."
              )
            }
          >
            Propor alteração
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  setProcedureSessions(
                    procedureId,
                    clinicId,
                    sessions.map((s) => ({
                      name: s.name,
                      minutes: s.minutes,
                      intervalDays: s.intervalDays,
                    }))
                  ),
                isUnit
                  ? "Protocolo da unidade salvo."
                  : "Protocolo de sessões salvo."
              )
            }
          >
            Salvar protocolo
          </Button>
        )}
      </div>
    </div>
  );
}

export function ProceduresEditor({
  procedures,
  specialties,
  selectedUnitId,
  unitName,
  overrides,
  changesByProcedure,
  sessionsByProcedure,
  unitSessionsByProcedure,
  canManageCatalog,
  isAdmin,
}: {
  procedures: Procedure[];
  specialties: string[];
  selectedUnitId: string;
  unitName: string | null;
  overrides: UnitPrice[];
  changesByProcedure: Record<string, ProcedureChange[]>;
  sessionsByProcedure: Record<string, ProcedureSession[]>;
  unitSessionsByProcedure: Record<string, ProcedureSession[]>;
  canManageCatalog: boolean;
  /** Admin aplica protocolo direto; Planner (não-admin) apenas propõe. */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const networkMode = selectedUnitId === "";
  const overrideByProc = new Map(overrides.map((o) => [o.procedureId, o.priceCents]));

  const [adding, setAdding] = useState(false);
  const [newProc, setNewProc] = useState<ProcedureInput>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      {networkMode && canManageCatalog && (
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
                specialties={specialties}
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

      {networkMode && canManageCatalog && (
        <ReadjustPanel
          specialties={specialties}
          selectedCount={selected.size}
          isPending={isPending}
          run={run}
          getSelectedIds={() => [...selected]}
          onDone={() => setSelected(new Set())}
        />
      )}

      {networkMode && canManageCatalog && (
        <CommissionPanel
          specialties={specialties}
          selectedCount={selected.size}
          isPending={isPending}
          run={run}
          getSelectedIds={() => [...selected]}
          onDone={() => setSelected(new Set())}
        />
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
                  specialties={specialties}
                  networkMode={networkMode}
                  selectedUnitId={selectedUnitId}
                  overrideCents={overrideByProc.get(p.id) ?? null}
                  changes={changesByProcedure[p.id] ?? []}
                  sessions={sessionsByProcedure[p.id] ?? []}
                  unitSessions={unitSessionsByProcedure[p.id] ?? []}
                  canManageCatalog={canManageCatalog}
                  isAdmin={isAdmin}
                  isPending={isPending}
                  run={run}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => toggleSelect(p.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReadjustPanel({
  specialties,
  selectedCount,
  isPending,
  run,
  getSelectedIds,
  onDone,
}: {
  specialties: string[];
  selectedCount: number;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
  getSelectedIds: () => string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [scope, setScope] = useState<"all" | "specialty" | "pillar" | "selected">(
    "all"
  );
  const [specialty, setSpecialty] = useState("");
  const [pillar, setPillar] = useState("");
  const [applyToBand, setApplyToBand] = useState(true);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Reajuste de preços em massa</CardTitle>
        <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen((s) => !s)}>
          {open ? "Fechar" : "Abrir"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Percentual (%)</Label>
              <Input
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 10 ou -5"
                className="w-28"
              />
            </div>
            <div>
              <Label>Aplicar a</Label>
              <select
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as typeof scope)
                }
                className={selectClass.replace("w-full", "w-48")}
              >
                <option value="all">Todos os procedimentos</option>
                <option value="specialty">Por especialidade</option>
                <option value="pillar">Por pilar</option>
                <option value="selected">Selecionados ({selectedCount})</option>
              </select>
            </div>
            {scope === "specialty" && (
              <div>
                <Label>Especialidade</Label>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className={selectClass.replace("w-full", "w-44")}
                >
                  <option value="">Selecione...</option>
                  {specialties.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {scope === "pillar" && (
              <div>
                <Label>Pilar</Label>
                <select
                  value={pillar}
                  onChange={(e) => setPillar(e.target.value)}
                  className={selectClass.replace("w-full", "w-44")}
                >
                  <option value="">Selecione...</option>
                  {METHODOLOGY_PILLARS.map((p) => (
                    <option key={p} value={p}>
                      {PILLAR_LABELS[p as MethodologyPillar]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyToBand}
              onChange={(e) => setApplyToBand(e.target.checked)}
            />
            Ajustar também os preços mínimo e máximo
          </label>
          <Button
            size="sm"
            disabled={!percent.trim() || isPending}
            onClick={() =>
              run(
                () =>
                  readjustPrices({
                    percent,
                    scope,
                    specialty: specialty || undefined,
                    pillar: pillar || undefined,
                    ids: scope === "selected" ? getSelectedIds() : undefined,
                    applyToBand,
                  }),
                "Reajuste aplicado.",
                () => {
                  setPercent("");
                  onDone();
                }
              )
            }
          >
            Aplicar reajuste
          </Button>
          <p className="text-xs text-muted-foreground">
            Use “Selecionados” marcando os procedimentos na lista abaixo. O
            reajuste fica registrado no histórico de cada procedimento.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/** H4.13: definir a comissão (%, R$ fixo, ou ambos) em massa, por escopo. */
function CommissionPanel({
  specialties,
  selectedCount,
  isPending,
  run,
  getSelectedIds,
  onDone,
}: {
  specialties: string[];
  selectedCount: number;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
  getSelectedIds: () => string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("");
  const [scope, setScope] = useState<"all" | "specialty" | "pillar" | "selected">(
    "all"
  );
  const [specialty, setSpecialty] = useState("");
  const [pillar, setPillar] = useState("");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Comissão em massa</CardTitle>
        <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen((s) => !s)}>
          {open ? "Fechar" : "Abrir"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Comissão (%)</Label>
              <Input
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 10"
                className="w-24"
              />
            </div>
            <div>
              <Label>Comissão fixa (R$)</Label>
              <Input
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 5,00"
                className="w-28"
              />
            </div>
            <div>
              <Label>Aplicar a</Label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
                className={selectClass.replace("w-full", "w-48")}
              >
                <option value="all">Todos os procedimentos</option>
                <option value="specialty">Por especialidade</option>
                <option value="pillar">Por pilar</option>
                <option value="selected">Selecionados ({selectedCount})</option>
              </select>
            </div>
            {scope === "specialty" && (
              <div>
                <Label>Especialidade</Label>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className={selectClass.replace("w-full", "w-44")}
                >
                  <option value="">Selecione...</option>
                  {specialties.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {scope === "pillar" && (
              <div>
                <Label>Pilar</Label>
                <select
                  value={pillar}
                  onChange={(e) => setPillar(e.target.value)}
                  className={selectClass.replace("w-full", "w-44")}
                >
                  <option value="">Selecione...</option>
                  {METHODOLOGY_PILLARS.map((p) => (
                    <option key={p} value={p}>
                      {PILLAR_LABELS[p as MethodologyPillar]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Deixe um dos campos em branco para não alterá-lo. Ex.: só o “%” muda a
            comissão percentual e mantém a fixa.
          </p>
          <Button
            size="sm"
            disabled={(!percent.trim() && !fixed.trim()) || isPending}
            onClick={() =>
              run(
                () =>
                  setCommissionBulk({
                    percent: percent || undefined,
                    fixed: fixed || undefined,
                    scope,
                    specialty: specialty || undefined,
                    pillar: pillar || undefined,
                    ids: scope === "selected" ? getSelectedIds() : undefined,
                  }),
                "Comissão aplicada.",
                () => {
                  setPercent("");
                  setFixed("");
                  onDone();
                }
              )
            }
          >
            Aplicar comissão
          </Button>
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            <strong>Regra:</strong> a comissão só é contabilizada quando o
            procedimento é <strong>finalizado</strong>. O pagamento é feito no{" "}
            <strong>módulo financeiro</strong> (Fase 2); aqui você só cadastra a
            regra de cada procedimento.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function ProcedureRow({
  procedure: p,
  specialties,
  networkMode,
  selectedUnitId,
  overrideCents,
  changes,
  sessions,
  unitSessions,
  canManageCatalog,
  isAdmin,
  isPending,
  run,
  selected,
  onToggleSelect,
}: {
  procedure: Procedure;
  specialties: string[];
  networkMode: boolean;
  selectedUnitId: string;
  overrideCents: number | null;
  changes: ProcedureChange[];
  sessions: ProcedureSession[];
  unitSessions: ProcedureSession[];
  canManageCatalog: boolean;
  isAdmin: boolean;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProcedureInput>(() => toInput(p));
  const [showHistory, setShowHistory] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [unitPrice, setUnitPriceValue] = useState(
    overrideCents != null ? centsToInput(overrideCents) : ""
  );

  // H4.3 Lote 4: Admin aplica direto; Coordenador aplica a própria unidade;
  // Planner (não-admin) só PROPÕE. (Coordenador = acessa unidade sem catálogo.)
  const networkPanelMode: "apply" | "propose" = isAdmin ? "apply" : "propose";
  const unitPanelMode: "apply" | "propose" =
    isAdmin || !canManageCatalog ? "apply" : "propose";

  if (editing) {
    return (
      <li className="space-y-3 p-3">
        <ProcedureFields
          value={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          specialties={specialties}
        />
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSessions((s) => !s)}
          >
            <Clock className="mr-1 size-4" />
            Protocolo de sessões
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((s) => !s)}
          >
            <History className="mr-1 size-4" />
            Histórico
          </Button>
        </div>
        {showHistory && <ChangeHistory changes={changes} />}
        {showSessions && (
          <SessionProtocolPanel
            procedureId={p.id}
            clinicId={null}
            initial={sessions}
            fallbackMinutes={p.estimatedMinutes ?? 0}
            mode={networkPanelMode}
            isPending={isPending}
            run={run}
          />
        )}
      </li>
    );
  }

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {networkMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label="Selecionar procedimento"
              className="mt-1 size-4 shrink-0 accent-primary"
            />
          )}
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
            {sessions.length > 0 ? (
              <span>Rede: {protocolSummary(sessions)}</span>
            ) : (
              p.estimatedMinutes != null && (
                <span>Rede: {formatMinutes(p.estimatedMinutes)}</span>
              )
            )}
            {unitSessions.length > 0 && (
              <span className="font-medium text-primary">
                Unidade: {protocolSummary(unitSessions)}
              </span>
            )}
          </p>
          </div>
        </div>

        {networkMode ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sessões"
              title="Protocolo de sessões"
              onClick={() => setShowSessions((s) => !s)}
            >
              <Clock className="size-4" />
            </Button>
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Protocolo da unidade"
              title="Protocolo de sessões da unidade"
              onClick={() => setShowSessions((s) => !s)}
            >
              <Clock className="size-4" />
            </Button>
            {canManageCatalog && (
              <>
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
              </>
            )}
          </div>
        )}
      </div>

      {showHistory && <ChangeHistory changes={changes} />}

      {showSessions &&
        (networkMode ? (
          <SessionProtocolPanel
            procedureId={p.id}
            clinicId={null}
            initial={sessions}
            fallbackMinutes={p.estimatedMinutes ?? 0}
            mode={networkPanelMode}
            isPending={isPending}
            run={run}
          />
        ) : (
          <SessionProtocolPanel
            procedureId={p.id}
            clinicId={selectedUnitId}
            initial={unitSessions.length > 0 ? unitSessions : sessions}
            fallbackMinutes={p.estimatedMinutes ?? 0}
            hasOverride={unitSessions.length > 0}
            mode={unitPanelMode}
            isPending={isPending}
            run={run}
          />
        ))}
    </li>
  );
}
