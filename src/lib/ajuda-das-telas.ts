import { apelido } from "@/lib/markdown";

// A AJUDA DE CADA TELA (relato OC-00102, 15/10/2026).
//
// O dono pediu "um ícone de ajuda em cada tela para mostrar o passo a passo".
// Decisão dele: um PAINEL na própria tela (o botão ? da barra de cima), com os
// passos escritos para aquela tela — não só um atalho para o manual.
//
// ⚠️ ISTO É UM SEGUNDO TEXTO, E ELE PODE ENVELHECER SEPARADO DO MANUAL. As
// travas contra isso (`ajuda-das-telas.test.ts`):
//   - toda ajuda aponta a seção do manual que explica o mesmo assunto, e a
//     régua reprova se a seção não existir;
//   - toda rota daqui tem de existir em `src/app` — tela renomeada sem mexer
//     aqui reprova o portão.
// E a mesma disciplina do manual: só entra aqui o que está no código (os
// nomes dos botões são os da tela, conferidos um a um).
//
// Começa por COMPRAS (as telas do relato). Tela sem ajuda escrita mostra isso
// com honestidade e oferece o manual — nunca um passo a passo genérico.

export type AjudaDaTela = {
  /** A rota da tela, como no endereço. `[id]` vale para qualquer valor. */
  rota: string;
  titulo: string;
  /** Para que a tela existe, em uma frase. */
  paraQue: string;
  /** Quem faz o quê nesta tela. */
  quem: string;
  /** O passo a passo, na ordem do trabalho. Nomes de botão em **negrito**. */
  passos: string[];
  /** O que costuma confundir. */
  atencao?: string[];
  /** Onde o manual explica: a seção (##) e, se houver, o trecho (###). */
  manual: { secao: string; trecho?: string };
};

const FLUXO_COMPRAS = {
  secao: "8. Fluxos principais de uso",
  trecho: "Fluxo 5 — Compras: pedir, negociar, aprovar e receber",
};

export const AJUDAS: AjudaDaTela[] = [
  {
    rota: "/compras",
    titulo: "Compras — Pedir",
    paraQue:
      "Montar a lista do que falta na unidade e enviar à Franqueadora, que negocia por toda a rede.",
    quem:
      "Monta e envia: o gerente, o coordenador clínico ou o ASB da unidade (e o Admin). As outras funções que abrem esta tela só consultam.",
    passos: [
      "Clique em **Gerar lista de compras**: o sistema sugere o que está abaixo do mínimo no Estoque.",
      "Ajuste as quantidades. Faltou algo? **Acrescentar item** — um item do estoque ou uma linha livre (com a conta de despesa).",
      "Vai comprar por fora da rede? Marque **Compra local** antes de gerar a lista: fica registrado como compra local.",
      "Clique em **Enviar à Franqueadora**. A lista segue para a Mesa de negociação.",
    ],
    atencao: [
      "Enquanto não é enviada, a lista é um rascunho só da unidade: a Franqueadora passa a ver a partir do envio.",
      "**Cancelar lista** desiste dela.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/rodadas",
    titulo: "Mesa de negociação",
    paraQue:
      "Juntar as listas das unidades, cotar com os fornecedores e escolher de quem comprar cada item.",
    quem:
      "Comprador, Financeiro da Franqueadora e Admin. As unidades não veem as cotações.",
    passos: [
      "**Abrir rodada** com as listas que as unidades enviaram.",
      "Para cada fornecedor, **Incluir na cotação** e digitar o preço de cada item.",
      "Escolha o fornecedor de cada item. Se precisar, altere a quantidade — com o motivo, que a unidade vê ao aprovar.",
      "**Fechar rodada**: cada unidade recebe a sua parte para aprovar.",
    ],
    atencao: [
      "Preço em branco quer dizer que o fornecedor não cotou; zero é bonificação, e concorre.",
      "Item que ninguém cotou não trava a rodada: volta para a unidade como não negociado.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/aprovar",
    titulo: "Aprovar compra",
    paraQue:
      "Ver o que a rede negociou para a unidade e decidir: o que for aprovado vira pedido.",
    quem:
      "Quem aprova é quem paga: o gerente da unidade (e o Admin). Na compra da própria Franqueadora, o Financeiro da Franqueadora. Quem não decide vê, na coluna Decisão, quem decide.",
    passos: [
      "Confira cada item: o preço previsto, o negociado e a economia.",
      "**Aprovar** ou **Recusar** item a item. Recusar pede o motivo — a Franqueadora vê.",
      "Clique em **Gerar pedidos**: nasce um pedido por fornecedor, faturado e entregue na unidade.",
    ],
    atencao: [
      "Item sem decisão não vira pedido — o sistema não aprova sozinho.",
      "Item que já virou pedido não volta atrás por aqui: desfazer exige cancelar o pedido.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/receber",
    titulo: "Receber a entrega",
    paraQue:
      "Registrar a entrega: o material entra no estoque e a conta a pagar nasce sozinha.",
    quem:
      "Gerente da unidade, Financeiro da Franqueadora e Admin. O coordenador e o ASB montam a lista, mas não recebem: o recebimento cria a conta a pagar.",
    passos: [
      "Quando a entrega chegar, abra o pedido e confira pela nota fiscal.",
      "Informe, item a item, a quantidade que chegou e o preço da nota (e o lote, nos itens de estoque).",
      "Preencha a nota fiscal, a emissão, as parcelas e o 1º vencimento.",
      "Clique em **Registrar entrega**.",
    ],
    atencao: [
      "Vale o preço da NOTA, não o do pedido: a diferença fica registrada para a próxima negociação.",
      "Chegou só parte? Registre o que veio — o pedido continua aberto até chegar o resto.",
    ],
    manual: FLUXO_COMPRAS,
  },
  {
    rota: "/compras/painel",
    titulo: "Painel de compras",
    paraQue:
      "Ver quanto a negociação conjunta economizou e quanto foi comprado por fora da rede.",
    quem:
      "Gerente e franqueado veem a própria unidade; a Franqueadora vê a rede e pode escolher uma unidade.",
    passos: [
      "Escolha o período (**De** e **Até**) e, na Franqueadora, a unidade.",
      "Economia: o previsto comparado com o negociado, só nos itens que foram negociados.",
      "Comprado por fora: as compras locais e o que foi lançado direto no Estoque, sem pedido.",
    ],
    atencao: ["A economia é medida contra a PREVISÃO de preço da lista, não contra o mercado."],
    manual: FLUXO_COMPRAS,
  },
];

function casa(rota: string, caminho: string): boolean {
  const padrao = rota
    .split("/")
    .map((parte) => (/^\[.+\]$/.test(parte) ? "[^/]+" : parte.replace(/[.*+?^${}()|\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${padrao}$`).test(caminho);
}

/** A ajuda da tela deste endereço, ou `null` quando ainda não foi escrita. */
export function ajudaDaTela(caminho: string): AjudaDaTela | null {
  const limpo = caminho.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return AJUDAS.find((a) => casa(a.rota, limpo)) ?? null;
}

/** O endereço do manual aberto na seção (e rolado até o trecho) desta ajuda. */
export function linkDoManual(manual: AjudaDaTela["manual"]): string {
  const base = `/manual?secao=${apelido(manual.secao)}`;
  return manual.trecho ? `${base}#${apelido(manual.trecho)}` : base;
}
