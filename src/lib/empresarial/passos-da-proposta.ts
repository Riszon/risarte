// Risarte Empresarial — OS PASSOS DA ABA PROPOSTA (OC-00083).
//
// Relato do dono (24/09/2026): *"no funil do empresarial, a configuração da
// proposta ainda está muito confusa e uma lista longa. Faça um refinamento
// estético e que siga um fluxo que otimize o trabalho."*
//
// ⚠️ ELE ESTÁ CERTO, E DÁ PARA MEDIR. A aba tinha NOVE blocos numa coluna só,
// mais de quarenta campos e CINCO botões de salvar diferentes. Pior que o
// tamanho era a ordem:
//
//   1. como a proposta será montada (preços)
//   2. prazo e carência
//   3. A SIMULAÇÃO          ← no meio do formulário
//   4. dados do contrato
//   5. unidades
//   6. CONDIÇÕES COMERCIAIS ← as faixas de preço, DEPOIS da simulação
//   7. benefícios
//   8. texto
//
// Quem mexia numa faixa (bloco 6) tinha de rolar para cima até o bloco 3 para
// ver o efeito no valor. A resposta ficava longe da pergunta — e é isso que
// faz uma tela parecer confusa mesmo com cada bloco certo por dentro.
//
// Aqui ficam só os RÓTULOS e o RESUMO de cada passo. A conta de cada resumo é
// pura e testada: a tela não decide o que dizer, ela só desenha.

import { formatBRL } from "@/lib/pricing";
import type { SituacaoDaEtapa } from "./etapas-do-funil";

/**
 * A ORDEM É A DO TRABALHO, não a do banco de dados.
 *
 * Primeiro se decide o preço (e é aí que a simulação responde), depois o que
 * está incluso, depois os prazos, o texto e — por último — os dados
 * cadastrais, que só fazem falta na hora de gerar o documento.
 *
 * `contrato` no fim de propósito: razão social e CPF de quem assina não
 * mudam nada na negociação, e estavam no MEIO da precificação.
 */
export const PASSOS_DA_PROPOSTA = [
  "precos",
  "condicoes",
  "beneficios",
  "prazos",
  "texto",
  "contrato",
] as const;
export type PassoDaProposta = (typeof PASSOS_DA_PROPOSTA)[number];

export const PASSO_ROTULO: Record<PassoDaProposta, string> = {
  precos: "Quem paga e quanto",
  condicoes: "Condições comerciais",
  beneficios: "Benefícios e unidades",
  prazos: "Prazo e carência",
  texto: "Texto da proposta",
  contrato: "Dados do contrato",
};

export type DadosDosPassos = {
  /** Quantos titulares entram (0 = não informado). */
  titulares: number;
  /** Mensalidade por titular, em centavos. */
  mensalidadePorTitularCents: number | null;
  /** A cobrança é um valor fixo mensal, em vez de por titular. */
  valorFixo: boolean;
  /** Quem paga o programa já foi escolhido. */
  temQuemPaga: boolean;
  /** Quantas faixas de preço por quantidade existem. */
  faixas: number;
  minAdhesions: number | null;
  maxAdhesions: number | null;
  /** A regra do excedente foi combinada (I4). */
  temRegraDeExcedente: boolean;
  /** Quantos benefícios a proposta tem. */
  beneficios: number;
  /** Quantas unidades atendem a parceria (0 = nenhuma escolhida). */
  unidades: number;
  /** Validade própria desta proposta, em dias. Nulo = padrão da rede. */
  validadeDias: number | null;
  validadePadraoDaRede: number;
  carenciaEmpresaDias: number | null;
  carenciaTitularDias: number | null;
  /** O texto da proposta foi personalizado para esta empresa. */
  textoPersonalizado: boolean;
  /** Campos que ainda faltam para o contrato (régua de `proposta.ts`). */
  faltaContrato: readonly string[];
};

const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/**
 * O resumo de cada passo, para caber embaixo do rótulo.
 *
 * ⚠️ ZERO NÃO É "NÃO PREENCHIDO". Faixa nenhuma é uma decisão legítima (o
 * preço é um só); benefício nenhum também. Por isso o estado desses passos é
 * `pronto`, não `falta` — pintar de amarelo o que está certo é a forma mais
 * rápida de ensinar a equipe a ignorar avisos. Só `contrato` sabe de verdade
 * o que falta, porque tem uma régua (`faltaParaContrato`).
 */
