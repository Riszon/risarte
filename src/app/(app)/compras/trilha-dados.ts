import type { SupabaseClient } from "@supabase/supabase-js";
import { contagemConfirmada } from "@/lib/contagem";

/**
 * O QUE ESPERA POR VOCÊ EM CADA ETAPA DA COMPRA.
 *
 * ⚠️ UMA CONTA SÓ, USADA POR TODAS AS TELAS DO FLUXO. A trilha aparece em cinco
 * telas; se cada uma montasse a própria consulta, bastaria alguém mexer numa
 * para a mesma etapa mostrar números diferentes conforme a tela de onde se
 * olha — e aí o número deixa de significar qualquer coisa. Mesma decisão do
 * custo de material (0216) e do painel da rede (FIN8.3).
 *
 * ⚠️ OS FILTROS SÃO OS DAS TELAS DE DESTINO, não filtros próprios. Régua
 * diferente da tela para onde o número leva é pior que número nenhum: a pessoa
 * clica em "2 esperando" e encontra três, ou nenhum.
 *
 * As duas contagens usam `head: true` — o banco devolve só o número, sem trazer
 * uma linha sequer.
 *
 * ⚠️ `null` = NÃO CONSEGUI CONTAR (AP11). Pedindo só a contagem, uma falha
 * volta `count: null`, às vezes sem erro nenhum. Antes isso virava zero, e a
 * trilha (e o Início) diziam que não havia nada para aprovar com itens
 * parados. Agora a etapa mostra "—" e a frase "Não foi possível contar agora."
 */
export async function contarEtapasDaCompra(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ aguardandoAprovacao: number | null; entregasAbertas: number | null }> {
  const [aprovacoes, entregas] = await Promise.all([
    supabase
      .from("purchase_allocations")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "pendente"),
    supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("status", ["aberto", "recebido_parcial"]),
  ]);

  return {
    aguardandoAprovacao: contagemConfirmada(aprovacoes),
    entregasAbertas: contagemConfirmada(entregas),
  };
}
