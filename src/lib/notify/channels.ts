import { toWhatsappNumber } from "@/lib/whatsapp";

/**
 * OS CANAIS PELOS QUAIS O LINK DE ASSINATURA CHEGA À PESSOA (plano ZS0 §5.4).
 *
 * Na ZS2 nenhum canal é automático: o riSZon monta o que a pessoa da clínica
 * dispara (abrir a conversa no WhatsApp com a mensagem pronta, copiar o link,
 * abrir o link no balcão para assinar agora). E-mail (Resend) entra na ZS3 e a
 * API do WhatsApp fica para depois — cada um é um arquivo novo aqui, atrás da
 * mesma forma. Regra pura, testada em `assinaturas-canais.test.ts`.
 */

export type ChannelId = "whatsapp_link" | "copy_link" | "sign_now" | "email" | "whatsapp_api";

export type ChannelOption = {
  id: ChannelId;
  label: string;
  /** O que abrir (WhatsApp, o próprio link). Ausente = copiar para a área de transferência. */
  href?: string;
  /** Por que o canal não está disponível para esta pessoa. */
  unavailable?: string;
};

export function canaisDoSignatario(input: {
  phone: string | null;
  signUrl: string;
  message: string;
}): ChannelOption[] {
  const number = toWhatsappNumber(input.phone);
  return [
    number
      ? {
          id: "whatsapp_link",
          label: "Abrir no WhatsApp",
          href: `https://wa.me/${number}?text=${encodeURIComponent(input.message)}`,
        }
      : { id: "whatsapp_link", label: "Abrir no WhatsApp", unavailable: "sem telefone com DDD" },
    { id: "copy_link", label: "Copiar o link" },
    { id: "sign_now", label: "Assinar agora", href: input.signUrl },
  ];
}
