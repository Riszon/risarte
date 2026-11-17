"use client";

/**
 * ASA6 (4021a, spec 20.17) — a CONFERÊNCIA DAS TAXAS: a conta do mês por unidade,
 * as divergências abertas, as ignoradas e "Em atraso com a rede". Só confere e
 * mostra. Ignorar e "Conferir agora": Financeiro da Franqueadora ou Admin Master.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { mesAno } from "@/lib/finance/cobranca-da-rede";
import { conferirAgora, ignorarDivergencia } from "./actions";

export type Conta = { devido: number; retido: number; a_reter: number; faturado: number; dispensado: number; ainda: number; diferenca: number };
export type Divergencia = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  period: string;
  kind: string;
  amount_cents: number;
  detail: Record<string, unknown>;
  status: "aberta" | "ignorada";
  first_seen_at: string;
  reopened_at: string | null;
  ignored_at: string | null;
  ignored_reason: string | null;
  ignored_by: string | null;
};
export type ConferenciaLida = {
  period: string;
  can_manage: boolean;
  last_run: { run_on: string; ran_at: string; open_issues: number } | null;
  units: { clinic_id: string; name: string; monthly_from: string; account: Conta | null }[];
  lines: { ref_type: string; ref_id: string; fee: string; fee_label: string; devido: number; retido: number; a_reter: number; dispensado: number; faturado: number; ainda: number }[] | null;
  issues: Divergencia[];
  overdue: { batch_id: string; clinic_name: string; period: string; total_cents: number; due_date: string; days: number }[];
};

export const TIPO_DA_DIVERGENCIA: Record<string, { rotulo: string; caminho: string }> = {
  linha_dois_donos: { rotulo: "Linha em dois donos", caminho: "Faturada a mais do que vale. O crédito entra sozinho na próxima prévia; fecha quando for faturado." },
  linha_sem_dono: { rotulo: "Linha sem dono", caminho: "Não entrou na cobrança que abriu depois dela. Refaça a prévia, ou dispense com motivo." },
  pago_diferente: { rotulo: "Pago diferente do faturado", caminho: "A cobrança foi paga a menor ou sem a baixa completa. Dê a baixa à mão nas Contas a pagar." },
  caixa_diferente: { rotulo: "Caixa diferente", caminho: "O caixa da unidade ou o da franqueadora não bate com a cobrança paga. Revisão do Financeiro." },
  split_a_mais: { rotulo: "Split a mais", caminho: "O Asaas repassou mais do que o devido (acima da tolerância). O Financeiro decide a devolução à unidade." },
  conta_desatualizada: { rotulo: "Conta a pagar desatualizada", caminho: "A conta de taxa do mês não bate com as linhas dela. O ajuste entra no mês aberto." },
  diferenca_do_mes: { rotulo: "Diferença da conta do mês", caminho: "A conta do mês não fecha em zero. Revisão do Financeiro." },
  sem_razao: { rotulo: "Sem lançamento no razão", caminho: "Uma taxa retida, uma conta de taxa ou o pagamento dela não tem o lançamento do mesmo valor no razão (despesa da unidade, receita da franqueadora ou caixa). Revisão do Financeiro; o DRE fica errado até corrigir." },
};

const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const COLUNAS: [keyof Conta, string][] = [
  ["devido", "Devido"],
  ["retido", "Retido pelo split"],
  ["a_reter", "A reter"],
  ["faturado", "Faturado"],
  ["dispensado", "Dispensado"],
  ["ainda", "Ainda a cobrar"],
  ["diferenca", "Diferença"],
];

export function ConferenciaDasTaxas({ lido, unidadeAberta }: { lido: ConferenciaLida; unidadeAberta: string | null }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [mes, setMes] = useState(lido.period.slice(0, 7));
  const abertas = lido.issues.filter((i) => i.status === "aberta");
  const ignoradas = lido.issues.filter((i) => i.status === "ignorada");
  const base = "/financeiro/cobranca-da-rede?aba=conferencia";

  const planilha = () => {
    const cel = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const r = (c: number | null | undefined) => (c == null ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));
    const linhas = [
      ["Unidade", "Mês", ...COLUNAS.map((c) => c[1])],
      ...lido.units.map((u) => [u.name, mesAno(lido.period), ...COLUNAS.map(([k]) => r(u.account?.[k]))]),
      [],
      ["Divergência", "Unidade", "Mês", "Valor", "Situação", "Desde", "Ignorada por", "Motivo"],
      ...lido.issues.map((i) => [TIPO_DA_DIVERGENCIA[i.kind]?.rotulo ?? i.kind, i.clinic_name, mesAno(i.period), r(i.amount_cents), i.status, dia(i.first_seen_at), i.ignored_by ?? "", i.ignored_reason ?? ""]),
    ];
    const blob = new Blob(["﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `conferencia-das-taxas-${mesAno(lido.period).replace("/", "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <Input type="month" className="w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
        <Button variant="outline" onClick={() => router.push(`${base}&mes=${mes}`)}>
          Ver o mês
        </Button>
        <Button variant="outline" onClick={planilha}>
          Baixar a planilha
        </Button>
        {lido.can_manage && (
          <Button
            disabled={pendente}
            onClick={() =>
              start(async () => {
                const r = await conferirAgora();
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.aviso ?? "Conferido.");
                router.refresh();
              })
            }
          >
            Conferir agora
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {lido.last_run ? `Última conferência: ${new Date(lido.last_run.ran_at).toLocaleString("pt-BR")}` : "Ainda sem conferência."}
        </span>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">A conta de {mesAno(lido.period)}</h2>
        <p className="text-xs text-muted-foreground">
          Devido = retido pelo split + a reter + faturado + dispensado + ainda a cobrar. A diferença tem de ser R$ 0,00. A
          conferência parte do 1º mês da cobrança mensal de cada unidade. No mês que ainda não fechou, a taxa fixa entra como
          prevista (o valor da Central) até a conta a pagar nascer, no dia 1º ou na prévia.
        </p>
        {lido.units.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma unidade com a cobrança mensal ligada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Unidade</th>
                  {COLUNAS.map(([k, t]) => (
                    <th key={k} className="px-3 py-2 text-right">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {lido.units.map((u) => (
                  <tr key={u.clinic_id} className={cn(u.clinic_id === unidadeAberta && "bg-gold/10")}>
                    <td className="px-3 py-2">
                      <Link className="text-primary underline-offset-2 hover:underline" href={`${base}&mes=${lido.period.slice(0, 7)}&unidade=${u.clinic_id}`}>
                        {u.name}
                      </Link>
                    </td>
                    {u.account ? (
                      COLUNAS.map(([k]) => (
                        <td key={k} className={cn("px-3 py-2 text-right tabular-nums", k === "diferenca" && Number(u.account?.[k]) !== 0 && "font-semibold text-red-700")}>
                          {formatBRL(Number(u.account?.[k] ?? 0))}
                        </td>
                      ))
                    ) : (
                      <td colSpan={COLUNAS.length} className="px-3 py-2 text-xs text-muted-foreground">
                        Antes do 1º mês ({mesAno(u.monthly_from)}).
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lido.lines && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">As linhas da unidade</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Taxa</th>
                  {["Devido", "Retido", "A reter", "Dispensado", "Faturado", "Ainda"].map((t) => (
                    <th key={t} className="px-2 py-1 text-right">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {lido.lines.map((l) => (
                  <tr key={l.ref_id ?? `${l.ref_type}-${l.fee}`} className={cn(Number(l.ainda) < 0 && "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200")}>
                    <td className="px-2 py-1">
                      {l.fee_label} {l.ref_type === "payable" ? "(fixa)" : l.ref_type === "previsto" ? "(fixa, prevista)" : ""}
                    </td>
                    {[l.devido, l.retido, l.a_reter, l.dispensado, l.faturado, l.ainda].map((v, k) => (
                      <td key={k} className="px-2 py-1 text-right tabular-nums">
                        {formatBRL(Number(v))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ListaDeDivergencias titulo={`Divergências abertas (${abertas.length})`} itens={abertas} podeIgnorar={lido.can_manage} />
      <ListaDeDivergencias titulo={`Ignoradas (${ignoradas.length})`} itens={ignoradas} podeIgnorar={false} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Em atraso com a rede (30 dias ou mais)</h2>
        {lido.overdue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {lido.overdue.map((o) => (
              <li key={o.batch_id}>
                {o.clinic_name} — {mesAno(o.period)} — {formatBRL(Number(o.total_cents))}, vencida em {dia(o.due_date)} ({o.days} dias)
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListaDeDivergencias({ titulo, itens, podeIgnorar }: { titulo: string; itens: Divergencia[]; podeIgnorar: boolean }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {itens.map((i) => {
            const t = TIPO_DA_DIVERGENCIA[i.kind] ?? { rotulo: i.kind, caminho: "" };
            return (
              <li key={i.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t.rotulo} — {i.clinic_name} — {mesAno(i.period)}
                  </span>
                  <span className="tabular-nums">{formatBRL(Number(i.amount_cents))}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.caminho} Desde {dia(i.first_seen_at)}
                  {i.reopened_at && `; reaberta em ${dia(i.reopened_at)} (o valor mudou)`}.
                </p>
                {i.status === "ignorada" && (
                  <p className="text-xs">
                    Ignorada por {i.ignored_by ?? "—"} em {dia(i.ignored_at)}: {i.ignored_reason}
                  </p>
                )}
                {podeIgnorar && (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    disabled={pendente}
                    onClick={() => {
                      const m = window.prompt("Por que ignorar esta divergência? (fica na auditoria; se o valor mudar, ela reabre)");
                      if (!m || m.trim().length < 5) return;
                      start(async () => {
                        const r = await ignorarDivergencia(i.id, m.trim());
                        if (!r.ok) return void toast.error(r.error);
                        toast.success("Ignorada.");
                        router.refresh();
                      });
                    }}
                  >
                    Ignorar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
