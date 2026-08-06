"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Network, Pencil, Plus, Star, Trash2 } from "lucide-react";
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
  ACQUIRER_SCOPES,
  ACQUIRER_SCOPE_LABELS,
  CARD_MODALITIES,
  CARD_MODALITY_LABELS,
  FEE_CHARGE_MOMENTS,
  FEE_CHARGE_MOMENT_LABELS,
  acquirerAppliesTo,
  computeSettlement,
  hasInstallmentRange,
  type AcquirerRate,
  type AcquirerScope,
  type CardModality,
  type FeeChargeMoment,
} from "@/lib/finance/acquirers";
import { closeRate, deleteRate, saveAcquirer, saveRate } from "./actions";

export type AcquirerRow = {
  id: string;
  clinicId: string | null;
  scope: AcquirerScope;
  clinicIds: string[];
  name: string;
  isDefault: boolean;
  notes: string | null;
  active: boolean;
};

type RateForm = {
  id: string | null;
  modality: CardModality;
  minInst: number;
  maxInst: number;
  fee: string;
  fixedFee: string;
  days: number;
  businessDays: boolean;
  freeCount: string;
  chargedOn: FeeChargeMoment;
  validFrom: string;
};

function emptyRateForm(today: string): RateForm {
  return {
    id: null,
    modality: "credito_avista",
    minInst: 1,
    maxInst: 1,
    fee: "",
    fixedFee: "",
    days: 30,
    businessDays: false,
    freeCount: "",
    chargedOn: "pagamento",
    validFrom: today,
  };
}

