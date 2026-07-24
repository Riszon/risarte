"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ShoppingCart, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import type {
  ChartAppointment,
  SellableProcedure,
} from "./direct-sale-loader";
import { createDirectSaleFromChart } from "./direct-sale-actions";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const APPT_TYPE_LABELS: Record<string, string> = {
  evaluation: "Avaliação",
  commercial_presentation: "Apresentação comercial",
  treatment_start: "Início de tratamento",
  treatment_session: "Sessão",
  return: "Retorno",
  urgency: "Urgência",
  emergency: "Emergência",
};

type Line = { procedureId: string; quantity: number };

export function DirectSaleDialog({
  clientId,
  procedures,
  appointments,
  programActive,
  programName,
}: {
  clientId: string;
  procedures: SellableProcedure[];
  appointments: ChartAppointment[];
  programActive: boolean;
  programName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [appointmentId, setAppointmentId] = useState("");
  const [doneBefore, setDoneBefore] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState("");
  const [notes, setNotes] = useState("");

  const chosen = appointments.find((a) => a.id === appointmentId) ?? null;

  function pickAppointment(id: string) {
    setAppointmentId(id);
    // Atendimento no passado = provavelmente já foi realizado (exceção).
    const a = appointments.find((x) => x.id === id);
    setDoneBefore(Boolean(a?.isPast));
  }

  function addLine(procedureId: string) {
    if (!procedureId) return;
    setLines((prev) => {
      const found = prev.find((l) => l.procedureId === procedureId);
      if (found) {
        return prev.map((l) =>
          l.procedureId === procedureId ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { procedureId, quantity: 1 }];
    });
    setPicking("");
  }

  const totals = useMemo(() => {
    let full = 0;
    let discount = 0;
    for (const l of lines) {
      const p = procedures.find((x) => x.id === l.procedureId);
      if (!p) continue;
      full += p.unitPriceCents * l.quantity;
      discount += p.programDiscountCents * l.quantity;
    }
    return { full, discount, final: Math.max(0, full - discount) };
  }, [lines, procedures]);

  function submit() {
    startTransition(async () => {
      const r = await createDirectSaleFromChart(clientId, {
        appointmentId,
        attendanceDoneBefore: doneBefore,
        items: lines,
        notes,
      });
      if (r.ok) {
        toast.success(
          "Venda direta lançada! Faça o fechamento na aba “Sessões & Procedimentos”, aqui mesmo."
        );
        setOpen(false);
        setAppointmentId("");
        setDoneBefore(false);
        setLines([]);
        setNotes("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <ShoppingCart className="mr-1 size-3.5" />
            Venda Direta
          </Button>
        }
      />
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Venda direta</DialogTitle>
          <DialogDescription>
            Procedimentos vendidos direto na clínica (urgência, consulta avulsa,
            limpeza...). Toda venda direta precisa estar ligada a um atendimento.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 space-y-3 overflow-y-auto px-1">
          {/* Atendimento vinculado — OBRIGATÓRIO. */}
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              Atendimento relacionado *
            </span>
            <select
              value={appointmentId}
              onChange={(e) => pickAppointment(e.target.value)}
              className={inputClass}
            >
              <option value="">Escolher o atendimento...</option>
              {appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {new Date(a.startsAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {APPT_TYPE_LABELS[a.type] ?? a.type}
                  {a.providerName ? ` · ${a.providerName}` : ""}
                  {a.isPast ? " (já passou)" : ""}
                </option>
              ))}
            </select>
            {appointments.length === 0 && (
              <span className="mt-1 block text-xs text-rose-700">
                Este cliente não tem atendimento. Agende primeiro (botão &quot;Novo
                agendamento&quot;) e depois lance a venda.
              </span>
            )}
          </label>

          {chosen && (
            <label className="flex items-start gap-2 rounded-lg border p-2 text-sm">
              <input
                type="checkbox"
                checked={doneBefore}
                onChange={(e) => setDoneBefore(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                O atendimento <strong>já foi realizado</strong> antes desta venda.
              </span>
            </label>
          )}

          {doneBefore && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong>Atenção — fluxo invertido.</strong> O certo é vender
                antes de atender. Esta venda será registrada como exceção e o
                Gerente/Franqueado serão avisados para corrigir o fluxo.
              </span>
            </p>
          )}

          {/* Procedimentos. */}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Procedimentos (só aparecem os que você pode lançar)
            </p>
            <div className="flex gap-2">
              <select
                value={picking}
                onChange={(e) => addLine(e.target.value)}
                className={inputClass}
              >
                <option value="">Adicionar procedimento...</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatBRL(p.unitPriceCents)}
                  </option>
                ))}
              </select>
            </div>

            {lines.length > 0 && (
              <ul className="mt-2 space-y-1">
                {lines.map((l) => {
                  const p = procedures.find((x) => x.id === l.procedureId);
                  if (!p) return null;
                  const lineFull = p.unitPriceCents * l.quantity;
                  const lineDisc = p.programDiscountCents * l.quantity;
                  return (
                    <li
                      key={l.procedureId}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1">{p.name}</span>
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x) =>
                              x.procedureId === l.procedureId
                                ? {
                                    ...x,
                                    quantity: Math.max(
                                      1,
                                      Number.parseInt(e.target.value, 10) || 1
                                    ),
                                  }
                                : x
                            )
                          )
                        }
                        className="h-8 w-14 rounded-md border border-input bg-transparent px-1.5 text-sm"
                        aria-label={`Quantidade de ${p.name}`}
                      />
                      <span className="text-xs tabular-nums">
                        {lineDisc > 0 ? (
                          <>
                            <span className="line-through opacity-60">
                              {formatBRL(lineFull)}
                            </span>{" "}
                            <span className="font-medium text-gold">
                              {formatBRL(lineFull - lineDisc)}
                            </span>
                          </>
                        ) : (
                          formatBRL(lineFull)
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) =>
                            prev.filter((x) => x.procedureId !== l.procedureId)
                          )
                        }
                        aria-label={`Remover ${p.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {procedures.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Nenhum procedimento liberado para você lançar. O Admin configura
                isso em Procedimentos.
              </p>
            )}
          </div>

          {/* Totais: normal → desconto → final. */}
          {lines.length > 0 && (
            <div className="space-y-0.5 rounded-lg bg-muted/40 p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Valor normal</span>
                <span className="tabular-nums">{formatBRL(totals.full)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-gold">
                  <span>
                    ★ Desconto {programName ? `(${programName})` : "do programa"}
                  </span>
                  <span className="tabular-nums">
                    − {formatBRL(totals.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>Valor final</span>
                <span className="tabular-nums">{formatBRL(totals.final)}</span>
              </div>
              {totals.final === 0 && (
                <p className="text-xs text-emerald-700">
                  Totalmente coberto pelo programa — no fechamento, o pagamento
                  já entra como realizado.
                </p>
              )}
            </div>
          )}

          {programActive && totals.discount === 0 && lines.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Cliente do programa, mas os procedimentos lançados não têm
              benefício disponível (cobertura, carência ou limite).
            </p>
          )}

          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              Observações (opcional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 min-h-14 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            Depois de lançada, a <strong>recepção ou o gerente</strong> define a
            forma de pagamento, envia o contrato e a cobrança (tela Comercial →
            Venda direta).
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || !appointmentId || lines.length === 0}
            onClick={submit}
            className={cn(lines.length === 0 && "opacity-70")}
          >
            <Plus className="mr-1 size-4" />
            Lançar venda direta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
