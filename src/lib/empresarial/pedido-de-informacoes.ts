// Risarte Empresarial — PEDIR À EMPRESA O QUE FALTA (dono, 09/11/2026).
//
// Pedido: *"quando está montando a proposta e o contrato, este botão deve
// enviar uma mensagem no whatsapp para solicitar as informações que faltam
// para poder finalizar o documento."*
//
// ⚠️ UMA RÉGUA SÓ. O que falta vem de `faltaParaContrato` — a mesma que liga
// os botões da proposta e do contrato — mais os campos que só o contrato usa.
// A mensagem e a tela nunca discordam sobre o que está faltando.
//
// ⚠️ SÓ VAI NA MENSAGEM O QUE A EMPRESA RESPONDE. "Quem paga o programa" e
// "como será cobrado" são decisões da negociação: pedi-las à empresa seria
// devolver a ela o que cabe a nós decidir. Elas ficam na tela, para quem monta.

import { enderecoEmLinha } from "./contrato";
import { faltaParaContrato, type DadosDaProposta } from "./proposta";
import type { CompanyAddress } from "./types";

/** As pendências da régua comum, e como cada uma é pedida à empresa. */
const PERGUNTAS: Record<string, string | null> = {
  "quantos titulares entram": "Quantos colaboradores (titulares) vão entrar no programa",
  "quem paga o programa": null,
  "como será cobrado": null,
  "razão social": "Razão social da empresa",
  "CNPJ completo": "CNPJ da empresa",
  "quem assina pela empresa": "Nome completo de quem vai assinar o contrato",
  "CPF de quem assina": "CPF de quem vai assinar",
  "e-mail de quem assina": "E-mail de quem vai assinar",
};

export type DadosDoPedido = DadosDaProposta & {
  /**
   * Os campos que só o contrato usa. AUSENTE (`undefined`) = esta tela não
   * conhece o campo, e ele não é cobrado; NULO = conhecido e vazio.
   */
  responsibleRole?: string | null;
  address?: CompanyAddress | null;
  responsibleRg?: string | null;
  responsibleNationality?: string | null;
  dueDay?: number | null;
};

export type PendenciasDoPedido = {
  /** O que vai na mensagem, já em forma de pedido. */
  daEmpresa: string[];
  /** O que falta e é decisão nossa — fica na tela, fora da mensagem. */
  nossas: string[];
};

const vazio = (v: string | null | undefined) => !v?.trim();

export function pendenciasDoPedido(d: DadosDoPedido): PendenciasDoPedido {
  const daEmpresa: string[] = [];
  const nossas: string[] = [];
  for (const falta of faltaParaContrato(d)) {
    const pergunta = PERGUNTAS[falta];
    if (pergunta) daEmpresa.push(pergunta);
    // Pendência que a régua conhece e o pedido não: é nossa até alguém dizer
    // como pedi-la — melhor fora da mensagem que uma pergunta inventada.
    else nossas.push(falta);
  }
  if ("responsibleRole" in d && vazio(d.responsibleRole)) {
    daEmpresa.push("Cargo de quem vai assinar");
  }
  if ("responsibleRg" in d && vazio(d.responsibleRg)) {
    daEmpresa.push("RG de quem vai assinar");
  }
  if ("responsibleNationality" in d && vazio(d.responsibleNationality)) {
    daEmpresa.push("Nacionalidade de quem vai assinar");
  }
  if ("address" in d && !enderecoEmLinha(d.address)) {
    daEmpresa.push("Endereço completo da sede, com CEP");
  }
  if ("dueDay" in d && d.dueDay == null) {
    daEmpresa.push("Dia preferido para o vencimento da mensalidade (de 1 a 28)");
  }
  return { daEmpresa, nossas };
}

/** A mensagem pronta, editável na tela antes de abrir o WhatsApp. */
export function mensagemDoPedido(e: {
  contato: string | null;
  empresa: string;
  consultor: string | null;
  perguntas: readonly string[];
}): string {
  const primeiroNome = e.contato?.trim().split(/\s+/)[0];
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}! Tudo bem?` : "Olá! Tudo bem?";
  const lista = e.perguntas.map((p) => `• ${p}`).join("\n");
  const assinatura = e.consultor?.trim()
    ? `${e.consultor.trim()} — Risarte Empresarial`
    : "Risarte Empresarial";
  return (
    `${saudacao}\n\n` +
    `Para finalizar a proposta e o contrato do Risarte Empresarial para a ${e.empresa}, ` +
    `preciso de algumas informações:\n\n${lista}\n\n` +
    `Assim que me enviar, preparo o documento. Obrigado!\n\n${assinatura}`
  );
}

/** O que fica no Histórico da empresa ao abrir o WhatsApp. */
export function anotacaoDoPedido(perguntas: readonly string[]): string {
  // Minúscula só no começo de palavra comum: "RG" e "CNPJ" ficam como são.
  const minuscula = (p: string) =>
    p.length > 1 && p[1] === p[1].toLowerCase() ? p.charAt(0).toLowerCase() + p.slice(1) : p;
  return `Pedido de informações enviado pelo WhatsApp: ${perguntas.map(minuscula).join("; ")}.`;
}
