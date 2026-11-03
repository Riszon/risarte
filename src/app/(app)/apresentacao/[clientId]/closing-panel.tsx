"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  FileSignature,
  Lock,
  PartyPopper,
  Printer,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import { markClosingStep } from "./closing-actions";
import { EnviarParaAssinaturaDialog } from "@/app/(app)/assinaturas/enviar-dialog";

export type ClosingSummary = {
  finalCents: number;
  adjustmentCents: number;
  paymentMethod: PaymentMethod | null;
  installments: number;
  partialReason: string | null;
  excludedDescriptions: string[];
  presentationSummary: string | null;
};

/**
 * OC-00158: o envio digital do contrato, já traduzido para a tela (o servidor
 * calcula com `situacaoDoContrato`). Nulo = nada enviado pela assinatura digital.
 */
export type ContratoDoFechamento = {
  numero: string;
  href: string | null;
  situacao: string;
  situacaoClasse: string;
  esperando: boolean;
  frase: string;
  assinaram: { papel: string; nome: string; quando: string | null }[];
  faltam: { papel: string; nome: string; situacao: string }[];
};

export function ClosingPanel({
  clientId,
  negotiationId,
  sale,
  summary,
  canClose,
  negotiationCancelled = false,
  assinatura = null,
  contrato = null,
  resumoFaltando = false,
}: {
  clientId: string;
  negotiationId: string;
  sale: {
    contractSigned: boolean;
    /** ZS3 (0343): 'manual' | 'assinatura_digital' | null, e quando. */
    contractSignedSource?: string | null;
    contractSignedAt?: string | null;
    /** 0202: cobrança gerada — informativo, não conclui a venda. */
    paymentIssued?: boolean;
    paymentConfirmed: boolean;
    closedAt: string | null;
  } | null;
  summary: ClosingSummary;
  canClose: boolean;
  negotiationCancelled?: boolean;
  /** ZS2: quem pode enviar para assinatura digital traz a unidade; nulo esconde o botão. */
  assinatura?: { clinicId: string } | null;
  /** OC-00158: a situação do envio digital (quem assinou e quem falta). */
  contrato?: ContratoDoFechamento | null;
  /** OC-00158 (0348): sem o resumo da apresentação, o contrato não é enviado. */
  resumoFaltando?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const signed = sale?.contractSigned ?? false;
  const issued = sale?.paymentIssued ?? false;
  const paid = sale?.paymentConfirmed ?? false;
  const closed = Boolean(sale?.closedAt);

  function toggle(
    step: "contract" | "payment_issued" | "payment_confirmed",
    value: boolean
  ) {
    startTransition(async () => {
      const r = await markClosingStep(clientId, negotiationId, step, value);
      if (r.ok) {
        if (r.closed)
          toast.success(
            r.orthoCaseId
              ? "VENDA CONCLUÍDA! O caso ortodôntico foi aberto (aguardando início) — a recepção, o Gerente e o Coordenador foram acionados para agendar a instalação."
              : "VENDA CONCLUÍDA! Contrato assinado e pagamento confirmado — a recepção foi acionada para iniciar o tratamento."
          );
        else toast.success("Fechamento atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card className="border-emerald-200">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <FileSignature className="size-4" />
          Fechamento
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Regra de ouro: só é venda com <strong>contrato assinado</strong> E{" "}
          <strong>pagamento confirmado</strong>.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Resumo que entra no contrato do cliente. */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resumo do fechamento (vai no contrato)
          </p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor final</span>
            <span className="text-base font-semibold">
              {formatBRL(summary.finalCents)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {summary.adjustmentCents !== 0 && (
              <span>
                {summary.adjustmentCents < 0 ? "Desconto" : "Acréscimo"}:{" "}
                {formatBRL(Math.abs(summary.adjustmentCents))}
              </span>
            )}
            <span>
              Pagamento:{" "}
              {summary.paymentMethod
                ? PAYMENT_METHOD_LABELS[summary.paymentMethod]
                : "a definir"}
            </span>
            {summary.installments > 1 && (
              <span>{summary.installments}x</span>
            )}
          </div>
          {summary.excludedDescriptions.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50/60 p-2">
              <p className="text-xs font-medium text-rose-800">
                Aprovação parcial — não aprovados pelo cliente:
              </p>
              <ul className="mt-0.5 list-inside list-disc text-xs text-rose-900">
                {summary.excludedDescriptions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              {summary.partialReason && (
                <p className="mt-1 text-xs text-rose-900/80">
                  Motivo: {summary.partialReason}
                </p>
              )}
            </div>
          )}
          {summary.presentationSummary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Resumo da apresentação:
              </p>
              <p className="whitespace-pre-wrap text-xs">
                {summary.presentationSummary}
              </p>
            </div>
          )}
        </div>

        {contrato && <AssinaturasDoContrato contrato={contrato} />}

        {negotiationCancelled ? (
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <p className="font-semibold">Venda cancelada.</p>
            <p className="text-xs text-muted-foreground">
              As sessões não realizadas e as cobranças em aberto foram
              canceladas. O termo de cancelamento está no prontuário do
              paciente.
            </p>
          </div>
        ) : closed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              <PartyPopper className="size-5 shrink-0" />
              <div>
                <p className="font-semibold">Venda concluída!</p>
                <p className="text-xs">
                  Cliente movido para o Início de Tratamento. A recepção foi
                  acionada para agendar.
                </p>
              </div>
            </div>
            {/* 0207: cancelar tratamento saiu daqui e foi para o PRONTUÁRIO,
                aba Plano — quem cancela é o Gerente, e apresentação é passado
                quando o paciente já está em tratamento. */}
          </div>
        ) : (
          <>
            {/* 0202: os MESMOS três passos da venda direta e da renegociação.
                Só contrato + pagamento CONFIRMADO concluem a venda; "cobrança
                emitida" registra que o documento foi gerado. */}
            {/* OD4 (G3): o papel que se assina hoje é o orçamento impresso. */}
            <div className="flex flex-wrap items-center gap-2">
              {/* ZS2: o contrato e o orçamento vão para assinatura digital. */}
              {resumoFaltando ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
                  Escreva o resumo da apresentação (aba Apresentação) para enviar o contrato: ele vai no texto que o cliente assina.
                </p>
              ) : assinatura && (
                <EnviarParaAssinaturaDialog
                  clientId={clientId}
                  clinicId={assinatura.clinicId}
                  origin={{ type: "plan_negotiation", id: negotiationId }}
                  variant="default"
                />
              )}
              <a
                href={`/orcamentos/${negotiationId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
              >
                <Printer className="size-3.5" />
                Imprimir orçamento para assinar
              </a>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <StepToggle
                icon={<FileSignature className="size-4" />}
                label="Contrato assinado"
                hint={
                  sale?.contractSigned && sale.contractSignedSource === "assinatura_digital"
                    ? `Marcado pela assinatura digital${sale.contractSignedAt ? ` em ${formatBrDate(sale.contractSignedAt)}` : ""}.`
                    : contrato?.esperando && !signed
                      ? `Envio digital ${contrato.numero} em andamento: marca sozinho quando todos assinarem. Marque à mão só se o contrato foi assinado no papel.`
                      : "Marque quando o contrato estiver assinado no papel. Pela assinatura digital, marca sozinho quando todos assinam."
                }
                done={signed}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("contract", v)}
              />
              <StepToggle
                icon={<Receipt className="size-4" />}
                label="Cobrança emitida"
                hint="Boleto/link gerado e enviado — ainda não é pagamento"
                done={issued}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("payment_issued", v)}
              />
              <StepToggle
                icon={<Wallet className="size-4" />}
                label="Pagamento confirmado"
                hint="Dinheiro na conta (marcação manual por enquanto)"
                done={paid}
                disabled={!canClose || isPending}
                onToggle={(v) => toggle("payment_confirmed", v)}
              />
            </div>
            {!canClose && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" />
                Apenas o Assistente/Consultor Comercial (ou Gerente) registra o
                fechamento.
              </p>
            )}
            {canClose && (
              <p className="text-xs text-muted-foreground">
                {signed && paid
                  ? "Tudo pronto."
                  : `Falta: ${[!signed && "contrato assinado", !paid && "pagamento confirmado"]
                      .filter(Boolean)
                      .join(" e ")}.`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StepToggle({
  icon,
  label,
  hint,
  done,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  done: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        done ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/15" : "bg-card"
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {done ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <CircleDot className="size-4 text-muted-foreground" />
        )}
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        disabled={disabled}
        className="mt-2 h-7 w-full text-xs"
        onClick={() => onToggle(!done)}
      >
        {done ? "Desmarcar" : "Marcar como concluído"}
      </Button>
    </div>
  );
}

/** Quem já assinou (com a hora) e quem falta, na ordem em que a ZapSign chama. */
function AssinaturasDoContrato({ contrato }: { contrato: ContratoDoFechamento }) {
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <FileSignature className="size-4" />
          Assinatura digital · <span className="font-mono text-xs">{contrato.numero}</span>
        </p>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", contrato.situacaoClasse)}>
          {contrato.situacao}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{contrato.frase}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
            Assinaram ({contrato.assinaram.length})
          </p>
          {contrato.assinaram.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguém ainda.</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {contrato.assinaram.map((s, i) => (
                <li key={i} className="flex items-start gap-1">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                  <span>
                    <strong>{s.papel}</strong> — {s.nome}
                    {s.quando && <span className="text-muted-foreground"> · {s.quando}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
            Faltam ({contrato.faltam.length})
          </p>
          {contrato.faltam.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguém.</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {contrato.faltam.map((s, i) => (
                <li key={i} className="flex items-start gap-1">
                  <Clock className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  <span>
                    <strong>{s.papel}</strong> — {s.nome}
                    <span className="text-muted-foreground"> · {s.situacao}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {contrato.href && (
        <a
          href={contrato.href}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" />
          Abrir o pacote (reenviar, ver o documento)
        </a>
      )}
    </div>
  );
}
