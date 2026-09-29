import type { SessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { PedirIndicacaoDialog } from "./pedir-indicacao-dialog";
import { regulamentoVigente, unidadesParaIndicar } from "./dados";
import { SeloIndica } from "./aba-ficha";

/**
 * O selo (Embaixador / indicado por) e o botão único "Pedir indicação" da
 * ficha do cliente — o pedido e as pessoas indicadas na mesma janela, várias
 * de uma vez (o cliente da ficha é quem indica).
 *
 * Mora no módulo, não na ficha: a ficha é do núcleo e só ganha a linha que
 * chama este componente (regra dos arquivos compartilhados, CLAUDE.md §0).
 * Quem chama já conferiu a permissão (`canIndicar`).
 */
export async function IndicaNaFicha({
  session,
  cliente,
  unidadeId,
}: {
  session: SessionContext;
  cliente: { id: string; nome: string; codigo: string | null };
  unidadeId: string;
}) {
  const db = await indicaDb();
  const [{ data: emb, error }, unidades, regulamento] = await Promise.all([
    db
      .from("embaixadores")
      .select("id, codigo, status, niveis ( nome )")
      .eq("cliente_id", cliente.id)
      .maybeSingle<{ id: string; codigo: string; status: string; niveis: { nome: string } | null }>(),
    unidadesParaIndicar(session),
    regulamentoVigente(),
  ]);
  // Banco sem o módulo (migração/exposição pendente): a ficha segue sem os
  // botões em vez de quebrar.
  if (error) {
    console.error("indica na ficha:", error.message);
    return null;
  }

  return (
    <>
      <SeloIndica session={session} clienteId={cliente.id} />
      <PedirIndicacaoDialog
        cliente={{ id: cliente.id, nome: cliente.nome }}
        embaixador={emb ? { id: emb.id, codigo: emb.codigo, nivel: emb.niveis?.nome ?? null, ativo: emb.status === "ativo" } : null}
        unidades={unidades}
        unidadePadrao={unidadeId}
        regulamento={regulamento}
      />
    </>
  );
}
