"use client";

import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBrDateTime } from "@/lib/dates";
import { canaisDoSignatario, type ChannelId } from "@/lib/notify/channels";

/**
 * OS LINKS DE ASSINATURA POR PESSOA, COM OS CANAIS (WhatsApp, copiar, assinar
 * agora). Um desenho só para a tela final do envio (ZS2), o "Reenviar" e o
 * "Reenviar como novo pacote" (ZS4). `onUse` avisa qual canal foi usado —
 * é como o reenvio grava `last_notified_at`.
 */

export type LinkDeAssinatura = {
  key: string;
  name: string;
  qualification: string;
  orderGroup: number;
  /** Ainda não é a vez desta pessoa (a ZapSign libera na ordem). */
  notYet: boolean;
  signUrl: string;
  phone: string | null;
  message: string;
  lastNotifiedAt?: string | null;
};

export function LinksDeAssinatura({
  links,
  onUse,
}: {
  links: LinkDeAssinatura[];
  onUse?: (key: string, channel: Exclude<ChannelId, "email" | "whatsapp_api">) => void;
}) {
  return (
    <div className="space-y-3">
      {links.map((l) => {
        const canais = canaisDoSignatario({ phone: l.phone, signUrl: l.signUrl, message: l.message });
        return (
          <div key={l.key} className="rounded-md border p-3 text-sm">
            <p className="font-medium">
              {l.orderGroup}º — {l.name} <span className="font-normal text-muted-foreground">({l.qualification})</span>
              {l.notYet && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  só depois do anterior
                </Badge>
              )}
            </p>
            {l.lastNotifiedAt !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {l.lastNotifiedAt ? `Último reenvio: ${formatBrDateTime(l.lastNotifiedAt)}` : "Ainda não reenviado"}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {canais.map((c) =>
                c.unavailable ? (
                  <Button key={c.id} size="sm" variant="outline" disabled title={c.unavailable}>
                    {c.label}
                  </Button>
                ) : c.id === "copy_link" ? (
                  <Button
                    key={c.id}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(l.message);
                        toast.success("Mensagem com o link copiada.");
                        onUse?.(l.key, "copy_link");
                      } catch {
                        toast.error("Não foi possível copiar. Selecione o link e copie à mão.");
                      }
                    }}
                  >
                    <Copy className="mr-1 size-3.5" /> {c.label}
                  </Button>
                ) : (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={c.id === "whatsapp_link" ? "default" : "outline"}
                    nativeButton={false}
                    render={<a href={c.href} target="_blank" rel="noopener noreferrer" />}
                    onClick={() => onUse?.(l.key, c.id as "whatsapp_link" | "sign_now")}
                  >
                    {c.id === "whatsapp_link" ? <MessageCircle className="mr-1 size-3.5" /> : <ExternalLink className="mr-1 size-3.5" />}
                    {c.label}
                  </Button>
                )
              )}
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{l.signUrl}</p>
          </div>
        );
      })}
    </div>
  );
}
