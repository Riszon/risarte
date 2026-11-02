"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Copy, Download, Eye, FileStack, Loader2, Mail, RotateCcw, Send } from "lucide-react";
import { PdfViewer } from "@/components/pdf-viewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import type { AllowedActions } from "@/lib/signatures/actions-permitidas";
import type { ResendSigner } from "@/lib/signatures/pacote";
import type { PrepareResult, SendResult } from "@/lib/signatures/send";
import { concluirEnvio, descartarEnvio } from "./envio-actions";
import { LinksDeAssinatura } from "./links-de-assinatura";
import {
  abrirPdfDoPacote,
  baixarCopiaDoDocumento,
  baixarPdfAssinado,
  cancelarPacoteDeAssinatura,
  carregarLinksParaReenvio,
  marcarReenviado,
  prepararReenvioComoNovo,
  reenviarPeloEmailDaZapsign,
} from "./pacote-actions";

/**
 * AS AÇÕES DE UM PACOTE (ZS4): Visualizar, Baixar assinado, Baixar cópia,
 * Reenviar, Cancelar e Reenviar como novo pacote. Quais aparecem vem pronto
 * de `acoesPermitidas` (situação × permissão), calculado no servidor; cada
 * Server Action confere de novo. Usado no detalhe do pacote e na aba
 * Documentos da ficha (`compacto`).
 */

export type ItemDoPacote = { id: string; title: string; firstPage: number | null; lastPage: number | null };

