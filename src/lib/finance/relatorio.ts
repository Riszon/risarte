// O MODELO DE RELATÓRIO — uma fonte, duas saídas (relato OC-00009).
//
// ⚠️ POR QUE ISTO EXISTE. A primeira entrega imprimia a TELA e montava a
// planilha à parte. Deu nos dois problemas que o dono relatou: o PDF saiu com
// a moldura do sistema dentro ("parecendo um print"), e a planilha saiu sem
// formatação. Pior que os dois: eram DUAS montagens da mesma informação, e
// duas montagens divergem na primeira mudança.
//
// Aqui o relatório é um DADO — título, metadados, resumo, colunas, linhas,
// totais e notas. Quem desenha é outro: a página de impressão e o gerador de
// planilha leem o mesmo modelo. Um número que mude, muda nos dois.
//
// Puro e testado: nada de banco, nada de React, nada de ExcelJS.

export type TipoDeColuna = "texto" | "dinheiro" | "numero" | "data";

export type ColunaDoRelatorio = {
  chave: string;
  titulo: string;
  tipo: TipoDeColuna;
  /** Entra na linha de TOTAL no rodapé. Só faz sentido em número e dinheiro. */
  somar?: boolean;
  /** Largura da coluna na planilha, em caracteres. */
  largura?: number;
};

export type LinhaDoRelatorio = Record<string, string | number | null>;

export type RelatorioPronto = {
  titulo: string;
  subtitulo: string | null;
  /** Unidade, período, quem gerou, quando. */
  metadados: { rotulo: string; valor: string }[];
  /** Os números de destaque, no alto do documento. */
  resumo: { rotulo: string; valor: string }[];
  /**
   * A frase da margem. Fica separada do resumo de propósito: é a única linha
   * do relatório que emite um JUÍZO, e ela precisa de lugar próprio para
   * ninguém confundi-la com mais um número.
   */
  situacao: string | null;
  colunas: ColunaDoRelatorio[];
  linhas: LinhaDoRelatorio[];
  /** Os limites declarados — o que o relatório NÃO diz. */
  notas: string[];
  /** Nome do arquivo, sem extensão. */
  nomeDoArquivo: string;
};

/**
 * Os totais do rodapé, por coluna marcada com `somar`.
 *
 * ⚠️ SOMA O QUE ESTÁ NO RELATÓRIO, não o que está no banco. Quando há filtro
 * de período, o total é o do recorte — e o documento tem de dizer isso, que é
 * papel da nota de rodapé. Somar o banco inteiro aqui faria a linha de total
 * discordar das linhas logo acima dela.
 */
export function totaisDoRelatorio(
  relatorio: RelatorioPronto
): Record<string, number> {
  const totais: Record<string, number> = {};
  for (const coluna of relatorio.colunas) {
    if (!coluna.somar) continue;
    totais[coluna.chave] = relatorio.linhas.reduce((soma, linha) => {
      const v = linha[coluna.chave];
      return soma + (typeof v === "number" ? v : 0);
    }, 0);
  }
  return totais;
}

/** Formata uma célula para LEITURA (papel e tela). Centavos viram reais. */
export function celulaEmTexto(
  valor: string | number | null,
  tipo: TipoDeColuna,
  formatarDinheiro: (cents: number) => string,
  formatarData: (iso: string) => string
): string {
  // ⚠️ VAZIO É TRAÇO, NUNCA ZERO. "R$ 0,00" numa coluna que não se aplica
  // àquela linha seria uma afirmação sobre dinheiro que ninguém fez.
  if (valor === null || valor === "") return "—";
  if (tipo === "dinheiro") {
    return typeof valor === "number" ? formatarDinheiro(valor) : String(valor);
  }
  if (tipo === "data") return formatarData(String(valor));
  return String(valor);
}

/**
 * O valor para a PLANILHA. Dinheiro vira número em reais (com centavos), para
 * o Excel somar sozinho — texto "R$ 1.234,56" não soma, e foi exatamente o que
 * a primeira versão exportou.
 */
export function celulaParaPlanilha(
  valor: string | number | null,
  tipo: TipoDeColuna
): string | number | Date | null {
  if (valor === null || valor === "") return null;
  if (tipo === "dinheiro" && typeof valor === "number") return valor / 100;
  // ⚠️ DATA VIRA DATA, NÃO TEXTO. Guardada como veio ("2026-09-11"), a planilha
  // mostrava o formato do banco no meio de um relatório em português, e a
  // coluna ordenava como texto — "10/02" antes de "09/03". Vira data de
  // verdade, e o formato brasileiro fica a cargo da própria planilha.
  //
  // Montada em UTC de propósito: aqui não há hora nenhuma, e deixar o fuso da
  // máquina entrar faria a data andar um dia para trás no servidor.
  if (tipo === "data") return dataDaPlanilha(valor);
  return valor;
}

/** "2026-09-11" → 11/09/2026 às 00:00 UTC. Texto ilegível volta como texto. */
function dataDaPlanilha(valor: string | number): string | Date {
  const texto = String(valor);
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!partes) return texto;
  const [, ano, mes, dia] = partes;
  const data = new Date(
    Date.UTC(Number(ano), Number(mes) - 1, Number(dia))
  );
  return Number.isNaN(data.getTime()) ? texto : data;
}

/** O formato de número que cada tipo pede na planilha. */
export function formatoDaColuna(tipo: TipoDeColuna): string | undefined {
  if (tipo === "dinheiro") return 'R$ #,##0.00';
  if (tipo === "numero") return "#,##0";
  if (tipo === "data") return "dd/mm/yyyy";
  return undefined;
}

/** Letra da coluna do Excel (1 → A, 27 → AA). */
export function letraDaColuna(indice1: number): string {
  let n = indice1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}
