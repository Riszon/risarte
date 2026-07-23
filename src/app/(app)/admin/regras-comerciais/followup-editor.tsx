"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteFollowupSettings, saveFollowupSettings } from "./actions";

export type FollowupRowUi = {
  id: string;
  clinic_id: string | null;
  max_attempts: number;
  interval_days: number;
  max_days: number;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function FollowupCadenceEditor({
  rows,
  clinics,
}: {
  rows: FollowupRowUi[];
  clinics: { id: string; name: string }[];
}) {
  const networkRow = rows.find((r) => r.clinic_id === null) ?? null;
  const unitRows = rows.filter((r) => r.clinic_id !== null);
  const [addUnitId, setAddUnitId] = useState("");

  const clinicName = (id: string | null) =>
    clinics.find((c) => c.id === id)?.name ?? "Unidade";
  const unitsWithout = clinics.filter(
    (c) => !unitRows.some((r) => r.clinic_id === c.id)
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Cadência do follow-up
        </h2>
        <p className="text-sm text-muted-foreground">
          Quantas tentativas o Consultor faz, de quanto em quanto tempo, e o
          prazo máximo. Esgotou → o cliente vai à Gerente (follow-up na clínica).
        </p>
      </div>

      <CadenceForm
        title="Padrão da rede"
        subtitle="Vale para todas as unidades sem cadência própria."
        clinicId={null}
        row={networkRow}
      />

      {unitRows.map((r) => (
        <CadenceForm
          key={r.id}
          title={clinicName(r.clinic_id)}
          clinicId={r.clinic_id}
          row={r}
          removableId={r.id}
        />
      ))}

      {unitsWithout.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">
            Cadência própria para a unidade:
          </span>
          <select
            value={addUnitId}
            onChange={(e) => setAddUnitId(e.target.value)}
            className={selectClass}
          >
            <option value="">Escolha a unidade</option>
            {unitsWithout.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {addUnitId && !unitRows.some((r) => r.clinic_id === addUnitId) && (
        <CadenceForm
          title={clinicName(addUnitId)}
          subtitle="Nova cadência — salve para valer."
          clinicId={addUnitId}
          row={null}
        />
      )}
    </div>
  );
}

function CadenceForm({
  title,
  subtitle,
  clinicId,
  row,
  removableId,
}: {
  title: string;
  subtitle?: string;
  clinicId: string | null;
  row: FollowupRowUi | null;
  removableId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const r = await saveFollowupSettings(formData);
      if (r.ok) {
        toast.success("Cadência salva.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function remove() {
    if (!removableId) return;
    startTransition(async () => {
      const r = await deleteFollowupSettings(removableId);
      if (r.ok) {
        toast.success("Cadência removida — vale o padrão da rede.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {removableId && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={remove}
            aria-label="Remover cadência da unidade"
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-3">
          <input type="hidden" name="clinicId" value={clinicId ?? ""} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Nº de tentativas
              </span>
              <Input
                name="maxAttempts"
                inputMode="numeric"
                defaultValue={String(row?.max_attempts ?? 3)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Intervalo (dias)
              </span>
              <Input
                name="intervalDays"
                inputMode="numeric"
                defaultValue={String(row?.interval_days ?? 2)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Prazo máximo (dias)
              </span>
              <Input
                name="maxDays"
                inputMode="numeric"
                defaultValue={String(row?.max_days ?? 15)}
              />
            </label>
          </div>
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
