"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { decidirDevolucao, linkDoTermo, pedirDevolucao } from "@/app/(app)/comercial/parcelado-actions";
import { ROTULO_DA_DEVOLUCAO, saldoParaDevolver, type ParcelamentoDaVenda } from "@/lib/asaas/cobrancas-da-venda";

const TIPOS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const CAMPO = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

/**
 * ASA4 (4014, 19.20, 1a): a DEVOLUÇÃO POR PIX na desistência do cartão
 * parcelado pelo Asaas, até a entrega 6. O parcelamento continua pago e a taxa da
 * rede continua devida. O pedido exige o distrato ou o termo de devolução
 * assinado (anexo); só o Financeiro da Franqueadora ou o Admin Master
 * autorizam. Autorizada, vira conta a pagar da unidade (paga pelo Pix).
 */
export function DevolucaoDoParcelamento({ p, aoMudar }: { p: ParcelamentoDaVenda; aoMudar: () => void }) {
  const [ocupado, start] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nota, setNota] = useState<Record<string, string>>({});
  const saldo = saldoParaDevolver(p);
  const devolucoes = p.devolucoes ?? [];

  function pedir() {
    const cents = parseBRLToCents(valor);
    if (!cents || cents <= 0) return toast.error("Informe o valor a devolver.");
    if (cents > saldo) return toast.error(`O valor passa do que ainda pode ser devolvido (${formatBRL(saldo)}).`);
    if (motivo.trim().length < 5) return toast.error("Escreva o motivo da desistência.");
    if (!arquivo) return toast.error("Anexe o distrato ou o termo de devolução assinado.");
    if (!TIPOS[arquivo.type]) return toast.error("Envie PDF ou imagem (PNG, JPG, WEBP).");
    if (arquivo.size > 10 * 1024 * 1024) return toast.error("O arquivo passa de 10 MB.");
    if (!p.clinic || !p.block) return;
    start(async () => {
      const path = `${p.clinic}/${p.block}/${crypto.randomUUID()}.${TIPOS[arquivo.type]}`;
      const { error } = await createClient().storage.from("devolucoes").upload(path, arquivo, { contentType: arquivo.type });
      if (error) {
        toast.error("Não foi possível enviar o termo. Tente de novo.");
        return;
      }
      const r = await pedirDevolucao({ blockId: p.block!, amountCents: cents, reason: motivo.trim(), termPath: path, termName: arquivo.name.slice(0, 120) });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Pedido de devolução enviado para a autorização do Financeiro da Franqueadora.");
        setAberto(false);
        setValor("");
        setMotivo("");
        setArquivo(null);
      }
      aoMudar();
    });
  }

  function decidir(id: string, approve: boolean) {
    start(async () => {
      const r = await decidirDevolucao({ id, approve, note: nota[id] ?? "" });
      if (!r.ok) toast.error(r.error);
      else toast.success(approve ? "Devolução autorizada: virou conta a pagar da unidade." : "Devolução negada.");
      aoMudar();
    });
  }

  async function abrirTermo(path: string) {
    const r = await linkDoTermo(path);
    if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else toast.error(r.error ?? "Não foi possível abrir o termo.");
  }

  if (!p.pode_pedir_devolucao && devolucoes.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t pt-2">
      {devolucoes.map((d) => (
        <div key={d.id} className="space-y-1 rounded-md border p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Devolução por Pix: {formatBRL(Number(d.valor))}</span>
            <span className="rounded border px-1.5 text-[11px] text-muted-foreground">{ROTULO_DA_DEVOLUCAO[d.situacao]}</span>
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => abrirTermo(d.termo)}>
              <FileText className="size-3" /> {d.termo_nome ?? "Termo assinado"}
            </button>
          </div>
          <p className="text-muted-foreground">
            {d.motivo} · pedida por {d.quem_pediu ?? "—"}
            {d.nota ? ` · ${d.nota}` : ""}
          </p>
          {d.situacao === "pedida" && p.pode_decidir_devolucao && (
            <div className="flex flex-wrap items-center gap-1">
              <input className={CAMPO + " max-w-xs"} placeholder="Observação (obrigatória para negar)" value={nota[d.id] ?? ""} onChange={(e) => setNota({ ...nota, [d.id]: e.target.value })} />
              <Button size="sm" className="h-7 text-[11px]" disabled={ocupado} onClick={() => decidir(d.id, true)}>
                Autorizar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={ocupado} onClick={() => decidir(d.id, false)}>
                Negar
              </Button>
            </div>
          )}
        </div>
      ))}

      {p.pode_pedir_devolucao && saldo > 0 && !aberto && (
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setAberto(true)}>
          Registrar devolução por Pix (desistência)
        </Button>
      )}
      {aberto && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <p className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Risco: depois de receber o Pix, o paciente ainda pode contestar a compra no cartão. O parcelamento continua pago e a taxa da rede
            continua devida. Só o Financeiro da Franqueadora ou o Admin Master autorizam a devolução.
          </p>
          <label className="block text-[11px] text-muted-foreground">
            Valor a devolver (até {formatBRL(saldo)})
            <input className={CAMPO} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Motivo da desistência
            <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Distrato ou termo de devolução assinado (obrigatório; PDF ou foto)
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-[11px]" disabled={ocupado} onClick={pedir}>
              Enviar para autorização
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setAberto(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
