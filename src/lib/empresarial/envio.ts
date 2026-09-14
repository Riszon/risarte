// Risarte Empresarial — o pacote que vai para a empresa (fase 5 do funil).
//
// ⚠️ O SISTEMA NÃO ENVIA E-MAIL. Nunca enviou: quem manda e-mail é o ZapSign
// (contrato para assinar), e o WhatsApp é manual por decisão de projeto. O que
// existe aqui é o REGISTRO do envio e a mensagem PRONTA para o consultor
// disparar. Prometer envio automático seria dizer que o sistema faz algo que
// ele não faz — e ninguém descobriria até um cliente cobrar a proposta.
//
// Puro e testado; nada de banco.

import {
  DISPATCH_ITEM_LABELS,
  type DispatchItem,
} from "./constants";

/** Só o envio que inclui a PROPOSTA move o cartão (espelha o gatilho da 1010). */
export function moveParaFollowUp(itens: readonly DispatchItem[]): boolean {
  return itens.includes("PROPOSAL");
}

export type MensagemInput = {
  empresa: string;
  contato: string | null;
  itens: readonly DispatchItem[];
  consultor: string | null;
};

/**
 * A mensagem que o consultor vai enviar, já escrita.
 *
 * Em português de gente: nomeia o que vai junto, pede a confirmação de
 * recebimento e não promete prazo que ninguém combinou.
 */
export function montarMensagem(input: MensagemInput): string {
  const saudacao = input.contato?.trim()
    ? `Olá, ${input.contato.trim().split(/\s+/)[0]}!`
    : "Olá!";

  const lista = input.itens
    .map((i) => `• ${DISPATCH_ITEM_LABELS[i]}`)
    .join("\n");

  const assinatura = input.consultor?.trim()
    ? `\n\n${input.consultor.trim()}\nRisarte Empresarial`
    : "\n\nRisarte Empresarial";

  return (
    `${saudacao}\n\n` +
    `Conforme conversamos, seguem os materiais do Risarte Empresarial ` +
    `para a ${input.empresa}:\n\n${lista}\n\n` +
    `Qualquer dúvida sobre a proposta, é só me chamar por aqui. ` +
    `Pode confirmar o recebimento?${assinatura}`
  );
}

/**
 * O endereço que abre a conversa no WhatsApp com a mensagem pronta.
 *
 * Devolve `null` sem telefone — botão que abre o WhatsApp vazio é pior que
 * botão nenhum, porque parece que funcionou.
 */
export function linkDoWhatsApp(
  telefone: string | null,
  mensagem: string
): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  // Número brasileiro sem o código do país não abre a conversa certa.
  const comPais = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}`;
}

// -----------------------------------------------------------------------------
// Os dois selos do follow-up
// -----------------------------------------------------------------------------

export type Selos = {
  contractSignedAt: string | null;
  implantationPaidAt: string | null;
};

/**
 * O que ainda falta para o negócio virar ganho.
 *
 * A regra de ouro do projeto, aqui também: só é venda com **documento assinado
 * E pagamento confirmado**. Um selo só não fecha nada — contrato sem pagamento
 * é promessa, pagamento sem contrato é dinheiro sem amarração.
 */
export function faltaParaFechar(selos: Selos): string[] {
  const falta: string[] = [];
  if (!selos.contractSignedAt) falta.push("contrato assinado");
  if (!selos.implantationPaidAt) falta.push("boleto da implantação pago");
  return falta;
}

export function estaSelado(selos: Selos): boolean {
  return faltaParaFechar(selos).length === 0;
}
