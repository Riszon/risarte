"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SLA_KEYS,
  SLA_LABELS,
  TIME_UNITS,
  TIME_UNIT_LABELS,
  type SlaSettingRow,
  type TimeUnit,
} from "@/lib/sla";
import { saveSlaSettings } from "./actions";

type ClinicOption = { id: string; name: string };

const unitSelectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm";

/** Seletor de unidade do prazo (minutos / horas / dias / meses). */
function UnitSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: TimeUnit;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={unitSelectClass}
      aria-label="Unidade de tempo"
    >
      {TIME_UNITS.map((u) => (
        <option key={u} value={u}>
          {TIME_UNIT_LABELS[u]}
        </option>
      ))}
    </select>
  );
}

export function SlaEditor({
  rows,
  clinics,
}: {
  rows: SlaSettingRow[];
  clinics: ClinicOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedClinicId, setSelectedClinicId] = useState(
    clinics[0]?.id ?? ""
  );

  const networkRow = (key: string) =>
    rows.find((r) => r.clinic_id === null && r.sla_key === key);
  const clinicRow = (key: string) =>
    rows.find((r) => r.clinic_id === selectedClinicId && r.sla_key === key);
  // I3: o prazo é quantidade + unidade (o banco converte tudo para minutos).
  const networkValue = (key: string) => {
    const r = networkRow(key);
    return r?.amount ?? r?.hours;
  };
  const networkUnit = (key: string): TimeUnit => networkRow(key)?.unit ?? "hours";
  const clinicValue = (key: string) => {
    const r = clinicRow(key);
    return r?.amount ?? r?.hours;
  };
  const clinicUnit = (key: string): TimeUnit | undefined => clinicRow(key)?.unit ?? undefined;

  function submit(clinicId: string | null, form: HTMLFormElement) {
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await saveSlaSettings(clinicId, formData);
      if (result.ok) {
        toast.success("Prazos salvos.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Padrão da rede</CardTitle>
          <CardDescription>
            Vale para todas as unidades que não tiverem prazos próprios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(null, e.currentTarget);
            }}
            className="space-y-3"
          >
            {SLA_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4"
              >
                <Label htmlFor={`network-${key}`} className="flex-1">
                  {SLA_LABELS[key]}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`network-${key}`}
                    name={key}
                    type="number"
                    min={1}
                    required
                    defaultValue={networkValue(key) ?? ""}
                    className="w-20 text-right"
                  />
                  <UnitSelect name={`${key}__unit`} defaultValue={networkUnit(key)} />
                </div>
              </div>
            ))}
            <div className="pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Salvando..." : "Salvar padrão da rede"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prazos por unidade</CardTitle>
          <CardDescription>
            Deixe um campo em branco para a unidade seguir o padrão da rede.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {clinics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma unidade franqueada cadastrada ainda.
            </p>
          ) : (
            <>
              <div className="max-w-xs space-y-1">
                <Label>Unidade</Label>
                <Select
                  items={clinics.map((c) => ({ value: c.id, label: c.name }))}
                  value={selectedClinicId}
                  onValueChange={(v) => v !== null && setSelectedClinicId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clinics.map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <form
                key={selectedClinicId}
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(selectedClinicId, e.currentTarget);
                }}
                className="space-y-3"
              >
                {SLA_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <Label htmlFor={`clinic-${key}`} className="flex-1">
                      {SLA_LABELS[key]}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`clinic-${key}`}
                        name={key}
                        type="number"
                        min={1}
                        defaultValue={clinicValue(key) ?? ""}
                        placeholder={String(networkValue(key) ?? "")}
                        className="w-20 text-right"
                      />
                      <UnitSelect
                        name={`${key}__unit`}
                        defaultValue={clinicUnit(key) ?? networkUnit(key)}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <Button type="submit" disabled={isPending} variant="outline">
                    {isPending ? "Salvando..." : "Salvar prazos da unidade"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
