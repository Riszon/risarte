"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORTHO_KIND_LABELS, ORTHO_KINDS } from "@/lib/ortodontia/constants";
import { maintenanceSchedule, plannedEndDate } from "@/lib/ortodontia/regras";
import type { ProcedureOption, StaffOption } from "@/lib/ortodontia/db";
import { createOrthoCase } from "../../actions";

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function NovoCasoForm({
  clientId,
  negotiationId,
  today,
  defaults,
  orthodontists,
  procedures,
}: {
  clientId: string;
  negotiationId: string | null;
  today: string;
  defaults: { monthlyCents: number; plannedMonths: number; intervalDays: number; billingDay: number; procedureId: string | null };
  orthodontists: StaffOption[];
  procedures: ProcedureOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [start, setStart] = useState(today);
  const [months, setMonths] = useState(defaults.plannedMonths);
  const [interval, setInterval] = useState(defaults.intervalDays);
  const [startNow, setStartNow] = useState(true);

  const end = start && months > 0 ? plannedEndDate(start, months) : null;
  const previstas = start && end ? maintenanceSchedule(start, end, interval).length : 0;
  const fmt = (iso: string) => iso.split("-").reverse().join("/");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createOrthoCase(fd);
      if (!r.ok) toast.error(r.error ?? "Não foi possível abrir o caso.");
      else {
        toast.success("Caso ortodôntico aberto.");
        router.push(`/ortodontia/casos/${r.caseId}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="client_id" value={clientId} />
      {negotiationId && <input type="hidden" name="negotiation_id" value={negotiationId} />}

      <Card>
        <CardHeader className="gap-1"><CardTitle className="text-base">O tratamento</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="orthodontist_id">Ortodontista responsável</Label>
            <select id="orthodontist_id" name="orthodontist_id" className={selectClass} defaultValue="">
              <option value="">— a definir —</option>
              {orthodontists.map((o) => (
                <option key={o.userId} value={o.userId}>{o.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">A agenda liga sozinha os agendamentos deste profissional com o paciente ao cronograma.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="treatment_kind">Tipo</Label>
            <select id="treatment_kind" name="treatment_kind" className={selectClass} defaultValue="aparelho_fixo">
              {ORTHO_KINDS.map((k) => (
                <option key={k} value={k}>{ORTHO_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="start_date">Início (instalação)</Label>
            <Input id="start_date" name="start_date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="planned_months">Meses previstos</Label>
            <Input id="planned_months" name="planned_months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value) || 0)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="maintenance_interval_days">Manutenção a cada (dias)</Label>
            <Input id="maintenance_interval_days" name="maintenance_interval_days" type="number" min={7} max={180} value={interval} onChange={(e) => setInterval(Number(e.target.value) || 30)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="maintenance_procedure_id">Procedimento da manutenção (repasse)</Label>
            <select id="maintenance_procedure_id" name="maintenance_procedure_id" className={selectClass} defaultValue={defaults.procedureId ?? ""}>
              <option value="">— o da configuração / nenhum —</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground sm:col-span-2">
            {end ? (
              <>
                Término previsto <strong>{fmt(end)}</strong> · <strong>{previstas}</strong> manutenções previstas no cronograma (a cada {interval} dias).
              </>
            ) : (
              "Informe o início e os meses para ver o cronograma."
            )}
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="start_now" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} className="size-4" />
            O aparelho já foi instalado: o caso nasce <strong>em tratamento</strong> e o cronograma é gerado agora.
            <span className="text-xs text-muted-foreground">(desmarcado = aguardando início; você inicia depois, na ficha do caso)</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">A mensalidade</CardTitle>
          <p className="text-sm text-muted-foreground">Não é procedimento: é devida todo mês, com ou sem comparecimento à manutenção. Entra na DRE em “Ortodontia — mensalidades”.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="monthly_fee">Mensalidade (R$)</Label>
            <Input id="monthly_fee" name="monthly_fee" inputMode="decimal" defaultValue={(defaults.monthlyCents / 100).toFixed(2).replace(".", ",")} placeholder="189,90" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="billing_day">Dia de vencimento</Label>
            <Input id="billing_day" name="billing_day" type="number" min={1} max={28} defaultValue={defaults.billingDay} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="installation_fee">Instalação / documentação (R$, informativo)</Label>
            <Input id="installation_fee" name="installation_fee" inputMode="decimal" placeholder="0,00" />
            <p className="text-[11px] text-muted-foreground">A instalação é cobrada pelo plano/venda; aqui só aparece no termo.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4">
          <Label htmlFor="notes">Observações</Label>
          <textarea id="notes" name="notes" rows={3} className="w-full rounded-lg border border-input bg-transparent p-2 text-sm" placeholder="Acordos especiais, histórico, cuidados…" />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>Cancelar</Button>
        <Button type="submit" disabled={isPending}>Abrir o caso</Button>
      </div>
    </form>
  );
}
