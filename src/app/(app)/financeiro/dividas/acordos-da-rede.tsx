import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_TONE, somarDias, type AgreementStatus } from "@/lib/finance/dividas-acordos";
import type { Acordo, BaseDasDividas } from "./dados";

// A aba "Acordos" da tela principal (0408, plano 3): os que esperam
// aprovação, os em andamento e os quebrados — com o saldo a pagar e as
// parcelas dos próximos 30 dias. O resto (cumprido, restabelecido,
// substituído, desfeito, recusado) fica embaixo, recolhido.

const GRUPOS: { titulo: string; situacoes: AgreementStatus[] }[] = [
  { titulo: "Aguardando aprovação", situacoes: ["aguardando_aprovacao"] },
  { titulo: "Quebrados", situacoes: ["quebrado"] },
  { titulo: "Em andamento", situacoes: ["em_andamento"] },
];

export function AcordosDaRede({
  acordos,
  ok,
  base,
  codigos,
  hoje,
}: {
  acordos: Acordo[];
  ok: boolean;
  base: BaseDasDividas;
  codigos: Record<string, string>;
  hoje: string;
}) {
  if (!ok) {
    return (
      <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        Os acordos precisam da migração 0408, que ainda não foi aplicada neste banco.
      </p>
    );
  }
  const em30 = somarDias(hoje, 30);
  const abertas = (a: Acordo) => a.titulos.filter((t) => t.status === "aberta" || t.status === "parcial");
  const falta = (a: Acordo) => abertas(a).reduce((x, t) => x + Math.max(t.valorCents - t.pagoCents, 0), 0);
  const proximos30 = (a: Acordo) =>
    abertas(a)
      .filter((t) => t.vencimento <= em30)
      .reduce((x, t) => x + Math.max(t.valorCents - t.pagoCents, 0), 0);
  const vivos = acordos.filter((a) => a.situacao === "em_andamento" || a.situacao === "quebrado");
  const encerrados = acordos.filter((a) => !GRUPOS.some((g) => g.situacoes.includes(a.situacao)));

  const linha = (a: Acordo) => {
    const prox = abertas(a)[0];
    return (
      <tr key={a.id} className="border-t align-top">
        <td className="whitespace-nowrap px-2 py-2">
          <Link href={`/financeiro/dividas/${a.principalId}?aba=acordos`} className="font-medium underline">
            {a.codigo}
          </Link>
          <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[11px]", AGREEMENT_STATUS_TONE[a.situacao])}>{AGREEMENT_STATUS_LABELS[a.situacao]}</span>
        </td>
        <td className="px-2 py-2">
          {base.devedores.find((d) => d.id === a.clinicId)?.nome ?? "—"}
          <span className="block text-xs text-muted-foreground">{base.credores.find((c) => c.id === a.supplierId)?.nome ?? "—"}</span>
        </td>
        <td className="px-2 py-2 text-xs">{a.dividas.map((x) => codigos[x.debtId] ?? "—").join(", ")}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatBRL(a.totalCents)}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{a.situacao === "aguardando_aprovacao" ? "—" : formatBRL(falta(a))}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{a.situacao === "aguardando_aprovacao" ? "—" : formatBRL(proximos30(a))}</td>
        <td className={cn("whitespace-nowrap px-2 py-2 text-xs", prox && prox.vencimento < hoje && "font-medium text-red-700 dark:text-red-300")}>
          {prox ? `${formatIsoDateBr(prox.vencimento)} · ${formatBRL(prox.valorCents - prox.pagoCents)}` : "—"}
        </td>
      </tr>
    );
  };

  const tabela = (lista: Acordo[]) => (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">Acordo</th>
            <th className="px-2 py-1.5">Devedor · credor</th>
            <th className="px-2 py-1.5">Dívidas</th>
            <th className="px-2 py-1.5 text-right">Acordado</th>
            <th className="px-2 py-1.5 text-right">Falta pagar</th>
            <th className="px-2 py-1.5 text-right">Próx. 30 dias</th>
            <th className="px-2 py-1.5">Próxima parcela</th>
          </tr>
        </thead>
        <tbody>{lista.map(linha)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Saldo a pagar nos acordos</p>
            <p className="text-xl font-semibold tabular-nums">{formatBRL(vivos.reduce((x, a) => x + falta(a), 0))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Parcelas dos próximos 30 dias (inclui as vencidas)</p>
            <p className="text-xl font-semibold tabular-nums">{formatBRL(vivos.reduce((x, a) => x + proximos30(a), 0))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">Quebrados · aguardando aprovação</p>
            <p className="text-xl font-semibold tabular-nums">
              {acordos.filter((a) => a.situacao === "quebrado").length} · {acordos.filter((a) => a.situacao === "aguardando_aprovacao").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {acordos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum acordo ainda. Para renegociar, abra a dívida e use “Renegociar dívida”.</p>
      )}

      {GRUPOS.map((g) => {
        const lista = acordos.filter((a) => g.situacoes.includes(a.situacao));
        if (lista.length === 0) return null;
        return (
          <section key={g.titulo} className="space-y-1">
            <h2 className="text-sm font-semibold">
              {g.titulo} ({lista.length})
            </h2>
            {tabela(lista)}
          </section>
        );
      })}

      {encerrados.length > 0 && (
        <details className="space-y-1">
          <summary className="cursor-pointer text-sm font-semibold">Encerrados, desfeitos e substituídos ({encerrados.length})</summary>
          {tabela(encerrados)}
        </details>
      )}
    </div>
  );
}
