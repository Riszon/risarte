"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterForm } from "@/components/filter-form";
import {
  WEEKDAY_NAMES,
  type AgendaSettings,
} from "@/lib/agenda-settings";
import { saveAgendaSettings } from "./actions";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function AgendaSettingsEditor({
  scope,
  units,
  values,
  hasOverride,
}: {
  scope: string;
  units: { id: string; name: string }[];
  values: AgendaSettings;
  hasOverride: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openTime, setOpenTime] = useState(values.openTime);
  const [closeTime, setCloseTime] = useState(values.closeTime);
  const [weekdays, setWeekdays] = useState<number[]>(values.weekdays);

  const isNetwork = scope === "";

  function toggleDay(d: number) {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveAgendaSettings(scope || null, {
        openTime,
        closeTime,
        weekdays,
      });
      if (result.ok) {
        toast.success("Configuração salva.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <FilterForm className="flex items-center gap-2">
            <Label htmlFor="unidade" className="text-sm">
              Configurar:
            </Label>
            <select
              id="unidade"
              name="unidade"
              defaultValue={scope}
              className={selectClass}
            >
              <option value="">Padrão da rede</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FilterForm>
          {!isNetwork && !hasOverride && (
            <span className="text-xs text-muted-foreground">
              Esta unidade usa o padrão da rede. Salve para criar uma
              configuração própria.
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isNetwork
              ? "Padrão da rede"
              : `Unidade: ${units.find((u) => u.id === scope)?.name ?? ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="open">Abertura</Label>
              <Input
                id="open"
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="close">Fechamento</Label>
              <Input
                id="close"
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Dias de atendimento</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, d) => (
                <label
                  key={d}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={weekdays.includes(d)}
                    onChange={() => toggleDay(d)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <Button size="sm" disabled={isPending} onClick={save}>
            Salvar configuração
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
