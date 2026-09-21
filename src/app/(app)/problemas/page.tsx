import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { abaInicial, ehAba } from "@/lib/system-reports";
import { podeVerPainelDeRelatos } from "@/lib/painel-de-relatos";
import { Problemas } from "./lista";
import { carregarRelatos, instanteDoPedido } from "./dados";
import { carregarRelatosDoTreino } from "@/lib/relatos-do-treino";
import { carregarEnderecos } from "@/lib/ambientes-db";

export const metadata: Metadata = { title: "Problemas" };

/**
 * PROBLEMAS — o canal entre quem opera e quem mantém o sistema.
 *
 * ⚠️ SEPARADA DE `/alertas` POR ORDEM DO DONO (08/09/2026) — ver o comentário
 * de `/alertas/page.tsx` para o motivo inteiro. Em resumo: as duas moravam na
 * mesma tela em abas, e os dois ícones da barra de cima abriam a MESMA página.
 * **Não juntar de novo.**
 *
 * A VERSÃO FICA NO CABEÇALHO desta tela, e não da outra, porque é aqui que ela
 * é usada: relato sem versão obriga quem for corrigir a adivinhar em qual
 * sistema o defeito aconteceu. O formulário já a grava sozinho; mostrá-la é o
 * que permite à pessoa dizer "estou na 0.236.0" antes mesmo de abrir o relato.
 *
 * 0256 (16/09/2026): a lista virou índice — abas, busca, filtros e o tempo
 * parado de cada relato. A conversa mora no detalhe (`/problemas/OC-00009`),
 * que é também o endereço que se pode mandar para alguém.
 */
export default async function ProblemasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  // QUEM ESTÁ SÓ NO INÍCIO TAMBÉM RELATA (20/09/2026): no modo portal a pessoa
  // não tem função nenhuma, então a matriz de permissões diria não — e quem
  // está treinando é justamente quem mais precisa avisar que algo deu errado.
  const soInicio = !session.ambientes.sistema;
  if (!soInicio && !pode(session, "menu.sistema")) redirect("/");

  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const supabase = await createClient();
  let clinicId = session.activeClinic?.id ?? null;
  // Sem unidade ativa (modo portal), a unidade do relato vem da ficha — a
  // mesma regra de `registrarProblema`, senão o botão ficaria cinza para quem
  // acabou de chegar.
  if (!clinicId) {
    const { data: ficha } = await supabase
      .from("staff_members")
      .select("clinic_id")
      .eq("user_id", session.userId)
      .order("created_at")
      .limit(1)
      .maybeSingle<{ clinic_id: string }>();
    clinicId = ficha?.clinic_id ?? null;
  }
  const { relatos, nivel } = await carregarRelatos(supabase, session.userId);

  // OS DOIS AMBIENTES NA MESMA LISTA (19/09/2026, decisão do dono). Quem
  // consolida é sempre a produção: o treino não alcança este banco.
  const enderecos = await carregarEnderecos(supabase);
  const doTreino = await carregarRelatosDoTreino({
    prodUserId: session.userId,
    isAdminMaster: session.isAdminMaster,
    endereco: enderecos.treino ?? null,
  });
  const todos = [...relatos, ...doTreino.relatos].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  const pedida = um(params.aba);
  const aba = ehAba(pedida) ? pedida : abaInicial(todos, session.isAdminMaster);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Problemas</h1>
          {podeVerPainelDeRelatos(session) && (
            <Link
              href="/problemas/painel"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <BarChart3 className="size-4" />
              Painel de indicadores
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Onde avisar que algo deu errado, tirar uma dúvida ou sugerir uma
          melhoria — e acompanhar a resposta. Você está na versão{" "}
          <strong className="font-medium text-foreground">
            {APP_VERSION} · migração {LATEST_MIGRATION}
          </strong>
          .
        </p>
      </header>

      {doTreino.aviso && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {doTreino.aviso}
        </p>
      )}

      <Problemas
        relatos={todos}
        isAdminMaster={session.isAdminMaster}
        nivel={nivel}
        semUnidade={!clinicId}
        abaDeInicio={aba}
        abrirFormulario={um(params.relatar) === "1"}
        telaSugerida={um(params.tela) ?? ""}
        digestSugerido={um(params.digest) ?? ""}
        versaoAtual={APP_VERSION}
        agora={instanteDoPedido()}
      />
    </div>
  );
}
