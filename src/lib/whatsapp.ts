// Helpers para abrir uma conversa de WhatsApp com mensagem pré-preenchida.
// Envio manual (o usuário revisa e envia) — automação fica para a Fase 3.

/** Telefone brasileiro "(11) 99999-9999" → número wa.me (55 + DDD + número). */
export function toWhatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null; // sem DDD → inválido
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return digits;
}

/** Monta o link wa.me com a mensagem (troca {nome} pelo primeiro nome). */
export function whatsappLink(
  phone: string | null | undefined,
  message: string,
  fullName?: string
): string | null {
  const number = toWhatsappNumber(phone);
  if (!number) return null;
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const text = message.replace(/\{nome\}/gi, firstName);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export const DEFAULT_BIRTHDAY_MESSAGE =
  "Olá {nome}! 🎉 A equipe Risarte Odontologia deseja a você um feliz aniversário, com muita saúde e muitos sorrisos! Conte sempre com a gente. 😁";
