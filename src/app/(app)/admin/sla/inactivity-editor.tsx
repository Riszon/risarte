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
  INACTIVITY_KEYS,
  INACTIVITY_LABELS,
  type InactivitySettingRow,
} from "@/lib/sla";
import { recomputeActivity, saveInactivitySettings } from "./actions";

type ClinicOption = { id: string; name: string };

export function InactivityEditor({
  rows,
  clinics,
}: {
  rows: InactivitySettingRow[];
  clinics: ClinicOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedClinicId, setSelectedClinicId] = useState(clinics[0]?.id ?? "");

  const networkValue = (key: string) =>
    rows.find((r) => r.clinic_id === null && r.setting_key === key)?.value_days;
  const clinicValue = (key: string) =>
    rows.find((r) => r.clinic_id === selectedClinicId && r.setting_key === key)
      ?.value_days;

  function submit(clinicId: string | null, form: HTMLFormElement) {
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await saveInactivitySettings(clinicId, formData);
      if (result.ok) {
        toast.success("Prazos salvos.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function recompute() {
    startTransition(async () => {
      const result = await recomputeActivity();
      if (result.ok) {
        toast.success("Status dos clientes recalculado.");
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
            {INACTIVITY_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <Label htmlFor={`net-${key}`} className="flex-1">
                  {INACTIVITY_LABELS[key]}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`net-${key}`}
                    name={key}
                    type="number"
                    min={1}
                    required
                    defaultValue={networkValue(key) ?? ""}
                    className="w-24 text-right"
                  />
                  <span className="w-10 text-sm text-muted-foreground">dias</span>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Salvando..." : "Salvar padrão da rede"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={recompute}
              >
                Recalcular status agora
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prazos por unidade</CardTitle>
          <CardDescription>
            Deixe em branco para a unidade seguir o padrão da rede.
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
                {INACTIVITY_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <Label htmlFor={`clinic-${key}`} className="flex-1">
                      {INACTIVITY_LABELS[key]}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`clinic-${key}`}
                        name={key}
                        type="number"
                        min={1}
                        defaultValue={clinicValue(key) ?? ""}
                        placeholder={String(networkValue(key) ?? "")}
                        className="w-24 text-right"
                      />
                      <span className="w-10 text-sm text-muted-foreground">
                        dias
                      </span>
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
