"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import {
  agruparPorEspecialidade,
  pendenciasDoProcedimento,
  ROTULO_DA_PENDENCIA,
  sobraDoPreco,
  textoDoUso,
  type Pendencia,
  type Sobra,
} from "@/lib/procedimento-na-lista";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatBRL,
  formatMinutes,
  intervalSummary,
  parseBRLToCents,
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
  saveProcedurePayoutLevels,
  setProcedureActive,
  setProcedureSessions,
  setUnitPrice,
  cancelarReajusteAgendado,
  historicoDoPreco,
  type LinhaDoHistoricoDePreco,
  type ProcedureInput,
} from "./actions";
import { BRAZIL_TIME_ZONE, todayInBrazil } from "@/lib/dates";
import {
  lerPercentual,
  percentualDoValor,
  textoDoPercentual,
  valorDoPercentual,
} from "@/lib/finance/repasse-percentual";
import { RepasseValorOuPercentual } from "./repasse-valor-percentual";
import {
  dataBr,
  proximoReajuste,
  ROTULO_DA_ORIGEM,
  type Agendamento,
} from "@/lib/vigencia-do-preco";

export type ProcedureKit = {
  id: string;
  name: string;
  scope: string;
  costCents: number;
  items: { name: string; quantity: number; unit: string }[];
};

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

/**
 * O repasse do cadastro com o par ao lado: "R$ 150,00 (30% do preço)".
 *
 * Antes mostrava "10% + R$ 50,00" quando os dois estavam preenchidos — mas o
 * repasse paga SÓ o valor (o percentual é o degrau de baixo, `resolvePayoutRate`).
 * Agora mostra o que vale de verdade.
 */
function commissionLabel(p: Procedure): string {
  if (p.commissionFixedCents > 0) {
    const pct = percentualDoValor(p.commissionFixedCents, p.defaultPriceCents);
    return pct != null
      ? `${formatBRL(p.commissionFixedCents)} (${textoDoPercentual(pct)} do preço)`
      : formatBRL(p.commissionFixedCents);
  }
  if (p.commissionPercent > 0) {
    const v = valorDoPercentual(p.commissionPercent, p.defaultPriceCents);
    return v != null
      ? `${formatBRL(v)} (${textoDoPercentual(p.commissionPercent)} do preço)`
      : `${textoDoPercentual(p.commissionPercent)} do preço (sem preço definido)`;
  }
  return "—";
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
  directSale: false,
  directSaleReception: false,
  directSaleSdr: false,
};

/**
 * O repasse ao abrir o formulário. Percentual antigo (de antes do par R$ ⇄ %)
 * já abre convertido em R$ quando há preço — é o que vai ser gravado. Sem
 * preço não há como converter, e o percentual fica como está.
 */
function repasseNoFormulario(
  p: Procedure
): Pick<ProcedureInput, "commissionFixed" | "commissionPercent"> {
  if (p.commissionFixedCents > 0) {
    return {
      commissionFixed: centsToInput(p.commissionFixedCents),
      commissionPercent: "",
    };
  }
  if (p.commissionPercent > 0) {
    const v = valorDoPercentual(p.commissionPercent, p.defaultPriceCents);
    return v != null
      ? { commissionFixed: centsToInput(v), commissionPercent: "" }
      : {
          commissionFixed: "",
          commissionPercent: String(p.commissionPercent).replace(".", ","),
        };
  }
  return { commissionFixed: "", commissionPercent: "" };
}

