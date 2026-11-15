"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CreditCard, Copy, ExternalLink, MessageCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { registrarEnvio } from "@/app/(app)/comercial/cobrancas-da-venda-actions";
import {
  cancelarParcelamento,
  estornarParcelamento,
  gerarParcelamento,
  previaDoEstorno,
  tentarDeNovoParcelamento,
  type PreviaDoEstorno,
} from "@/app/(app)/comercial/parcelado-actions";
import { mensagemDoParcelamento, ROTULO_DO_PARCELAMENTO, type ParcelamentoDaVenda } from "@/lib/asaas/cobrancas-da-venda";
import { DevolucaoDoParcelamento } from "@/components/commercial/devolucao-do-parcelamento";

const TOM: Record<string, string> = {
  pago: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  aguardando: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  vencido: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  erro: "border-destructive/40 bg-destructive/5 text-destructive",
  em_contestacao: "border-destructive/40 bg-destructive/5 text-destructive",
};
const CAMPO = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

/**
 * ASA4 (4013, spec 19.19): o CARTÃO PARCELADO PELO ASAAS nas Cobranças da venda.
 * Um link só para o parcelamento inteiro (o Asaas não manda nada: o cadastro é
 * sem avisos, 19.21); gerar à mão, tentar de novo, cancelar o não pago e
 * estornar o pago — sempre inteiro. O estorno mostra antes o que a unidade perde.
 */
export function ParcelamentoDaVendaBloco({
  p,
  negotiationId,
  directSaleId,
  aoMudar,
}: {
  p: ParcelamentoDaVenda;
  negotiationId?: string | null;
  directSaleId?: string | null;
  aoMudar: () => void;
}) {
  const [ocupado, start] = useTransition();
  const [modo, setModo] = useState<null | "cancelar" | "estornar">(null);
  const [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<PreviaDoEstorno | null>(null);

  const rodar = (f: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) =>
    start(async () => {
      const r = await f();
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(ok);
        setModo(null);
        setMotivo("");
        setPrevia(null);
      }
      aoMudar();
    });

  async function enviar(canal: "copiar_link" | "whatsapp") {
    if (!p.link || !p.primeira) return;
    if (canal === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(mensagemDoParcelamento(p))}`, "_blank", "noopener,noreferrer");
    } else {
      try {
        await navigator.clipboard.writeText(p.link);
        toast.success("Link copiado.");
      } catch {
        toast.error("Não foi possível copiar. Selecione e copie à mão.");
        return;
      }
    }
    await registrarEnvio(p.primeira, canal);
    aoMudar();
  }

  function abrirEstorno() {
    if (!p.block) return;
    setModo("estornar");
    start(async () => {
      const r = await previaDoEstorno(p.block!);
      if (!r.ok) {
        toast.error(r.error);
        setModo(null);
      } else setPrevia(r.previa);
    });
  }

  const podeEnviar = p.link && (p.situacao === "aguardando" || p.situacao === "vencido");
  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CreditCard className="size-4 text-primary" />
        <span className="font-medium">
          Cartão parcelado pelo Asaas: {p.parcelas}x, total {formatBRL(p.total)}
        </span>
        <span className={cn("rounded border px-1.5 text-[11px]", TOM[p.situacao] ?? "border-border bg-muted text-muted-foreground")}>
          {ROTULO_DO_PARCELAMENTO[p.situacao]}
        </span>
        {p.situacao === "pago" && p.creditadas > 0 && (
          <span className="text-[11px] text-muted-foreground">{p.creditadas} de {p.parcelas} parcela(s) já creditada(s)</span>
        )}
      </div>
      {p.situacao === "em_contestacao" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          O titular do cartão contestou a compra. A defesa é no painel do Asaas, com os documentos da venda.
          {p.contestacao_prazo
            ? ` Prazo para mandar os documentos: ${p.contestacao_prazo.slice(8, 10)}/${p.contestacao_prazo.slice(5, 7)}/${p.contestacao_prazo.slice(0, 4)}.`
            : " O prazo dos documentos ainda vai ser lido do Asaas."}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        O paciente paga pelo link, no cartão, sem juros (a unidade absorve a tarifa). O Asaas não manda aviso: envie o link uma vez, por aqui.
        A venda só fecha com a aprovação do cartão.
      </p>
      <div className="flex flex-wrap gap-1">
        {podeEnviar && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar("copiar_link")}>
              <Copy className="mr-1 size-3" /> Copiar link
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar("whatsapp")}>
              <MessageCircle className="mr-1 size-3" /> WhatsApp
            </Button>
            <a
              href={p.link!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="mr-1 size-3" /> Abrir
            </a>
          </>
        )}
        {p.pode_gerar && p.gerar_permitido && (
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={ocupado}
            onClick={() => rodar(() => gerarParcelamento({ negotiationId, directSaleId }), "Parcelamento criado no Asaas.")}
          >
            Gerar parcelamento no Asaas
          </Button>
        )}
        {p.pode_tentar_de_novo && p.gerar_permitido && p.block && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={ocupado} onClick={() => rodar(() => tentarDeNovoParcelamento(p.block!), "Parcelamento criado no Asaas.")}>
            <RotateCcw className="mr-1 size-3" /> Tentar de novo
          </Button>
        )}
        {p.pode_cancelar && p.cancelar_permitido && modo === null && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={ocupado} onClick={() => setModo("cancelar")}>
            Cancelar parcelamento
          </Button>
        )}
        {p.pode_estornar && p.estornar_permitido && modo === null && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive" disabled={ocupado} onClick={abrirEstorno}>
            Estornar parcelamento
          </Button>
        )}
      </div>

      <DevolucaoDoParcelamento p={p} aoMudar={aoMudar} />

      {modo === "cancelar" && p.block && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <p className="text-xs">Cancela o parcelamento inteiro no Asaas (ainda não pago). Escreva o motivo:</p>
          <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento" />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-[11px]" disabled={ocupado || motivo.trim().length < 5} onClick={() => rodar(() => cancelarParcelamento({ blockId: p.block!, reason: motivo.trim() }), "Parcelamento cancelado.")}>
              Confirmar cancelamento
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setModo(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {modo === "estornar" && p.block && (
        <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <p className="text-xs font-medium text-destructive">Estorno do parcelamento inteiro: o que a unidade perde</p>
          {!previa ? (
            <p className="text-xs text-muted-foreground">Calculando…</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              <li>
                Valor devolvido ao paciente: <strong className="tabular-nums">{formatBRL(previa.devolvido_cents)}</strong> ({previa.parcelas} parcelas;{" "}
                {previa.creditadas} já creditada(s), {previa.a_creditar} a creditar)
              </li>
              <li>
                Tarifa do Asaas que não volta: <strong className="tabular-nums">{formatBRL(previa.tarifa_que_nao_volta_cents)}</strong>
              </li>
              <li>
                Taxa da rede que continua devida: <strong className="tabular-nums">{formatBRL(previa.taxa_devida_cents)}</strong> (vira conta a pagar da
                unidade; só o Financeiro da Franqueadora ou o Admin Master dispensam, à mão)
              </li>
            </ul>
          )}
          <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do estorno" />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[11px]"
              disabled={ocupado || !previa || !previa.estornavel || motivo.trim().length < 5}
              onClick={() => rodar(() => estornarParcelamento({ blockId: p.block!, reason: motivo.trim() }), "Estorno pedido ao Asaas.")}
            >
              Confirmar estorno
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setModo(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
