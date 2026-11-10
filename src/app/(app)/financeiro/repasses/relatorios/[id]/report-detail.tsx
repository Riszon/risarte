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
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import {
  EXCLUSION_HELP,
  EXCLUSION_LABEL,
  REPORT_STATUS_LABEL,
  eventLabel,
  reasonError,
  type ExclusionKind,
  type Report,
  type ReportItem,
} from "@/lib/finance/payout-report";
import {
  cancelPayoutReport,
  excludeReportItem,
  restoreReportItem,
} from "../actions";

export type HistoryRow = {
  at: string;
  action: string;
  note: string | null;
  actorName: string | null;
  procedureName: string | null;
};

export function ReportDetail({
  report,
  items,
  history,
  canManage,
  loadFailed,
}: {
  report: Report;
  items: ReportItem[];
  history: HistoryRow[];
  canManage: boolean;
  loadFailed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isDraft = report.status === "rascunho";
  const canEdit = canManage && isDraft;

  // Um formulário de motivo aberto por vez: de um item, ou do cancelamento.
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<ExclusionKind>("adiar");
  const [reason, setReason] = useState("");

  const incluidos = items.filter((i) => i.status === "incluido");
  const excluidos = items.filter((i) => i.status === "excluido");

  function abrir(id: string) {
    setOpen(id);
    setKind("adiar");
    setReason("");
  }

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string
  ) {
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

  function excluir(itemId: string) {
    const erro = reasonError(reason);
    if (erro) return void toast.error(erro);
    run(
      () => excludeReportItem({ reportId: report.id, itemId, kind, reason }),
      kind === "adiar"
        ? "Procedimento adiado para o próximo relatório."
        : "Procedimento marcado como não pagar."
    );
  }

  function cancelar() {
    const erro = reasonError(reason);
    if (erro) return void toast.error(erro);
    run(
      () => cancelPayoutReport({ reportId: report.id, reason }),
      "Relatório cancelado. Os procedimentos voltaram a poder entrar em outro."
    );
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
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
              </p>
            </div>
          </div>

          {report.status === "cancelado" && (
            <p className="rounded-lg border bg-muted/40 p-2 text-sm">
              Cancelado
              {report.cancelledAt ? ` em ${formatBrDateTime(report.cancelledAt)}` : ""}
              {report.cancelledByName ? ` por ${report.cancelledByName}` : ""}.
              Motivo: {report.cancelReason ?? "—"}
            </p>
          )}

          <div className="flex flex-wrap gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 size-3.5" />
              Imprimir / salvar em PDF
            </Button>
            {canEdit && open !== "cancelar" && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => abrir("cancelar")}
              >
                Cancelar o rascunho
              </Button>
            )}
          </div>

          {open === "cancelar" && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2 print:hidden">
              <label className="block min-w-0 flex-1">
                <Label className="text-[11px]">
                  Por que cancelar este relatório? Os procedimentos voltam a
                  poder entrar em outro.
                </Label>
                <Input
                  className="h-8"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motivo (obrigatório)"
                />
              </label>
              <Button size="sm" disabled={isPending} onClick={cancelar}>
                Confirmar cancelamento
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                Desistir
              </Button>
            </div>
          )}

          {isDraft && !canManage && (
            <p className="text-xs text-muted-foreground print:hidden">
              Rascunho do Financeiro da Franqueadora. O ajuste e o envio são
              feitos por ele.
            </p>
          )}
        </CardContent>
      </Card>

      {loadFailed && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar os procedimentos deste relatório.
        </p>
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
                  {incluidos.map((i) => (
                    <ItemRow
                      key={i.itemId}
                      item={i}
                      canEdit={canEdit}
                      isPending={isPending}
                      open={open === i.itemId}
                      kind={kind}
                      reason={reason}
                      onOpen={() => abrir(i.itemId)}
                      onClose={() => setOpen(null)}
                      onKind={setKind}
                      onReason={setReason}
                      onConfirm={() => excluir(i.itemId)}
                    />
                  ))}
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
                <li
                  key={i.itemId}
                  className="flex flex-wrap items-start justify-between gap-2 p-2"
                >
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
                      {i.excludedByName ? ` (${i.excludedByName}` : ""}
                      {i.excludedAt
                        ? `${i.excludedByName ? ", " : " ("}${formatBrDateTime(i.excludedAt)})`
                        : i.excludedByName
                          ? ")"
                          : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => restoreReportItem({ reportId: report.id, itemId: i.itemId }),
                          "Procedimento devolvido ao relatório."
                        )
                      }
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
                    {h.actorName ? ` · ${h.actorName}` : ""}
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

function ItemRow({
  item,
  canEdit,
  isPending,
  open,
  kind,
  reason,
  onOpen,
  onClose,
  onKind,
  onReason,
  onConfirm,
}: {
  item: ReportItem;
  canEdit: boolean;
  isPending: boolean;
  open: boolean;
  kind: ExclusionKind;
  reason: string;
  onOpen: () => void;
  onClose: () => void;
  onKind: (k: ExclusionKind) => void;
  onReason: (r: string) => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <tr className="border-b border-dashed align-top last:border-0">
        <td className="py-1.5 pr-2 whitespace-nowrap">
          {formatIsoDateBr(item.finishedOn)}
        </td>
        <td className="py-1.5 pr-2">
          {item.procedureName}
          {item.origin === "ortodontia" && (
            <span className="ml-1 text-xs text-muted-foreground">
              (manutenção de Ortodontia)
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
        </td>
        <td className="py-1.5 text-right print:hidden">
          {canEdit && !open && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={onOpen}>
              Excluir
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="print:hidden">
          <td colSpan={5} className="pb-2">
            <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
              <div className="flex flex-wrap gap-4 text-sm">
                {(["adiar", "nao_pagar"] as ExclusionKind[]).map((k) => (
                  <label key={k} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`tipo-${item.itemId}`}
                      className="mt-1"
                      checked={kind === k}
                      onChange={() => onKind(k)}
                    />
                    <span>
                      <span className="font-medium">
                        {k === "adiar" ? "Adiar" : "Não pagar"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {EXCLUSION_HELP[k]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1">
                  <Label className="text-[11px]">Motivo (obrigatório)</Label>
                  <Input
                    className="h-8"
                    value={reason}
                    onChange={(e) => onReason(e.target.value)}
                    placeholder="Por que este procedimento sai do relatório?"
                  />
                </label>
                <Button size="sm" disabled={isPending} onClick={onConfirm}>
                  Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Desistir
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
