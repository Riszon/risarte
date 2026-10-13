// LER TUDO, NÃO SÓ AS PRIMEIRAS MIL LINHAS.
//
// ⚠️ A API do banco devolve NO MÁXIMO 1.000 linhas por chamada — tabela ou
// função, pedindo ou não um limite maior (medido em 13/10/2026: 1.212 linhas
// existentes, 1.000 devolvidas, sem erro e sem aviso). Quem soma o que recebeu
// mostra um total CORTADO com cara de certo.
//
// O relatório de atividade (0289) nasceu assim: 30 pessoas × 40 dias já
// passam de mil linhas pessoa×dia. Aqui a leitura segue em páginas até a
// página vir incompleta — que é o único jeito de saber que acabou.
//
// A ordem TEM de ser estável (a consulta precisa de um `order by` que não
// empate): página lida sobre ordem que muda repete umas linhas e pula outras.

export const LINHAS_POR_PAGINA = 1000;
/** Trava de segurança: nenhuma tela deste sistema precisa de mais que isto. */
export const MAXIMO_DE_PAGINAS = 200;

export type Pagina<T> = {
  data: T[] | null;
  error: { message: string; code?: string } | null;
};

export type TudoLido<T> =
  | { ok: true; linhas: T[]; paginas: number }
  | { ok: false; error: { message: string; code?: string } };

/**
 * Chama `buscar(de, ate)` (índices inclusivos, como o `.range()` da API) até a
 * página vir com menos linhas que o tamanho pedido.
 *
 * Erro em QUALQUER página devolve erro — nunca o que deu para ler até ali:
 * metade de um relatório é pior que nenhum, porque parece inteiro.
 */
export async function lerTodasAsPaginas<T>(
  buscar: (de: number, ate: number) => PromiseLike<Pagina<T>>,
  tamanho: number = LINHAS_POR_PAGINA
): Promise<TudoLido<T>> {
  const linhas: T[] = [];
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const de = pagina * tamanho;
    const { data, error } = await buscar(de, de + tamanho - 1);
    if (error) return { ok: false, error };
    const parte = data ?? [];
    linhas.push(...parte);
    if (parte.length < tamanho) return { ok: true, linhas, paginas: pagina + 1 };
  }
  return {
    ok: false,
    error: {
      message: `Mais de ${MAXIMO_DE_PAGINAS * tamanho} linhas: a leitura foi interrompida.`,
    },
  };
}