function formFromRate(r: AcquirerRate): RateForm {
  return {
    id: r.id,
    modality: r.modality,
    minInst: r.minInstallments,
    maxInst: r.maxInstallments,
    fee: String(r.feePercent).replace(".", ","),
    fixedFee: r.fixedFeeCents > 0 ? formatBRL(r.fixedFeeCents).replace("R$ ", "") : "",
    days: r.settlementDays,
    businessDays: r.settlementBusinessDays,
    freeCount: r.freeMonthlyCount === null ? "" : String(r.freeMonthlyCount),
    chargedOn: r.feeChargedOn,
    validFrom: r.validFrom,
  };
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Só boleto e PIX têm documento a emitir — no cartão não há o que cobrar antes. */
function allowsIssueCharge(modality: CardModality): boolean {
  return modality === "boleto" || modality === "pix";
}

export function AcquirerManager({
  clinicId,
  acquirers,
  rates,
  usageByRate,
  clinics,
  today,
  canEdit,
  canManageNetwork,
}: {
  clinicId: string;
  acquirers: AcquirerRow[];
  rates: AcquirerRate[];
  usageByRate: Record<string, number>;
  clinics: { id: string; name: string }[];
  today: string;
  canEdit: boolean;
  canManageNetwork: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AcquirerRow | null>(null);
  const [rateFor, setRateFor] = useState<AcquirerRow | null>(null);
  const [form, setForm] = useState<RateForm>(() => emptyRateForm(today));

  function emptyAcquirer(): AcquirerRow {
    return {
      id: "",
      clinicId,
      scope: "unidade",
      clinicIds: [],
      name: "",
      isDefault: false,
      notes: null,
      active: true,
    };
  }

  function saveAcq() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveAcquirer({
        id: editing.id || null,
        clinicId,
        scope: editing.scope,
        clinicIds: editing.clinicIds,
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

  function submitRate() {
    if (!rateFor) return;
    startTransition(async () => {
      const r = await saveRate({
        id: form.id,
        acquirerId: rateFor.id,
        modality: form.modality,
        minInstallments: hasInstallmentRange(form.modality) ? form.minInst : 1,
        maxInstallments: hasInstallmentRange(form.modality) ? form.maxInst : 1,
        feePercent: Number(form.fee.replace(",", ".")) || 0,
        fixedFeeCents: parseBRLToCents(form.fixedFee) ?? 0,
        settlementDays: form.days,
        settlementBusinessDays: form.businessDays,
        freeMonthlyCount: form.freeCount.trim() ? Number(form.freeCount) : null,
        feeChargedOn: allowsIssueCharge(form.modality) ? form.chargedOn : "pagamento",
        validFrom: form.validFrom,
        validTo: null,
      });
      if (r.ok) {
        toast.success(form.id ? "Taxa atualizada." : "Taxa salva.");
        setForm(emptyRateForm(today));
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function endRate(id: string) {
    startTransition(async () => {
      const r = await closeRate({ id, validTo: today });
      if (r.ok) {
        toast.success("Vigência encerrada hoje.");
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
    feePercent: Number(form.fee.replace(",", ".")) || 0,
    fixedFeeCents: parseBRLToCents(form.fixedFee) ?? 0,
    settlementDays: form.days,
    settlementBusinessDays: form.businessDays,
    freeMonthlyCount: null,
    feeChargedOn: form.chargedOn,
  };
  const hasRate = form.fee.trim() !== "" || form.fixedFee.trim() !== "";
  const previewBig = hasRate
    ? computeSettlement({ grossCents: 100000, rate: rateShape, paidAt: today })
    : null;
  const previewSmall = hasRate
    ? computeSettlement({ grossCents: 5000, rate: rateShape, paidAt: today })
    : null;

  const editingUses = form.id ? (usageByRate[form.id] ?? 0) : 0;

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing(emptyAcquirer())}>
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
          const isNetwork = a.clinicId === null;
          // Cadastro da rede só a Franqueadora mexe: a unidade não reescreve a
          // taxa que a rede negociou.
          const canEditThis = canEdit && (!isNetwork || canManageNetwork);
          const serves = acquirerAppliesTo(a, clinicId);
          return (
            <Card key={a.id} className={cn(!a.active && "opacity-60")}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {a.name}
                    {isNetwork && (
                      <Badge variant="outline" className="text-[10px]">
                        {a.scope === "rede" ? (
                          <Network className="mr-1 size-3" />
                        ) : (
                          <Building2 className="mr-1 size-3" />
                        )}
                        {a.scope === "rede"
                          ? "Rede"
                          : `${a.clinicIds.length} unidade${a.clinicIds.length === 1 ? "" : "s"}`}
                      </Badge>
                    )}
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
                    {!serves && (
                      <Badge variant="outline" className="text-[10px]">
                        Não atende esta unidade
                      </Badge>
                    )}
                  </span>
                  {canEditThis && (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          setRateFor(a);
                          setForm(emptyRateForm(today));
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

                {isNetwork && !canManageNetwork && (
                  <p className="text-xs text-muted-foreground">
                    Cadastro da Franqueadora — a taxa negociada pela rede vale
                    para a sua unidade e não é editada aqui.
                  </p>
                )}

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
                          {r.feeChargedOn === "emissao" && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px]"
                            >
                              cobrada na emissão
                            </Badge>
                          )}
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
                          {canEditThis && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1"
                                title="Editar esta faixa"
                                onClick={() => {
                                  setRateFor(a);
                                  setForm(formFromRate(r));
                                }}
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1"
                                title="Excluir (só faixa nunca usada)"
                                onClick={() => removeRate(r.id)}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </>
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
                  placeholder="Ex.: Cielo, Stone, Asaas"
                />
              </label>

              {canManageNetwork && (
                <label className="block">
                  <Label className="text-[11px]">Abrangência</Label>
                  <select
                    value={editing.scope}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        scope: e.target.value as AcquirerScope,
                      })
                    }
                    className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {ACQUIRER_SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {ACQUIRER_SCOPE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {editing.scope === "rede"
                      ? "Vale para todas as unidades, inclusive as que ainda vão existir."
                      : editing.scope === "unidades"
                        ? "Vale só para as unidades marcadas abaixo."
                        : "Cadastro da unidade ativa — só ela usa."}
                  </span>
                </label>
              )}

              {canManageNetwork && editing.scope === "unidades" && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {clinics.map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={editing.clinicIds.includes(c.id)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            clinicIds: e.target.checked
                              ? [...editing.clinicIds, c.id]
                              : editing.clinicIds.filter((x) => x !== c.id),
                          })
                        }
                      />
                      <span className="text-xs">{c.name}</span>
                    </label>
                  ))}
                </div>
              )}

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
                  {editing.scope === "unidade"
                    ? "Padrão da unidade (usada na projeção das vendas no cartão)"
                    : "Padrão da rede (usada onde a unidade não tem cadastro próprio)"}
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
            <DialogTitle>
              {form.id ? "Editar faixa" : "Taxas"} — {rateFor?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Cada faixa vale <strong>a partir</strong> da data informada.
            Renegociou a taxa? <strong>Encerre</strong> a faixa atual e cadastre
            uma nova valendo da data do acordo — o que já foi recebido continua
            com a taxa antiga. A edição aqui é para corrigir digitação.
          </p>

          {form.id && editingUses > 0 && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs">
              Esta faixa já precificou <strong>{editingUses}</strong>{" "}
              {editingUses === 1 ? "cobrança" : "cobranças"}. Corrigir aqui{" "}
              <strong>não recalcula</strong> o que já foi recebido — se a taxa
              mudou de verdade, encerre esta faixa e cadastre outra.
            </p>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Modalidade</Label>
              <select
                value={form.modality}
                onChange={(e) =>
                  setForm({
                    ...form,
                    modality: e.target.value as CardModality,
                    chargedOn: allowsIssueCharge(e.target.value as CardModality)
                      ? form.chargedOn
                      : "pagamento",
                  })
                }
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              >
                {CARD_MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {CARD_MODALITY_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            {hasInstallmentRange(form.modality) && (
              <>
                <label className="block">
                  <Label className="text-[11px]">De (parcelas)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    min={1}
                    value={form.minInst}
                    onChange={(e) =>
                      setForm({ ...form, minInst: Number(e.target.value) || 1 })
                    }
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Até (parcelas)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    min={1}
                    value={form.maxInst}
                    onChange={(e) =>
                      setForm({ ...form, maxInst: Number(e.target.value) || 1 })
                    }
                  />
                </label>
              </>
            )}
            <label className="block">
              <Label className="text-[11px]">Taxa (%)</Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={form.fee}
                onChange={(e) => setForm({ ...form, fee: e.target.value })}
                placeholder="Ex.: 2,39"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">+ Taxa fixa (R$)</Label>
              <Input
                className="h-9"
                inputMode="decimal"
                value={form.fixedFee}
                onChange={(e) => setForm({ ...form, fixedFee: e.target.value })}
                placeholder="Ex.: 0,29"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Prazo (dias)</Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                value={form.days}
                onChange={(e) =>
                  setForm({ ...form, days: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Franquia grátis por mês</Label>
              <Input
                className="h-9"
                type="number"
                min={1}
                value={form.freeCount}
                onChange={(e) => setForm({ ...form, freeCount: e.target.value })}
                placeholder="em branco = sem franquia"
              />
            </label>

            {allowsIssueCharge(form.modality) && (
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Quando a taxa é cobrada</Label>
                <select
                  value={form.chargedOn}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      chargedOn: e.target.value as FeeChargeMoment,
                    })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {FEE_CHARGE_MOMENTS.map((m) => (
                    <option key={m} value={m}>
                      {FEE_CHARGE_MOMENT_LABELS[m]}
                    </option>
                  ))}
                </select>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {form.chargedOn === "emissao"
                    ? "O custo nasce ao gerar o documento — pago ou não. A baixa não cobra de novo."
                    : "A taxa sai do que entra na baixa: não pagou, não custou."}
                </span>
              </label>
            )}

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={form.businessDays}
                onChange={(e) =>
                  setForm({ ...form, businessDays: e.target.checked })
                }
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
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
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
              {previewBig.chargedAtIssue && (
                <p className="text-muted-foreground">
                  Esta taxa é cobrada <strong>na emissão</strong>: sai do caixa
                  ao gerar o documento, mesmo que o cliente nunca pague — e a
                  baixa não cobra de novo.
                </p>
              )}
              {previewSmall.fixedFeeCents > 0 && (
                <p className="text-muted-foreground">
                  A taxa fixa pesa muito mais nas cobranças pequenas — é por
                  isso que ela precisa estar aqui.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {form.id && (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  endRate(form.id as string);
                  setForm(emptyRateForm(today));
                }}
              >
                Encerrar vigência hoje
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                form.id ? setForm(emptyRateForm(today)) : setRateFor(null)
              }
            >
              {form.id ? "Cancelar edição" : "Fechar"}
            </Button>
            <Button
              disabled={isPending || form.fee.trim() === ""}
              onClick={submitRate}
            >
              {form.id ? "Salvar alteração" : "Salvar taxa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
