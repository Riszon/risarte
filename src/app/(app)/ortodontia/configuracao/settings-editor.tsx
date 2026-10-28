"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import type { OrthoSettingsRow, ProcedureOption } from "@/lib/ortodontia/db";
import { saveOrthoSettings } from "../actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function OrthoSettingsEditor({
  rows,
  clinics,
  isAdmin,
  procedures,
}: {
  rows: OrthoSettingsRow[];
  clinics: { id: string; name: string }[];
  isAdmin: boolean;
  procedures: ProcedureOption[];
}) {
  const network = rows.find((r) => r.clinic_id === null) ?? null;
  const units = rows.filter((r) => r.clinic_id !== null && clinics.some((c) => c.id === r.clinic_id));
  const [addUnitId, setAddUnitId] = useState("");
  const without = clinics.filter((c) => !units.some((r) => r.clinic_id === c.id));
  const nameOf = (id: string | null) => clinics.find((c) => c.id === id)?.name ?? "Unidade";

  return (
    <div className="space-y-4">
      {isAdmin && (
        <SettingsForm title="Padrão da rede" subtitle="Vale para toda unidade que não tiver ajuste próprio." clinicId={null} row={network} procedures={procedures} />
      )}
      {!isAdmin && network && (
        <Card>
          <CardHeader className="gap-1"><CardTitle className="text-base">Padrão da rede (só leitura)</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Mensalidade {formatBRL(network.monthly_fee_cents)} · {network.planned_months} meses · manutenção a cada {network.maintenance_interval_days} dias · reavaliação a cada {network.reevaluation_interval_months} meses · tolerância {network.finish_tolerance_days} dias · vencimento dia {network.billing_day}.
          </CardContent>
        </Card>
      )}
      {units.map((r) => (
        <SettingsForm key={r.id} title={nameOf(r.clinic_id)} subtitle="Ajuste desta unidade." clinicId={r.clinic_id} row={r} procedures={procedures} />
      ))}
      {without.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">Ajuste para a unidade:</span>
          <select value={addUnitId} onChange={(e) => setAddUnitId(e.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="">Escolha a unidade</option>
            {without.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      {addUnitId && !units.some((r) => r.clinic_id === addUnitId) && (
        <SettingsForm title={nameOf(addUnitId)} subtitle="Novo ajuste — salve para valer." clinicId={addUnitId} row={network ? { ...network, clinic_id: addUnitId } : null} procedures={procedures} />
      )}
    </div>
  );
}

function SettingsForm({
  title,
  subtitle,
  clinicId,
  row,
  procedures,
}: {
  title: string;
  subtitle?: string;
  clinicId: string | null;
  row: OrthoSettingsRow | null;
  procedures: ProcedureOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveOrthoSettings(clinicId, fd);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Configuração salva.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`fee-${clinicId}`}>Mensalidade padrão (R$)</Label>
            <Input id={`fee-${clinicId}`} name="monthly_fee" defaultValue={row ? (row.monthly_fee_cents / 100).toFixed(2).replace(".", ",") : ""} placeholder="189,90" inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`months-${clinicId}`}>Meses previstos</Label>
            <Input id={`months-${clinicId}`} name="planned_months" type="number" min={1} max={120} defaultValue={row?.planned_months ?? 24} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`interval-${clinicId}`}>Manutenção a cada (dias)</Label>
            <Input id={`interval-${clinicId}`} name="maintenance_interval_days" type="number" min={7} max={180} defaultValue={row?.maintenance_interval_days ?? 30} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`reeval-${clinicId}`}>Reavaliação a cada (meses)</Label>
            <Input id={`reeval-${clinicId}`} name="reevaluation_interval_months" type="number" min={1} max={36} defaultValue={row?.reevaluation_interval_months ?? 6} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`tol-${clinicId}`}>Tolerância do prazo (dias)</Label>
            <Input id={`tol-${clinicId}`} name="finish_tolerance_days" type="number" min={0} max={365} defaultValue={row?.finish_tolerance_days ?? 30} />
            <p className="text-[11px] text-muted-foreground">Depois disso, o caso conta como atrasado.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`billing-${clinicId}`}>Dia de vencimento</Label>
            <Input id={`billing-${clinicId}`} name="billing_day" type="number" min={1} max={28} defaultValue={row?.billing_day ?? 10} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`proc-${clinicId}`}>Procedimento da manutenção (repasse)</Label>
            <select id={`proc-${clinicId}`} name="maintenance_procedure_id" defaultValue={row?.maintenance_procedure_id ?? ""} className={selectClass}>
              <option value="">— nenhum (repasse registra zero) —</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">O valor do repasse do ortodontista vem da tabela de repasse deste procedimento (Financeiro → Repasses).</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={isPending}>Salvar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
