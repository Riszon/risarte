"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PLAN_ITEM_LABELS,
  PLAN_ITEM_CLASS,
  type PlanItemType,
} from "@/lib/annual-plan";
import { decideHoliday } from "../actions";
import { deletePlanItem } from "./actions";
import { PlanItemDialog } from "./plan-item-dialog";

type ManagedItem = {
  id: string;
  type: PlanItemType;
  startsDate: string;
  endsDate: string;
  title: string | null;
  note: string | null;
  userIds: string[];
  isPast: boolean;
};

export function AnnualPlanManager({
  clinicId,
  year,
  todayIso,
  items,
  staff,
  holidays,
}: {
  clinicId: string;
  year: number;
  todayIso: string;
  items: ManagedItem[];
  staff: { userId: string; name: string }[];
  holidays: { date: string; name: string; decision: boolean | null }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const staffName = new Map(staff.map((s) => [s.userId, s.name]));

  function remove(id: string) {
    startTransition(async () => {
      const result = await deletePlanItem(id);
      if (result.ok) {
        toast.success("Item removido do plano.");
        setConfirmId(null);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function decide(date: string, willAttend: boolean) {
    startTransition(async () => {
      const result = await decideHoliday(clinicId, date, willAttend);
      if (result.ok) {
        toast.success("Feriado atualizado.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <>
      {/* Itens do plano --------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Itens planejados{" "}
            <span className="font-normal text-muted-foreground">
              ({items.length})
            </span>
          </CardTitle>
          <PlanItemDialog
            clinicId={clinicId}
            staff={staff}
            todayIso={todayIso}
            trigger={
              <Button size="sm">
                <Plus className="mr-1 size-3.5" />
                Adicionar
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum item planejado para {year}.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${PLAN_ITEM_CLASS[it.type]}`}
                    >
                      {PLAN_ITEM_LABELS[it.type]}
                    </span>
                    <span className="ml-1.5 font-medium">
                      {fmt(it.startsDate)}
                      {it.endsDate !== it.startsDate ? ` – ${fmt(it.endsDate)}` : ""}
                    </span>
                    {it.isPast && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        histórico
                      </span>
                    )}
                    {it.title && (
                      <p className="text-xs text-muted-foreground">{it.title}</p>
                    )}
                    {it.userIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {it.userIds.map((id) => staffName.get(id) ?? "—").join(", ")}
                      </p>
                    )}
                    {it.note && (
                      <p className="text-xs text-muted-foreground">{it.note}</p>
                    )}
                  </div>
                  {!it.isPast && (
                    <span className="flex shrink-0 items-center gap-1">
                      <PlanItemDialog
                        clinicId={clinicId}
                        staff={staff}
                        todayIso={todayIso}
                        item={it}
                        trigger={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                          >
                            Editar
                          </Button>
                        }
                      />
                      {confirmId === it.id ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 border-red-300 px-2 text-xs text-red-700"
                          disabled={isPending}
                          onClick={() => remove(it.id)}
                        >
                          Confirmar?
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmId(it.id)}
                        >
                          Remover
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Feriados do ano -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feriados de {year}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {holidays.map((h) => (
              <li
                key={h.date}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-muted-foreground"> · {fmt(h.date)}</span>
                  {h.decision === true && (
                    <span className="ml-1 text-emerald-700">· Trabalha</span>
                  )}
                  {h.decision === false && (
                    <span className="ml-1 text-red-700">· Fecha</span>
                  )}
                  {h.decision === null && (
                    <span className="ml-1 text-amber-700">· A decidir</span>
                  )}
                </div>
                <span className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={h.decision === true ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() => decide(h.date, true)}
                  >
                    Trabalha
                  </Button>
                  <Button
                    size="sm"
                    variant={h.decision === false ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() => decide(h.date, false)}
                  >
                    Fecha
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
