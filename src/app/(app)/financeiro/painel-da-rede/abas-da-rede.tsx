"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NETWORK_TABS, type NetworkTab } from "@/lib/finance/network-areas";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

/**
 * OC-00121, K1 e K4 — as abas do Painel da rede e o mês, que vale para todas.
 * Trocar de aba mantém o mês; trocar o mês mantém a aba.
 */
export function AbasDaRede({
  aba,
  ano,
  mes,
  anoAtual,
}: {
  aba: NetworkTab;
  ano: number;
  mes: number;
  /** O ano de hoje no Brasil, vindo do servidor (relógio da máquina não serve). */
  anoAtual: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const href = (a: NetworkTab, y = ano, m = mes) =>
    `/financeiro/painel-da-rede?${new URLSearchParams({
      aba: a,
      ano: String(y),
      mes: String(m),
    })}`;

  const anos = Array.from({ length: 6 }, (_, i) => anoAtual + 1 - i);
  if (!anos.includes(ano)) anos.push(ano);

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] text-muted-foreground">Mês</span>
          <select
            value={mes}
            onChange={(e) =>
              startTransition(() => router.push(href(aba, ano, Number(e.target.value))))
            }
            className={cn(selectClass, "w-36")}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted-foreground">Ano</span>
          <select
            value={ano}
            onChange={(e) =>
              startTransition(() => router.push(href(aba, Number(e.target.value), mes)))
            }
            className={cn(selectClass, "w-24")}
          >
            {anos
              .sort((a, b) => b - a)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        </label>
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4">
        {NETWORK_TABS.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={aba === t.key ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm",
              aba === t.key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
