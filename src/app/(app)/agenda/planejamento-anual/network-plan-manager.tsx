"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Plus, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  NETWORK_PLAN_ITEM_TYPES,
  PLAN_ITEM_LABELS,
  PLAN_ITEM_CLASS,
  type PlanItemType,
} from "@/lib/annual-plan";
import {
  createNetworkPlanItem,
  updateNetworkPlanItem,
  deleteNetworkPlanItem,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type NetItem = {
  id: string;
  type: PlanItemType;
  startsDate: string;
  endsDate: string;
  title: string | null;
  note: string | null;
  locked: boolean;
  isPast: boolean;
};

function NetworkPlanDialog({
  todayIso,
  item,
  trigger,
}: {
  todayIso: string;
  item?: NetItem;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const isEdit = Boolean(item);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<PlanItemType>(item?.type ?? "recess");
  const [starts, setStarts] = useState(item?.startsDate ?? todayIso);
  const [ends, setEnds] = useState(item?.endsDate ?? todayIso);
  const [title, setTitle] = useState(item?.title ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [locked, setLocked] = useState(item?.locked ?? true);

  const isCampaign = type === "campaign";

  function save() {
    startTransition(async () => {
      const payload = {
        type,
        starts,
        ends,
        title,
        note,
        // Campanha não fecha nada; a trava não se aplica.
        locked: isCampaign ? false : locked,
      };
      const result = isEdit
        ? await updateNetworkPlanItem({ itemId: item!.id, ...payload })
        : await createNetworkPlanItem(payload);
      if (result.ok) {
        toast.success(isEdit ? "Item da rede atualizado." : "Item da rede criado.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar item da rede" : "Novo item do calendário da rede"}
          </DialogTitle>
          <DialogDescription>
            Vale para todas as unidades. A trava define se a unidade pode abrir
            por cima; a campanha é só informativa (não fecha a agenda).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="np-type">Tipo *</Label>
            <select
              id="np-type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as PlanItemType)}
            >
              {NETWORK_PLAN_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLAN_ITEM_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-start">Início *</Label>
              <Input
                id="np-start"
                type="date"
                min={todayIso}
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-end">Fim *</Label>
              <Input
                id="np-end"
                type="date"
                min={starts || todayIso}
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </div>
          </div>

          {isCampaign ? (
            <p className="rounded-md border border-pink-200 bg-pink-50 p-2 text-xs text-pink-800">
              Campanha é <b>informativa</b>: aparece na agenda das unidades como
              aviso, mas <b>não fecha</b> nenhum dia.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="np-lock">Quem decide *</Label>
              <select
                id="np-lock"
                className={selectClass}
                value={locked ? "locked" : "unit"}
                onChange={(e) => setLocked(e.target.value === "locked")}
              >
                <option value="locked">
                  Travado pela rede — fecha em todas as unidades
                </option>
                <option value="unit">
                  Decisão da unidade — a unidade pode abrir por cima
                </option>
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="np-title">Título</Label>
            <Input
              id="np-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Convenção anual da rede"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-note">Observação</Label>
            <Input
              id="np-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <DialogFooter>
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Salvando..." : isEdit ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NetworkPlanManager({
  year,
  todayIso,
  items,
}: {
  year: number;
  todayIso: string;
  items: NetItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteNetworkPlanItem(id);
      if (result.ok) {
        toast.success("Item da rede removido.");
        setConfirmId(null);
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          Calendário da rede{" "}
          <span className="font-normal text-muted-foreground">
            ({items.length})
          </span>
        </CardTitle>
        <NetworkPlanDialog
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
            Nenhum item da rede para {year}.
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
                  {it.type !== "campaign" &&
                    (it.locked ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-red-100 px-1 text-[10px] text-red-700">
                        <Lock className="size-2.5" /> Travado
                      </span>
                    ) : (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                        <Unlock className="size-2.5" /> Unidade decide
                      </span>
                    ))}
                  {it.isPast && (
                    <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      histórico
                    </span>
                  )}
                  {it.title && (
                    <p className="text-xs text-muted-foreground">{it.title}</p>
                  )}
                  {it.note && (
                    <p className="text-xs text-muted-foreground">{it.note}</p>
                  )}
                </div>
                {!it.isPast && (
                  <span className="flex shrink-0 items-center gap-1">
                    <NetworkPlanDialog
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
  );
}
