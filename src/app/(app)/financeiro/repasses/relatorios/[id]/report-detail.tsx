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
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import {
  APPROVER_LABEL,
  CONTEST_LABEL,
  EXCLUSION_HELP,
  EXCLUSION_LABEL,
  FINANCE_ACTION_LABEL,
  PAYMENT_STATE_LABEL,
  REPORT_STATUS_LABEL,
  REVIEW_LABEL,
  correctionError,
  eventLabel,
  itemPaymentText,
  nextStepText,
  paymentByItem,
  reasonError,
  type ExclusionKind,
  type FinanceAction,
  type ManagerAction,
  type Report,
  type ReportItem,
  type ReportPayment,
} from "@/lib/finance/payout-report";
import {
  billPayoutReport,
  cancelPayoutReport,
  decideContestedItem,
  excludeReportItem,
  restoreReportItem,
  sendPayoutReport,
} from "../actions";
import {
  answerContest,
  approvePayoutReport,
  approverExcludeItem,
  approverRestoreItem,
  openPayoutFailure,
  returnPayoutReport,
} from "@/app/(app)/repasses/actions";

export type HistoryRow = {
  at: string;
  action: string;
  note: string | null;
  actorName: string | null;
  procedureName: string | null;
};

type Resultado = { ok: boolean; error?: string };

/**
 * UM relatório de repasse, para quem cuida dele: o Financeiro da Franqueadora
 * (monta, envia, decide a contestação que chegou a ele) e o APROVADOR (confere,
 * exclui com motivo, aprova e envia ao dentista, responde à contestação).
 *
 * O que cada um pode vem do banco, relatório a relatório (`canManage`,
 * `canApprove`); a tela só mostra o botão a quem o banco vai aceitar.
 * O dentista NÃO usa esta tela: ele tem "Meus repasses", sem o registro
 * interno.
 */
