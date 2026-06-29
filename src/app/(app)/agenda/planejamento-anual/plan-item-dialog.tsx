"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  PLAN_ITEM_TYPES,
  PLAN_ITEM_LABELS,
  type PlanItemType,
} from "@/lib/annual-plan";
import { createPlanItem, updatePlanItem } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function PlanItemDialog({
  clinicId,
  staff,
  todayIso,
  item,
  trigger,
}: {
  clinicId: string;
  staff: { userId: string; name: string }[];
  todayIso: string;
  item?: {
    id: string;
    type: PlanItemType;
    startsDate: string;
    endsDate: string;
    title: string | null;
    note: string | null;
    userIds: string[];
  };
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
  const [people, setPeople] = useState<Set<string>>(
    new Set(item?.userIds ?? [])
  );

  function togglePerson(id: string) {
    setPeople((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const payload = {
        type,
        starts,
        ends,
        title,
        note,
        userIds: [...people],
      };
      const result = isEdit
        ? await updatePlanItem({ itemId: item!.id, ...payload })
        : await createPlanItem({ clinicId, ...payload });
      if (result.ok) {
        toast.success(isEdit ? "Item atualizado." : "Item adicionado ao plano.");
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
            {isEdit ? "Editar item do plano" : "Adicionar ao planejamento"}
          </DialogTitle>
          <DialogDescription>
            Recesso, férias, evento, treinamento ou manutenção fecham a agenda no
            período (férias individuais fecham só as pessoas escolhidas).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pi-type">Tipo *</Label>
            <select
              id="pi-type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as PlanItemType)}
            >
              {PLAN_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLAN_ITEM_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pi-start">Início *</Label>
              <Input
                id="pi-start"
                type="date"
                min={todayIso}
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pi-end">Fim *</Label>
              <Input
                id="pi-end"
                type="date"
                min={starts || todayIso}
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </div>
          </div>

          {type === "individual_vacation" && (
            <div className="space-y-1.5">
              <Label>Colaboradores de férias *</Label>
              {staff.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum colaborador cadastrado.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {staff.map((s) => (
                    <label
                      key={s.userId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={people.has(s.userId)}
                        onChange={() => togglePerson(s.userId)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pi-title">Título</Label>
            <Input
              id="pi-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Recesso de fim de ano"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-note">Observação</Label>
            <Input
              id="pi-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <DialogFooter>
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Salvando..." : isEdit ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
