import type { TemplateBody, TemplateSection } from "@/lib/signatures/types";
import {
  LINHA_EM_BRANCO,
  paragrafosDoBloco,
  preencher,
  trechos,
  type ModeloDeContrato,
} from "./contrato";

/**
 * O CONTRATO DE ADESÃO VIRA O TEXTO DO PDF DE ASSINATURA (ZS5, plano ZS0 §4.6).
 *
 * A tela `/empresarial/funil/[leadId]/contrato` monta o contrato a partir do
 * modelo do banco e da proposta salva. Esta regra pura pega o MESMO resultado
 * (o modelo, os valores de `montarContrato` e a lista do Anexo I) e o põe na
 * forma que o PDF da assinatura desenha: preâmbulo, uma seção por cláusula,
 * o fecho com a cidade e a data, e o Anexo I como seção própria.
 *
 * Duas diferenças de propósito em relação à tela:
 *   * O PDF não tem negrito: o `**assim**` do modelo sai como texto corrido.
 *   * As linhas de assinatura do papel NÃO entram: o PDF desenha as caixas de
 *     assinatura da ZapSign no fim, uma por signatário.
 */

export type BeneficioDoAnexo = {
  nome: string;
  unidades: string | null;
  cobertura: string;
  paraQuem: string;
  limite: string;
  carencia: string;
};

export type AnexoDoContrato = {
  carenciaDoProgramaDias: number | null;
  carenciaDoTitularDias: number | null;
  beneficios: BeneficioDoAnexo[];
  /** "Pagamento do tratamento: …" já em frase (`textoDoPagamento`). */
  pagamento: string;
  /** Nulo = a empresa não participa do Riso+ Social. */
  social: { metas: string[] } | null;
  vantagens: string[];
};

export const TITULO_DO_ANEXO = "Anexo I — Rol de procedimentos, cobertura e carências";

/** Tira a marcação `**…**` (o PDF não tem negrito no corpo). */
export function semMarcacao(texto: string): string {
  return trechos(texto)
    .map((t) => t.texto)
    .join("");
}

export function corpoDoContratoParaAssinatura(input: {
  modelo: ModeloDeContrato;
  valores: Readonly<Record<string, string | null | undefined>>;
  anexo: AnexoDoContrato;
}): { titulo: string; body: TemplateBody } {
  const v = input.valores;
  const texto = (t: string) => semMarcacao(preencher(t, v));

  const sections: TemplateSection[] = input.modelo.blocos.map((b) => ({
    title: "",
    body: paragrafosDoBloco(b)
      .map((p) => [p.rotulo, texto(p.texto)].filter(Boolean).join(" "))
      .join("\n\n"),
  }));
  sections.push({ title: TITULO_DO_ANEXO, body: textoDoAnexo(input.anexo) });

  const local = `${v.cidade_assinatura?.trim() || LINHA_EM_BRANCO}, ${v.data_assinatura?.trim() || LINHA_EM_BRANCO}.`;
  const fecho = [texto(input.modelo.fecho).trim(), local].filter(Boolean).join("\n\n");

  return {
    titulo: texto(input.modelo.titulo).trim() || "Contrato de adesão",
    body: { preamble: texto(input.modelo.preambulo), sections, closing: fecho },
  };
}

export function textoDoAnexo(a: AnexoDoContrato): string {
  const partes: string[] = [
    "Procedimentos, cobertura, limite de uso e carência combinados na proposta comercial desta parceria.",
  ];
  const carencias: string[] = [];
  if ((a.carenciaDoProgramaDias ?? 0) > 0) {
    carencias.push(`Carência do programa: ${a.carenciaDoProgramaDias} dia(s), contados do início do contrato.`);
  }
  if ((a.carenciaDoTitularDias ?? 0) > 0) {
    carencias.push(`Carência de cada titular: ${a.carenciaDoTitularDias} dia(s), contados da entrada dele no programa.`);
  }
  if (carencias.length) partes.push(carencias.join("\n"));

  if (a.beneficios.length === 0) {
    partes.push("Nenhum procedimento foi combinado na proposta desta empresa.");
  } else {
    partes.push(
      a.beneficios
        .map(
          (b) =>
            `• ${b.nome}${b.unidades ? ` (${b.unidades})` : ""}: cobertura ${b.cobertura}; para ${b.paraQuem}; limite de uso: ${b.limite}; carência: ${b.carencia}.`
        )
        .join("\n")
    );
  }

  partes.push(`Pagamento do tratamento: ${a.pagamento}, somado às condições da unidade.`);

  if (a.social) {
    partes.push(
      a.social.metas.length > 0
        ? [
            "Riso+ Social: enquanto pagar, integral ou parcialmente, a mensalidade dos Titulares, a CONTRATANTE poderá indicar pessoas carentes para tratamento, conforme as metas abaixo (em cada uma, todas as condições ao mesmo tempo):",
            ...a.social.metas.map((m, i) => `${i + 1}. ${m}`),
          ].join("\n")
        : "Riso+ Social: enquanto pagar, integral ou parcialmente, a mensalidade dos Titulares, a CONTRATANTE poderá indicar pessoas carentes para tratamento, em quantidade combinada com a CONTRATADA."
    );
  }

  if (a.vantagens.length > 0) {
    partes.push(["Outras vantagens:", ...a.vantagens.map((t) => `• ${t}`)].join("\n"));
  }

  return partes.join("\n\n");
}
