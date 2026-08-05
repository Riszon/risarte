"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  CARD_MODALITIES,
  CARD_MODALITY_LABELS,
  computeSettlement,
  hasInstallmentRange,
  type AcquirerRate,
  type CardModality,
} from "@/lib/finance/acquirers";
import { deleteRate, saveAcquirer, saveRate } from "./actions";

export type AcquirerRow = {
  id: string;
  name: string;
  isDefault: boolean;
  notes: string | null;
  active: boolean;
};

const EMPTY_ACQUIRER: AcquirerRow = {
  id: "",
  name: "",
  isDefault: false,
  notes: null,
  active: true,
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function AcquirerManager({
  clinicId,
  acquirers,
  rates,
  today,
  canEdit,
}: {
  clinicId: string;
  acquirers: AcquirerRow[];
  rates: AcquirerRate[];
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AcquirerRow | null>(null);
  const [rateFor, setRateFor] = useState<AcquirerRow | null>(null);

  // Formulário de taxa
  const [modality, setModality] = useState<CardModality>("credito_avista");
  const [minInst, setMinInst] = useState(1);
  const [maxInst, setMaxInst] = useState(1);
  const [fee, setFee] = useState("");
  const [fixedFee, setFixedFee] = useState("");
  const [days, setDays] = useState(30);
  const [businessDays, setBusinessDays] = useState(false);
  const [freeCount, setFreeCount] = useState("");
  const [validFrom, setValidFrom] = useState(today);

  function saveAcq() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveAcquirer({
        id: editing.id || null,
        clinicId,
        name: editing.name,
        isDefault: editing.isDefault,
        notes: editing.notes ?? "",
        active: editing.active,
      });
      if (r.ok) {
        toast.success("Adquirente salva.");
        setEditing(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function addRate() {
    if (!rateFor) return;
    startTransition(async () => {
      const r = await saveRate({
        id: null,
        acquirerId: rateFor.id,
        modality,
        minInstallments: hasInstallmentRange(modality) ? minInst : 1,
        maxInstallments: hasInstallmentRange(modality) ? maxInst : 1,
        feePercent: Number(fee.replace(",", ".")) || 0,
        fixedFeeCents: parseBRLToCents(fixedFee) ?? 0,
        settlementDays: days,
        settlementBusinessDays: businessDays,
        freeMonthlyCount: freeCount.trim() ? Number(freeCount) : null,
        validFrom,
        validTo: null,
      });
      if (r.ok) {
        toast.success("Taxa salva.");
        setFee("");
        setFixedFee("");
        setFreeCount("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function removeRate(id: string) {
    startTransition(async () => {
      const r = await deleteRate({ id });
      if (r.ok) {
        toast.success("Taxa removida.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  // Prévia em DOIS valores: numa cobrança pequena a taxa fixa pesa mais que o
  // percentual, e é isso que o cadastro precisa deixar claro.
  const rateShape = {
    feePercent: Number(fee.replace(",", ".")) || 0,
    fixedFeeCents: parseBRLToCents(fixedFee) ?? 0,
    settlementDays: days,
    settlementBusinessDays: businessDays,
    freeMonthlyCount: null,
  };
  const hasRate = fee.trim() !== "" || fixedFee.trim() !== "";
  const previewBig = hasRate
    ? computeSettlement({ grossCents: 100000, rate: rateShape, paidAt: today })
    : null;
  const previewSmall = hasRate
    ? computeSettlement({ grossCents: 5000, rate: rateShape, paidAt: today })
    : null;

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_ACQUIRER })}>
            <Plus className="mr-1 size-4" />
            Nova adquirente
          </Button>
        </div>
      )}

      {acquirers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma adquirente cadastrada. Enquanto não houver, o sistema assume
            que o dinheiro do cartão cai no próprio vencimento e sem taxa — o
            que infla a receita e a projeção de caixa.
          </CardContent>
        </Card>
      ) : (
        acquirers.map((a) => {
          const mine = rates.filter((r) => r.acquirerId === a.id);
          return (
            <Card key={a.id} className={cn(!a.active && "opacity-60")}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {a.name}
                    {a.isDefault && (
                      <Badge className="bg-gold/20 text-[10px] text-gold-foreground">
                        <Star className="mr-1 size-3" />
                        Padrão
                      </Badge>
                    )}
                    {!a.active && (
                      <Badge variant="outline" className="text-[10px]">
                        Inativa
                      </Badge>
                    )}
                  </span>
                  {canEdit && (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          setRateFor(a);
                          setModality("credito_avista");
                          setMinInst(1);
                          setMaxInst(1);
                          setFee("");
                          setDays(30);
                          setValidFrom(today);
                        }}
                      >
                        Taxas ({mine.length})
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => setEditing(a)}
                      >
                        Editar
                      </Button>
                    </span>
                  )}
                </div>

                {mine.length === 0 ? (
                  <p className="text-xs text-destructive">
                    Sem taxa cadastrada — as vendas no cartão desta adquirente
                    não terão taxa nem prazo calculados.
                  </p>
                ) : (
                  <ul className="space-y-0.5 text-xs">
                    {mine.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed py-0.5 last:border-0"
                      >
                        <span>
                          {CARD_MODALITY_LABELS[r.modality]}
                          {r.modality === "credito_parcelado" &&
                            ` ${r.minInstallments}× a ${r.maxInstallments}×`}
                          <span className="ml-2 text-muted-foreground">
                            desde {fmtDate(r.validFrom)}
                            {r.validTo && ` até ${fmtDate(r.validTo)}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 tabular-nums">
                          <strong>
                            {r.feePercent > 0 && `${r.feePercent}%`}
                            {r.feePercent > 0 && r.fixedFeeCents > 0 && " + "}
                            {r.fixedFeeCents > 0 && formatBRL(r.fixedFeeCents)}
                            {r.feePercent === 0 &&
                              r.fixedFeeCents === 0 &&
                              "sem custo"}
                          </strong>
                          {r.freeMonthlyCount !== null && (
                            <span className="text-muted-foreground">
                              {r.freeMonthlyCount} grátis/mês
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            D+{r.settlementDays}
                            {r.settlementBusinessDays && " úteis"}
                          </span>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => removeRate(r.id)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Adquirente. */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar adquirente" : "Nova adquirente"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-2 text-sm">
              <label className="block">
                <Label className="text-[11px]">Nome</Label>
                <Input
                  className="h-9"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="Ex.: Cielo, Stone, PagSeguro"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Observação</Label>
                <Input
                  className="h-9"
                  value={editing.notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editing.isDefault}
                  onChange={(e) =>
                    setEditing({ ...editing, isDefault: e.target.checked })
                  }
                />
                <span className="text-xs">
                  Padrão da unidade (usada na projeção das vendas no cartão)
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editing.active}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                <span className="text-xs">Ativa</span>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending || !editing?.name.trim()} onClick={saveAcq}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Taxas. */}
      <Dialog open={rateFor !== null} onOpenChange={(o) => !o && setRateFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Taxas — {rateFor?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Cada faixa vale <strong>a partir</strong> da data informada.
            Renegociou a taxa? Cadastre uma nova valendo da data do acordo — o
            que já foi recebido continua com a taxa antiga.
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Modalidade</Label>
              <select
                value={modality}
                onChange={(e) => setModality(e.target.value as CardModality)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                {CARD_MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {CARD_MODALITY_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            {hasInstallmentRange(modality) && (
              <>
                <label className="block">
                  <Label className="text-[11px]">De (parcelas)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    min={1}
                    value={minInst}
                    onChange={(e) => setMinInst(Number(e.target.value) || 1)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Até (parcelas)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    min={1}
                    value={maxInst}
                    onChange={(e) => setMaxInst(Number(e.target.value) || 1)}
                  />
                </label>
              </>
            )}
            <label className="block">
              <Label className="text-[11px]">Taxa (%)</Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="Ex.: 2,39"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">+ Taxa fixa (R$)</Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={fixedFee}
                onChange={(e) => setFixedFee(e.target.value)}
                placeholder="Ex.: 0,29"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Prazo (dias)</Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 0)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Franquia grátis por mês</Label>
              <Input
                className="h-9"
                type="number"
                min={1}
                value={freeCount}
                onChange={(e) => setFreeCount(e.target.value)}
                placeholder="em branco = sem franquia"
              />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={businessDays}
                onChange={(e) => setBusinessDays(e.target.checked)}
              />
              <span className="text-xs">
                O prazo é em <strong>dias úteis</strong> (pula fim de semana;
                feriado ainda não é considerado)
              </span>
            </label>
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Vale a partir de</Label>
              <Input
                className="h-9"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </label>
          </div>

          {previewBig && previewSmall && (
            <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-2 text-xs">
              <p>
                Cobrança de <strong>R$ 1.000,00</strong>: a clínica recebe{" "}
                <strong>{formatBRL(previewBig.netCents)}</strong> (taxa de{" "}
                {formatBRL(previewBig.feeCents)}), em{" "}
                <strong>{fmtDate(previewBig.settlementDate)}</strong>.
              </p>
              <p>
                Cobrança de <strong>R$ 50,00</strong>: recebe{" "}
                <strong>{formatBRL(previewSmall.netCents)}</strong> (taxa de{" "}
                {formatBRL(previewSmall.feeCents)}
                {previewSmall.fixedFeeCents > 0 &&
                  ` — ${((previewSmall.feeCents / 5000) * 100).toFixed(1)}% do valor`}
                ).
              </p>
              {previewSmall.fixedFeeCents > 0 && (
                <p className="text-muted-foreground">
                  A taxa fixa pesa muito mais nas cobranças pequenas — é por
                  isso que ela precisa estar aqui.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRateFor(null)}>
              Fechar
            </Button>
            <Button disabled={isPending || fee.trim() === ""} onClick={addRate}>
              Salvar taxa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
