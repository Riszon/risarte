import type { SessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { Button } from "@/components/ui/button";
import { PediIndicacaoDialog } from "./pedi-indicacao-dialog";
import { NovaIndicacaoDialog } from "./nova-indicacao-dialog";
import { regulamentoVigente, unidadesParaIndicar } from "./dados";
import { SeloIndica } from "./aba-ficha";

/**
 * O selo (Embaixador / indicado por) e os dois botões do Indica +Risos na
 * ficha do cliente: "Pedi indicação" e
 * "Nova indicação" (com o cliente da ficha como quem indica).
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
      <PediIndicacaoDialog clienteId={cliente.id} clienteNome={cliente.nome} unidadeId={unidadeId} />
      <NovaIndicacaoDialog
        unidades={unidades}
        regulamento={regulamento}
        abrirAoGravar={canViewIndica(session)}
        indicadorInicial={{
          clienteId: cliente.id,
          nome: cliente.nome,
          codigoCliente: cliente.codigo,
          unidade: null,
          embaixadorId: emb?.id ?? null,
          embaixadorCodigo: emb?.codigo ?? null,
          embaixadorAtivo: emb?.status === "ativo",
          nivel: emb?.niveis?.nome ?? null,
        }}
        gatilho={
          <Button size="sm" variant="outline">
            Nova indicação
          </Button>
        }
      />
    </>
  );
}
