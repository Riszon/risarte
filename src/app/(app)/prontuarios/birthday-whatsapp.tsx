"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_BIRTHDAY_MESSAGE,
  toWhatsappNumber,
  whatsappLink,
} from "@/lib/whatsapp";

export type BirthdayContact = {
  id: string;
  fullName: string;
  phone: string | null;
};

/**
 * H3.8: parabenizar aniversariantes por WhatsApp (envio manual). Uma mensagem
 * personalizável ({nome} vira o primeiro nome) + um botão por cliente
 * (individual) e a lista toda (em massa, clicando um a um).
 */
export function BirthdayWhatsApp({ clients }: { clients: BirthdayContact[] }) {
  const [message, setMessage] = useState(DEFAULT_BIRTHDAY_MESSAGE);
  const withPhone = clients.filter((c) => toWhatsappNumber(c.phone));

  if (clients.length === 0) return null;

  function open(c: BirthdayContact) {
    const link = whatsappLink(c.phone, message, c.fullName);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-2 rounded-md border border-gold/40 bg-gold/5 p-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-4 text-green-600" />
        <Label className="text-sm font-medium">
          Parabenizar por WhatsApp
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Personalize a mensagem abaixo (<code>{"{nome}"}</code> vira o primeiro
        nome) e clique no cliente para abrir o WhatsApp já com o texto pronto —
        você confere e envia.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
      />
      <div className="flex flex-wrap gap-1.5">
        {withPhone.map((c) => (
          <Button
            key={c.id}
            type="button"
            size="sm"
            variant="outline"
            className="border-green-300 text-green-700 hover:bg-green-50"
            onClick={() => open(c)}
          >
            <MessageCircle className="mr-1 size-3.5" />
            {c.fullName.split(/\s+/)[0]}
          </Button>
        ))}
      </div>
      {withPhone.length < clients.length && (
        <p className="text-[11px] text-muted-foreground">
          {clients.length - withPhone.length} aniversariante(s) sem telefone
          válido não aparecem acima.
        </p>
      )}
    </div>
  );
}

/** Botão único de WhatsApp de aniversário — usado no prontuário do cliente. */
export function BirthdayWhatsAppButton({
  fullName,
  phone,
}: {
  fullName: string;
  phone: string | null;
}) {
  const link = whatsappLink(phone, DEFAULT_BIRTHDAY_MESSAGE, fullName);
  if (!link) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      nativeButton={false}
      className="border-green-300 text-green-700 hover:bg-green-50"
      render={<a href={link} target="_blank" rel="noopener noreferrer" />}
    >
      <MessageCircle className="mr-1 size-3.5" />
      Parabenizar no WhatsApp
    </Button>
  );
}
