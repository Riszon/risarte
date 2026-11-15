"use client";

/**
 * 4017 (19.28) — o termo da renegociação, na ficha: enviar pela ZapSign (com a
 * confirmação dos boletos que serão cancelados na assinatura e das cobranças
 * emitidas fora do riSZon), ver o pacote para reenviar, cancelar o acordo que
 * ainda não vale e anexar o termo assinado (exceção: Gerente ou Admin Master).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, FileSignature, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import type { RenegotiationRow } from "./receivables-loader";
import {
  anexarTermoAssinado,
  cancelarRenegociacaoPendente,
  confirmarCobrancasExternas,
  enviarTermo,
  lerEnvioDoTermo,
} from "./renegociacao-actions";

const data = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

type Externa = { charge_id: string; seq: number; vencimento: string; valor: number; nota: string | null };

export function TermoDaRenegociacao({
  clientId,
  r,
  podeGerir,
  podeEnviar,
}: {
  clientId: string;
  r: RenegotiationRow;
  /** Gerente da unidade ou Admin Master (cobrança externa e termo anexado). */
  podeGerir: boolean;
  /** Quem negociou, ou quem pode renegociar. */
  podeEnviar: boolean;
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [externas, setExternas] = useState<Externa[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<{ name: string; signUrl: string; message: string }[] | null>(null);

  const esperando = r.status === "aguardando_assinatura" || r.status === "aguardando_autorizacao";
  if (r.flow !== "assinatura") return null;

  if (!esperando) {
    if (["nao_assinada", "expirada", "cancelada_pagamento", "cancelada", "encerrada"].includes(r.status) && r.endReason) {
      return <p className="mt-1 text-[11px] text-muted-foreground">{r.endReason}</p>;
    }
    if (r.status === "aplicada" && r.signedVia) {
      return (
        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          Termo assinado {r.signedVia === "zapsign" ? "pela ZapSign" : "(termo impresso anexado)"}.
        </p>
      );
    }
    return null;
  }

  function enviar() {
    start(async () => {
      const c = await lerEnvioDoTermo({ renegotiationId: r.id });
      if (!c.ok) return void toast.error(c.error);
      if (c.vencido) return void toast.error("O prazo do termo venceu. Refaça a renegociação com o saldo de hoje.");
      if (c.externas.length > 0) {
        setExternas(c.externas);
        return;
      }
      const texto =
        c.boletos_vivos > 0
          ? `Quando o cliente assinar, ${c.boletos_vivos} boleto(s) já entregue(s) ao cliente serão cancelados. Enviar o termo?`
          : "Enviar o termo para o cliente assinar?";
      if (!window.confirm(texto)) return;
      const e = await enviarTermo({ clientId, renegotiationId: r.id });
      if (!e.ok) {
        if ("externas" in e && e.externas) setExternas(e.externas);
        return void toast.error(e.error);
      }
      setLinks(e.links.map((l) => ({ name: l.name, signUrl: l.signUrl, message: l.message })));
      toast.success(`Termo enviado (pacote ${e.number}). O prazo para assinar é ${data(r.signDeadline)}.`);
      router.refresh();
    });
  }

  function confirmarExternas() {
    start(async () => {
      const x = await confirmarCobrancasExternas({ clientId, renegotiationId: r.id, chargeIds: [...marcadas] });
      if (!x.ok) return void toast.error(x.error);
      toast.success("Confirmado. Agora o termo pode ser enviado.");
      setExternas(null);
      setMarcadas(new Set());
      router.refresh();
    });
  }

  function cancelar() {
    const motivo = window.prompt("Por que cancelar este acordo? Nada muda nas parcelas antigas.");
    if (!motivo) return;
    start(async () => {
      const x = await cancelarRenegociacaoPendente({ clientId, renegotiationId: r.id, motivo });
      if (!x.ok) return void toast.error(x.error);
      toast.success("Acordo cancelado. As parcelas antigas continuam valendo.");
      router.refresh();
    });
  }

  function anexar(file: File) {
    const texto = "Anexar este termo assinado aplica o acordo agora: as parcelas antigas são substituídas e os boletos delas são cancelados. Continuar?";
    if (!window.confirm(texto)) return;
    const f = new FormData();
    f.set("clientId", clientId);
    f.set("renegotiationId", r.id);
    f.set("arquivo", file);
    start(async () => {
      const x = await anexarTermoAssinado(f);
      if (!x.ok) return void toast.error(x.error);
      toast.success("Termo anexado e acordo aplicado. As cobranças novas estão sendo criadas.");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      {r.status === "aguardando_assinatura" && (
        <p className="text-[11px]">
          <strong>Aguardando assinatura</strong> até {data(r.signDeadline)}. Até lá, as parcelas antigas e os boletos delas
          continuam valendo.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {r.status === "aguardando_assinatura" && podeEnviar && !r.signaturePackageId && (
          <Button size="sm" className="h-7 text-[11px]" disabled={isPending} onClick={enviar}>
            <Send className="mr-1 size-3.5" />
            Enviar termo
          </Button>
        )}
        {r.signaturePackageId && (
          <a
            href={`/assinaturas/pacotes/${r.signaturePackageId}`}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium hover:border-primary hover:text-primary"
          >
            <FileSignature className="size-3.5" />
            Ver o termo (reenviar o link)
          </a>
        )}
        {r.status === "aguardando_assinatura" && podeGerir && (
          <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium hover:border-primary hover:text-primary">
            <Paperclip className="size-3.5" />
            Anexar termo assinado
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) anexar(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {podeEnviar && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={cancelar}>
            <X className="mr-1 size-3.5" />
            Cancelar acordo
          </Button>
        )}
      </div>

      {externas && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          <p>
            Estas cobranças foram emitidas fora do riSZon. Cancele cada uma no painel do Asaas antes de enviar o termo.
          </p>
          {externas.map((x) => (
            <label key={x.charge_id} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!podeGerir}
                checked={marcadas.has(x.charge_id)}
                onChange={(e) => {
                  const n = new Set(marcadas);
                  if (e.target.checked) n.add(x.charge_id);
                  else n.delete(x.charge_id);
                  setMarcadas(n);
                }}
              />
              Parcela {x.seq} · {data(x.vencimento)} · {formatBRL(x.valor)}
              {x.nota ? ` · ${x.nota}` : ""} — Cancelei no painel do Asaas
            </label>
          ))}
          {podeGerir ? (
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={isPending || marcadas.size !== externas.length}
              onClick={confirmarExternas}
            >
              Confirmar
            </Button>
          ) : (
            <p>Só o Gerente da unidade ou o Admin Master confirma. Peça a ele.</p>
          )}
        </div>
      )}

      {links && links.length > 0 && (
        <div className="space-y-1 rounded-lg border p-2 text-[11px]">
          <p className="font-semibold">Links de assinatura</p>
          {links.map((l) => (
            <div key={l.signUrl} className="flex items-center justify-between gap-2">
              <span>{l.name}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => {
                  void navigator.clipboard.writeText(l.message || l.signUrl);
                  toast.success("Mensagem com o link copiada.");
                }}
              >
                <Copy className="mr-1 size-3" />
                Copiar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
