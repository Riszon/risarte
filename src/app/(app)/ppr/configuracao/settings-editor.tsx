"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { removePprSettings, savePprSettings } from "./actions";

export type PprSettingsRow = {
  id: string;
  clinic_id: string | null;
  suspend_after_days: number;
  cancel_after_days: number;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * Prazos de inadimplência no padrão cascata: o valor da rede vale para todas as
 * unidades; a unidade com ajuste próprio usa o dela.
 */
export function PprSettingsEditor({
  rows,
  clinics,
}: {
  rows: PprSettingsRow[];
  clinics: { id: string; name: string }[];
}) {
  const network = rows.find((r) => r.clinic_id === null) ?? null;
  const units = rows.filter((r) => r.clinic_id !== null);
  const [addUnitId, setAddUnitId] = useState("");
  const without = clinics.filter(
    (c) => !units.some((r) => r.clinic_id === c.id)
  );
  const clinicName = (id: string | null) =>
    clinics.find((c) => c.id === id)?.name ?? "Unidade";

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <AlertTriangle className="size-4 text-amber-600" />
          Falta de pagamento da mensalidade
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Quantos dias de atraso <strong>suspendem</strong> o plano (o
          beneficiário para de usar os benefícios) e quantos dias{" "}
          <strong>cancelam</strong> (perde o selo PPR+ e fica só no histórico).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettingsForm
          title="Padrão da rede"
          subtitle="Vale para toda unidade que não tiver ajuste próprio."
          clinicId={null}
          row={network}
        />

        {units.map((r) => (
          <SettingsForm
            key={r.id}
            title={clinicName(r.clinic_id)}
            clinicId={r.clinic_id}
            row={r}
            removableId={r.id}
          />
        ))}

        {without.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
            <span className="text-muted-foreground">
              Ajuste para a unidade:
            </span>
            <select
              value={addUnitId}
              onChange={(e) => setAddUnitId(e.target.value)}
              className={selectClass}
            >
              <option value="">Escolha a unidade</option>
              {without.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {addUnitId && !units.some((r) => r.clinic_id === addUnitId) && (
          <SettingsForm
            title={clinicName(addUnitId)}
            subtitle="Novo ajuste — salve para valer."
            clinicId={addUnitId}
            row={null}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SettingsForm({
  title,
  subtitle,
  clinicId,
  row,
  removableId,
}: {
  title: string;
  subtitle?: string;
  clinicId: string | null;
  row: PprSettingsRow | null;
  removableId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function save(form: FormData) {
    startTransition(async () => {
      const r = await savePprSettings(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Prazos salvos.");
        router.refresh();
      }
    });
  }

  function remove() {
    if (!removableId) return;
    startTransition(async () => {
      const r = await removePprSettings(removableId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível remover.");
      else {
        toast.success("Ajuste removido — a unidade volta ao padrão da rede.");
        router.refresh();
      }
    });
  }

  return (
    <form action={save} className="rounded-xl border p-3">
      <input type="hidden" name="clinicId" value={clinicId ?? ""} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {removableId && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={remove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs">
          <span className="text-muted-foreground">Suspende com (dias)</span>
          <Input
            name="suspendAfterDays"
            type="number"
            min={0}
            defaultValue={row?.suspend_after_days ?? 30}
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Cancela com (dias)</span>
          <Input
            name="cancelAfterDays"
            type="number"
            min={0}
            defaultValue={row?.cancel_after_days ?? 90}
          />
        </label>
        <Button type="submit" size="sm" disabled={isPending} className="self-end">
          Salvar
        </Button>
      </div>
    </form>
  );
}
