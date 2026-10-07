"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
} from "lucide-react";
import { GutBadge } from "@/components/gut-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMinutes, type BudgetItem } from "@/lib/pricing";
import type { ProjectedSession } from "@/lib/planning";
import {
  reorderPlannedBlocks,
  setBlockMinutes,
  setPlannedSessionGroup,
  setSessionMinutes,
  setSessionProvider,
} from "../../prontuarios/[id]/planning-actions";

/**
 * "ATENDIMENTOS E SEQUÊNCIA" DE TODAS AS OPÇÕES DO PLANO (OC-00087, 07/10/2026).
 *
 * Antes só a opção PRINCIPAL podia ser configurada. Se o cliente comprasse a
 * alternativa, o tratamento começava sem atendimento conjunto, sem tempo
 * ajustado e sem sequência — o Planner não tinha onde montar isso.
 *
 * Uma aba por opção, a principal primeiro. A configuração é guardada por
 * procedimento, então cada opção tem a sua, e só a da opção que o cliente
 * COMPRAR vira sessão de verdade (migração 0286).
 */
export function SequenciaPorOpcao({
  opcoes,
  providerOptions,
  canEdit,
}: {
  opcoes: {
    id: string;
    title: string;
    isPrimary: boolean;
    items: BudgetItem[];
    sessions: ProjectedSession[];
  }[];
  providerOptions: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [ativa, setAtiva] = useState(opcoes[0]?.id ?? "");
  const opcao = opcoes.find((o) => o.id === ativa) ?? opcoes[0];
  if (!opcao) return null;

  return (
    <div className="space-y-3">
      {opcoes.length > 1 && (
        <div className="space-y-1.5">
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === opcao.id}
                onClick={() => setAtiva(o.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  o.id === opcao.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.title}
                {o.isPrimary ? " · principal" : ""}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Cada opção tem os seus atendimentos e a sua sequência. Vale a da
            opção que o cliente <strong>comprar</strong> — configure também as
            alternativas.
          </p>
        </div>
      )}
      {/* A chave troca o estado de arrasto junto com a opção. */}
      <SessionJoinPlanner
        key={opcao.id}
        sessions={opcao.sessions}
        optionId={opcao.id}
        providerOptions={providerOptions}
        items={opcao.items}
        canEdit={canEdit}
      />
    </div>
  );
}

type Block = {
  key: string;
  groupNo: number | null;
  sessions: ProjectedSession[];
  minutes: number;
};

/**
 * H4.5: o Planner monta os "atendimentos" (junta sessões), edita o tempo de cada
 * sessão, define o profissional e ordena a sequência do tratamento (arrastar ou
 * setas). Sessões do mesmo atendimento são feitas no mesmo horário.
 */
export function SessionJoinPlanner({
  sessions,
  optionId,
  providerOptions,
  items = [],
  canEdit,
}: {
  sessions: ProjectedSession[];
  optionId: string;
  providerOptions: { id: string; name: string }[];
  /** Itens do orçamento (para mostrar a prioridade GUT de cada procedimento). */
  items?: BudgetItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragKey, setDragKey] = useState<string | null>(null);

  if (sessions.length === 0) return null;

  const gutById = new Map(items.map((i) => [i.id, i]));

  const providerName = (id: string | null) =>
    id ? (providerOptions.find((p) => p.id === id)?.name ?? "profissional") : null;

  // Blocos (atendimentos) na ordem da projeção (que já respeita a sequência).
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  for (const s of sessions) {
    const key = s.groupNo != null ? `g:${s.groupNo}` : `s:${s.itemId}:${s.sessionIndex}`;
    let b = byKey.get(key);
    if (!b) {
      b = { key, groupNo: s.groupNo, sessions: [], minutes: 0 };
      byKey.set(key, b);
      blocks.push(b);
    }
    b.sessions.push(s);
    b.minutes += s.plannedMinutes ?? 0;
  }
  const usedGroups = [
    ...new Set(sessions.map((s) => s.groupNo).filter((g): g is number => g != null)),
  ].sort((a, b) => a - b);
  const nextGroup = usedGroups.length ? Math.max(...usedGroups) + 1 : 1;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, msg?: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        if (msg) toast.success(msg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function persistOrder(ordered: Block[]) {
    const payload = ordered.map((b) =>
      b.sessions.map((s) => ({ itemId: s.itemId, sessionIndex: s.sessionIndex }))
    );
    run(() => reorderPlannedBlocks(optionId, payload));
  }

  function moveBlock(index: number, dir: "up" | "down") {
    const target = dir === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= blocks.length) return;
    const arr = [...blocks];
    [arr[index], arr[target]] = [arr[target], arr[index]];
    persistOrder(arr);
  }

  function dropOn(targetKey: string) {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      return;
    }
    const from = blocks.findIndex((b) => b.key === dragKey);
    const to = blocks.findIndex((b) => b.key === targetKey);
    setDragKey(null);
    if (from < 0 || to < 0) return;
    const arr = [...blocks];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    persistOrder(arr);
  }

  function changeGroup(s: ProjectedSession, value: string) {
    const groupNo =
      value === "" ? null : value === "new" ? nextGroup : Number(value);
    run(() => setPlannedSessionGroup(s.itemId, s.sessionIndex, groupNo));
  }

  return (
    <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Cada cartão é um <strong>atendimento</strong> (o que é feito no mesmo
          horário). Ajuste o <strong>tempo</strong> de cada sessão, o{" "}
          <strong>profissional</strong>, e <strong>arraste</strong> (ou use as
          setas) para definir a ordem — do <strong>Início</strong> ao{" "}
          <strong>Fim</strong>.
        </p>

        <ol className="space-y-2">
          {blocks.map((b, i) => {
            const providersInBlock = [
              ...new Set(
                b.sessions
                  .map((s) => s.providerId)
                  .filter((p): p is string => Boolean(p))
              ),
            ];
            const conflict = providersInBlock.length > 1;
            return (
              <li
                key={b.key}
                draggable={canEdit && !isPending}
                onDragStart={() => setDragKey(b.key)}
                onDragOver={(e) => {
                  if (canEdit) e.preventDefault();
                }}
                onDrop={() => dropOn(b.key)}
                className={`rounded-md border p-2 ${
                  dragKey === b.key ? "opacity-50" : ""
                } ${conflict ? "border-destructive/50" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                  )}
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">
                    {b.groupNo != null
                      ? `Atendimento conjunto`
                      : b.sessions[0].procedureName}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {i === 0 ? "Início · " : i === blocks.length - 1 ? "Fim · " : ""}
                    {b.sessions.length}{" "}
                    {b.sessions.length === 1 ? "sessão" : "sessões"}
                    {b.minutes > 0 ? ` · ${formatMinutes(b.minutes)}` : ""}
                  </span>
                  {canEdit && (
                    <span className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Subir na sequência"
                        disabled={isPending || i === 0}
                        onClick={() => moveBlock(i, "up")}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Descer na sequência"
                        disabled={isPending || i === blocks.length - 1}
                        onClick={() => moveBlock(i, "down")}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </span>
                  )}
                </div>

                {conflict && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                    <AlertTriangle className="size-3" />
                    Profissionais diferentes neste atendimento — ajuste abaixo.
                  </p>
                )}

                {/* OC-00087: O TEMPO DO ATENDIMENTO INTEIRO. Dez sessões de 60
                    min no mesmo horário não levam 600 — o Planner digita o
                    total e o sistema reparte entre as sessões, em vez de
                    obrigar a acertar uma por uma. Só aparece com mais de uma
                    sessão: com uma só, o tempo dela JÁ é o do atendimento. */}
                {canEdit && b.sessions.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                    <label
                      htmlFor={`tempo-${b.key}`}
                      className="font-medium"
                    >
                      Tempo do atendimento
                    </label>
                    <Input
                      // A chave refaz o campo quando o total muda (o campo não
                      // é controlado): sem ela, depois de salvar ele mostraria
                      // o número antigo.
                      key={`${b.key}-${b.minutes}`}
                      id={`tempo-${b.key}`}
                      type="number"
                      inputMode="numeric"
                      min={b.sessions.length}
                      defaultValue={b.minutes > 0 ? b.minutes : ""}
                      disabled={isPending}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === "") return;
                        const n = Number(v);
                        if (n === b.minutes) return;
                        run(
                          () =>
                            setBlockMinutes(
                              optionId,
                              b.sessions.map((s) => ({
                                itemId: s.itemId,
                                sessionIndex: s.sessionIndex,
                              })),
                              n
                            ),
                          "Tempo do atendimento repartido entre as sessões."
                        );
                      }}
                      className="h-7 w-20"
                    />
                    <span className="text-muted-foreground">
                      min — o total é repartido entre as {b.sessions.length}{" "}
                      sessões abaixo (dá para ajustar cada uma depois).
                    </span>
                  </div>
                )}

                <ul className="mt-1.5 space-y-1.5">
                  {b.sessions.map((s) => (
                    <li
                      key={`${s.itemId}-${s.sessionIndex}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                    >
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <span>
                          {b.groupNo != null && (
                            <span className="text-muted-foreground">
                              {s.procedureName} —{" "}
                            </span>
                          )}
                          {s.name}
                        </span>
                        <GutBadge item={gutById.get(s.itemId) ?? {}} />
                      </span>
                      {canEdit ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Input
                              // Refaz o campo quando o tempo muda por fora
                              // (o "tempo do atendimento" reparte e grava).
                              key={s.plannedMinutes ?? "vazio"}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              defaultValue={s.plannedMinutes ?? ""}
                              disabled={isPending}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const n = v === "" ? null : Number(v);
                                if ((s.plannedMinutes ?? null) !== (n ?? null)) {
                                  run(() =>
                                    setSessionMinutes(s.itemId, s.sessionIndex, n)
                                  );
                                }
                              }}
                              className="h-7 w-16"
                              aria-label="Tempo da sessão (min)"
                            />
                            min
                          </span>
                          <select
                            value={s.providerId ?? ""}
                            disabled={isPending}
                            onChange={(e) =>
                              run(() =>
                                setSessionProvider(
                                  s.itemId,
                                  s.sessionIndex,
                                  e.target.value || null
                                )
                              )
                            }
                            className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                            aria-label="Profissional da sessão"
                          >
                            <option value="">Profissional: automático</option>
                            {providerOptions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={s.groupNo != null ? String(s.groupNo) : ""}
                            disabled={isPending}
                            onChange={(e) => changeGroup(s, e.target.value)}
                            className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                            aria-label="Atendimento conjunto"
                          >
                            <option value="">Separado</option>
                            {usedGroups.map((g) => (
                              <option key={g} value={String(g)}>
                                Atendimento {g}
                              </option>
                            ))}
                            <option value="new">+ Novo atendimento</option>
                          </select>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {s.plannedMinutes ? `${s.plannedMinutes} min` : ""}
                          {providerName(s.providerId)
                            ? ` · ${providerName(s.providerId)}`
                            : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
    </div>
  );
}