export function ReportDetail({
  report,
  items,
  history,
  payments,
  canManage,
  canApprove,
  backHref,
  loadFailed,
}: {
  report: Report;
  items: ReportItem[];
  history: HistoryRow[];
  /** As contas a pagar geradas deste relatório (0393). */
  payments: ReportPayment[];
  /** Financeiro da Franqueadora / Admin Master. */
  canManage: boolean;
  /** É o aprovador DESTE relatório. */
  canApprove: boolean;
  backHref: string;
  loadFailed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isDraft = report.status === "rascunho";
  const withApprover = report.status === "com_gerente";
  // Ajustar as linhas: o Financeiro no rascunho; o aprovador na vez dele.
  const financeAdjusts = canManage && isDraft;
  const approverAdjusts = canApprove && withApprover;
  const canAdjust = financeAdjusts || approverAdjusts;
  const canAnswer = canApprove && report.status === "em_contestacao";

  // Um formulário aberto por vez.
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<ExclusionKind>("adiar");
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState<ManagerAction>("manter");
  const [decision, setDecision] = useState<FinanceAction>("manter");
  const [amount, setAmount] = useState("");

  const incluidos = items.filter((i) => i.status === "incluido");
  const excluidos = items.filter((i) => i.status === "excluido");

  // 0393 — o pagamento: o que está liberado e ainda não foi para uma conta.
  const contaDaLinha = paymentByItem(payments);
  const semConta = incluidos.filter((i) => i.released && !contaDaLinha.has(i.itemId));
  const semContaCents = semConta.reduce((s, i) => s + i.amountCents, 0);
  // 0400 — só gera conta com repasse POSITIVO liberado; o desconto abate nela.
  const positivoSemConta = semConta.some((i) => i.amountCents > 0);
  // "Registrar falha do dentista": depois de enviado, num procedimento com repasse.
  const podeRegistrarFalha =
    (canManage || canApprove) && !["rascunho", "cancelado"].includes(report.status);

  function registrarFalha(item: ReportItem) {
    comMotivo(
      () => openPayoutFailure({ payoutId: item.payoutId, reason, reportId: report.id }),
      "Ocorrência registrada. Quem aprova a equipe decide se foi falha."
    );
  }
  const temLiberado = incluidos.some((i) => i.released);

  function abrir(id: string) {
    setOpen(id);
    setKind("adiar");
    setReason("");
    setAnswer("manter");
    setDecision("manter");
    setAmount("");
  }

  function run(fn: () => Promise<Resultado>, sucesso: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success(sucesso);
        setOpen(null);
        setReason("");
      }
      router.refresh();
    });
  }

  function comMotivo(fn: () => Promise<Resultado>, sucesso: string) {
    const erro = reasonError(reason);
    if (erro) return void toast.error(erro);
    run(fn, sucesso);
  }

  function excluir(itemId: string) {
    const entrada = { reportId: report.id, itemId, kind, reason };
    comMotivo(
      () => (financeAdjusts ? excludeReportItem(entrada) : approverExcludeItem(entrada)),
      kind === "adiar"
        ? "Procedimento adiado para o próximo relatório."
        : "Procedimento marcado como não pagar."
    );
  }

  function devolverItem(itemId: string) {
    const entrada = { reportId: report.id, itemId };
    run(
      () => (financeAdjusts ? restoreReportItem(entrada) : approverRestoreItem(entrada)),
      "Procedimento devolvido ao relatório."
    );
  }

  function responder(itemId: string) {
    comMotivo(
      () =>
        answerContest({
          reportId: report.id,
          itemId,
          action: answer,
          text: reason,
          exclusionKind: answer === "excluir" ? kind : null,
        }),
      answer === "manter"
        ? "Resposta enviada ao dentista."
        : answer === "financeiro"
          ? "Pedido enviado ao Financeiro."
          : "Procedimento excluído do relatório."
    );
  }

  function decidir(item: ReportItem) {
    const novo = decision === "corrigir" ? parseBRLToCents(amount) : null;
    if (decision === "corrigir") {
      const e = correctionError(novo, item.amountCents);
      if (e) return void toast.error(e);
    }
    comMotivo(
      () =>
        decideContestedItem({
          reportId: report.id,
          itemId: item.itemId,
          action: decision,
          reason,
          newAmountCents: novo,
          currentAmountCents: item.amountCents,
          exclusionKind: decision === "excluir" ? kind : null,
        }),
      "Decisão registrada."
    );
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      <Link
        href={backHref}
        className="inline-flex text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        ← Voltar
      </Link>

      {/* -- CABEÇALHO ------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground">{report.code}</p>
              <h1 className="text-xl font-semibold tracking-tight">
                Repasse — {report.providerName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {report.clinicName} · {formatIsoMonthBr(report.periodMonth)} ·
                nível <strong>{report.levelName ?? "não definido"}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Gerado em {formatBrDateTime(report.createdAt)}
                {report.createdByName ? ` por ${report.createdByName}` : ""}
                {report.sentAt
                  ? ` · enviado em ${formatBrDateTime(report.sentAt)}${report.sentByName ? ` por ${report.sentByName}` : ""}`
                  : ""}
                {report.managerAt
                  ? ` · aprovado em ${formatBrDateTime(report.managerAt)}${report.managerByName ? ` por ${report.managerByName}` : ""}`
                  : ""}
              </p>
            </div>
            <div className="text-right">
              <Badge variant="outline">
                {REPORT_STATUS_LABEL[report.status] ?? report.status}
              </Badge>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatBRL(report.totalCents)}
              </p>
              <p className="text-xs text-muted-foreground">
                {report.itemCount} procedimento{report.itemCount === 1 ? "" : "s"}
                {report.releasedCents > 0 &&
                  report.releasedCents !== report.totalCents &&
                  ` · ${formatBRL(report.releasedCents)} já liberado`}
              </p>
            </div>
          </div>

          <p className="rounded-lg border bg-muted/40 p-2 text-sm">
            {nextStepText(report)}
            {report.approverKind && !["aprovado", "cancelado"].includes(report.status) && (
              <span className="block text-xs text-muted-foreground">
                Aprovador: {APPROVER_LABEL[report.approverKind] ?? report.approverKind}
              </span>
            )}
          </p>

          {report.status === "cancelado" && (
            <p className="rounded-lg border bg-muted/40 p-2 text-sm">
              Cancelado
              {report.cancelledAt ? ` em ${formatBrDateTime(report.cancelledAt)}` : ""}
              {report.cancelledByName ? ` por ${report.cancelledByName}` : ""}.
              Motivo: {report.cancelReason ?? "—"}
            </p>
          )}

          {report.missingNote && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <strong>O dentista avisou que falta procedimento:</strong>{" "}
              {report.missingNote}
              <span className="block text-xs">
                Se proceder, ele entra no próximo relatório (este não é reaberto).
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-2 print:hidden">
            {financeAdjusts && report.itemCount > 0 && (
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => sendPayoutReport({ reportId: report.id }),
                    "Relatório enviado para aprovação."
                  )
                }
              >
                Enviar para aprovação
              </Button>
            )}
            {approverAdjusts && report.itemCount > 0 && (
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => approvePayoutReport({ reportId: report.id }),
                    "Aprovado. O dentista foi avisado."
                  )
                }
              >
                Aprovar e enviar ao dentista
              </Button>
            )}
            {approverAdjusts && open !== "devolver" && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => abrir("devolver")}>
                Devolver ao Financeiro
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 size-3.5" />
              Imprimir / salvar em PDF
            </Button>
            {financeAdjusts && open !== "cancelar" && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => abrir("cancelar")}>
                Cancelar o rascunho
              </Button>
            )}
          </div>

          {(open === "cancelar" || open === "devolver") && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2 print:hidden">
              <label className="block min-w-0 flex-1">
                <Label className="text-[11px]">
                  {open === "cancelar"
                    ? "Por que cancelar este relatório? Os procedimentos voltam a poder entrar em outro."
                    : "Por que devolver ao Financeiro? Ele volta a rascunho."}
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
                onClick={() =>
                  open === "cancelar"
                    ? comMotivo(
                        () => cancelPayoutReport({ reportId: report.id, reason }),
                        "Relatório cancelado."
                      )
                    : comMotivo(
                        () => returnPayoutReport({ reportId: report.id, reason }),
                        "Relatório devolvido ao Financeiro."
                      )
                }
              >
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                Desistir
              </Button>
            </div>
          )}

          {approverAdjusts && (
            <p className="text-xs text-muted-foreground print:hidden">
              Confira cada procedimento. Para tirar um, use <strong>Excluir</strong>{" "}
              e escreva o motivo. Cada relatório é aprovado separadamente.
            </p>
          )}
        </CardContent>
      </Card>

      {loadFailed && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar os procedimentos deste relatório.
        </p>
      )}

      {/* -- PAGAMENTO (0393) --------------------------------------------------- */}
      {(temLiberado || payments.length > 0) && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <h2 className="font-medium">Pagamento</h2>
              <p className="text-xs text-muted-foreground">
                Só vira conta a pagar o que foi aprovado por quem responde pela
                equipe <strong>e</strong> pelo dentista. Cada procedimento entra
                em uma conta só. O pagamento é registrado em Contas a pagar.
              </p>
            </div>

            {semConta.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <span>
                  <strong>{formatBRL(semContaCents)}</strong> liberado em{" "}
                  {semConta.length} procedimento{semConta.length === 1 ? "" : "s"},
                  ainda sem conta a pagar.
                  <span className="block text-xs text-muted-foreground">
                    Vencimento no dia 15: liberado até o dia 10 vence no mesmo
                    mês; depois disso, no mês seguinte. Desconto por falha abate
                    na conta; o que passar do repasse fica para o próximo
                    relatório.
                  </span>
                </span>
                {canManage && positivoSemConta && (
                  <Button
                    size="sm"
                    className="print:hidden"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => billPayoutReport({ reportId: report.id }),
                        "Conta a pagar gerada. O dentista foi avisado."
                      )
                    }
                  >
                    Gerar conta a pagar
                  </Button>
                )}
              </div>
            )}

            {payments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma conta a pagar gerada ainda.
              </p>
            ) : (
              <ul className="divide-y divide-dashed rounded-lg border text-sm">
                {payments.map((p) => (
                  <li
                    key={p.paymentId}
                    className="flex flex-wrap items-center justify-between gap-2 p-2"
                  >
                    <div className="min-w-0">
                      <p>
                        <strong className="tabular-nums">{formatBRL(p.amountCents)}</strong>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p.itemCount} procedimento{p.itemCount === 1 ? "" : "s"} ·
                          vencimento {formatIsoDateBr(p.dueDate)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Gerada em {formatBrDateTime(p.createdAt)}
                        {p.createdByName ? ` por ${p.createdByName}` : ""}
                        {p.state === "pago" && p.paidOn
                          ? ` · paga em ${formatIsoDateBr(p.paidOn)}`
                          : ""}
                        {p.state === "parcial"
                          ? ` · ${formatBRL(p.paidCents)} já pago`
                          : ""}
                        {p.state === "cancelado"
                          ? ` · motivo do cancelamento: ${p.cancelReason ?? "—"}`
                          : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      {canManage && p.state !== "cancelado" && p.state !== "pago" && (
                        <Link
                          href="/financeiro/contas-a-pagar"
                          className="text-xs underline print:hidden"
                        >
                          pagar em Contas a pagar
                        </Link>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          p.state === "cancelado" && "text-muted-foreground",
                          p.state === "pago" &&
                            "border-emerald-300 text-emerald-700 dark:text-emerald-300"
                        )}
                      >
                        {PAYMENT_STATE_LABEL[p.state]}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* -- PROCEDIMENTOS ------------------------------------------------------ */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Procedimentos do relatório</h2>
          {incluidos.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum procedimento incluído.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-normal">Finalizado em</th>
                    <th className="py-1 pr-2 font-normal">Procedimento</th>
                    <th className="py-1 pr-2 font-normal">Cliente</th>
                    <th className="py-1 pr-2 text-right font-normal">Repasse</th>
                    <th className="py-1 font-normal print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {incluidos.map((i) => {
                    const podeResponder = canAnswer && i.reviewState === "contestado";
                    const podeDecidir = canManage && i.reviewState === "no_financeiro";
                    const aberto = open === i.itemId;
                    return (
                      <ItemRows
                        key={i.itemId}
                        item={i}
                        paymentText={itemPaymentText(i.released, contaDaLinha.get(i.itemId))}
                      >
                        <td className="py-1.5 text-right print:hidden">
                          {!aberto && canAdjust && (
                            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => abrir(i.itemId)}>
                              Excluir
                            </Button>
                          )}
                          {!aberto && podeResponder && (
                            <Button size="sm" variant="outline" disabled={isPending} onClick={() => abrir(i.itemId)}>
                              Responder
                            </Button>
                          )}
                          {!aberto && podeDecidir && (
                            <Button size="sm" variant="outline" disabled={isPending} onClick={() => abrir(i.itemId)}>
                              Decidir
                            </Button>
                          )}
                          {!aberto &&
                            podeRegistrarFalha &&
                            !podeResponder &&
                            !podeDecidir &&
                            i.origin !== "desconto" &&
                            i.amountCents > 0 &&
                            !i.hasFailure && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs"
                                disabled={isPending}
                                onClick={() => abrir(`falha-${i.itemId}`)}
                              >
                                Registrar falha
                              </Button>
                            )}
                          {i.hasFailure && (
                            <Link href="/repasses/ocorrencias" className="text-[11px] underline">
                              ocorrência
                            </Link>
                          )}
                        </td>
                        {open === `falha-${i.itemId}` ? (
                          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                            <p className="text-xs text-muted-foreground">
                              Registra uma ocorrência sobre este procedimento. Quem
                              aprova a equipe decide se foi falha do dentista; só
                              então há desconto.
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block min-w-0 flex-1">
                                <Label className="text-[11px]">O que aconteceu (obrigatório)</Label>
                                <Input
                                  className="h-8"
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                />
                              </label>
                              <Button size="sm" disabled={isPending} onClick={() => registrarFalha(i)}>
                                Registrar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                                Desistir
                              </Button>
                            </div>
                          </div>
                        ) : aberto && (
                          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                            {canAdjust && (
                              <KindRadios name={`ex-${i.itemId}`} kind={kind} onKind={setKind} />
                            )}

                            {podeResponder && (
                              <div className="space-y-2 text-sm">
                                {(
                                  [
                                    ["manter", "Manter", "O procedimento volta ao dentista com a sua resposta."],
                                    ["excluir", "Excluir do relatório", "O dentista tem razão: o procedimento sai deste relatório."],
                                    ["financeiro", "Pedir a decisão do Financeiro", "Para corrigir o valor ou quando você não pode resolver."],
                                  ] as [ManagerAction, string, string][]
                                ).map(([a, titulo, ajuda]) => (
                                  <label key={a} className="flex items-start gap-2">
                                    <input
                                      type="radio"
                                      name={`resp-${i.itemId}`}
                                      className="mt-1"
                                      checked={answer === a}
                                      onChange={() => setAnswer(a)}
                                    />
                                    <span>
                                      <span className="font-medium">{titulo}</span>
                                      <span className="block text-[11px] text-muted-foreground">{ajuda}</span>
                                    </span>
                                  </label>
                                ))}
                                {answer === "excluir" && (
                                  <KindRadios name={`rk-${i.itemId}`} kind={kind} onKind={setKind} />
                                )}
                              </div>
                            )}

                            {podeDecidir && (
                              <div className="space-y-2 text-sm">
                                {(
                                  [
                                    ["manter", "Manter o valor", "Libera para pagar pelo valor que está."],
                                    ["corrigir", "Corrigir o valor", "Grava o valor novo (o antigo fica guardado) e libera para pagar."],
                                    ["excluir", "Excluir do relatório", "O procedimento sai deste relatório."],
                                  ] as [FinanceAction, string, string][]
                                ).map(([a, titulo, ajuda]) => (
                                  <label key={a} className="flex items-start gap-2">
                                    <input
                                      type="radio"
                                      name={`dec-${i.itemId}`}
                                      className="mt-1"
                                      checked={decision === a}
                                      onChange={() => setDecision(a)}
                                    />
                                    <span>
                                      <span className="font-medium">{titulo}</span>
                                      <span className="block text-[11px] text-muted-foreground">{ajuda}</span>
                                    </span>
                                  </label>
                                ))}
                                {decision === "corrigir" && (
                                  <label className="block max-w-xs">
                                    <Label className="text-[11px]">
                                      Valor corrigido (hoje: {formatBRL(i.amountCents)})
                                    </Label>
                                    <Input
                                      className="h-8"
                                      inputMode="decimal"
                                      value={amount}
                                      onChange={(e) => setAmount(e.target.value)}
                                      placeholder="0,00"
                                    />
                                  </label>
                                )}
                                {decision === "excluir" && (
                                  <KindRadios name={`dk-${i.itemId}`} kind={kind} onKind={setKind} />
                                )}
                                <p className="text-[11px] text-muted-foreground">
                                  Esta é a decisão final sobre este procedimento.
                                </p>
                              </div>
                            )}

                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block min-w-0 flex-1">
                                <Label className="text-[11px]">
                                  {podeResponder && answer === "manter"
                                    ? "Sua resposta ao dentista (obrigatória)"
                                    : "Motivo (obrigatório)"}
                                </Label>
                                <Input
                                  className="h-8"
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                />
                              </label>
                              <Button
                                size="sm"
                                disabled={isPending}
                                onClick={() =>
                                  podeDecidir
                                    ? decidir(i)
                                    : podeResponder
                                      ? responder(i.itemId)
                                      : excluir(i.itemId)
                                }
                              >
                                Confirmar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                                Desistir
                              </Button>
                            </div>
                          </div>
                        )}
                      </ItemRows>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="py-1 pr-2" colSpan={3}>
                      Total
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatBRL(report.totalCents)}
                    </td>
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* -- EXCLUÍDOS ----------------------------------------------------------- */}
      {excluidos.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="font-medium">
              Excluídos deste relatório{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({excluidos.length})
              </span>
            </h2>
            <ul className="divide-y divide-dashed rounded-lg border text-sm">
              {excluidos.map((i) => (
                <li key={i.itemId} className="flex flex-wrap items-start justify-between gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-medium">{i.procedureName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatIsoDateBr(i.finishedOn)} · {i.clientName ?? "—"} ·{" "}
                        {formatBRL(i.amountCents)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <strong>
                        {i.exclusionKind ? EXCLUSION_LABEL[i.exclusionKind] : "Excluído"}
                      </strong>
                      {" — "}
                      {i.exclusionReason}
                      {" ("}
                      {[i.excludedByName, i.excludedAt ? formatBrDateTime(i.excludedAt) : null]
                        .filter(Boolean)
                        .join(", ") || "sem registro de autor"}
                      {")"}
                    </p>
                  </div>
                  {canAdjust && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      disabled={isPending}
                      onClick={() => devolverItem(i.itemId)}
                    >
                      Devolver ao relatório
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* -- LINHA DO TEMPO ------------------------------------------------------- */}
      <Card className="print:hidden">
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Quem fez o quê</h2>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem registros.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {history.map((h, idx) => (
                <li key={`${h.at}-${idx}`} className="border-b border-dashed pb-1 last:border-0">
                  <span className="font-medium">{eventLabel(h.action)}</span>
                  {h.procedureName ? ` — ${h.procedureName}` : ""}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatBrDateTime(h.at)}
                    {h.actorName ? ` · ${h.actorName}` : " · sistema"}
                  </span>
                  {h.note && (
                    <span className="block text-xs text-muted-foreground">{h.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KindRadios({
  name,
  kind,
  onKind,
}: {
  name: string;
  kind: ExclusionKind;
  onKind: (k: ExclusionKind) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {(["adiar", "nao_pagar"] as ExclusionKind[]).map((k) => (
        <label key={k} className="flex items-start gap-2">
          <input
            type="radio"
            name={name}
            className="mt-1"
            checked={kind === k}
            onChange={() => onKind(k)}
          />
          <span>
            <span className="font-medium">{k === "adiar" ? "Adiar" : "Não pagar"}</span>
            <span className="block text-[11px] text-muted-foreground">
              {EXCLUSION_HELP[k]}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * A linha do procedimento, a conversa dela (contestação, resposta, decisão) e,
 * quando há, o formulário aberto. `children` = [célula de ações, formulário].
 */
function ItemRows({
  item,
  paymentText,
  children,
}: {
  item: ReportItem;
  /** O pagamento desta linha, numa frase (0393); nulo = ainda não liberada. */
  paymentText: string | null;
  children: [React.ReactNode, React.ReactNode];
}) {
  const [acoes, formulario] = children;
  const temConversa =
    item.contestText || item.managerResponse || item.financeAction || item.reviewState;
  return (
    <>
      <tr className="align-top">
        <td className="py-1.5 pr-2 whitespace-nowrap">{formatIsoDateBr(item.finishedOn)}</td>
        <td className="py-1.5 pr-2">
          {item.procedureName}
          {item.origin === "ortodontia" && (
            <span className="ml-1 text-xs text-muted-foreground">
              (manutenção de Ortodontia)
            </span>
          )}
          {item.origin === "desconto" && item.failureReason && (
            <span className="block text-xs text-muted-foreground">
              Motivo: {item.failureReason}
            </span>
          )}
        </td>
        <td className="py-1.5 pr-2">
          {item.clientName ?? "—"}
          {item.clientId && (
            <Link
              href={`/prontuarios/${item.clientId}`}
              className="ml-2 text-xs underline print:hidden"
              title="Abre o prontuário, para quem tem acesso a ele"
            >
              ver atendimento
            </Link>
          )}
        </td>
        <td className="py-1.5 pr-2 text-right tabular-nums">
          {formatBRL(item.amountCents)}
          {item.originalAmountCents !== null && (
            <span className="block text-[11px] text-muted-foreground line-through">
              {formatBRL(item.originalAmountCents)}
            </span>
          )}
        </td>
        {acoes}
      </tr>
      {temConversa && (
        <tr>
          <td colSpan={5} className="pb-1.5 text-xs text-muted-foreground">
            {item.reviewState && (
              <Badge variant="outline" className="mr-2 text-[10px]">
                {REVIEW_LABEL[item.reviewState]}
              </Badge>
            )}
            {paymentText && <span className="font-medium">{paymentText}</span>}
            {item.contestText && (
              <span className="block">
                <strong>
                  Dentista contestou
                  {item.contestRound > 1 ? ` (${item.contestRound}ª vez)` : ""}:
                </strong>{" "}
                {item.contestKind ? `${CONTEST_LABEL[item.contestKind]} — ` : ""}
                {item.contestText}
              </span>
            )}
            {item.managerResponse && (
              <span className="block">
                <strong>Resposta do aprovador:</strong> {item.managerResponse}
              </span>
            )}
            {item.financeAction && (
              <span className="block">
                <strong>{FINANCE_ACTION_LABEL[item.financeAction]}:</strong>{" "}
                {item.financeReason}
              </span>
            )}
          </td>
        </tr>
      )}
      {formulario && (
        <tr className="print:hidden">
          <td colSpan={5} className="pb-2">
            {formulario}
          </td>
        </tr>
      )}
      <tr aria-hidden>
        <td colSpan={5} className="border-b border-dashed p-0" />
      </tr>
    </>
  );
}
