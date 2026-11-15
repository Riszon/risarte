"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle, QrCode, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { lerCobrancasDaVenda, registrarEnvio } from "@/app/(app)/comercial/cobrancas-da-venda-actions";
import { ParcelamentoDaVendaBloco } from "@/components/commercial/parcelamento-da-venda";
import { FormaDosBoletosBloco } from "@/components/commercial/forma-dos-boletos";
import {
  linhasDeEnvio,
  mensagemDoWhatsApp,
  situacaoDaParcela,
  type CobrancasDaVenda as Dados,
  type ParcelaDaVenda,
} from "@/lib/asaas/cobrancas-da-venda";

const TOM: Record<string, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  aguardando: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  vencida: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  erro: "border-destructive/40 bg-destructive/5 text-destructive",
};

const fmt = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/**
 * 4012 (spec 19.3): COBRANÇAS DA VENDA — no comercial do cliente (Fechamento)
 * e na venda direta. Situação de cada parcela, "Enviada pelo Asaas" (não é
 * confirmação de entrega), "Aberta pelo pagador", e o envio pelo riSZon
 * (Copiar link, WhatsApp, Copiar Pix, linha digitável), cada um registrado.
 * Quem não pode ver (ou banco sem a 4012): o bloco não aparece.
 */
export function CobrancasDaVenda({ negotiationId, directSaleId }: { negotiationId?: string | null; directSaleId?: string | null }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const carregar = useCallback(() => {
    lerCobrancasDaVenda({ negotiationId, directSaleId }).then(setDados).catch(() => setDados(null));
  }, [negotiationId, directSaleId]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!dados || dados.parcelas.length === 0) return null;

  async function enviar(p: ParcelaDaVenda, canal: "copiar_link" | "whatsapp" | "copiar_pix" | "linha_digitavel") {
    const c = p.cobranca;
    if (!c) return;
    if (canal === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(mensagemDoWhatsApp(p))}`, "_blank", "noopener,noreferrer");
    } else {
      const texto = canal === "copiar_link" ? c.link : canal === "copiar_pix" ? c.pix : c.linha;
      if (!texto) return;
      try {
        await navigator.clipboard.writeText(texto);
        toast.success(canal === "copiar_link" ? "Link copiado." : canal === "copiar_pix" ? "Pix copia e cola copiado." : "Linha digitável copiada.");
      } catch {
        toast.error("Não foi possível copiar. Selecione e copie à mão.");
        return;
      }
    }
    await registrarEnvio(c.id, canal);
    carregar();
  }

  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Receipt className="size-4 text-primary" />
          Cobranças da venda
        </h3>
        <span className="text-xs text-muted-foreground">
          {dados.venda_fechada_em ? `Venda fechada em ${fmt(dados.venda_fechada_em)}` : "Venda ainda não fechada"}
          {dados.automatica && ` · as próximas nascem ${dados.prazo} dias antes do vencimento`}
        </span>
      </div>
      {dados.boletos && (
        <FormaDosBoletosBloco b={dados.boletos} negotiationId={negotiationId} directSaleId={directSaleId} aoMudar={carregar} />
      )}
      {dados.parcelamento && (
        <ParcelamentoDaVendaBloco p={dados.parcelamento} negotiationId={negotiationId} directSaleId={directSaleId} aoMudar={carregar} />
      )}
      <ul className="divide-y text-sm">
        {dados.parcelas.map((p) => {
          const s = situacaoDaParcela(p);
          const c = p.cobranca;
          // A parcela do parcelado é enviada pelo link do parcelamento (acima), não sozinha.
          const podeEnviar = c && !p.parcelado && ["emitida", "vencida"].includes(c.status);
          return (
            <li key={p.installment_id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-right text-xs text-muted-foreground">{p.seq}</span>
                <span className="w-24 text-xs text-muted-foreground">{fmt(p.vencimento)}</span>
                <span className="font-medium tabular-nums">{formatBRL(p.valor)}</span>
                <span className={cn("rounded border px-1.5 text-[11px]", TOM[s.tom])}>{s.rotulo}</span>
                {podeEnviar && (
                  <span className="ml-auto flex flex-wrap gap-1">
                    {c.link && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar(p, "copiar_link")}>
                          <Copy className="mr-1 size-3" /> Copiar link
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar(p, "whatsapp")}>
                          <MessageCircle className="mr-1 size-3" /> WhatsApp
                        </Button>
                      </>
                    )}
                    {c.pix && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar(p, "copiar_pix")}>
                        <QrCode className="mr-1 size-3" /> Copiar Pix
                      </Button>
                    )}
                    {c.linha && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar(p, "linha_digitavel")}>
                        <Copy className="mr-1 size-3" /> Linha digitável
                      </Button>
                    )}
                    {c.link && (
                      <a
                        href={c.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="mr-1 size-3" /> Abrir
                      </a>
                    )}
                  </span>
                )}
              </div>
              {linhasDeEnvio(p).map((l) => (
                <p key={l} className="pl-8 text-[11px] text-muted-foreground">
                  {l}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
