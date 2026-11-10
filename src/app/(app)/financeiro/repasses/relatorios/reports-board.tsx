"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import {
  REPORT_STATUS_LABEL,
  nextStepText,
  reasonError,
  totalReady,
  type Candidate,
  type Report,
} from "@/lib/finance/payout-report";
import {
  generatePayoutReports,
  releaseWithheldPayout,
  sendAllDraftReports,
} from "./actions";

export type WithheldRow = {
  payoutId: string;
  providerName: string;
  procedureName: string;
  finishedOn: string;
  amountCents: number;
  reason: string;
  byName: string | null;
  at: string | null;
};

export function ReportsBoard({
  clinicId,
  month,
  today,
  canManage,
  candidates,
  reports,
  withheld,
  loadFailed,
}: {
  clinicId: string;
  /** AAAA-MM */
  month: string;
  today: string;
  canManage: boolean;
  candidates: Candidate[];
  reports: Report[];
  withheld: WithheldRow[];
  loadFailed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [releasing, setReleasing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const resumo = totalReady(candidates);

  function generate(providerId: string | null) {
    startTransition(async () => {
      const r = await generatePayoutReports({ clinicId, month, providerId });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        const n = r.count ?? 0;
        toast.success(
          n === 0
            ? "Nada novo para entrar em relatório."
            : `${n} relatório${n === 1 ? "" : "s"} gerado${n === 1 ? "" : "s"} ou completado${n === 1 ? "" : "s"}.`
        );
      }
      router.refresh();
    });
  }

  const rascunhosComItens = reports.filter(
    (r) => r.status === "rascunho" && r.itemCount > 0
  ).length;

  function sendAll() {
    startTransition(async () => {
      const r = await sendAllDraftReports({ clinicId });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        const n = r.count ?? 0;
        toast.success(
          n === 0
            ? "Nenhum rascunho para enviar."
            : `${n} relatório${n === 1 ? "" : "s"} enviado${n === 1 ? "" : "s"} para aprovação.`
        );
      }
      router.refresh();
    });
  }

  function release(payoutId: string) {
    const erro = reasonError(reason);
    if (erro) {
      toast.error(erro);
      return;
    }
    startTransition(async () => {
      const r = await releaseWithheldPayout({ payoutId, reason });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success("O procedimento voltou a poder entrar em relatório.");
        setReleasing(null);
        setReason("");
      }
      router.refresh();
    });
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      {loadFailed && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar os relatórios desta unidade. Tente de novo;
          se continuar, avise o suporte.
        </p>
      )}

      {/* -- GERAR -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">
                O que pode entrar em relatório até o fim de{" "}
                {formatIsoMonthBr(`${month}-01`)}
              </h2>
              <p className="text-xs text-muted-foreground">
                Tudo o que foi finalizado até o último dia do mês e ainda não
                está em relatório — inclusive o que ficou de meses anteriores.
              </p>
            </div>
            <label className="block">
              <Label className="text-[11px]">Mês do relatório</Label>
              <Input
                type="month"
                className="h-8 w-40"
                value={month}
                max={today.slice(0, 7)}
                onChange={(e) => {
                  if (e.target.value) {
                    router.push(
                      `/financeiro/repasses/relatorios?mes=${e.target.value}`
                    );
                  }
                }}
              />
            </label>
          </div>

          {candidates.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum procedimento finalizado esperando relatório.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-dashed rounded-lg border text-sm">
                {candidates.map((c) => (
                  <li
                    key={c.providerId}
                    className="flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{c.providerName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.levelName ?? "sem nível"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.readyCount} procedimento
                        {c.readyCount === 1 ? "" : "s"} com valor ·{" "}
                        {formatBRL(c.readyCents)}
                        {c.zeroCount > 0 && (
                          <span className="ml-1 text-amber-700 dark:text-amber-300">
                            · {c.zeroCount} com R$ 0,00 fica
                            {c.zeroCount === 1 ? "" : "m"} de fora
                          </span>
                        )}
                        {c.draftCode && (
                          <span className="ml-1">
                            · já tem o rascunho{" "}
                            <Link
                              href={`/financeiro/repasses/relatorios/${c.draftId}`}
                              className="underline"
                            >
                              {c.draftCode}
                            </Link>
                          </span>
                        )}
                      </p>
                    </div>
                    {canManage && c.readyCount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => generate(c.providerId)}
                      >
                        {c.draftCode ? "Completar o rascunho" : "Gerar relatório"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <span>
                  {resumo.dentists} dentista{resumo.dentists === 1 ? "" : "s"} ·{" "}
                  {resumo.count} procedimento{resumo.count === 1 ? "" : "s"} ·{" "}
                  <strong>{formatBRL(resumo.cents)}</strong>
                  {resumo.zeros > 0 && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                      {resumo.zeros} com R$ 0,00 não entra
                      {resumo.zeros === 1 ? "" : "m"}
                    </span>
                  )}
                </span>
                {canManage && resumo.dentists > 0 && (
                  <Button size="sm" disabled={isPending} onClick={() => generate(null)}>
                    Gerar o de todos os dentistas
                  </Button>
                )}
              </div>
            </>
          )}

          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Quem gera e ajusta o relatório é o Financeiro da Franqueadora.
              Aqui você acompanha os relatórios da unidade.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -- OS RELATÓRIOS DA UNIDADE ---------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              Relatórios da unidade{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({reports.length})
              </span>
            </h2>
            {canManage && rascunhosComItens > 0 && (
              <Button size="sm" disabled={isPending} onClick={sendAll}>
                Enviar os {rascunhosComItens} rascunho
                {rascunhosComItens === 1 ? "" : "s"} para aprovação
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Enviar pode ser de uma vez. Aprovar é sempre um relatório por vez,
            por quem responde pela equipe e depois pelo dentista.
          </p>
          {reports.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum relatório gerado ainda.
            </p>
          ) : (
            <ul className="divide-y divide-dashed rounded-lg border text-sm">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/financeiro/repasses/relatorios/${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p>
                        <span className="font-mono text-xs">{r.code}</span>
                        <span className="ml-2 font-medium">{r.providerName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatIsoMonthBr(r.periodMonth)} ·{" "}
                          {r.levelName ?? "sem nível"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.itemCount} procedimento{r.itemCount === 1 ? "" : "s"}
                        {r.excludedCount > 0 &&
                          ` · ${r.excludedCount} excluído${r.excludedCount === 1 ? "" : "s"}`}{" "}
                        · gerado em {formatBrDateTime(r.createdAt)}
                        {r.createdByName ? ` por ${r.createdByName}` : ""}
                      </p>
                      {!["rascunho", "cancelado"].includes(r.status) && (
                        <p className="text-xs text-muted-foreground">
                          {nextStepText(r)}
                          {r.financeCount > 0 && canManage && (
                            <strong className="ml-1 text-foreground">
                              {r.financeCount} procedimento
                              {r.financeCount === 1 ? "" : "s"} esperando a sua
                              decisão.
                            </strong>
                          )}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-2">
                      <strong className="tabular-nums">
                        {formatBRL(r.totalCents)}
                      </strong>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          r.status === "cancelado" && "text-muted-foreground"
                        )}
                      >
                        {REPORT_STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* -- NÃO PAGAR ---------------------------------------------------------- */}
      {withheld.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <h2 className="font-medium">
                Fora de vez — &quot;não pagar&quot;{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({withheld.length})
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Procedimentos excluídos de um relatório para não serem pagos.
                Não entram em relatório nenhum até alguém reverter, com motivo.
              </p>
            </div>
            <ul className="divide-y divide-dashed rounded-lg border text-sm">
              {withheld.map((w) => (
                <li key={w.payoutId} className="space-y-2 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-medium">{w.procedureName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {w.providerName} · {formatIsoDateBr(w.finishedOn)} ·{" "}
                          {formatBRL(w.amountCents)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Motivo: {w.reason}
                        {w.byName ? ` — ${w.byName}` : ""}
                        {w.at ? `, ${formatBrDateTime(w.at)}` : ""}
                      </p>
                    </div>
                    {canManage && releasing !== w.payoutId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => {
                          setReleasing(w.payoutId);
                          setReason("");
                        }}
                      >
                        Voltar a pagar
                      </Button>
                    )}
                  </div>
                  {releasing === w.payoutId && (
                    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2">
                      <label className="block min-w-0 flex-1">
                        <Label className="text-[11px]">
                          Por que este procedimento volta a ser pago?
                        </Label>
                        <Input
                          className="h-8"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Motivo (obrigatório)"
                        />
                      </label>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => release(w.payoutId)}
                      >
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => setReleasing(null)}
                      >
                        Desistir
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