function toInput(p: Procedure): ProcedureInput {
  return {
    name: p.name,
    tussCode: p.tussCode ?? "",
    specialty: p.specialty ?? "",
    pillar: p.pillar ?? "",
    defaultPrice: centsToInput(p.defaultPriceCents),
    minPrice: p.minPriceCents != null ? centsToInput(p.minPriceCents) : "",
    maxPrice: p.maxPriceCents != null ? centsToInput(p.maxPriceCents) : "",
    ...repasseNoFormulario(p),
    estimatedMinutes: p.estimatedMinutes != null ? String(p.estimatedMinutes) : "",
    directSale: p.directSale ?? false,
    directSaleReception: p.directSaleReception ?? false,
    directSaleSdr: p.directSaleSdr ?? false,
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
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
  mostrarVigencia = false,
}: {
  value: ProcedureInput;
  onChange: (patch: Partial<ProcedureInput>) => void;
  specialties: string[];
  /** 0309: na edição, o preço pode valer a partir de uma data futura. */
  mostrarVigencia?: boolean;
}) {
  // Inclui o valor atual (mesmo que seja antigo/desativado) para não se perder.
  const specialtyOptions =
    value.specialty && !specialties.includes(value.specialty)
      ? [value.specialty, ...specialties]
      : specialties;
  const precoDoFormulario = value.defaultPrice.trim()
    ? parseBRLToCents(value.defaultPrice)
    : null;
  // Percentual gravado antes da 0.352.0 que não deu para converter (sem preço).
  const percentualAntigo =
    !value.commissionFixed.trim() && value.commissionPercent.trim()
      ? lerPercentual(value.commissionPercent)
      : null;
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
      {mostrarVigencia && (
        <div>
          <Label>O preço vale a partir de</Label>
          <Input
            type="date"
            min={todayInBrazil()}
            value={value.priceValidFrom || todayInBrazil()}
            onChange={(e) => onChange({ priceValidFrom: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Hoje = vale na hora. Data futura = o reajuste fica agendado e o
            sistema aplica sozinho na data; até lá vale o preço atual.
          </p>
        </div>
      )}
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
      <div className="sm:col-span-2">
        <Label>Repasse ao dentista (comissão)</Label>
        <div className="max-w-sm">
          <RepasseValorOuPercentual
            valor={value.commissionFixed}
            // Digitou R$ ou % → grava em R$; o percentual antigo sai junto.
            onValor={(v) => onChange({ commissionFixed: v, commissionPercent: "" })}
            precoCents={precoDoFormulario}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Digite o valor <strong>ou</strong> o percentual do preço padrão: o
          outro aparece sozinho. O que fica gravado é o valor em R$ — se o
          preço mudar depois, o repasse continua o mesmo e o percentual
          muda. Vale para o nível de carreira sem valor próprio.
        </p>
        {percentualAntigo != null && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Este procedimento tem repasse de{" "}
            {textoDoPercentual(percentualAntigo)} gravado antes desta tela.
            Defina o preço padrão para ele virar valor em R$.
          </p>
        )}
      </div>

      {/* Venda direta na unidade (docs/COMERCIAL.md §7.3). */}
      <div className="rounded-lg border bg-muted/30 p-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={value.directSale}
            onChange={(e) => onChange({ directSale: e.target.checked })}
          />
          <ShoppingCart className="size-4" />
          Autorizado para VENDA DIRETA na unidade
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pode ser vendido direto na clínica (urgência, consulta avulsa,
          limpeza...), sem passar pelo Centro de Planejamento.
        </p>
        {value.directSale && (
          <div className="mt-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              Quem pode <strong>lançar</strong> este procedimento? (Gerente e
              Coordenador Clínico já podem lançar todos.)
            </p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.directSaleReception}
                  onChange={(e) =>
                    onChange({ directSaleReception: e.target.checked })
                  }
                />
                Recepção
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.directSaleSdr}
                  onChange={(e) => onChange({ directSaleSdr: e.target.checked })}
                />
                SDR
              </label>
            </div>
          </div>
        )}
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
  adjustedByProcedure = {},
  changesByProcedure,
  sessionsByProcedure,
  unitSessionsByProcedure,
  canManageCatalog,
  canEditNetworkSessions,
  isAdmin,
  levels = [],
  payoutByProcedure = {},
  canEditPayout = false,
  kitsByProcedure = {},
  usageByProcedure = null,
  agendamentos = [],
  nomesDasUnidades = {},
}: {
  procedures: Procedure[];
  specialties: string[];
  selectedUnitId: string;
  unitName: string | null;
  overrides: UnitPrice[];
  /** No modo REDE: unidades que têm preço próprio, por procedimento. */
  adjustedByProcedure?: Record<
    string,
    { unitName: string; priceCents: number }[]
  >;
  changesByProcedure: Record<string, ProcedureChange[]>;
  sessionsByProcedure: Record<string, ProcedureSession[]>;
  unitSessionsByProcedure: Record<string, ProcedureSession[]>;
  canManageCatalog: boolean;
  /** OC-00068: o Planner edita direto as sessões da rede (Admin também). */
  canEditNetworkSessions: boolean;
  /** Admin aplica protocolo direto; Planner (não-admin) apenas propõe. */
  isAdmin: boolean;
  /** 0212: níveis do plano de carreira, para o repasse por nível. */
  levels?: { id: string; name: string }[];
  payoutByProcedure?: Record<
    string,
    Record<string, { amountCents: number; source: string }>
  >;
  canEditPayout?: boolean;
  /** 0216: kits vinculados a cada procedimento, com o que compõe cada um. */
  kitsByProcedure?: Record<string, ProcedureKit[]>;
  /** 0307: em quantos planos cada procedimento entrou em 90 dias. Nulo = não
   *  foi possível medir (a tela esconde, nunca mostra "0"). */
  usageByProcedure?: Record<string, number> | null;
  /** 0309: reajustes agendados (ainda não aplicados), de toda a rede. */
  agendamentos?: Agendamento[];
  nomesDasUnidades?: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const networkMode = selectedUnitId === "";
  const overrideByProc = new Map(overrides.map((o) => [o.procedureId, o.priceCents]));

  const [adding, setAdding] = useState(false);
  const [newProc, setNewProc] = useState<ProcedureInput>(EMPTY);

  // Pedido do dono (19/10/2026): blocos por especialidade, uma linha de resumo
  // por procedimento (clique abre; um aberto por vez) e os inativos à parte.
  const levelIds = levels.map((l) => l.id);
  const pendenciasDe = (p: Procedure) =>
    pendenciasDoProcedimento({
      defaultPriceCents: p.defaultPriceCents,
      estimatedMinutes: p.estimatedMinutes ?? null,
      sessionsCount: (sessionsByProcedure[p.id] ?? []).length,
      pillar: p.pillar ?? null,
      levelIds,
      payoutByLevel: payoutByProcedure[p.id] ?? {},
    });
  const ativos = procedures.filter((p) => p.isActive);
  const inativos = procedures.filter((p) => !p.isActive);
  const comPendencia = ativos.filter((p) => pendenciasDe(p).length > 0).length;
  const [somentePendentes, setSomentePendentes] = useState(false);
  const visiveis = somentePendentes
    ? ativos.filter((p) => pendenciasDe(p).length > 0)
    : ativos;
  const grupos = agruparPorEspecialidade(visiveis, specialties);
  // Lista curta (busca, filtro) já abre; a longa abre fechada, por blocos.
  const [abertos, setAbertos] = useState<Set<string>>(() =>
    visiveis.length <= 40 ? new Set(grupos.map((g) => g.especialidade)) : new Set()
  );
  const [verInativos, setVerInativos] = useState(ativos.length === 0);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  function alternarGrupo(nome: string) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(nome)) novo.delete(nome);
      else novo.add(nome);
      return novo;
    });
  }

  const linha = (p: Procedure, inativo: boolean) => {
    const kits = kitsByProcedure[p.id] ?? [];
    const precoCents = networkMode
      ? p.defaultPriceCents
      : (overrideByProc.get(p.id) ?? p.defaultPriceCents);
    return (
      <ProcedureRow
        key={p.id}
        procedure={p}
        specialties={specialties}
        networkMode={networkMode}
        selectedUnitId={selectedUnitId}
        overrideCents={overrideByProc.get(p.id) ?? null}
        adjustedUnits={adjustedByProcedure[p.id] ?? []}
        changes={changesByProcedure[p.id] ?? []}
        sessions={sessionsByProcedure[p.id] ?? []}
        unitSessions={unitSessionsByProcedure[p.id] ?? []}
        canManageCatalog={canManageCatalog}
        canEditNetworkSessions={canEditNetworkSessions}
        isAdmin={isAdmin}
        isPending={isPending}
        run={run}
        levels={levels}
        payoutByLevel={payoutByProcedure[p.id] ?? {}}
        canEditPayout={canEditPayout}
        kits={kits}
        open={abertoId === p.id}
        onToggle={() => setAbertoId((id) => (id === p.id ? null : p.id))}
        pendencias={inativo ? [] : pendenciasDe(p)}
        sobra={sobraDoPreco(
          precoCents,
          kits.reduce((s, k) => s + k.costCents, 0),
          payoutByProcedure[p.id] ?? {}
        )}
        uso={usageByProcedure ? (usageByProcedure[p.id] ?? 0) : null}
        inativo={inativo}
        agendamentos={agendamentos.filter((a) => a.procedureId === p.id)}
        nomesDasUnidades={nomesDasUnidades}
      />
    );
  };

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

      {/* 0212: reajuste e comissão em massa MUDARAM para a Precificação —
          mexer em preço sem ver a margem é o que a tela nova existe para
          impedir. Fica o caminho, para ninguém procurar o botão sumido. */}
      {networkMode && canManageCatalog && (
        <p className="rounded-md border bg-muted/30 p-2 text-sm text-muted-foreground">
          <strong>Reajuste de preços</strong> e <strong>comissão em massa</strong>{" "}
          agora ficam em{" "}
          <Link
            href="/procedimentos/precificacao"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Precificação
          </Link>
          , ao lado do custo e da margem que eles alteram.
        </p>
      )}

      {!networkMode && (
        <p className="rounded-md border bg-muted/30 p-2 text-sm text-muted-foreground">
          Editando os preços da unidade <strong>{unitName}</strong>. Deixe em
          branco para a unidade usar o preço padrão da rede.
        </p>
      )}

      {procedures.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhum procedimento encontrado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* O resumo do que está na tela, e o atalho para o que falta. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <span>
              <strong>{ativos.length}</strong> ativo{ativos.length === 1 ? "" : "s"}
              {comPendencia > 0 ? (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-3.5" />
                  {comPendencia} com pendência
                </span>
              ) : (
                ativos.length > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    todos completos
                  </span>
                )
              )}
              {inativos.length > 0 && (
                <span className="ml-2 text-muted-foreground">
                  · {inativos.length} inativo{inativos.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {(comPendencia > 0 || somentePendentes) && (
                <Button
                  size="sm"
                  variant={somentePendentes ? "default" : "outline"}
                  onClick={() => {
                    const proximo = !somentePendentes;
                    setSomentePendentes(proximo);
                    // Ver só o que falta = abrir os blocos que sobram.
                    if (proximo) {
                      setAbertos(
                        new Set(
                          agruparPorEspecialidade(
                            ativos.filter((p) => pendenciasDe(p).length > 0),
                            specialties
                          ).map((g) => g.especialidade)
                        )
                      );
                    }
                  }}
                >
                  {somentePendentes ? "Mostrar todos" : "Só os com pendência"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAbertos(new Set(grupos.map((g) => g.especialidade)))}
              >
                Abrir todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAbertos(new Set())}>
                Fechar todos
              </Button>
            </span>
          </div>

          {grupos.map((g) => {
            const aberto = abertos.has(g.especialidade);
            const pendentes = g.itens.filter((p) => pendenciasDe(p).length > 0).length;
            return (
              <section key={g.especialidade} className="rounded-lg border bg-card">
                <button
                  type="button"
                  onClick={() => alternarGrupo(g.especialidade)}
                  aria-expanded={aberto}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {aberto ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                    {g.especialidade}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {g.itens.length}
                    </span>
                  </span>
                  {pendentes > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" />
                      {pendentes} com pendência
                    </span>
                  )}
                </button>
                {aberto && (
                  <ul className="space-y-2 border-t p-2">
                    {g.itens.map((p) => linha(p, false))}
                  </ul>
                )}
              </section>
            );
          })}

          {/* Inativos: nunca no meio dos ativos (pedido do dono). */}
          {inativos.length > 0 && (
            <section className="rounded-lg border border-dashed bg-muted/40">
              <button
                type="button"
                onClick={() => setVerInativos((v) => !v)}
                aria-expanded={verInativos}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left font-semibold text-muted-foreground hover:bg-muted/60"
              >
                {verInativos ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Inativos
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {inativos.length}
                </span>
                <span className="text-xs font-normal">
                  — fora do orçamento e da venda; reative para voltar a usar
                </span>
              </button>
              {verInativos && (
                <ul className="space-y-2 border-t border-dashed p-2">
                  {inativos.map((p) => linha(p, true))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 0212 — o repasse de cada NÍVEL, ao lado da comissão do procedimento.
 *
 * Pedido do dono: "nos procedimentos onde é lançado o repasse para o dentista
 * deve também ter a informação de repasse para cada nível". Sem isto, o
 * cadastro mostrava só a comissão do procedimento — que é o ÚLTIMO degrau, o
 * que vale quando o nível não tem valor próprio. Quem olhasse a tela concluiria
 * que todo dentista custa igual.
 *
 * Valor em itálico = veio do cadastro do procedimento, não do nível. Os dois
 * mostram o mesmo R$, e é justamente essa diferença que o gestor precisa ver.
 */
function PayoutByLevel({
  procedureId,
  priceCents,
  levels,
  payoutByLevel,
  canEdit,
  isPending,
  run,
}: {
  procedureId: string;
  /** Preço padrão: a base do percentual de cada nível (par R$ ⇄ %). */
  priceCents: number;
  levels: { id: string; name: string }[];
  payoutByLevel: Record<string, { amountCents: number; source: string }>;
  canEdit: boolean;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  function startEdit() {
    const next: Record<string, string> = {};
    for (const l of levels) {
      const v = payoutByLevel[l.id];
      next[l.id] =
        v && v.source === "nivel" ? centsToInput(v.amountCents) : "";
    }
    setDraft(next);
    setEditing(true);
  }

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Repasse por nível</span>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => (editing ? setEditing(false) : startEdit())}
          >
            {editing ? "Cancelar" : "Editar"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            {levels.map((l) => (
              <RepasseValorOuPercentual
                key={l.id}
                compacto
                rotulo={l.name}
                valor={draft[l.id] ?? ""}
                onValor={(v) => setDraft((d) => ({ ...d, [l.id]: v }))}
                precoCents={priceCents}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Digite o valor <strong>ou</strong> o percentual do preço padrão; o
            que fica gravado é o valor em R$. Valor da <strong>rede</strong>,
            valendo a partir de hoje. A unidade que tem contrato próprio
            sobrescreve em Financeiro › Repasses, e o que já foi apurado
            continua com o valor da época. Em branco = o nível usa o repasse
            do cadastro do procedimento.
          </p>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  saveProcedurePayoutLevels({
                    procedureId,
                    values: levels
                      .filter((l) => (draft[l.id] ?? "").trim() !== "")
                      .map((l) => ({ levelId: l.id, amount: draft[l.id] })),
                  }),
                "Repasse por nível salvo.",
                () => setEditing(false)
              )
            }
          >
            Salvar repasses
          </Button>
        </div>
      ) : (
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
          {levels.map((l) => {
            const v = payoutByLevel[l.id];
            return (
              <span key={l.id}>
                {l.name}:{" "}
                {!v ? (
                  <span className="text-destructive">sem repasse</span>
                ) : v.source === "nivel" ? (
                  <strong className="text-foreground tabular-nums">
                    {formatBRL(v.amountCents)}
                  </strong>
                ) : (
                  <em
                    className="tabular-nums"
                    title="Valor do cadastro do procedimento — este nível não tem valor próprio."
                  >
                    {formatBRL(v.amountCents)}
                  </em>
                )}
                {v && <PercentualDoNivel valorCents={v.amountCents} priceCents={priceCents} />}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}

/** "· 30%" ao lado do valor do nível; nada quando não há preço. */
function PercentualDoNivel({
  valorCents,
  priceCents,
}: {
  valorCents: number;
  priceCents: number;
}) {
  const pct = percentualDoValor(valorCents, priceCents);
  if (pct == null) return null;
  return <span className="tabular-nums"> · {textoDoPercentual(pct)}</span>;
}

function ProcedureRow({
  procedure: p,
  specialties,
  networkMode,
  selectedUnitId,
  overrideCents,
  adjustedUnits = [],
  changes,
  sessions,
  unitSessions,
  canManageCatalog,
  canEditNetworkSessions,
  isAdmin,
  isPending,
  run,
  levels,
  payoutByLevel,
  canEditPayout,
  kits,
  open,
  onToggle,
  pendencias,
  sobra,
  uso,
  inativo,
  agendamentos,
  nomesDasUnidades,
}: {
  procedure: Procedure;
  specialties: string[];
  networkMode: boolean;
  selectedUnitId: string;
  overrideCents: number | null;
  /** Modo rede: unidades com preço próprio (para avisar que existe ajuste). */
  adjustedUnits?: { unitName: string; priceCents: number }[];
  changes: ProcedureChange[];
  sessions: ProcedureSession[];
  unitSessions: ProcedureSession[];
  canManageCatalog: boolean;
  /** OC-00068: o Planner edita direto as sessões da rede (Admin também). */
  canEditNetworkSessions: boolean;
  isAdmin: boolean;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
  /** 0212: níveis do plano de carreira (rede + unidade ativa). */
  levels: { id: string; name: string }[];
  /** Repasse vigente deste procedimento por nível. */
  payoutByLevel: Record<string, { amountCents: number; source: string }>;
  canEditPayout: boolean;
  kits: ProcedureKit[];
  /** A linha está aberta (detalhes à mostra). Uma por vez, quem manda é a lista. */
  open: boolean;
  onToggle: () => void;
  /** O que falta para estar pronto para o orçamento (vazio = completo). */
  pendencias: Pendencia[];
  /** Preço − material − maior repasse; nulo sem preço. */
  sobra: Sobra | null;
  /** Planos em 90 dias; nulo = não medido. */
  uso: number | null;
  inativo: boolean;
  /** 0309: os reajustes agendados DESTE procedimento (rede e unidades). */
  agendamentos: Agendamento[];
  nomesDasUnidades: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [showKits, setShowKits] = useState(false);
  const [form, setForm] = useState<ProcedureInput>(() => toInput(p));
  const [showHistory, setShowHistory] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [unitPrice, setUnitPriceValue] = useState(
    overrideCents != null ? centsToInput(overrideCents) : ""
  );
  const [unitValidFrom, setUnitValidFrom] = useState("");
  const proximo = proximoReajuste(agendamentos, p.id, networkMode ? null : selectedUnitId);

  // OC-00068 (decisão do dono, 19/10/2026): Admin e Planner aplicam direto o
  // protocolo da REDE. Na unidade: Admin e Coordenador aplicam; o Planner
  // propõe. (Coordenador = acessa a unidade sem ver o catálogo da rede.)
  const networkPanelMode: "apply" | "propose" =
    isAdmin || canEditNetworkSessions ? "apply" : "propose";
  const unitPanelMode: "apply" | "propose" =
    isAdmin || !canEditNetworkSessions ? "apply" : "propose";

  if (editing) {
    return (
      <li className="space-y-3 rounded-lg border-2 border-primary/50 bg-card p-3">
        <ProcedureFields
          value={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          specialties={specialties}
          mostrarVigencia
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

  const tempo =
    sessions.length > 0
      ? protocolSummary(sessions)
      : p.estimatedMinutes != null && p.estimatedMinutes > 0
        ? formatMinutes(p.estimatedMinutes)
        : null;
  const precoNaTela = networkMode ? p.defaultPriceCents : (overrideCents ?? p.defaultPriceCents);
  const textoUso = textoDoUso(uso);

  // Cada procedimento é um CARTÃO (pedido do dono: "difícil entender quando
  // muda de um procedimento para outro"). Inativo: cinza, tracejado, apagado.
  const cartao = inativo
    ? "rounded-lg border border-dashed bg-muted/60 text-muted-foreground"
    : open
      ? "rounded-lg border-2 border-primary/50 bg-card shadow-sm"
      : "rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40";

  return (
    <li className={cartao}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-left"
        >
          <span className="min-w-0">
            <span className={`flex flex-wrap items-center gap-1.5 font-medium ${inativo ? "line-through decoration-1" : ""}`}>
              {p.name}
              {inativo && (
                <Badge variant="outline" className="border-muted-foreground/50 bg-background text-[10px] font-semibold uppercase no-underline">
                  Inativo
                </Badge>
              )}
              {!inativo && p.pillar && (
                <Badge className="bg-gold text-gold-foreground text-[10px]">
                  {PILLAR_LABELS[p.pillar]}
                </Badge>
              )}
              {/* Indicador de venda direta + quem pode lançar (§7.3). */}
              {!inativo && p.directSale && (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-300 bg-emerald-50 text-[10px] text-emerald-800"
                  title="Autorizado para venda direta na unidade"
                >
                  <ShoppingCart className="size-3" />
                  Venda direta
                  {(p.directSaleReception || p.directSaleSdr) && (
                    <span className="opacity-80">
                      ·{" "}
                      {[
                        p.directSaleReception && "Recepção",
                        p.directSaleSdr && "SDR",
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </span>
                  )}
                </Badge>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {p.code && <span className="font-mono text-gold-tinta">{p.code}</span>}
              {p.tussCode && <span>TUSS {p.tussCode}</span>}
              {inativo && p.specialty && <span>{p.specialty}</span>}
            </span>
          </span>

          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {precoNaTela > 0 ? formatBRL(precoNaTela) : <span className="text-muted-foreground">sem preço</span>}
              {!networkMode && overrideCents != null && (
                <span className="ml-1 text-[10px] font-normal text-primary">unidade</span>
              )}
            </span>
            {!inativo && proximo && (
              <span
                className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300"
                title="Reajuste agendado — o sistema aplica sozinho na data"
              >
                {formatBRL(proximo.priceCents)} a partir de {dataBr(proximo.validFrom)}
              </span>
            )}
            {tempo && <span className="text-muted-foreground">{tempo}</span>}
            {!inativo && sobra && (
              <span
                className={sobra.negativa ? "font-medium text-destructive" : "text-muted-foreground"}
                title="Preço − material do kit − o maior repasse entre os níveis. Cadeira, imposto e taxa ficam na Precificação."
              >
                sobra {formatBRL(sobra.sobraCents)} ({sobra.percentual}%)
              </span>
            )}
            {!inativo && textoUso && (
              <span className={uso === 0 ? "text-muted-foreground/80" : "text-muted-foreground"}>
                {textoUso}
              </span>
            )}
            {!inativo &&
              (pendencias.length > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  title="O que falta para o procedimento estar pronto para o orçamento"
                >
                  <AlertTriangle className="size-3" />
                  falta {pendencias.map((x) => ROTULO_DA_PENDENCIA[x]).join(" · ")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="size-3" />
                  completo
                </span>
              ))}
            {open ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </span>
        </button>
        {/* Reativar à vista, sem abrir: é o que se faz com um inativo. */}
        {inativo && canManageCatalog && networkMode && (
          <div className="flex items-center pr-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => setProcedureActive(p.id, true), "Reativado.")}
            >
              Reativar
            </Button>
          </div>
        )}
      </div>

      {open && (
      <div className="space-y-2 border-t px-3 pb-3 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {p.specialty && <span>{p.specialty}</span>}
            <span>Padrão: {formatBRL(p.defaultPriceCents)}</span>
            {/* Modo rede: avisa que alguma unidade tem preço próprio, senão
                parece que o ajuste da unidade se perdeu. */}
            {networkMode && adjustedUnits.length > 0 && (
              <span
                className="rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
                title={adjustedUnits
                  .map((u) => `${u.unitName}: ${formatBRL(u.priceCents)}`)
                  .join(" · ")}
              >
                {adjustedUnits.length === 1
                  ? `ajustado: ${adjustedUnits[0].unitName} ${formatBRL(adjustedUnits[0].priceCents)}`
                  : `ajustado em ${adjustedUnits.length} unidades`}
              </span>
            )}
            {(p.minPriceCents != null || p.maxPriceCents != null) && (
              <span>
                Faixa: {p.minPriceCents != null ? formatBRL(p.minPriceCents) : "—"}
                {" a "}
                {p.maxPriceCents != null ? formatBRL(p.maxPriceCents) : "—"}
              </span>
            )}
            <span>Repasse: {commissionLabel(p)}</span>
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
            {/* OC-00068: cadastro, ativação e exclusão são da rede (Admin). */}
            {canManageCatalog && (
              <>
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
              </>
            )}
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
                <span className="text-xs text-muted-foreground">a partir de</span>
                <Input
                  type="date"
                  aria-label="O preço da unidade vale a partir de"
                  min={todayInBrazil()}
                  value={unitValidFrom || todayInBrazil()}
                  onChange={(e) => setUnitValidFrom(e.target.value)}
                  className="w-40"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => setUnitPrice(selectedUnitId, p.id, unitPrice, unitValidFrom),
                      unitValidFrom && unitValidFrom > todayInBrazil()
                        ? "Preço da unidade agendado."
                        : "Preço da unidade salvo."
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

      <PrecoNoTempo
        procedureId={p.id}
        agendamentos={agendamentos}
        nomesDasUnidades={nomesDasUnidades}
        podeCancelar={canManageCatalog}
        isPending={isPending}
        run={run}
      />

      {/* 0216: os kits que este procedimento consome, e o que tem dentro —
          sem sair do catálogo e sem entrar em modo de edição. */}
      {kits.length > 0 && (
        <div className="mt-2 rounded-md border bg-muted/20 p-2 text-xs">
          <button
            type="button"
            onClick={() => setShowKits((s) => !s)}
            className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
          >
            <span>
              <strong>
                {kits.length} kit{kits.length === 1 ? "" : "s"}
              </strong>{" "}
              <span className="text-muted-foreground">
                {kits.map((k) => k.name).join(" · ")}
              </span>
            </span>
            <span className="tabular-nums">
              material{" "}
              <strong>
                {formatBRL(kits.reduce((s, k) => s + k.costCents, 0))}
              </strong>
              <span className="ml-2 text-muted-foreground">
                {showKits ? "ocultar" : "ver itens"}
              </span>
            </span>
          </button>

          {showKits && (
            <div className="mt-1 space-y-1 border-t pt-1">
              {kits.map((k) => (
                <div key={k.id}>
                  <p className="font-medium">
                    {k.name}
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      {k.scope === "rede" ? "Rede" : "Unidade"}
                    </Badge>
                    <span className="ml-2 tabular-nums text-muted-foreground">
                      {formatBRL(k.costCents)}
                    </span>
                  </p>
                  <ul className="ml-3 text-muted-foreground">
                    {k.items.map((it, idx) => (
                      <li key={idx}>
                        {it.name} — {it.quantity} {it.unit}
                        {it.quantity === 1 ? "" : "s"}
                      </li>
                    ))}
                    {k.items.length === 0 && <li>Kit sem itens.</li>}
                  </ul>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                O custo é calculado ao custo médio da sua unidade, na hora. Para
                mudar, edite o kit em Estoque.
              </p>
            </div>
          )}
        </div>
      )}

      {networkMode && levels.length > 0 && (
        <PayoutByLevel
          procedureId={p.id}
          priceCents={p.defaultPriceCents}
          levels={levels}
          payoutByLevel={payoutByLevel}
          canEdit={canEditPayout}
          isPending={isPending}
          run={run}
        />
      )}

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
      </div>
      )}
    </li>
  );
}

/**
 * 0309 — o preço no tempo: os reajustes agendados (com Cancelar, para o
 * Admin) e o histórico de preço, lido do banco só quando se pede.
 */
function PrecoNoTempo({
  procedureId,
  agendamentos,
  nomesDasUnidades,
  podeCancelar,
  isPending,
  run,
}: {
  procedureId: string;
  agendamentos: Agendamento[];
  nomesDasUnidades: Record<string, string>;
  podeCancelar: boolean;
  isPending: boolean;
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) => void;
}) {
  const [historico, setHistorico] = useState<LinhaDoHistoricoDePreco[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const onde = (clinicId: string | null) =>
    clinicId ? (nomesDasUnidades[clinicId] ?? "unidade") : "Rede";

  async function abrirHistorico() {
    if (historico) {
      setHistorico(null);
      return;
    }
    setLendo(true);
    const r = await historicoDoPreco(procedureId);
    setLendo(false);
    if (r.ok) {
      setErro(null);
      setHistorico(r.linhas);
    } else setErro(r.error);
  }

  return (
    <div className="mt-2 space-y-1 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Preço no tempo</span>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={lendo} onClick={abrirHistorico}>
          {historico ? "Ocultar histórico" : lendo ? "Lendo…" : "Ver histórico de preço"}
        </Button>
      </div>
      {agendamentos.length > 0 ? (
        <ul className="space-y-0.5">
          {agendamentos
            .slice()
            .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
            .map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-300 bg-sky-50 px-1.5 text-[10px] font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  agendado
                </span>
                <span>
                  {onde(a.clinicId)}: <strong className="tabular-nums">{formatBRL(a.priceCents)}</strong> a partir de{" "}
                  {dataBr(a.validFrom)}
                  {a.note && <span className="text-muted-foreground"> · {a.note}</span>}
                </span>
                {podeCancelar && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] text-destructive"
                    disabled={isPending}
                    onClick={() => run(() => cancelarReajusteAgendado(a.id), "Reajuste cancelado.")}
                  >
                    Cancelar
                  </Button>
                )}
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nenhum reajuste agendado.</p>
      )}
      {erro && <p className="text-destructive">{erro}</p>}
      {historico && (
        <ul className="space-y-0.5 border-t pt-1">
          {historico.length === 0 && <li className="text-muted-foreground">Sem histórico registrado.</li>}
          {historico.map((h, i) => (
            <li key={i} className="tabular-nums">
              {dataBr(h.validFrom)} · {onde(h.clinicId)}:{" "}
              <strong>{h.priceCents == null ? "volta ao preço da rede" : formatBRL(h.priceCents)}</strong>{" "}
              <span className="text-muted-foreground">
                ({ROTULO_DA_ORIGEM[h.source] ?? h.source}
                {h.quem ? ` · ${h.quem}` : ""})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
