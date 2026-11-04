import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { todayInBrazil } from "@/lib/dates";
import { isTreino } from "@/lib/environment";
import { carregarCategorias, carregarItens } from "./dados";
import { TelaDoBacklog } from "./tela";

export const metadata: Metadata = { title: "Backlog" };

/**
 * ADMINISTRAÇÃO → BACKLOG (BK2, plano `docs/backlog/TELA-BACKLOG-PLANO.md`).
 *
 * A lista viva do que está aberto e do que já foi resolvido no sistema — só
 * para o Admin Master. As sessões do Claude registram pelo `npm run backlog`
 * (grava na produção), e o que gravam aparece aqui ao recarregar.
 */
export default async function BacklogPage() {
  await requireAdminMaster();
  const [itens, categorias] = await Promise.all([carregarItens(), carregarCategorias()]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
        <p className="text-sm text-muted-foreground">
          Defeitos, melhorias e decisões em aberto no sistema — e o que já foi resolvido. As sessões registram
          aqui o que encontram; recarregue a página para ver o mais novo.
        </p>
      </div>

      {!itens.ok || !categorias.ok ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          {(!itens.ok && itens.motivo === "sem_migracao") || (!categorias.ok && categorias.motivo === "sem_migracao")
            ? "O backlog ainda não foi ligado neste banco: falta aplicar a migração 0366."
            : "Não foi possível ler o backlog agora. Recarregue a página; se continuar, avise."}
        </p>
      ) : (
        <TelaDoBacklog itens={itens.dados} categorias={categorias.dados} hoje={todayInBrazil()} noTreino={isTreino()} />
      )}
    </div>
  );
}
