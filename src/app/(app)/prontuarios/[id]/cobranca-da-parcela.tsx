"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { linkDoWhatsApp } from "@/lib/empresarial/envio";
import type { InstallmentView } from "@/lib/finance/receivables";
import {
  MEIOS_DA_COBRANCA,
  METODOS_SEM_COBRANCA_NA_ASA1,
  ROTULO_DA_SITUACAO,
  SITUACOES_ATIVAS,
  meioInicial,
  mensagemDaCobrancaNoWhatsApp,
  motivoSemCobranca,
  type MeioDaCobranca,
  type SituacaoDaCobranca,
} from "@/lib/cobrancas";
import type { ChargeRow, WaiverRow } from "./receivables-loader";
import {
  cancelarCobranca,
  desfazerCobrancaExterna,
  emitirCobranca,
  marcarCobrancaExterna,
  previaDaCobranca,
  tentarDeNovo,
  type PreviaDaCobranca,
} from "./cobranca-actions";

export type PermissoesDaCobranca = {
  ver: boolean;
  emitir: boolean;
  cancelar: boolean;
  /** Quem dá baixa (para "Recebeu no balcão"). */
  receber: boolean;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function somaDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const MEIO_CURTO: Record<string, string> = { BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartão" };

const ESTILO: Partial<Record<SituacaoDaCobranca, string>> = {
  emitida: "border-sky-300 bg-sky-50 text-sky-800",
  vencida: "border-destructive/40 bg-destructive/5 text-destructive",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  erro_emissao: "border-amber-300 bg-amber-50 text-amber-800",
  externa: "border-border bg-muted text-muted-foreground",
};

async function copiar(texto: string, oQue: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oQue} copiado.`);
  } catch {
    toast.error("Não foi possível copiar.");
  }
}

/**
 * A COBRANÇA DO ASAAS NA LINHA DA PARCELA (ASA1, entrega 2): gerar, mandar o
 * link, cancelar, "recebeu no balcão" e a cobrança feita fora do riSZon. As
 * regras moram no banco; esta tela só pergunta e mostra.
 */
export function CobrancaDaParcela({
  clientId,
  parcela,
  cobrancas,
  dispensas,
  today,
  unidadePronta,
  permissoes,
  onAbrirBaixa,
}: {
  clientId: string;
  parcela: InstallmentView;
  cobrancas: ChargeRow[];
  dispensas: WaiverRow[];
  today: string;
  /** A unidade da parcela está pronta para cobrar; `null` = banco sem a 4004. */
  unidadePronta: boolean | null;
  permissoes: PermissoesDaCobranca;
  onAbrirBaixa: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [emitindo, setEmitindo] = useState(false);
  const [cancelando, setCancelando] = useState<"cancel" | "counter" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [externa, setExterna] = useState(false);
  const [nota, setNota] = useState("");

  const ativa = cobrancas.find((c) => SITUACOES_ATIVAS.has(c.status as SituacaoDaCobranca)) ?? null;
  const anteriores = cobrancas.filter((c) => c !== ativa).length;
  // Sem cobrança ativa: ou o botão aparece, ou a tela diz por quê.
  const jaPagaPeloAsaas = cobrancas.some((c) => c.status === "paga" || c.status === "liquidada");
  const motivo_ = ativa || jaPagaPeloAsaas
    ? null
    : motivoSemCobranca({
        status: parcela.status,
        paymentMethod: parcela.paymentMethod,
        graceDays: parcela.terms.graceDays,
        unidadePronta,
        podeEmitir: permissoes.emitir,
      });
  const podeTerCobranca =
    parcela.isOpen &&
    !METODOS_SEM_COBRANCA_NA_ASA1.has(parcela.paymentMethod ?? "") &&
    parcela.terms.graceDays === 0 &&
    unidadePronta === true;

  function aposAcao(r: { ok: boolean; error?: string }, sucesso: string) {
    if (r.ok) {
      toast.success(sucesso);
      router.refresh();
    } else toast.error(r.error ?? "Algo deu errado.");
  }

  function confirmarCancelamento() {
    if (!ativa || !cancelando) return;
    const purpose = cancelando;
    startTransition(async () => {
      const r = await cancelarCobranca({ clientId, chargeId: ativa.id, purpose, reason: motivo });
      setCancelando(null);
      setMotivo("");
      if (r.ok && purpose === "counter") {
        toast.success("Cobrança cancelada no Asaas. Registre o recebimento.");
        router.refresh();
        onAbrirBaixa();
        return;
      }
      aposAcao(r, "Cobrança cancelada no Asaas.");
    });
  }

  if (!permissoes.ver && dispensas.length === 0) return null;
  // Parcela paga pelo Asaas: só a linha da paga (sem o motivo "parcela paga").

  return (
    <div className="mt-2 space-y-1.5 border-t pt-2 text-xs">
      {dispensas.map((w) =>
        w.kind === "arredondamento" ? (
          <p key={w.id} className="text-muted-foreground">
            Fechada por arredondamento do Asaas (automático): {formatBRL(w.totalCents)} em {fmtDate(w.createdAt)}.
          </p>
        ) : (
          <p key={w.id} className="rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900">
            Quitada por valor menor: dispensado {formatBRL(w.totalCents)}
            {w.principalCents > 0 && ` (principal ${formatBRL(w.principalCents)})`} — “{w.reason}”
            {w.byName && `, por ${w.byName}`} em {fmtDate(w.createdAt)}.
          </p>
        )
      )}
      {permissoes.ver &&
        (() => {
          const paga = cobrancas.find((c) => c.status === "paga" || c.status === "liquidada");
          if (!paga) return null;
          return (
            <p className="text-muted-foreground">
              Paga pelo Asaas ({MEIO_CURTO[paga.billingType ?? ""] ?? paga.billingType})
              {paga.status === "liquidada" ? " · dinheiro disponível" : " · aguardando o dinheiro cair"}.
            </p>
          );
        })()}

      {permissoes.ver && ativa && !ativa.isExternal && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px]", ESTILO[ativa.status as SituacaoDaCobranca])}>
            {ROTULO_DA_SITUACAO[ativa.status as SituacaoDaCobranca] ?? ativa.status}
          </Badge>
          <span className="text-muted-foreground">
            {MEIO_CURTO[ativa.billingType ?? ""] ?? ativa.billingType}
            {ativa.valueCents !== null && ` · ${formatBRL(ativa.valueCents)}`}
            {ativa.discountCents > 0 && ` (${formatBRL(ativa.discountCents)} de desconto até o vencimento)`}
            {` · vence ${fmtDate(ativa.dueDate)}`}
            {ativa.payerKind === "guardian" && ativa.payerName && ` · paga: ${ativa.payerName}`}
          </span>
          <span className="flex flex-wrap gap-1">
            {ativa.invoiceUrl && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copiar(ativa.invoiceUrl!, "Link")}>
                  <Copy className="mr-1 size-3" /> Link
                </Button>
                <a
                  href={ativa.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-7 items-center rounded-md border px-2 hover:bg-muted"
                  title="Abrir a fatura do Asaas"
                >
                  <ExternalLink className="size-3" />
                </a>
                {(() => {
                  const wa = linkDoWhatsApp(
                    ativa.payerPhone,
                    mensagemDaCobrancaNoWhatsApp({
                      nomeDoPagador: ativa.payerName ?? "",
                      valorFormatado: formatBRL(ativa.valueCents ?? 0),
                      vencimentoFormatado: fmtDate(ativa.dueDate),
                      link: ativa.invoiceUrl!,
                    })
                  );
                  return wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 hover:bg-muted"
                    >
                      <MessageCircle className="size-3" /> WhatsApp
                    </a>
                  ) : null;
                })()}
              </>
            )}
            {ativa.pixCopyPaste && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copiar(ativa.pixCopyPaste!, "Pix copia e cola")}>
                <Copy className="mr-1 size-3" /> Pix
              </Button>
            )}
            {ativa.identificationField && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => copiar(ativa.identificationField!, "Linha digitável")}
              >
                <Copy className="mr-1 size-3" /> Linha digitável
              </Button>
            )}
            {permissoes.emitir && (ativa.status === "erro_emissao" || ativa.status === "emitindo") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () =>
                    aposAcao(await tentarDeNovo({ clientId, chargeId: ativa.id }), "Cobrança emitida.")
                  )
                }
              >
                <RefreshCw className="mr-1 size-3" /> Tentar de novo
              </Button>
            )}
            {permissoes.receber && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCancelando("counter")}>
                Recebeu no balcão
              </Button>
            )}
            {permissoes.cancelar && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setCancelando("cancel")}>
                Cancelar cobrança
              </Button>
            )}
          </span>
        </div>
      )}

      {permissoes.ver && ativa?.isExternal && (
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Badge variant="outline" className={cn("text-[10px]", ESTILO.externa)}>
            {ROTULO_DA_SITUACAO.externa}
          </Badge>
          <span>“{ativa.externalNote}”{ativa.byName && ` — ${ativa.byName}`}</span>
          {permissoes.cancelar && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() =>
                startTransition(async () =>
                  aposAcao(
                    await desfazerCobrancaExterna({ clientId, chargeId: ativa.id, reason: "marcação desfeita" }),
                    "Marcação desfeita."
                  )
                )
              }
            >
              Desfazer
            </Button>
          )}
        </div>
      )}

      {permissoes.ver && !ativa && podeTerCobranca && (permissoes.emitir || permissoes.cancelar) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {permissoes.emitir && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEmitindo(true)}>
              <Send className="mr-1 size-3" /> Gerar cobrança no Asaas
            </Button>
          )}
          {permissoes.cancelar && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setExterna(true)}>
              Já cobrada fora do riSZon
            </Button>
          )}
          {anteriores > 0 && <span className="text-muted-foreground">{anteriores} cobrança(s) anterior(es) cancelada(s)</span>}
        </div>
      )}

      {permissoes.ver && !ativa && motivo_ && (
        <p className="text-muted-foreground">
          <span className="font-medium">Cobrança pelo Asaas:</span> {motivo_}
          {anteriores > 0 && ` (${anteriores} cobrança(s) anterior(es) cancelada(s))`}
        </p>
      )}

      {emitindo && (
        <DialogoDeEmissao
          clientId={clientId}
          parcela={parcela}
          today={today}
          onFechar={() => setEmitindo(false)}
        />
      )}

      <Dialog open={cancelando !== null} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cancelando === "counter" ? "Recebeu no balcão" : "Cancelar a cobrança"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {cancelando === "counter"
                ? "A cobrança é cancelada no Asaas e, confirmado o cancelamento, abre o registro do recebimento. Se o paciente já pagou pelo Asaas, nada é cancelado."
                : "A cobrança é cancelada no Asaas. O link deixa de funcionar. Se já foi paga no Asaas, nada é cancelado."}
            </p>
            {cancelando === "cancel" && (
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Motivo</span>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                />
              </label>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button disabled={isPending} onClick={confirmarCancelamento}>
              {cancelando === "counter" ? "Cancelar e registrar" : "Cancelar cobrança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={externa} onOpenChange={setExterna}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parcela já cobrada fora do riSZon</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Use quando a cobrança desta parcela foi gerada direto no Asaas. O riSZon não gera outra, e a baixa continua
              manual.
            </p>
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Onde e como foi cobrada</span>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExterna(false)}>
              Voltar
            </Button>
            <Button
              disabled={isPending || nota.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const r = await marcarCobrancaExterna({ clientId, installmentId: parcela.id, note: nota });
                  if (r.ok) {
                    setExterna(false);
                    setNota("");
                  }
                  aposAcao(r, "Parcela marcada como cobrada fora do riSZon.");
                })
              }
            >
              Marcar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DialogoDeEmissao({
  clientId,
  parcela,
  today,
  onFechar,
}: {
  clientId: string;
  parcela: InstallmentView;
  today: string;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const vencida = parcela.dueDate < today;
  const [meio, setMeio] = useState<MeioDaCobranca>(meioInicial(parcela.paymentMethod));
  const [data, setData] = useState<string>(today);
  const [previa, setPrevia] = useState<PreviaDaCobranca | null>(null);

  useEffect(() => {
    let vivo = true;
    previaDaCobranca({ installmentId: parcela.id, billingType: meio, dueDate: vencida ? data : null }).then((p) => {
      if (vivo) setPrevia(p);
    });
    return () => {
      vivo = false;
    };
  }, [parcela.id, meio, data, vencida]);

  const limite = previa?.ok ? previa.maxReissueDays : (previa?.maxReissueDays ?? 7);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar cobrança no Asaas</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Forma de pagamento</span>
            <select
              value={meio}
              onChange={(e) => setMeio(e.target.value as MeioDaCobranca)}
              className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            >
              {MEIOS_DA_COBRANCA.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>
            {meio === "CREDIT_CARD" && (
              <span className="text-[10px] text-muted-foreground">
                O paciente digita o cartão na página do Asaas. O riSZon nunca recebe dados de cartão.
              </span>
            )}
          </label>

          {vencida && (
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Novo vencimento</span>
              <input
                type="date"
                value={data}
                min={today}
                max={somaDias(today, limite)}
                onChange={(e) => setData(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              />
              <span className="text-[10px] text-muted-foreground">
                Parcela vencida: o valor é atualizado com multa e juros até a nova data (de hoje até {limite} dias). Sem
                desconto de pontualidade. Mais que isso, só renegociando.
              </span>
            </label>
          )}

          {previa === null && <p className="text-xs text-muted-foreground">Calculando…</p>}
          {previa && !previa.ok && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{previa.error}</p>
          )}
          {previa?.ok && (
            <ul className="space-y-0.5 rounded-lg bg-muted/40 p-2 text-xs tabular-nums">
              <li className="flex justify-between">
                <span>Valor da cobrança</span>
                <strong>{formatBRL(previa.valueCents)}</strong>
              </li>
              {previa.discountCents > 0 && (
                <li className="flex justify-between">
                  <span>Desconto se pagar até o vencimento</span>
                  <span>− {formatBRL(previa.discountCents)}</span>
                </li>
              )}
              <li className="flex justify-between">
                <span>Vencimento</span>
                <span>{fmtDate(previa.dueDate)}</span>
              </li>
              <li className="flex justify-between">
                <span>Depois do vencimento</span>
                <span>
                  {previa.finePercent > 0 ? `multa ${previa.finePercent}% + ` : ""}juros {previa.interestPercent}% ao mês
                </span>
              </li>
              <li className="flex justify-between">
                <span>Quem paga</span>
                <span>
                  {previa.payerName}
                  {previa.payerKind === "guardian" && " (responsável financeiro)"}
                </span>
              </li>
            </ul>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            disabled={isPending || !previa?.ok}
            onClick={() =>
              startTransition(async () => {
                const r = await emitirCobranca({
                  clientId,
                  installmentId: parcela.id,
                  billingType: meio,
                  dueDate: vencida ? data : null,
                });
                if (r.ok) {
                  toast.success("Cobrança gerada no Asaas. Copie o link ou envie pelo WhatsApp.");
                  onFechar();
                } else toast.error(r.error);
                router.refresh();
              })
            }
          >
            <Send className="mr-1 size-4" /> Gerar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
