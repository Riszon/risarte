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
        <SettingsForm title="Padrão da rede" subtitle="Vale para toda unidade que não tiver ajuste próprio." clinicId={null} row={network} procedures={procedures} isAdmin />
      )}
      {!isAdmin && network && (
        <Card>
          <CardHeader className="gap-1"><CardTitle className="text-base">Padrão da rede (só leitura)</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Mensalidade {formatBRL(network.monthly_fee_cents)} · {network.planned_months} meses · manutenção a cada {network.maintenance_interval_days} dias · reavaliação a cada {network.reevaluation_interval_months} meses · tolerância {network.finish_tolerance_days} dias · vencimento dia {network.billing_day} · contenção {network.retainer_charge_enabled ? `cobrada (${formatBRL(network.retainer_fee_cents)})` : "incluída"}.
          </CardContent>
        </Card>
      )}
      {units.map((r) => (
        <SettingsForm key={r.id} title={nameOf(r.clinic_id)} subtitle="Ajuste desta unidade." clinicId={r.clinic_id} row={r} procedures={procedures} isAdmin={isAdmin} />
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
        <SettingsForm title={nameOf(addUnitId)} subtitle="Novo ajuste — salve para valer." clinicId={addUnitId} row={network ? { ...network, clinic_id: addUnitId, legacy_entry_enabled: null } : null} procedures={procedures} isAdmin={isAdmin} />
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
  isAdmin = false,
}: {
  title: string;
  subtitle?: string;
  /** Q1: só o Admin abre/fecha a porta do caso legado. */
  isAdmin?: boolean;
  clinicId: string | null;
  row: OrthoSettingsRow | null;
  procedures: ProcedureOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [chargeRetainer, setChargeRetainer] = useState(row?.retainer_charge_enabled ?? false);

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

          <div className="space-y-2 rounded-lg border border-dashed p-3 sm:col-span-2 lg:col-span-4">
            <p className="text-sm font-medium">A contenção no fim do tratamento</p>
            <p className="text-[11px] text-muted-foreground">
              A mensalidade é cobrada até a <strong>entrega das contenções</strong>; a entrega finaliza o tratamento e o paciente passa ao acompanhamento. A contenção pode ser cobrada à parte — e o que estiver aqui sai no termo do paciente.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="retainer_charge_enabled" checked={chargeRetainer} onChange={(e) => setChargeRetainer(e.target.checked)} className="size-4" />
              Cobrar a contenção na entrega
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor={`ret-fee-${clinicId}`}>Valor da contenção (R$)</Label>
                <Input id={`ret-fee-${clinicId}`} name="retainer_fee" inputMode="decimal" disabled={!chargeRetainer} defaultValue={row ? (row.retainer_fee_cents / 100).toFixed(2).replace(".", ",") : ""} placeholder="350,00" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`ret-terms-${clinicId}`}>Condição especial (sai no termo)</Label>
                <Input id={`ret-terms-${clinicId}`} name="retainer_terms" disabled={!chargeRetainer} defaultValue={row?.retainer_terms ?? ""} placeholder="Ex.: em até 3x sem juros; isenta para quem pagou todas as mensalidades em dia" />
              </div>
            </div>
          </div>

          {/* R1/Q4 (0334): o acordo comercial da ortodontia tem limites próprios. */}
          <div className="space-y-2 rounded-lg border border-dashed p-3 sm:col-span-2 lg:col-span-4">
            <p className="text-sm font-medium">O acordo comercial: pontualidade e limites</p>
            <p className="text-[11px] text-muted-foreground">
              O Consultor fecha o acordo da ortodontia na negociação (mensalidade, quantas mensalidades, forma de emissão, desconto por pontualidade, contenção). O que sair destes limites cai em <strong>autorização do Gerente</strong>, como qualquer negociação fora da regra.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor={`punct-${clinicId}`}>Desconto por pontualidade sugerido (%)</Label>
                <Input id={`punct-${clinicId}`} name="punctuality_discount_percent" inputMode="decimal" defaultValue={row ? String(row.punctuality_discount_percent).replace(".", ",") : "0"} placeholder="5" />
                <p className="text-[11px] text-muted-foreground">Para quem paga até o vencimento (aplicado na baixa).</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`punct-max-${clinicId}`}>Pontualidade máxima (%)</Label>
                <Input id={`punct-max-${clinicId}`} name="max_punctuality_discount_percent" inputMode="decimal" defaultValue={row ? String(row.max_punctuality_discount_percent).replace(".", ",") : "10"} placeholder="10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`min-fee-${clinicId}`}>Mensalidade mínima (R$)</Label>
                <Input id={`min-fee-${clinicId}`} name="min_monthly_fee" inputMode="decimal" defaultValue={row ? (row.min_monthly_fee_cents / 100).toFixed(2).replace(".", ",") : "0,00"} placeholder="150,00" />
                <p className="text-[11px] text-muted-foreground">Abaixo disto, o Gerente autoriza. 0 = sem mínimo.</p>
              </div>
            </div>
          </div>

          {/* Q1 (0334): a porta do caso legado — só o Admin mexe. */}
          {isAdmin && (
            <div className="space-y-1 rounded-lg border border-dashed p-3 sm:col-span-2 lg:col-span-4">
              <input type="hidden" name="legacy_entry_present" value="1" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="legacy_entry_enabled" defaultChecked={row?.legacy_entry_enabled ?? true} className="size-4" />
                Permitir cadastrar <strong>caso legado</strong> (paciente que já estava em tratamento antes do sistema, sem venda no Comercial)
              </label>
              <p className="text-[11px] text-muted-foreground">
                O caso novo nasce no fechamento da venda. Esta porta existe para a transição; feche-a quando os pacientes antigos estiverem cadastrados.
              </p>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={isPending}>Salvar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
