"use client";

/**
 * ASA6 (4021, 20.12 e 20.15.6) — A COBRANÇA MENSAL ÀS UNIDADES na Central.
 * Os valores do contrato nascem EM BRANCO e nada é inventado: sem eles, nada é
 * emitido. Valor de exemplo só no treino e no sandbox, marcado como exemplo.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salvarConfigDaRede, salvarConfigDaUnidade, type ConfigDaRede, type ConfigDaUnidade } from "../financeiro/cobranca-da-rede/actions";

export type ConfigLida = {
  network: Record<string, unknown>;
  root_account: { id: string; label: string; environment: string } | null;
  units: {
    clinic_id: string;
    name: string;
    legal_name: string | null;
    cnpj: string | null;
    go_live_on: string | null;
    settings: Record<string, unknown>;
    missing: string[] | null;
    fixed: { fee: string; label: string; amount_cents: number; active: boolean; is_override: boolean }[] | null;
  }[];
};

const t = (v: unknown) => (v == null ? "" : String(v).replace(".", ","));
const num = (s: string) => s.trim().replace(/\./g, "").replace(",", ".");

export function CobrancaMensalConfig({ lido, podeEditar }: { lido: ConfigLida; podeEditar: boolean }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const n = lido.network;
  const exemploPode = lido.root_account?.environment !== "production";
  const [rede, setRede] = useState<ConfigDaRede>({
    fine_percent: t(n.fine_percent),
    interest_percent_month: t(n.interest_percent_month),
    due_day: t(n.due_day),
    period_kind: String(n.period_kind ?? ""),
    preview_days: t(n.preview_days),
    partial_month_rule: String(n.partial_month_rule ?? ""),
    revenue_recognition: String(n.revenue_recognition ?? ""),
    example_values: Boolean(n.example_values),
  });
  const campo = (k: keyof ConfigDaRede) => ({
    value: String(rede[k] ?? ""),
    disabled: !podeEditar || pendente,
    onChange: (e: { target: { value: string } }) => setRede((r) => ({ ...r, [k]: e.target.value })),
  });

  const gravarRede = () =>
    start(async () => {
      const r = await salvarConfigDaRede({ ...rede, fine_percent: num(rede.fine_percent), interest_percent_month: num(rede.interest_percent_month) });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Gravado.");
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Os valores do contrato de franquia nascem em branco. Sem eles, a cobrança mensal não sai, e a tela diz o que falta.
        A cobrança sai pela conta da franqueadora{lido.root_account ? ` (${lido.root_account.label})` : ""}, com a unidade como
        pagadora (boleto com Pix; avisos do Asaas só por e-mail). A tarifa do Asaas é da franqueadora. Sem desconto por
        pagar em dia.
      </p>

      <section className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Multa por atraso (%)</span>
          <Input {...campo("fine_percent")} inputMode="decimal" placeholder="em branco" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Juros ao mês (%)</span>
          <Input {...campo("interest_percent_month")} inputMode="decimal" placeholder="em branco" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Dia de vencimento (1 a 28)</span>
          <Input {...campo("due_day")} inputMode="numeric" placeholder="em branco" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Período de apuração</span>
          <select className="h-9 w-full rounded-lg border border-input bg-transparent px-2" {...campo("period_kind")}>
            <option value="">em branco</option>
            <option value="mes_calendario">Mês calendário</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Dias da prévia (1 a 20)</span>
          <Input {...campo("preview_days")} inputMode="numeric" placeholder="em branco" />
          <span className="block text-xs text-muted-foreground">Sem contestação nesse prazo, a prévia vai para a aprovação e é emitida.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Taxas fixas no mês incompleto</span>
          <select className="h-9 w-full rounded-lg border border-input bg-transparent px-2" {...campo("partial_month_rule")}>
            <option value="">em branco</option>
            <option value="cheio">Valor cheio</option>
            <option value="proporcional">Proporcional aos dias</option>
          </select>
          <span className="block text-xs text-muted-foreground">Início ou saída da unidade no meio do mês.</span>
        </label>
        <label className="space-y-1 text-sm sm:col-span-3">
          <span className="font-medium">Reconhecimento da receita da taxa (decisão do contador)</span>
          <select className="h-9 w-full rounded-lg border border-input bg-transparent px-2" {...campo("revenue_recognition")}>
            <option value="">A definir pelo contador</option>
            <option value="fechamento">No fechamento do mês (competência)</option>
            <option value="pagamento">No pagamento (caixa)</option>
          </select>
          <span className="block text-xs text-muted-foreground">Não trava a cobrança: o razão guarda os dois jeitos.</span>
        </label>
        {exemploPode && (
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              checked={rede.example_values}
              disabled={!podeEditar || pendente}
              onChange={(e) => setRede((r) => ({ ...r, example_values: e.target.checked }))}
            />
            Valores de exemplo (treino e sandbox) — não são do contrato
          </label>
        )}
      </section>
      {podeEditar && (
        <Button onClick={gravarRede} disabled={pendente}>
          {pendente ? "Gravando…" : "Gravar a rede"}
        </Button>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Por unidade</h3>
        <div className="divide-y rounded-lg border">
          {lido.units.map((u) => (
            <Unidade key={u.clinic_id} u={u} podeEditar={podeEditar} exemploPode={exemploPode} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Unidade({ u, podeEditar, exemploPode }: { u: ConfigLida["units"][number]; podeEditar: boolean; exemploPode: boolean }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [pendente, start] = useTransition();
  const s = u.settings ?? {};
  const [c, setC] = useState<ConfigDaUnidade>({
    fine_percent: t(s.fine_percent),
    interest_percent_month: t(s.interest_percent_month),
    due_day: t(s.due_day),
    finance_email: String(s.finance_email ?? ""),
    monthly_from: s.monthly_from ? String(s.monthly_from).slice(0, 7) : "",
    started_on: String(s.started_on ?? ""),
    ended_on: String(s.ended_on ?? ""),
    example_values: Boolean(s.example_values),
  });
  const campo = (k: keyof ConfigDaUnidade) => ({
    value: String(c[k] ?? ""),
    disabled: !podeEditar || pendente,
    onChange: (e: { target: { value: string } }) => setC((x) => ({ ...x, [k]: e.target.value })),
  });
  const falta = u.missing ?? [];
  return (
    <div className="px-3 py-2 text-sm">
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setAberta((x) => !x)}>
        <span className="font-medium">{u.name}</span>
        <span className={falta.length ? "text-xs text-red-700" : "text-xs text-emerald-700"}>
          {falta.length ? `Falta: ${falta.join(", ")}` : "Configuração completa"}
        </span>
      </button>
      {aberta && (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            CNPJ {u.cnpj ?? "— (cadastre na unidade)"} · taxas fixas:{" "}
            {(u.fixed ?? []).map((f) => `${f.label} ${f.active ? `R$ ${(Number(f.amount_cents) / 100).toFixed(2).replace(".", ",")}` : "não se aplica"}`).join(" · ")}{" "}
            (valores em Taxas da rede). Em branco nos campos de multa, juros e vencimento = o da rede.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="font-medium">E-mail financeiro da unidade</span>
              <Input {...campo("finance_email")} type="email" placeholder="em branco" />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Primeiro mês da cobrança mensal</span>
              <Input {...campo("monthly_from")} type="month" />
              <span className="block text-xs text-muted-foreground">Em branco = a unidade ainda não entra. O que estiver antes é o saldo anterior.</span>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Início das atividades</span>
              <Input {...campo("started_on")} type="date" />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Saída da unidade</span>
              <Input {...campo("ended_on")} type="date" />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Multa (%) — exceção</span>
              <Input {...campo("fine_percent")} inputMode="decimal" placeholder="a da rede" />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Juros ao mês (%) — exceção</span>
              <Input {...campo("interest_percent_month")} inputMode="decimal" placeholder="a da rede" />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Dia de vencimento — exceção</span>
              <Input {...campo("due_day")} inputMode="numeric" placeholder="o da rede" />
            </label>
            {exemploPode && (
              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" checked={c.example_values} disabled={!podeEditar || pendente} onChange={(e) => setC((x) => ({ ...x, example_values: e.target.checked }))} />
                Valores de exemplo (treino e sandbox)
              </label>
            )}
          </div>
          {podeEditar && (
            <Button
              size="sm"
              disabled={pendente}
              onClick={() =>
                start(async () => {
                  const r = await salvarConfigDaUnidade(u.clinic_id, {
                    ...c,
                    fine_percent: num(c.fine_percent),
                    interest_percent_month: num(c.interest_percent_month),
                    monthly_from: c.monthly_from ? `${c.monthly_from}-01` : "",
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Gravado.");
                  router.refresh();
                })
              }
            >
              Gravar a unidade
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
