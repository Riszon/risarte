"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2Off, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  isCampaignLive,
  simulateMonth,
  totalFixedCents,
  totalPercent,
  type CampaignMode,
  type FeeCampaign,
  type NetworkFeeKind,
  type NetworkFeeRule,
  type NetworkFeeType,
} from "@/lib/finance/network-fees";
import {
  chargeFixedFeesNow,
  clearNetworkFeeOverride,
  deleteCampaign,
  deleteFeeType,
  saveCampaign,
  saveFeeType,
  saveNetworkFee,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type FeeSummaryRow = {
  fee: string;
  label: string;
  kind: NetworkFeeKind;
  percent: number;
  isOverride: boolean;
  campaignName: string | null;
  baseCents: number;
  amountCents: number;
  receipts: number;
  payableStatus: string | null;
};

type AccountOption = { code: string; name: string; scope: string };

function pct(v: number): string {
  return `${v.toFixed(2).replace(".", ",")}%`;
}

function parseNumber(text: string): number {
  const n = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Uma linha editável da configuração de valor. */
function RuleRow({
  rule,
  scope,
  canEdit,
  onSave,
  onClear,
}: {
  rule: NetworkFeeRule;
  scope: "rede" | "unidade";
  canEdit: boolean;
  onSave: (next: NetworkFeeRule) => void;
  onClear?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(String(rule.percent).replace(".", ","));
  const [amount, setAmount] = useState(
    (rule.amountCents / 100).toFixed(2).replace(".", ",")
  );
  const [dueDay, setDueDay] = useState(String(rule.dueDay));
  const [active, setActive] = useState(rule.active);
  const [note, setNote] = useState(rule.note);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-sm">
        <span className="flex items-center gap-2">
          {rule.label}
          {scope === "unidade" && rule.isOverride && (
            <span
              className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
              title={rule.note || undefined}
            >
              acordo próprio
            </span>
          )}
          {scope === "unidade" && !rule.isOverride && (
            <span className="text-[10px] text-muted-foreground">
              segue a rede
            </span>
          )}
          {!rule.active && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
              desligada
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 tabular-nums">
          <span className="w-24 text-right">
            {rule.kind === "percent"
              ? pct(rule.percent)
              : formatBRL(rule.amountCents)}
          </span>
          <span className="w-24 text-right text-xs text-muted-foreground">
            vence dia {rule.dueDay}
          </span>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                title="Editar"
              >
                <Pencil className="size-3" />
              </Button>
              {scope === "unidade" && rule.isOverride && onClear && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClear}
                  title="Voltar ao padrão da rede"
                >
                  <Link2Off className="size-3" />
                </Button>
              )}
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t py-2">
      <p className="text-sm font-medium">{rule.label}</p>
      <div className="flex flex-wrap items-end gap-2">
        {rule.kind === "percent" ? (
          <label className="block">
            <Label className="text-[11px]">% sobre o recebido</Label>
            <Input
              className="h-8 w-24"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </label>
        ) : (
          <label className="block">
            <Label className="text-[11px]">Valor mensal (R$)</Label>
            <Input
              className="h-8 w-28"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        <label className="block">
          <Label className="text-[11px]">Vence dia</Label>
          <Input
            className="h-8 w-20"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 pb-1 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Cobrar
        </label>
        <label className="block flex-1">
          <Label className="text-[11px]">
            {scope === "unidade"
              ? "Motivo do acordo diferente (fica registrado)"
              : "Observação"}
          </Label>
          <Input
            className="h-8"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              scope === "unidade"
                ? "Ex.: carência de royalty nos 12 primeiros meses"
                : ""
            }
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            onSave({
              ...rule,
              percent: parseNumber(percent),
              amountCents: Math.round(parseNumber(amount) * 100),
              dueDay: Number(dueDay) || 10,
              active,
              note,
            });
            setEditing(false);
          }}
        >
          Salvar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Cadastro de uma taxa do catálogo. */
function FeeTypeForm({
  initial,
  accounts,
  onSave,
  onCancel,
}: {
  initial: NetworkFeeType | null;
  accounts: AccountOption[];
  onSave: (v: {
    key: string | null;
    label: string;
    kind: NetworkFeeKind;
    unitAccount: string;
    franchisorAccount: string;
    active: boolean;
    sortOrder: number;
    note: string;
  }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<NetworkFeeKind>(initial?.kind ?? "percent");
  const [unitAccount, setUnitAccount] = useState(initial?.unitAccount ?? "");
  const [franchisorAccount, setFranchisorAccount] = useState(
    initial?.franchisorAccount ?? ""
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  const unitOptions = accounts.filter((a) => a.scope !== "franchisor");
  const franchisorOptions = accounts.filter((a) => a.scope !== "unit");

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-medium">
        {initial ? `Editar ${initial.label}` : "Nova taxa da rede"}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Label className="text-[11px]">Nome</Label>
          <Input
            className="h-8 w-56"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Taxa de inovação"
          />
        </label>
        <label className="block">
          <Label className="text-[11px]">Natureza</Label>
          <select
            value={kind}
            disabled={!!initial?.system}
            onChange={(e) => setKind(e.target.value as NetworkFeeKind)}
            className={cn(selectClass, "w-40")}
          >
            <option value="percent">% sobre o recebido</option>
            <option value="fixed">Valor fixo mensal</option>
          </select>
        </label>
        <label className="flex items-center gap-1 pb-1 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Ativa
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Label className="text-[11px]">Conta de despesa (unidade)</Label>
          <select
            value={unitAccount}
            onChange={(e) => setUnitAccount(e.target.value)}
            className={cn(selectClass, "w-72")}
          >
            <option value="">Escolha…</option>
            {unitOptions.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label className="text-[11px]">Conta de receita (franqueadora)</Label>
          <select
            value={franchisorAccount}
            onChange={(e) => setFranchisorAccount(e.target.value)}
            className={cn(selectClass, "w-72")}
          >
            <option value="">Escolha…</option>
            {franchisorOptions.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <Label className="text-[11px]">Observação</Label>
        <Input
          className="h-8"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <p className="text-[10px] text-muted-foreground">
        As contas precisam existir no <strong>Plano de contas</strong> e receber
        lançamento. Se faltar a conta certa, crie-a lá antes — plano de contas
        que cresce sozinho vira relatório que ninguém entende.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!label.trim() || !unitAccount || !franchisorAccount}
          onClick={() =>
            onSave({
              key: initial?.key ?? null,
              label,
              kind,
              unitAccount,
              franchisorAccount,
              active,
              sortOrder: initial?.sortOrder ?? 100,
              note,
            })
          }
        >
          Salvar taxa
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Cadastro de campanha. */
function CampaignForm({
  types,
  units,
  onSave,
  onCancel,
}: {
  types: NetworkFeeType[];
  units: { id: string; name: string }[];
  onSave: (v: {
    id: string | null;
    name: string;
    clinicId: string | null;
    fee: string | null;
    startsOn: string;
    endsOn: string;
    mode: CampaignMode;
    percent: number | null;
    amountCents: number | null;
    discountPercent: number | null;
    note: string;
    active: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [fee, setFee] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [mode, setMode] = useState<CampaignMode>("valor");
  const [percent, setPercent] = useState("0");
  const [amount, setAmount] = useState("0,00");
  const [discount, setDiscount] = useState("50");
  const [note, setNote] = useState("");

  const chosen = types.find((t) => t.key === fee);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-medium">Nova campanha</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Label className="text-[11px]">Nome</Label>
          <Input
            className="h-8 w-56"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Carência de abertura"
          />
        </label>
        <label className="block">
          <Label className="text-[11px]">Vale para</Label>
          <select
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className={cn(selectClass, "w-48")}
          >
            <option value="">Toda a rede</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label className="text-[11px]">Taxa</Label>
          <select
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className={cn(selectClass, "w-48")}
          >
            <option value="">Todas as taxas</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Label className="text-[11px]">De</Label>
          <Input
            className="h-8 w-40"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
        <label className="block">
          <Label className="text-[11px]">Até</Label>
          <Input
            className="h-8 w-40"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </label>
        <label className="block">
          <Label className="text-[11px]">O que a campanha faz</Label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as CampaignMode)}
            className={cn(selectClass, "w-56")}
          >
            <option value="valor">Trocar o valor (0 = isenção)</option>
            <option value="desconto">Descontar do valor vigente</option>
          </select>
        </label>

        {mode === "desconto" ? (
          <label className="block">
            <Label className="text-[11px]">Desconto (%)</Label>
            <Input
              className="h-8 w-24"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </label>
        ) : chosen?.kind === "fixed" ? (
          <label className="block">
            <Label className="text-[11px]">Novo valor (R$)</Label>
            <Input
              className="h-8 w-28"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        ) : (
          <label className="block">
            <Label className="text-[11px]">Novo percentual (%)</Label>
            <Input
              className="h-8 w-24"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </label>
        )}
      </div>

      <label className="block">
        <Label className="text-[11px]">Motivo (fica registrado)</Label>
        <Input
          className="h-8"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <p className="text-[10px] text-muted-foreground">
        A campanha ganha do acordo da unidade e do padrão da rede enquanto
        estiver valendo. <strong>Não recalcula o passado:</strong> o percentual
        fica congelado em cada baixa no dia em que ela acontece.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSave({
              id: null,
              name,
              clinicId: clinicId || null,
              fee: fee || null,
              startsOn,
              endsOn,
              mode,
              percent: mode === "valor" ? parseNumber(percent) : null,
              amountCents:
                mode === "valor" && chosen?.kind === "fixed"
                  ? Math.round(parseNumber(amount) * 100)
                  : null,
              discountPercent: mode === "desconto" ? parseNumber(discount) : null,
              note,
              active: true,
            })
          }
        >
          Criar campanha
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function NetworkFeesView({
  isNetworkAdmin,
  types,
  network,
  unit,
  unitId,
  units,
  year,
  month,
  today,
  summary,
  campaigns,
  accounts,
}: {
  isNetworkAdmin: boolean;
  types: NetworkFeeType[];
  network: NetworkFeeRule[];
  unit: NetworkFeeRule[];
  unitId: string | null;
  units: { id: string; name: string }[];
  year: number;
  month: number;
  today: string;
  summary: FeeSummaryRow[];
  campaigns: FeeCampaign[];
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [simulate, setSimulate] = useState("50.000,00");
  const [newType, setNewType] = useState(false);
  const [editType, setEditType] = useState<NetworkFeeType | null>(null);
  const [newCampaign, setNewCampaign] = useState(false);

  function apply(next: Partial<{ ano: number; mes: number; unidade: string }>) {
    const params = new URLSearchParams({
      ano: String(next.ano ?? year),
      mes: String(next.mes ?? month),
      unidade: next.unidade ?? unitId ?? "",
    });
    startTransition(() => router.push(`/financeiro/taxas-da-rede?${params}`));
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; count?: number }>,
    okMessage: (count?: number) => string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(okMessage(r.count));
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const sim = simulateMonth(unit, Math.round(parseNumber(simulate) * 100));
  const totalApurado = summary.reduce((s, r) => s + r.amountCents, 0);
  const liveCampaigns = campaigns.filter((c) => isCampaignLive(c, today));

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          {isNetworkAdmin && units.length > 1 && (
            <label className="block">
              <Label className="text-[11px]">Unidade</Label>
              <select
                value={unitId ?? ""}
                onChange={(e) => apply({ unidade: e.target.value })}
                className={cn(selectClass, "w-52")}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <Label className="text-[11px]">Ano</Label>
            <Input
              className="h-8 w-24"
              type="number"
              value={year}
              onChange={(e) => apply({ ano: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Mês</Label>
            <select
              value={month}
              onChange={(e) => apply({ mes: Number(e.target.value) })}
              className={cn(selectClass, "w-36")}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {/* -- CAMPANHAS VIGENTES ------------------------------------------ */}
      {liveCampaigns.length > 0 && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-medium">
            <Tag className="size-4" />
            Campanha valendo hoje
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {liveCampaigns.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> — {c.fee ? c.fee : "todas as taxas"},{" "}
                {c.clinicId ? "só esta unidade" : "toda a rede"}, de{" "}
                {fmtDate(c.startsOn)} a {fmtDate(c.endsOn)}
                {c.mode === "desconto"
                  ? ` · −${pct(c.discountPercent ?? 0)} do valor vigente`
                  : c.percent !== null
                    ? ` · passa a ${pct(c.percent)}`
                    : c.amountCents !== null
                      ? ` · passa a ${formatBRL(c.amountCents)}`
                      : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* -- O QUE VALE PARA ESTA UNIDADE -------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">O que vale para esta unidade</h2>
          <p className="pb-1 text-[11px] text-muted-foreground">
            É esta a referência do split: cada baixa de parcela cobra estes
            percentuais sobre o valor recebido. Os números abaixo{" "}
            <strong>não incluem campanha</strong> — a campanha aparece na faixa
            verde acima e no apurado do mês.
          </p>
          {unit.map((r) => (
            <RuleRow
              key={r.fee}
              rule={r}
              scope="unidade"
              canEdit={isNetworkAdmin && !!unitId}
              onSave={(next) =>
                run(
                  () =>
                    saveNetworkFee({
                      clinicId: unitId,
                      fee: next.fee,
                      kind: next.kind,
                      percent: next.percent,
                      amountCents: next.amountCents,
                      dueDay: next.dueDay,
                      active: next.active,
                      note: next.note,
                    }),
                  () => "Taxa salva."
                )
              }
              onClear={() =>
                unitId &&
                run(
                  () => clearNetworkFeeOverride({ clinicId: unitId, fee: r.fee }),
                  () => "Voltou ao padrão da rede."
                )
              }
            />
          ))}

          <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
            <div>
              <p className="text-[11px] text-muted-foreground">
                Sobre cada real recebido
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {pct(totalPercent(unit))}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Fixo por mês</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatBRL(totalFixedCents(unit))}
              </p>
            </div>
            <label className="block">
              <Label className="text-[11px]">Se receber no mês (R$)</Label>
              <Input
                className="h-8 w-32"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value)}
              />
            </label>
            <p className="pb-1 text-sm">
              paga{" "}
              <strong className="tabular-nums">
                {formatBRL(sim.totalCents)}
              </strong>{" "}
              <span className="text-[11px] text-muted-foreground">
                ({formatBRL(sim.percentCents)} de percentual +{" "}
                {formatBRL(sim.fixedCents)} de fixo)
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* -- O APURADO NO MÊS -------------------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Apurado em {MONTHS[month - 1]} de {year}
            </h2>
            {isNetworkAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run(
                    () => chargeFixedFeesNow({ year, month }),
                    (n) => `${n ?? 0} taxas fixas geradas.`
                  )
                }
              >
                Gerar taxas fixas do mês
              </Button>
            )}
          </div>

          {summary.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              Nada apurado neste mês.
            </p>
          ) : (
            <>
              <div className="flex justify-between pb-1 pt-2 text-[10px] uppercase text-muted-foreground">
                <span>Taxa</span>
                <span className="flex gap-3">
                  <span className="w-20 text-right">Base recebida</span>
                  <span className="w-16 text-right">Baixas</span>
                  <span className="w-24 text-right">Valor</span>
                  <span className="w-20 text-right">Conta</span>
                </span>
              </div>
              {summary.map((s) => (
                <div
                  key={s.fee}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>
                    {s.label}
                    {s.kind === "percent" && s.percent > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        ({pct(s.percent)})
                      </span>
                    )}
                    {s.campaignName && (
                      <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">
                        {s.campaignName}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-20 text-right text-muted-foreground">
                      {s.kind === "percent" ? formatBRL(s.baseCents) : "—"}
                    </span>
                    <span className="w-16 text-right text-muted-foreground">
                      {s.kind === "percent" ? s.receipts : "—"}
                    </span>
                    <span className="w-24 text-right">
                      {formatBRL(s.amountCents)}
                    </span>
                    <span className="w-20 text-right text-muted-foreground">
                      {s.payableStatus ?? "—"}
                    </span>
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t-2 py-1.5 text-sm font-semibold">
                <span>Total do mês</span>
                <span className="tabular-nums">{formatBRL(totalApurado)}</span>
              </div>
            </>
          )}

          <p className="pt-2 text-[10px] text-muted-foreground">
            Cada taxa vira <strong>uma conta a pagar por mês</strong>, que cresce
            conforme os recebimentos entram. Hoje o split{" "}
            <strong>não é retido pela adquirente</strong> (o ASAAS ainda não está
            plugado): a unidade recebe tudo e paga a rede pela conta.
          </p>
        </CardContent>
      </Card>

      {/* -- ADMINISTRAÇÃO DA REDE --------------------------------------- */}
      {isNetworkAdmin && (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Padrão da rede</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditType(null);
                    setNewType((v) => !v);
                  }}
                >
                  <Plus className="mr-1 size-3" /> Nova taxa
                </Button>
              </div>
              <p className="pb-1 text-[11px] text-muted-foreground">
                Vale para toda unidade que não tem acordo próprio. Mudar aqui{" "}
                <strong>não recalcula o que já foi cobrado</strong>.
              </p>

              {(newType || editType) && (
                <div className="py-2">
                  <FeeTypeForm
                    initial={editType}
                    accounts={accounts}
                    onCancel={() => {
                      setNewType(false);
                      setEditType(null);
                    }}
                    onSave={(v) => {
                      run(() => saveFeeType(v), () => "Taxa salva.");
                      setNewType(false);
                      setEditType(null);
                    }}
                  />
                </div>
              )}

              {network.map((r) => {
                const t = types.find((x) => x.key === r.fee);
                return (
                  <div key={r.fee}>
                    <RuleRow
                      rule={r}
                      scope="rede"
                      canEdit
                      onSave={(next) =>
                        run(
                          () =>
                            saveNetworkFee({
                              clinicId: null,
                              fee: next.fee,
                              kind: next.kind,
                              percent: next.percent,
                              amountCents: next.amountCents,
                              dueDay: next.dueDay,
                              active: next.active,
                              note: next.note,
                            }),
                          () => "Padrão da rede salvo."
                        )
                      }
                    />
                    {t && (
                      <div className="flex items-center gap-2 pb-1 pl-1 text-[10px] text-muted-foreground">
                        <span>
                          {t.unitAccount} → {t.franchisorAccount}
                        </span>
                        {!t.active && <span>· inativa no catálogo</span>}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setNewType(false);
                            setEditType(t);
                          }}
                        >
                          editar cadastro
                        </button>
                        {!t.system && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-destructive underline"
                            onClick={() =>
                              run(
                                () => deleteFeeType({ key: t.key }),
                                () => "Taxa excluída."
                              )
                            }
                          >
                            <Trash2 className="size-3" /> excluir
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Campanhas</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNewCampaign((v) => !v)}
                >
                  <Plus className="mr-1 size-3" /> Nova campanha
                </Button>
              </div>
              <p className="pb-1 text-[11px] text-muted-foreground">
                Períodos em que a unidade paga menos. A campanha ganha do acordo
                da unidade enquanto estiver valendo.
              </p>

              {newCampaign && (
                <div className="py-2">
                  <CampaignForm
                    types={types}
                    units={units}
                    onCancel={() => setNewCampaign(false)}
                    onSave={(v) => {
                      run(() => saveCampaign(v), () => "Campanha criada.");
                      setNewCampaign(false);
                    }}
                  />
                </div>
              )}

              {campaigns.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Nenhuma campanha cadastrada.
                </p>
              ) : (
                campaigns.map((c) => {
                  const live = isCampaignLive(c, today);
                  return (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-xs"
                    >
                      <span>
                        <strong>{c.name}</strong>{" "}
                        <span className="text-muted-foreground">
                          {fmtDate(c.startsOn)} a {fmtDate(c.endsOn)} ·{" "}
                          {c.fee ?? "todas as taxas"} ·{" "}
                          {c.clinicId ? "uma unidade" : "toda a rede"}
                        </span>
                        {live && (
                          <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">
                            valendo
                          </span>
                        )}
                        {!c.active && (
                          <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            desligada
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">
                          {c.mode === "desconto"
                            ? `−${pct(c.discountPercent ?? 0)}`
                            : c.percent !== null
                              ? pct(c.percent)
                              : c.amountCents !== null
                                ? formatBRL(c.amountCents)
                                : "—"}
                        </span>
                        <button
                          type="button"
                          className="text-destructive underline"
                          onClick={() =>
                            run(
                              () => deleteCampaign({ id: c.id }),
                              () => "Campanha excluída."
                            )
                          }
                        >
                          excluir
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
