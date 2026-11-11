"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import {
  CONTEST_KINDS,
  CONTEST_LABEL,
  FINANCE_ACTION_LABEL,
  MY_REVIEW_LABEL,
  MY_STATUS_LABEL,
  PAYMENT_STATE_LABEL,
  dentistResponseError,
  itemPaymentText,
  paymentByItem,
  type ContestInput,
  type ContestKind,
  type MyItem,
  type MyReport,
  type ReportPayment,
} from "@/lib/finance/payout-report";
import { respondToMyReport } from "../actions";

type Rascunho = { kind: ContestKind; text: string };

/**
 * MEUS REPASSES — o relatório, para o dentista (0391).
 *
 * Ele aprova ou contesta POR PROCEDIMENTO (decisão 2 do dono): o que não
 * contestar fica aprovado e liberado para pagar; o contestado volta para quem
 * responde pela equipe. Contestar exige motivo e explicação.
 *
 * Aqui não aparece o registro interno: nem o que foi tirado do relatório, nem
 * por quem, nem por quê.
 */
export function MyReportView({
  report,
  items,
  payments,
  loadFailed,
}: {
  report: MyReport;
  items: MyItem[];
  /** Os pagamentos deste relatório (0393): programados e feitos. */
  payments: ReportPayment[];
  loadFailed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const minhaVez = report.status === "com_dentista";

  // As linhas que ele marcou para contestar, com o motivo de cada uma.
  const [contests, setContests] = useState<Record<string, Rascunho>>({});
  const [missing, setMissing] = useState("");
  const [confirming, setConfirming] = useState(false);

  const contaDaLinha = paymentByItem(payments);
  const pendentes = items.filter((i) => i.reviewState === "pendente");
  const marcadas = Object.keys(contests).length;
  const aprovando = pendentes.length - marcadas;
  const somaAprovando = pendentes
    .filter((i) => !contests[i.itemId])
    .reduce((s, i) => s + i.amountCents, 0);

  function toggle(itemId: string) {
    setConfirming(false);
    setContests((c) => {
      const novo = { ...c };
      if (novo[itemId]) delete novo[itemId];
      else novo[itemId] = { kind: "valor", text: "" };
      return novo;
    });
  }

  function entrada(): ContestInput[] {
    return Object.entries(contests).map(([itemId, c]) => ({
      itemId,
      kind: c.kind,
      text: c.text,
    }));
  }

  function conferir() {
    const erro = dentistResponseError(entrada(), missing);
    if (erro) return void toast.error(erro);
    setConfirming(true);
  }

  function enviar() {
    startTransition(async () => {
      const r = await respondToMyReport({
        reportId: report.id,
        contests: entrada(),
        missing,
      });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success(
          marcadas === 0
            ? "Relatório aprovado. Obrigado!"
            : "Resposta enviada. O que você aprovou já está liberado."
        );
        setContests({});
        setMissing("");
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      <Link
        href="/repasses"
        className="inline-flex text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        ← Repasses
      </Link>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground">{report.code}</p>
              <h1 className="text-xl font-semibold tracking-tight">
                Meu repasse — {report.clinicName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {formatIsoMonthBr(report.periodMonth)} · seu nível nesta unidade:{" "}
                <strong>{report.levelName ?? "não definido"}</strong>
              </p>
            </div>
            <div className="text-right">
              <Badge variant="outline">
                {MY_STATUS_LABEL[report.status] ?? report.status}
              </Badge>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatBRL(report.totalCents)}
              </p>
              <p className="text-xs text-muted-foreground">
                {report.itemCount} procedimento{report.itemCount === 1 ? "" : "s"}
                {report.releasedCents > 0 && report.releasedCents !== report.totalCents
                  ? ` · ${formatBRL(report.releasedCents)} já aprovado`
                  : ""}
              </p>
            </div>
          </div>

          <p className="rounded-lg border bg-muted/40 p-2 text-sm">
            {minhaVez ? (
              <>
                Confira cada procedimento.{" "}
                <strong>O que você não contestar fica aprovado</strong> e liberado
                para pagamento. Se algo estiver errado, marque{" "}
                <strong>Contestar</strong> na linha e explique.
                {report.dentistDueOn && (
                  <span className="block text-xs text-muted-foreground">
                    Responda até {formatIsoDateBr(report.dentistDueOn)}. Sem a sua
                    resposta, o pagamento não é liberado.
                  </span>
                )}
              </>
            ) : report.status === "aprovado" ? (
              "Relatório aprovado. O pagamento é feito pelo Financeiro, no dia 15."
            ) : report.status === "em_contestacao" ? (
              "Sua contestação está com quem responde pela equipe. O que você aprovou já está liberado para pagamento."
            ) : (
              "Sua contestação está com o Financeiro da Franqueadora, que dá a decisão final. O que você aprovou já está liberado para pagamento."
            )}
          </p>

          <Button
            size="sm"
            variant="outline"
            className="print:hidden"
            onClick={() => window.print()}
          >
            <Printer className="mr-1 size-3.5" />
            Imprimir / salvar em PDF
          </Button>
        </CardContent>
      </Card>

      {loadFailed && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar os procedimentos.
        </p>
      )}

      {payments.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="font-medium">Pagamento</h2>
            <ul className="divide-y divide-dashed rounded-lg border text-sm">
              {payments.map((p) => (
                <li
                  key={p.paymentId}
                  className="flex flex-wrap items-center justify-between gap-2 p-2"
                >
                  <span>
                    <strong className="tabular-nums">{formatBRL(p.amountCents)}</strong>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.itemCount} procedimento{p.itemCount === 1 ? "" : "s"} ·{" "}
                      {p.state === "pago" && p.paidOn
                        ? `pago em ${formatIsoDateBr(p.paidOn)}`
                        : `previsto para ${formatIsoDateBr(p.dueDate)}`}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      p.state === "pago" &&
                        "border-emerald-300 text-emerald-700 dark:text-emerald-300"
                    )}
                  >
                    {PAYMENT_STATE_LABEL[p.state]}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              O que você aprovou é pago no dia 15. Um procedimento ainda em
              análise entra em um pagamento à parte, quando for resolvido.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-medium">Procedimentos</h2>
          <ul className="divide-y divide-dashed rounded-lg border text-sm">
            {items.map((i) => {
              const c = contests[i.itemId];
              const podeMarcar = minhaVez && i.reviewState === "pendente";
              return (
                <li key={i.itemId} className="space-y-2 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-medium">{i.procedureName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          finalizado em {formatIsoDateBr(i.finishedOn)} ·{" "}
                          {i.clientName ?? "—"}
                        </span>
                        {i.clientId && (
                          <Link
                            href={`/prontuarios/${i.clientId}`}
                            className="ml-2 text-xs underline print:hidden"
                          >
                            ver atendimento
                          </Link>
                        )}
                      </p>
                      {i.reviewState && !podeMarcar && (
                        <p className="text-xs text-muted-foreground">
                          {MY_REVIEW_LABEL[i.reviewState]}
                          {i.released && (
                            <strong className="ml-1 text-foreground">
                              ·{" "}
                              {contaDaLinha.has(i.itemId)
                                ? itemPaymentText(true, contaDaLinha.get(i.itemId))
                                : "aguardando o Financeiro programar o pagamento"}
                            </strong>
                          )}
                        </p>
                      )}
                      {i.contestText && (
                        <p className="text-xs text-muted-foreground">
                          <strong>Você contestou:</strong>{" "}
                          {i.contestKind ? `${CONTEST_LABEL[i.contestKind]} — ` : ""}
                          {i.contestText}
                        </p>
                      )}
                      {i.managerResponse && (
                        <p className="text-xs">
                          <strong>Resposta:</strong> {i.managerResponse}
                        </p>
                      )}
                      {i.financeAction && (
                        <p className="text-xs">
                          <strong>{FINANCE_ACTION_LABEL[i.financeAction]}:</strong>{" "}
                          {i.financeReason}
                        </p>
                      )}
                      {podeMarcar && i.contestRound >= 1 && !c && (
                        <p className="text-[11px] text-muted-foreground">
                          Se contestar de novo, a decisão final passa a ser do
                          Financeiro da Franqueadora.
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums">
                        {formatBRL(i.amountCents)}
                        {i.originalAmountCents !== null && (
                          <span className="ml-1 text-[11px] text-muted-foreground line-through">
                            {formatBRL(i.originalAmountCents)}
                          </span>
                        )}
                      </p>
                      {podeMarcar && (
                        <label className="mt-1 inline-flex items-center gap-1 text-xs print:hidden">
                          <input
                            type="checkbox"
                            checked={Boolean(c)}
                            disabled={isPending}
                            onChange={() => toggle(i.itemId)}
                          />
                          Contestar
                        </label>
                      )}
                    </div>
                  </div>

                  {c && (
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-2 print:hidden">
                      <div className="flex flex-wrap gap-3 text-sm">
                        {CONTEST_KINDS.map((k) => (
                          <label key={k} className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`motivo-${i.itemId}`}
                              checked={c.kind === k}
                              onChange={() => {
                                setConfirming(false);
                                setContests((x) => ({
                                  ...x,
                                  [i.itemId]: { ...x[i.itemId], kind: k },
                                }));
                              }}
                            />
                            {CONTEST_LABEL[k]}
                          </label>
                        ))}
                      </div>
                      <label className="block">
                        <Label className="text-[11px]">
                          Explique (obrigatório): o que está errado e como deveria ser
                        </Label>
                        <Input
                          className="h-8"
                          value={c.text}
                          onChange={(e) => {
                            setConfirming(false);
                            setContests((x) => ({
                              ...x,
                              [i.itemId]: { ...x[i.itemId], text: e.target.value },
                            }));
                          }}
                        />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {minhaVez && (
            <div className="space-y-3 print:hidden">
              <label className="block">
                <Label className="text-[11px]">
                  Está faltando algum procedimento neste relatório? (opcional)
                </Label>
                <Input
                  className="h-8"
                  value={missing}
                  onChange={(e) => {
                    setConfirming(false);
                    setMissing(e.target.value);
                  }}
                  placeholder="Diga qual procedimento, de qual cliente e a data"
                />
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  O aviso vai para quem responde pela equipe. Se proceder, o
                  procedimento entra no seu próximo relatório.
                </span>
              </label>

              {!confirming ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <span>
                    Aprovando <strong>{aprovando}</strong> procedimento
                    {aprovando === 1 ? "" : "s"} ({formatBRL(somaAprovando)})
                    {marcadas > 0 && (
                      <>
                        {" "}
                        e contestando <strong>{marcadas}</strong>
                      </>
                    )}
                  </span>
                  <Button size="sm" disabled={isPending} onClick={conferir}>
                    {marcadas === 0 ? "Aprovar tudo" : "Enviar minha resposta"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                  <p>
                    Confirma?{" "}
                    {aprovando > 0 && (
                      <>
                        <strong>
                          {aprovando} procedimento{aprovando === 1 ? "" : "s"} (
                          {formatBRL(somaAprovando)})
                        </strong>{" "}
                        {aprovando === 1 ? "fica aprovado" : "ficam aprovados"} e{" "}
                        {aprovando === 1 ? "liberado" : "liberados"} para pagamento.{" "}
                      </>
                    )}
                    {marcadas > 0 && (
                      <>
                        <strong>{marcadas}</strong>{" "}
                        {marcadas === 1 ? "volta" : "voltam"} para análise.{" "}
                      </>
                    )}
                    Depois de enviar, não dá para desfazer.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={isPending} onClick={enviar}>
                      Confirmar e enviar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => setConfirming(false)}
                    >
                      Voltar e revisar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