export function resumoDosPassos(
  d: DadosDosPassos
): Record<PassoDaProposta, SituacaoDaEtapa> {
  return {
    precos: resumoDosPrecos(d),
    condicoes: resumoDasCondicoes(d),
    beneficios: resumoDosBeneficios(d),
    prazos: resumoDosPrazos(d),
    texto: {
      estado: "pronto",
      resumo: d.textoPersonalizado ? "texto próprio" : "modelo da rede",
    },
    contrato:
      d.faltaContrato.length === 0
        ? { estado: "feito", resumo: "completo" }
        : {
            estado: "falta",
            resumo:
              d.faltaContrato.length === 1
                ? `falta ${d.faltaContrato[0]}`
                : `faltam ${d.faltaContrato.length} campos`,
          },
  };
}

function resumoDosPrecos(d: DadosDosPassos): SituacaoDaEtapa {
  // Sem quem paga e sem valor, não há proposta nenhuma: este é o único passo
  // em que "vazio" é mesmo falta.
  if (!d.temQuemPaga && !d.mensalidadePorTitularCents && !d.valorFixo) {
    return { estado: "falta", resumo: "não começou" };
  }
  const partes: string[] = [];
  if (d.valorFixo) {
    partes.push("valor fixo mensal");
  } else if (d.mensalidadePorTitularCents) {
    partes.push(`${formatBRL(d.mensalidadePorTitularCents)} por titular`);
  } else {
    return { estado: "falta", resumo: "falta o valor" };
  }
  if (d.titulares > 0) {
    partes.push(`${d.titulares} ${d.titulares === 1 ? "titular" : "titulares"}`);
  }
  return { estado: "feito", resumo: partes.join(" · ") };
}

function resumoDasCondicoes(d: DadosDosPassos): SituacaoDaEtapa {
  const partes: string[] = [];
  if (d.faixas > 0) {
    partes.push(`${d.faixas} ${d.faixas === 1 ? "faixa" : "faixas"}`);
  }
  if (d.minAdhesions != null) partes.push(`mín. ${d.minAdhesions}`);
  if (d.maxAdhesions != null) partes.push(`máx. ${d.maxAdhesions}`);
  if (d.temRegraDeExcedente) partes.push("excedente combinado");
  if (partes.length === 0) return { estado: "pronto", resumo: "preço único" };
  // ⚠️ O MÁXIMO SEM REGRA DE EXCEDENTE É O CASO QUE DÓI DEPOIS (I4): a empresa
  // fecha com teto, quer incluir mais gente, e o termo de inclusão nasce sem
  // valor porque ninguém combinou quanto custa passar do teto. Avisar aqui é
  // barato; descobrir na hora de cobrar, não.
  if (d.maxAdhesions != null && !d.temRegraDeExcedente) {
    return { estado: "falta", resumo: `${partes.join(" · ")} · sem regra de excedente` };
  }
  return { estado: "feito", resumo: partes.join(" · ") };
}

function resumoDosBeneficios(d: DadosDosPassos): SituacaoDaEtapa {
  const partes: string[] = [];
  partes.push(
    d.beneficios === 0
      ? "sem benefício"
      : `${d.beneficios} ${d.beneficios === 1 ? "benefício" : "benefícios"}`
  );
  if (d.unidades > 0) {
    partes.push(`${d.unidades} ${d.unidades === 1 ? "unidade" : "unidades"}`);
  }
  return {
    estado: d.beneficios === 0 ? "pronto" : "feito",
    resumo: partes.join(" · "),
  };
}

function resumoDosPrazos(d: DadosDosPassos): SituacaoDaEtapa {
  const validade =
    d.validadeDias == null
      ? `${dias(d.validadePadraoDaRede)} (padrão)`
      : dias(d.validadeDias);
  const carencias: string[] = [];
  if (d.carenciaEmpresaDias != null) carencias.push(`empresa ${d.carenciaEmpresaDias}d`);
  if (d.carenciaTitularDias != null) carencias.push(`titular ${d.carenciaTitularDias}d`);
  return {
    estado: d.validadeDias == null && carencias.length === 0 ? "pronto" : "feito",
    resumo:
      carencias.length > 0 ? `${validade} · ${carencias.join(", ")}` : validade,
  };
}
