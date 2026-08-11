"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { summarizePayouts } from "@/lib/finance/payout";
import {
  closePayoutMonth,
  saveCareerLevel,
  savePayoutRate,
  setProviderLevel,
} from "./actions";

type Level = {
  id: string;
  clinicId: string | null;
  name: string;
  sortOrder: number;
  active: boolean;
  description: string;
  reqMonthsMin: number | null;
  reqMonthlyProductionCents: number | null;
  reqResults: string;
  reqEducation: string;
  reqOther: string;
};
type Rate = {
  id: string;
  procedureId: string;
  levelId: string | null;
  providerId: string | null;
  amountCents: number;
  validFrom: string;
  validTo: string | null;
};
type Line = {
  id: string;
  providerId: string;
  providerName: string;
  procedureName: string;
  accrualDate: string;
  amountCents: number;
  closed: boolean;
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * 0212 — o comparativo procedimento × nível.
 *
 * Pedido do dono: "para poder visualizar o resultado quando um dentista junior
 * ou senior executa o procedimento". A tabela de repasse era uma LISTA solta —
 * para responder isso era preciso caçar linha por linha e fazer a conta de
 * cabeça.
 *
 * Célula em cinza itálico = o nível NÃO tem valor próprio; está herdando a
 * comissão do cadastro do procedimento. Traço = nenhum degrau, vai apurar
 * R$ 0,00. É esse buraco que a lista escondia.
 */
function PayoutMatrix({
  levels,
  procedures,
  matrix,
  canEdit,
  today,
  clinicId,
  isPending,
  onSaved,
  startTransition,
}: {
  levels: Level[];
  procedures: { id: string; name: string }[];
  matrix: Record<
    string,
    Record<string, { amountCents: number; source: string }>
  >;
  canEdit: boolean;
  today: string;
  clinicId: string;
  isPending: boolean;
  onSaved: () => void;
  startTransition: (cb: () => void) => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    procedureId: string;
    levelId: string;
  } | null>(null);
  const [value, setValue] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? procedures.filter((p) => p.name.toLowerCase().includes(q))
      : procedures;
    return list.slice(0, 60);
  }, [procedures, search]);

  if (levels.length === 0) return null;

  function startEdit(procedureId: string, levelId: string) {
    const cur = matrix[procedureId]?.[levelId];
    setValue(
      cur && cur.source === "nivel"
        ? (cur.amountCents / 100).toFixed(2).replace(".", ",")
        : ""
    );
    setEditing({ procedureId, levelId });
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await savePayoutRate({
        id: null,
        clinicId,
        procedureId: editing.procedureId,
        levelId: editing.levelId,
        providerId: null,
        amountCents: parseBRLToCents(value) ?? 0,
        validFrom: today,
        validTo: null,
      });
      if (r.ok) {
        toast.success("Valor salvo para este nível.");
        setEditing(null);
        onSaved();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Comparativo por nível</h2>
          <Input
            className="h-8 w-56"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar procedimento"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Quanto o mesmo procedimento custa em repasse conforme{" "}
          <strong>quem executa</strong>. Valor em <em>itálico</em> não é do
          nível: é a comissão do cadastro do procedimento aparecendo igual para
          todos — quem olhar de longe acha que a tabela está pronta.
          {canEdit && " Clique numa célula para definir o valor da unidade."}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-2 font-medium">Procedimento</th>
                {levels.map((l) => (
                  <th key={l.id} className="px-2 py-1 text-right font-medium">
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-dashed last:border-0">
                  <td className="py-1 pr-2">{p.name}</td>
                  {levels.map((l) => {
                    const cell = matrix[p.id]?.[l.id];
                    const isEditing =
                      editing?.procedureId === p.id && editing?.levelId === l.id;
                    return (
                      <td key={l.id} className="px-2 py-1 text-right tabular-nums">
                        {isEditing ? (
                          <span className="flex items-center justify-end gap-1">
                            <Input
                              className="h-7 w-24 text-xs"
                              inputMode="decimal"
                              autoFocus
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") save();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={isPending}
                              onClick={save}
                            >
                              OK
                            </Button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => startEdit(p.id, l.id)}
                            className={cn(
                              "rounded px-1",
                              canEdit && "hover:bg-muted"
                            )}
                          >
                            {!cell ? (
                              <span className="text-destructive">—</span>
                            ) : cell.source === "nivel" ? (
                              formatBRL(cell.amountCents)
                            ) : (
                              <em
                                className="text-muted-foreground"
                                title="Vem do cadastro do procedimento — este nível não tem valor próprio."
                              >
                                {formatBRL(cell.amountCents)}
                              </em>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {procedures.length > shown.length && (
          <p className="text-[11px] text-muted-foreground">
            Mostrando {shown.length} de {procedures.length} procedimentos — use a
            busca para chegar no que falta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PayoutManager({
  clinicId,
  month,
  today,
  canEdit,
  levels,
  rates,
  procedures,
  providers,
  lines,
  matrix,
  closing,
}: {
  clinicId: string;
  month: string;
  today: string;
  canEdit: boolean;
  levels: Level[];
  rates: Rate[];
  procedures: { id: string; name: string }[];
  providers: { id: string; name: string; levelId: string | null }[];
  lines: Line[];
  /** 0212: procedimento → nível → repasse vigente + de onde ele veio. */
  matrix: Record<
    string,
    Record<string, { amountCents: number; source: string }>
  >;
  closing: {
    bonusPercent: number;
    fixedCents: number;
    bonusCents: number;
    totalCents: number;
    status: string;
  } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [bonus, setBonus] = useState(String(closing?.bonusPercent ?? 0));

  // Formulário da tabela.
  const [procedureId, setProcedureId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [amount, setAmount] = useState("");
  const [validFrom, setValidFrom] = useState(today);

  /** 0210: nível em edição — nome, descrição e requisitos para evoluir. */
  const [editLevel, setEditLevel] = useState<Level | null>(null);

  function submitLevel() {
    if (!editLevel) return;
    startTransition(async () => {
      const r = await saveCareerLevel({
        id: editLevel.id || null,
        clinicId: editLevel.clinicId,
        name: editLevel.name,
        sortOrder: editLevel.sortOrder,
        description: editLevel.description,
        reqMonthsMin: editLevel.reqMonthsMin,
        reqMonthlyProductionCents: editLevel.reqMonthlyProductionCents,
        reqResults: editLevel.reqResults,
        reqEducation: editLevel.reqEducation,
        reqOther: editLevel.reqOther,
        active: editLevel.active,
      });
      if (r.ok) {
        toast.success("Nível salvo.");
        setEditLevel(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function emptyLevel(): Level {
    return {
      id: "",
      clinicId: null,
      name: "",
      sortOrder: levels.length + 1,
      active: true,
      description: "",
      reqMonthsMin: null,
      reqMonthlyProductionCents: null,
      reqResults: "",
      reqEducation: "",
      reqOther: "",
    };
  }

  function levelRequirements(l: Level): string {
    const parts = [
      l.reqMonthsMin !== null ? `${l.reqMonthsMin} meses na função` : null,
      l.reqMonthlyProductionCents !== null
        ? `produção ${formatBRL(l.reqMonthlyProductionCents)}/mês`
        : null,
      l.reqResults || null,
      l.reqEducation || null,
      l.reqOther || null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Sem requisitos definidos";
  }

  const procName = useMemo(
    () => new Map(procedures.map((p) => [p.id, p.name])),
    [procedures]
  );
  const levelName = useMemo(
    () => new Map(levels.map((l) => [l.id, l.name])),
    [levels]
  );

  const activeLevels = useMemo(
    () => levels.filter((l) => l.active),
    [levels]
  );

  const bonusNum = Number(bonus.replace(",", ".")) || 0;
  const summary = summarizePayouts(
    lines.map((l) => ({
      providerId: l.providerId,
      providerName: l.providerName,
      amountCents: l.amountCents,
      accrualDate: l.accrualDate,
    })),
    closing?.status === "fechado" ? closing.bonusPercent : bonusNum
  );
  const totalFixed = summary.reduce((s, p) => s + p.fixedCents, 0);
  const totalGeral = summary.reduce((s, p) => s + p.totalCents, 0);
  const semTabela = lines.filter((l) => l.amountCents === 0).length;
  const isClosed = closing?.status === "fechado";

  function addRate() {
    startTransition(async () => {
      const r = await savePayoutRate({
        id: null,
        clinicId,
        procedureId,
        levelId: levelId || null,
        providerId: null,
        amountCents: parseBRLToCents(amount) ?? 0,
        validFrom,
        validTo: null,
      });
      if (r.ok) {
        toast.success("Valor de repasse salvo.");
        setAmount("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function changeLevel(userId: string, value: string) {
    startTransition(async () => {
      const r = await setProviderLevel({
        userId,
        clinicId,
        levelId: value || null,
      });
      if (r.ok) {
        toast.success("Nível atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function closeMonth() {
    startTransition(async () => {
      const r = await closePayoutMonth({
        clinicId,
        month: `${month}-01`,
        bonusPercent: bonusNum,
      });
      if (r.ok) {
        toast.success(
          "Mês fechado — as contas a pagar dos dentistas foram geradas."
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      {/* -- APURAÇÃO DO MÊS -------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              Apuração de {month.split("-").reverse().join("/")}
            </h2>
            {isClosed && (
              <Badge variant="outline" className="text-[10px]">
                <Lock className="mr-1 size-3" />
                Mês fechado
              </Badge>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum procedimento concluído neste mês.
            </p>
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                {summary.map((s) => (
                  <li
                    key={s.providerId}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed py-1 last:border-0"
                  >
                    <span>
                      {s.providerName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.count} procedimento{s.count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatBRL(s.fixedCents)}
                      {s.bonusCents > 0 && (
                        <span className="ml-1 text-xs text-emerald-700">
                          + bônus {formatBRL(s.bonusCents)}
                        </span>
                      )}
                      <strong className="ml-2">{formatBRL(s.totalCents)}</strong>
                    </span>
                  </li>
                ))}
              </ul>

              {semTabela > 0 && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  <strong>{semTabela}</strong> procedimento
                  {semTabela === 1 ? "" : "s"} sem valor de repasse cadastrado —
                  entraram com R$ 0,00. Cadastre na tabela abaixo antes de
                  fechar o mês, senão o dentista recebe a menos.
                </p>
              )}

              <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <label className="block">
                  <Label className="text-[11px]">Bônus do período (%)</Label>
                  <Input
                    className="h-8 w-28"
                    inputMode="decimal"
                    value={bonus}
                    disabled={isClosed || !canEdit}
                    onChange={(e) => setBonus(e.target.value)}
                  />
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    incide sobre o total, não por procedimento
                  </span>
                </label>
                <span className="text-sm">
                  Fixo {formatBRL(totalFixed)} ·{" "}
                  <strong className="text-base">
                    Total {formatBRL(totalGeral)}
                  </strong>
                </span>
                {canEdit && !isClosed && (
                  <Button size="sm" disabled={isPending} onClick={closeMonth}>
                    Fechar o mês e gerar contas a pagar
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* -- COMPARATIVO POR NÍVEL (0212) -------------------------------- */}
      <PayoutMatrix
        levels={activeLevels}
        procedures={procedures}
        matrix={matrix}
        canEdit={canEdit}
        today={today}
        clinicId={clinicId}
        isPending={isPending}
        onSaved={() => router.refresh()}
        startTransition={startTransition}
      />

      {/* -- NÍVEL DE CADA DENTISTA ------------------------------------- */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Nível no plano de carreira</h2>
          <p className="text-xs text-muted-foreground">
            O dentista herda os valores do nível. Valor individual existe, mas é
            exceção — se virar regra, o plano de carreira deixa de significar
            alguma coisa.
          </p>
          {providers.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nenhum dentista nesta unidade.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {providers.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed py-1 last:border-0"
                >
                  <span>{p.name}</span>
                  <select
                    value={p.levelId ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => changeLevel(p.id, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">Sem nível</option>
                    {levels
                      .filter((l) => l.active)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* -- PLANO DE CARREIRA ------------------------------------------ */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Plano de carreira</h2>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setEditLevel(emptyLevel())}
              >
                <Plus className="mr-1 size-4" />
                Novo nível
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Os requisitos são <strong>descritivos</strong>: o sistema não promove
            ninguém sozinho. Promover é decisão de gestão — o que o sistema faz é
            deixar o critério escrito e visível para os dois lados.
          </p>

          <ul className="space-y-1 text-sm">
            {levels.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-dashed py-1 last:border-0"
              >
                <span className="min-w-0">
                  <strong>{l.name}</strong>
                  {l.clinicId === null && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Rede
                    </Badge>
                  )}
                  {!l.active && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Inativo
                    </Badge>
                  )}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {levelRequirements(l)}
                  </span>
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setEditLevel(l)}
                  >
                    Editar
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {editLevel && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <label className="block">
                <Label className="text-[11px]">Nome do nível</Label>
                <Input
                  className="h-8"
                  value={editLevel.name}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, name: e.target.value })
                  }
                  placeholder="Ex.: Pleno"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Ordem</Label>
                <Input
                  className="h-8"
                  type="number"
                  min={0}
                  value={editLevel.sortOrder}
                  onChange={(e) =>
                    setEditLevel({
                      ...editLevel,
                      sortOrder: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">
                  O que se espera de quem está neste nível
                </Label>
                <textarea
                  value={editLevel.description}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, description: e.target.value })
                  }
                  className="mt-0.5 min-h-12 w-full rounded-md border border-input bg-transparent p-2 text-xs"
                />
              </label>

              <p className="sm:col-span-2 text-[11px] font-medium">
                Requisitos para evoluir para o próximo nível
              </p>
              <label className="block">
                <Label className="text-[11px]">Tempo mínimo (meses)</Label>
                <Input
                  className="h-8"
                  type="number"
                  min={0}
                  value={editLevel.reqMonthsMin ?? ""}
                  onChange={(e) =>
                    setEditLevel({
                      ...editLevel,
                      reqMonthsMin: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Produção mensal (R$)</Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={
                    editLevel.reqMonthlyProductionCents !== null
                      ? (editLevel.reqMonthlyProductionCents / 100)
                          .toFixed(2)
                          .replace(".", ",")
                      : ""
                  }
                  onChange={(e) =>
                    setEditLevel({
                      ...editLevel,
                      reqMonthlyProductionCents: e.target.value
                        ? (parseBRLToCents(e.target.value) ?? null)
                        : null,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Indicadores de resultado</Label>
                <Input
                  className="h-8"
                  value={editLevel.reqResults}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, reqResults: e.target.value })
                  }
                  placeholder="Ex.: NPS acima de 80, retrabalho abaixo de 3%"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Formação / experiência</Label>
                <Input
                  className="h-8"
                  value={editLevel.reqEducation}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, reqEducation: e.target.value })
                  }
                  placeholder="Ex.: especialização concluída"
                />
              </label>
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Outros critérios</Label>
                <Input
                  className="h-8"
                  value={editLevel.reqOther}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, reqOther: e.target.value })
                  }
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editLevel.active}
                  onChange={(e) =>
                    setEditLevel({ ...editLevel, active: e.target.checked })
                  }
                />
                <span className="text-xs">Nível ativo</span>
              </label>

              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setEditLevel(null)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isPending || !editLevel.name.trim()}
                  onClick={submitLevel}
                >
                  Salvar nível
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* -- TABELA DE REPASSE ------------------------------------------ */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-medium">Tabela de repasse</h2>
          <p className="text-xs text-muted-foreground">
            Cada linha vale <strong>a partir</strong> da data informada. Mudou o
            valor? Cadastre uma linha nova — o que já foi apurado continua com o
            valor da época.
          </p>

          {canEdit && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-5">
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Procedimento</Label>
                <select
                  value={procedureId}
                  onChange={(e) => setProcedureId(e.target.value)}
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Escolher…</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Nível</Label>
                <select
                  value={levelId}
                  onChange={(e) => setLevelId(e.target.value)}
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">Escolher…</option>
                  {levels
                    .filter((l) => l.active)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Valor (R$)</Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="120,00"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Vale de</Label>
                <Input
                  className="h-8"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </label>
              <div className="sm:col-span-5 flex justify-end">
                <Button
                  size="sm"
                  disabled={isPending || !procedureId || !levelId}
                  onClick={addRate}
                >
                  <Plus className="mr-1 size-4" />
                  Adicionar
                </Button>
              </div>
            </div>
          )}

          {rates.length === 0 ? (
            <p className="py-2 text-xs text-destructive">
              Nenhum valor cadastrado — todo procedimento concluído vai apurar
              R$ 0,00 até a tabela existir.
            </p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {rates.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed py-0.5 last:border-0"
                >
                  <span>
                    {procName.get(r.procedureId) ?? "Procedimento"}
                    <span className="ml-2 text-muted-foreground">
                      {r.levelId
                        ? (levelName.get(r.levelId) ?? "nível")
                        : "individual"}
                      {" · desde "}
                      {fmtDate(r.validFrom)}
                      {r.validTo && ` até ${fmtDate(r.validTo)}`}
                    </span>
                  </span>
                  <strong className="tabular-nums">
                    {formatBRL(r.amountCents)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
