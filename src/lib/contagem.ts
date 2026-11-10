/**
 * ⚠️ CONTAGEM QUE NÃO CONSEGUIU CONTAR NÃO É ZERO (AP11, 26/09/2026).
 *
 * O Supabase responde a um pedido de contagem (`count: "exact", head: true`)
 * com `count: null` em dois casos que NÃO são "não há nenhum":
 *
 *   1. quando a consulta dá erro (rede, tempo-limite, permissão) — o erro vem
 *      em `error`, mas quem só lê `count` não vê;
 *   2. quando a TABELA NÃO EXISTE — aí nem erro vem: `error: null` e
 *      `count: null`, medido contra o banco de treino em 26/09/2026.
 *
 * O jeito natural de escrever, `count ?? 0`, transforma os dois em ZERO. Numa
 * tela, isso mostra um número errado. Numa TRAVA, é pior: "já existe cobrança
 * deste mês?" vira "não" e a empresa é cobrada duas vezes; "quantos titulares
 * já estão ativos?" vira "zero" e o teto contratado deixa de valer.
 *
 * É a régua vazia respondendo "não" (§0d do CLAUDE.md), no lugar onde ela
 * custa dinheiro. **Guarda que não consegue conferir tem de FECHAR, não
 * abrir** — mesma lição do AP9, a trava escrita com `<>` sobre valor nulo.
 *
 * Como usar:
 *
 *   const n = contagemConfirmada(await supabase.from(...).select(..., {
 *     count: "exact", head: true }));
 *   if (n === null) return { ok: false, error: naoConseguiConferir("...") };
 *
 * E quando zero FOR mesmo a resposta aceitável (ordem de exibição, um contador
 * na tela), escreva `contagemConfirmada(r) ?? 0` — a escolha fica visível no
 * código, em vez de escondida num `count ?? 0` que parece inofensivo.
 */
export function contagemConfirmada(r: {
  count: number | null;
  error: unknown;
}): number | null {
  if (r.error) return null;
  return typeof r.count === "number" && Number.isFinite(r.count) ? r.count : null;
}

/**
 * A MESMA REGRA, PARA AS TELAS (AP11, a parte que tinha sobrado).
 *
 * Numa tela de pendências a consulta nem sempre é feita: quem não tem o papel
 * daquele cartão recebe `null` no lugar da consulta. São duas ausências
 * diferentes, e só uma delas é zero:
 *
 *   - consulta NÃO PEDIDA (`null`/`undefined`) → 0. É zero por construção:
 *     aquele número não é desta pessoa, e o cartão não deve existir para ela;
 *   - consulta pedida que FALHOU (erro ou `count: null`) → `null`, que a tela
 *     mostra como "—" e "não foi possível contar agora". Antes virava 0, e o
 *     Início dizia "Nada esperando por você" com trabalho parado.
 */
export function contagemDaTela(
  r: { count: number | null; error: unknown } | null | undefined
): number | null {
  if (r === null || r === undefined) return 0;
  return contagemConfirmada(r);
}

/**
 * Soma de contagens em que alguma pode ter falhado (a boia de relatos junta a
 * daqui e a do treino). O total é o que DEU para contar; `incompleta` diz que
 * pode haver mais. Devolver só o total esconderia a falha; devolver `null`
 * jogaria fora a parte que se sabe.
 */
export function somarContagens(partes: readonly (number | null)[]): {
  total: number;
  incompleta: boolean;
} {
  let total = 0;
  let incompleta = false;
  for (const p of partes) {
    if (p === null) incompleta = true;
    else total += p;
  }
  return { total, incompleta };
}

/** O que a tela põe no lugar do número quando não conseguiu contar. */
export const SEM_CONTAGEM = "—";

/** A frase curta que acompanha o "—". Uma só, para todas as telas. */
export const NAO_FOI_POSSIVEL_CONTAR = "Não foi possível contar agora.";

/**
 * A frase de quando a trava não conseguiu conferir. Diz as duas coisas que a
 * pessoa precisa saber: o que não deu para conferir, e que NADA foi feito —
 * sem isso ela não sabe se precisa desfazer alguma coisa antes de tentar de
 * novo.
 */
export function naoConseguiConferir(oQue: string): string {
  return `Não foi possível conferir ${oQue} agora. Nada foi alterado — tente de novo em instantes.`;
}
