import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lerOrigem,
  type Indicador,
  type ResultadoDaContagem,
} from "@/lib/certificacao";

/**
 * A CONTAGEM — o que a pessoa fez no banco de TREINO desde o clique.
 *
 * Recebe o cliente do banco como parâmetro, em vez de criá-lo, por um motivo
 * só: dá para testar ESTA função contra o banco de treino de verdade, sem
 * passar pelas variáveis do servidor. Quem monta o cliente em produção é
 * `certificacao-servidor.ts`.
 *
 * ⚠️ CADA CONTAGEM É UMA FRASE COMPLETA, e todas as peças vêm do catálogo:
 *
 *   count(*) from <tabela>
 *    where <coluna do autor> = <pessoa no treino>
 *      and <coluna do QUANDO> >= <clique que começou a missão>
 *      and <filtros>
 *
 * A data é a da AÇÃO (checked_in_at para check-in, done_at para sessão), não
 * a de criação do registro: um agendamento criado ontem e com check-in feito
 * hoje é check-in de hoje. `npm run check:indicadores` confere as três peças
 * contra o banco — autor, data (que tem de ser instante) e filtros.
 */

/**
 * ⚠️ TEMPO-LIMITE: o banco de treino é OUTRO projeto. Se ele estiver lento, a
 * tela de Início de quem está em missão não pode ficar pendurada esperando —
 * ela desiste e diz "não consegui medir agora", que é verdade. Esperar para
 * sempre seria transformar um problema do treino num problema do sistema real.
 */
export const TEMPO_LIMITE_MS = 4000;

export async function contarAcao(
  treino: SupabaseClient,
  indicador: Indicador,
  pessoaNoTreino: string,
  desde: Date,
  tempoLimiteMs: number = TEMPO_LIMITE_MS
): Promise<ResultadoDaContagem> {
  const o = lerOrigem(indicador.origem);
  const base = o.schema === "public" ? treino : treino.schema(o.schema);

  let consulta = base
    .from(o.tabela)
    .select("*", { count: "exact", head: true })
    .eq(o.coluna, pessoaNoTreino)
    .gte(indicador.quando, desde.toISOString());

  for (const f of o.filtros) consulta = consulta.eq(f.coluna, f.valor);

  try {
    const { count, error, status } = await consulta.abortSignal(
      AbortSignal.timeout(tempoLimiteMs)
    );
    if (error) {
      // O tempo-limite NÃO chega como exceção: o cliente do Supabase o devolve
      // como erro comum, com `status: 0` e "TimeoutError" na mensagem (medido
      // contra o treino em 26/09/2026). Sem este caso, a tela diria "o banco
      // recusou" quando ele só estava lento — e alguém iria procurar permissão
      // errada onde não há nenhuma.
      if (status === 0 || /timeout|abort/i.test(error.message ?? "")) {
        return { ok: false, motivo: "o banco de treino demorou demais para responder" };
      }
      // O texto do banco pode repetir valores; guarda-se só o código — mesma
      // regra do espelho do treino (nunca a mensagem crua do Postgres).
      return { ok: false, motivo: `o banco de treino recusou (${error.code || "sem código"})` };
    }
    // ⚠️ ESTA GUARDA JÁ PROVOU QUE É NECESSÁRIA. Pedindo só a contagem
    // (`head: true`), uma TABELA QUE NÃO EXISTE volta com `error: null` e
    // `count: null` — sem erro nenhum (medido contra o treino em 26/09/2026).
    // O jeito "natural" de escrever, `count ?? 0`, faria um indicador quebrado
    // mostrar ZERO para sempre, e a conclusão de quem olha seria "a pessoa não
    // fez". É a régua vazia respondendo "não" (§0d do CLAUDE.md).
    if (count === null || count === undefined) {
      return { ok: false, motivo: "o banco de treino não devolveu a contagem" };
    }
    return { ok: true, feito: count };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    return {
      ok: false,
      motivo:
        nome === "TimeoutError" || nome === "AbortError"
          ? "o banco de treino demorou demais para responder"
          : "não foi possível falar com o banco de treino",
    };
  }
}

/**
 * Conta todos os critérios de uma missão, em paralelo. Um critério que falhar
 * não derruba os outros: a pessoa vê o que deu para medir e, separado, o que
 * não deu — nunca uma tela inteira de erro por causa de uma tabela.
 */
export async function medirMissao(
  treino: SupabaseClient,
  indicadores: readonly Indicador[],
  pessoaNoTreino: string,
  desde: Date,
  tempoLimiteMs: number = TEMPO_LIMITE_MS
): Promise<Record<string, ResultadoDaContagem>> {
  const pares = await Promise.all(
    indicadores.map(
      async (i) =>
        [i.chave, await contarAcao(treino, i, pessoaNoTreino, desde, tempoLimiteMs)] as const
    )
  );
  return Object.fromEntries(pares);
}
