"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, FileText, Link2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { escolherForma, gerarLinkDaLista, registrarEnvioDaLista, revogarLista } from "@/app/(app)/comercial/boletos-actions";
import { mensagemDaLista, textosDaForma, type BoletosDaVenda, type FormaDosBoletos } from "@/lib/asaas/forma-dos-boletos";
import { comConfirmacaoDeBoletos } from "@/lib/confirmar-boletos";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * ASA4, 1B (4015; spec 19.9 acréscimo A, 19.25 e 19.26): a FORMA DOS BOLETOS nas
 * Cobranças da venda — "Um boleto por mês" (padrão) ou "Todos os boletos agora",
 * com os textos para quem fecha e para o cliente. Na forma 2: o link da lista
 * (aparece UMA vez ao gerar: o banco guarda só o resumo), Copiar e WhatsApp (o
 * envio fica registrado), Revogar, e quantas vezes a lista foi aberta.
 */
export function FormaDosBoletosBloco({
  b,
  negotiationId,
  directSaleId,
  aoMudar,
}: {
  b: BoletosDaVenda;
  negotiationId?: string | null;
  directSaleId?: string | null;
  aoMudar: () => void;
}) {
  const [ocupado, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const textos = textosDaForma(b.prazo);
  if (!b.tem_boleto) return null;
  const venda = { negotiationId: negotiationId ?? null, directSaleId: directSaleId ?? null };

  const trocar = (forma: FormaDosBoletos) =>
    start(async () => {
      const r = await comConfirmacaoDeBoletos((confirmar) => escolherForma({ ...venda, forma, confirmar }));
      if (!r.ok) toast.error(r.error);
      else {
        const extra = forma === "todos" ? ` ${r.criados ?? 0} boleto(s) criado(s) agora.` : r.cancelados ? ` ${r.cancelados} boleto(s) cancelado(s).` : "";
        toast.success(`Forma: ${textos[forma].titulo}.${extra}`);
      }
      aoMudar();
    });

  const gerar = () =>
    start(async () => {
      const r = await gerarLinkDaLista(venda);
      if (!r.ok) toast.error(r.error);
      else {
        setLink(r.link ?? null);
        toast.success("Link novo gerado. O anterior parou de valer.");
      }
      aoMudar();
    });

  async function enviar(canal: "lista_copiada" | "lista_whatsapp") {
    if (!link) return;
    if (canal === "lista_whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(mensagemDaLista(null, link))}`, "_blank", "noopener,noreferrer");
    } else {
      try {
        await navigator.clipboard.writeText(link);
        toast.success("Link da lista copiado.");
      } catch {
        toast.error("Não foi possível copiar. Selecione e copie à mão.");
        return;
      }
    }
    await registrarEnvioDaLista({ ...venda, canal });
    aoMudar();
  }

  const revogar = () =>
    start(async () => {
      const r = await revogarLista(venda);
      if (!r.ok) toast.error(r.error);
      else {
        setLink(null);
        toast.success("Link revogado: a lista parou de abrir.");
      }
      aoMudar();
    });

  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FileText className="size-4 text-primary" />
        <span className="font-medium">Boletos: {textos[b.forma].titulo}</span>
        {b.forma === "todos" && <span className="text-[11px] text-muted-foreground">{b.boletos_no_carne} boleto(s) emitido(s)</span>}
        {b.forma === "todos" && b.boletos_para_depois > 0 && (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-800 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
            {b.boletos_para_depois} boleto(s) saem na próxima rodada (limite diário do Asaas ou erro)
          </span>
        )}
      </div>
      {b.operacoes_interrompidas > 0 && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          Há operação interrompida nesta venda: boleto cancelado sem a mudança. Conclua ou reemita em Financeiro › Cobranças automáticas.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {(["mensal", "todos"] as const).map((f) => (
          <div key={f} className={cn("space-y-1 rounded-md border p-2 text-[11px]", b.forma === f ? "border-primary bg-primary/5" : "")}>
            <p className="text-xs font-medium">
              {textos[f].titulo}
              {f === "mensal" && <span className="font-normal text-muted-foreground"> (padrão)</span>}
            </p>
            <p className="text-muted-foreground">
              <strong className="font-medium text-foreground">Para quem fecha:</strong> {textos[f].paraQuemFecha}
            </p>
            <p className="text-muted-foreground">
              <strong className="font-medium text-foreground">Para o cliente:</strong> {textos[f].paraOCliente}
            </p>
            {b.pode_escolher && b.forma !== f && (f === "mensal" || b.unidade_ligada) && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={ocupado} onClick={() => trocar(f)}>
                Escolher “{textos[f].titulo}”
              </Button>
            )}
            {f === "todos" && !b.unidade_ligada && b.forma !== "todos" && (
              <p className="text-amber-800 dark:text-amber-200">Só para a unidade ligada em Cobranças automáticas.</p>
            )}
          </div>
        ))}
      </div>

      {b.forma === "todos" && b.pode_escolher && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2 text-[11px]">
          <p className="text-xs font-medium">A lista dos boletos (uma mensagem só, enviada por você)</p>
          {b.lista ? (
            <p className="text-muted-foreground">
              Link ativo desde {quando(b.lista.criada_em)}, vale até {dia(b.lista.expira)}.{" "}
              {b.lista.acessos > 0 ? `Aberta ${b.lista.acessos} vez(es); a última em ${quando(b.lista.ultimo_acesso!)}.` : "Ainda não foi aberta."}
            </p>
          ) : (
            <p className="text-muted-foreground">Nenhum link ativo.</p>
          )}
          {link ? (
            <div className="space-y-1">
              <p className="break-all rounded bg-muted px-2 py-1 font-mono text-[10px]">{link}</p>
              <p className="text-muted-foreground">Copie agora: por segurança, o link não é mostrado de novo (gere outro se precisar).</p>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar("lista_copiada")}>
                  <Copy className="mr-1 size-3" /> Copiar link
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => enviar("lista_whatsapp")}>
                  <MessageCircle className="mr-1 size-3" /> WhatsApp
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" className="h-7 text-[11px]" disabled={ocupado} onClick={gerar}>
              <Link2 className="mr-1 size-3" /> {b.lista ? "Gerar novo link" : "Gerar link da lista"}
            </Button>
            {b.lista && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={ocupado} onClick={revogar}>
                Revogar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
