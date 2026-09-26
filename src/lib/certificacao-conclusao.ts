// A CONCLUSÃO DA MISSÃO (0281) — a parte pura: quando registrar, o que guardar
// e o que dizer. Quem grava é o servidor (`registrarSeCumprida`), com a chave
// de serviço, depois de medir.

import type { Medicao, ProgressoDaMissao } from "@/lib/certificacao";

/** O que o banco devolve ao registrar ou aprovar. */
export const RESULTADOS_DA_CONCLUSAO = [
  "liberado",
  "porta_fechada",
  "aguardando_aprovacao",
  "ja_registrado",
] as const;
export type ResultadoDaConclusao = (typeof RESULTADOS_DA_CONCLUSAO)[number];

export function ehResultadoDaConclusao(v: unknown): v is ResultadoDaConclusao {
  return typeof v === "string" && (RESULTADOS_DA_CONCLUSAO as readonly string[]).includes(v);
}

/**
 * Registrar a conclusão? SÓ com a missão medida E cumprida.
 *
 * ⚠️ "Não deu para medir" NUNCA registra (lei da Etapa 2): o banco de treino
 * fora do ar não pode abrir o sistema real para ninguém. `cumprida` já exige
 * todos os critérios medidos — conferir o estado aqui é a segunda trava, para
 * uma mudança em `progressoDaMissao` não abrir o portão sem ninguém notar.
 */
export function deveRegistrarConclusao(medicao: Medicao | null | undefined): boolean {
  return (
    medicao?.estado === "medido" &&
    medicao.progresso.cumprida &&
    medicao.progresso.semMedida === 0 &&
    medicao.progresso.itens.length > 0 &&
    medicao.progresso.itens.every((i) => i.feito !== null && i.feito >= i.minimo)
  );
}

/**
 * O retrato guardado na matrícula e no certificado: os números de cada
 * critério NO MOMENTO da conclusão. É o que o Admin vê para aprovar, e o que
 * sobrevive a uma limpeza do treino (certificado é fato histórico — 0273).
 */
export function retratoDaMedicao(p: ProgressoDaMissao, agora: Date) {
  return {
    medido_em: agora.toISOString(),
    itens: p.itens.map((i) => ({
      chave: i.chave,
      rotulo: i.rotulo,
      minimo: i.minimo,
      feito: i.feito,
    })),
  };
}

export type ItemDoRetrato = { chave: string; rotulo: string; minimo: number; feito: number | null };

/** Lê o retrato que veio do banco — sem confiar no formato. */
export function lerRetrato(v: unknown): ItemDoRetrato[] {
  const itens = (v as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      chave: String(i.chave ?? ""),
      rotulo: String(i.rotulo ?? i.chave ?? ""),
      minimo: Number(i.minimo ?? 0),
      feito: typeof i.feito === "number" ? i.feito : null,
    }));
}

/** O recado para a pessoa, depois do registro. */
export function recadoDaConclusao(r: ResultadoDaConclusao): string {
  switch (r) {
    case "liberado":
    case "ja_registrado":
      return "Missão cumprida! O sistema real está liberado nas unidades onde você tem esta função. Se a unidade estiver numa turma coletiva, ela abre quando o grupo todo cumprir.";
    case "aguardando_aprovacao":
      return "Missão cumprida! Agora o Admin confere os seus números e aprova — o sistema real abre em seguida.";
    case "porta_fechada":
      return "Missão cumprida e certificação registrada. O acesso ao sistema real depende de uma liberação do Admin na sua ficha.";
  }
}