export function AcoesDoPacote({
  packageId,
  number,
  clientId,
  actions,
  items,
  signersAside,
  compacto = false,
}: {
  packageId: string;
  number: string;
  clientId: string | null;
  actions: AllowedActions;
  items: ItemDoPacote[];
  signersAside?: ReactNode;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [viewer, setViewer] = useState<{ url: string; kind: "merged" | "signed" } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resend, setResend] = useState<{ signers: ResendSigner[]; zapsignEmail: boolean } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [novo, setNovo] = useState<Extract<PrepareResult, { ok: true }> | null>(null);
  const [novoEnviado, setNovoEnviado] = useState<Extract<SendResult, { ok: true }> | null>(null);
  const size = compacto ? "xs" : "sm";
  const comPaginas = items.filter((i) => i.firstPage && i.lastPage);

  function visualizar() {
    setViewer(null);
    setViewerOpen(true);
    startTransition(async () => {
      const r = await abrirPdfDoPacote(packageId);
      if (r.ok) setViewer({ url: r.url, kind: r.kind });
      else {
        toast.error(r.error);
        setViewerOpen(false);
      }
    });
  }

  function baixar(get: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    startTransition(async () => {
      const r = await get();
      if (r.ok) window.location.assign(r.url);
      else toast.error(r.error);
    });
  }

  function abrirReenvio() {
    setResend(null);
    setResendOpen(true);
    startTransition(async () => {
      const r = await carregarLinksParaReenvio(packageId);
      if (r.ok) setResend({ signers: r.signers, zapsignEmail: r.zapsignEmail });
      else {
        toast.error(r.error);
        setResendOpen(false);
      }
    });
  }

  function usouCanal(signerId: string, channel: "whatsapp_link" | "copy_link" | "sign_now") {
    marcarReenviado({ packageId, signerId, channel, clientId }).then((r) => {
      if (!r.ok) toast.error(r.error);
      else {
        setResend((cur) =>
          cur ? { ...cur, signers: cur.signers.map((s) => (s.id === signerId ? { ...s, lastNotifiedAt: new Date().toISOString() } : s)) } : cur
        );
        router.refresh();
      }
    });
  }

  function reenviarPorEmail() {
    startTransition(async () => {
      const r = await reenviarPeloEmailDaZapsign({ packageId, clientId });
      if (r.ok) {
        toast.success("A ZapSign vai reenviar o e-mail a quem falta assinar.");
        setResendOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function cancelar() {
    if (!reason.trim()) {
      toast.error("Escreva o motivo do cancelamento.");
      return;
    }
    startTransition(async () => {
      const r = await cancelarPacoteDeAssinatura({ packageId, reason, clientId });
      if (r.ok) {
        toast.success(`Pacote ${r.number} cancelado.`);
        setCancelOpen(false);
        setReason("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function prepararNovo() {
    setNovo(null);
    setNovoEnviado(null);
    setNovoOpen(true);
    startTransition(async () => {
      const r = await prepararReenvioComoNovo(packageId);
      if (r.ok) setNovo(r);
      else {
        toast.error(r.error);
        setNovoOpen(false);
      }
    });
  }

  function enviarNovo() {
    if (!novo) return;
    startTransition(async () => {
      const r = await concluirEnvio({ packageId: novo.packageId, clientId: clientId ?? "" });
      if (r.ok) {
        setNovoEnviado(r);
        toast.success(`Pacote ${r.number} enviado.`);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function fecharNovo(next: boolean) {
    if (next) return;
    // Fechou com o rascunho preparado e não enviado: descarta (vira cancelado).
    if (novo && !novoEnviado) void descartarEnvio({ packageId: novo.packageId });
    setNovoOpen(false);
    setNovo(null);
    setNovoEnviado(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.view && (
        <Button size={size} variant="outline" onClick={visualizar} disabled={isPending}>
          <Eye className="size-3.5" /> Visualizar
        </Button>
      )}
      {actions.downloadSigned && (
        <Button size={size} variant="outline" onClick={() => baixar(() => baixarPdfAssinado(packageId))} disabled={isPending}>
          <Download className="size-3.5" /> Baixar assinado
        </Button>
      )}
      {actions.downloadCopy && comPaginas.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size={size} variant="outline" disabled={isPending}>
                <Copy className="size-3.5" /> Baixar cópia
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-72">
            {comPaginas.map((it) => (
              <DropdownMenuItem key={it.id} onClick={() => baixar(() => baixarCopiaDoDocumento(packageId, it.id))}>
                <span className="truncate">{it.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  pág. {it.firstPage}
                  {it.lastPage !== it.firstPage ? `–${it.lastPage}` : ""}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {actions.resend && (
        <Button size={size} variant="outline" onClick={abrirReenvio} disabled={isPending}>
          <Send className="size-3.5" /> Reenviar
        </Button>
      )}
      {actions.cancel && (
        <Button size={size} variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)} disabled={isPending}>
          <Ban className="size-3.5" /> Cancelar
        </Button>
      )}
      {!compacto && !actions.cancel && actions.cancelBlockedReason && (
        <Button size={size} variant="outline" disabled title={actions.cancelBlockedReason}>
          <Ban className="size-3.5" /> Cancelar
        </Button>
      )}
      {actions.resendAsNew && (
        <Button size={size} variant="outline" onClick={prepararNovo} disabled={isPending}>
          <RotateCcw className="size-3.5" /> Reenviar como novo pacote
        </Button>
      )}
      {compacto && (
        <Button size={size} variant="ghost" nativeButton={false} render={<Link href={`/assinaturas/pacotes/${packageId}`} />}>
          <FileStack className="size-3.5" /> Detalhe
        </Button>
      )}

      {/* VISUALIZAR */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              {number} · {viewer?.kind === "signed" ? "PDF assinado" : "PDF enviado para assinatura"}
            </DialogTitle>
            <DialogDescription>
              {viewer?.kind === "signed"
                ? "O documento com as assinaturas e o registro da ZapSign."
                : "O documento como foi enviado. A versão assinada aparece aqui quando todos assinarem."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {viewer ? (
              <PdfViewer
                url={viewer.url}
                index={viewer.kind === "merged" ? comPaginas.map((i) => ({ title: i.title, firstPage: i.firstPage! })) : undefined}
                aside={signersAside}
              />
            ) : (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando o PDF…
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* REENVIAR */}
      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Reenviar o link · {number}</DialogTitle>
            <DialogDescription>Quem ainda falta assinar. O link é o mesmo do envio; a mensagem é a padrão das configurações.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!resend ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando…
              </p>
            ) : resend.signers.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Não há ninguém pendente com link para reenviar.</p>
            ) : (
              <LinksDeAssinatura
                links={resend.signers.map((s) => ({
                  key: s.id,
                  name: s.name,
                  qualification: s.qualification,
                  orderGroup: s.orderGroup,
                  notYet: !s.isTurn,
                  signUrl: s.signUrl,
                  phone: s.phone,
                  message: s.message,
                  lastNotifiedAt: s.lastNotifiedAt,
                }))}
                onUse={usouCanal}
              />
            )}
          </div>
          {resend?.zapsignEmail && (
            <DialogFooter>
              <Button variant="outline" onClick={reenviarPorEmail} disabled={isPending}>
                <Mail className="size-4" /> Reenviar pelo e-mail da ZapSign
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* CANCELAR */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="flex flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar o pacote {number}?</DialogTitle>
            <DialogDescription>
              O documento é cancelado também na ZapSign: os links param de funcionar e ninguém mais consegue assinar. O pacote não
              é apagado — fica na lista como Cancelado, com o motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`motivo-${packageId}`}>Motivo (obrigatório)</Label>
            <textarea
              id={`motivo-${packageId}`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ex.: paciente pediu para mudar a forma de pagamento"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={isPending}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={cancelar} disabled={isPending || !reason.trim()}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} Cancelar o pacote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REENVIAR COMO NOVO PACOTE */}
      <Dialog open={novoOpen} onOpenChange={fecharNovo}>
        <DialogContent className="flex max-h-[92vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{novo ? `Novo pacote ${novo.number}` : "Reenviar como novo pacote"}</DialogTitle>
            <DialogDescription>
              {novoEnviado
                ? "Enviado. Agora é entregar o link a cada pessoa."
                : `Os mesmos documentos e as mesmas pessoas de ${number}, com prazo novo. Confira o PDF e envie.`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!novo ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Montando o pacote novo…
              </p>
            ) : novoEnviado ? (
              <div className="space-y-3">
                <LinksDeAssinatura
                  links={novoEnviado.links.map((l, i) => ({
                    key: String(i),
                    name: l.name,
                    qualification: l.qualification,
                    orderGroup: l.order_group,
                    notYet: l.order_group !== 1,
                    signUrl: l.signUrl,
                    phone: l.phone,
                    message: l.message,
                  }))}
                />
                <Button variant="link" nativeButton={false} render={<Link href={`/assinaturas/pacotes/${novo.packageId}`} />}>
                  Abrir o pacote {novo.number}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {novo.pageCount} páginas · vale até {formatBrDate(novo.expiresAt)}
                  {novo.authReason ? ` · ${novo.authReason}` : ""}
                </p>
                <div className="h-[55vh]">
                  <PdfViewer url={novo.previewUrl} />
                </div>
              </div>
            )}
          </div>
          {novo && !novoEnviado && (
            <DialogFooter>
              <Button variant="outline" onClick={() => fecharNovo(false)} disabled={isPending}>
                Desistir
              </Button>
              <Button onClick={enviarNovo} disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar para assinatura
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
