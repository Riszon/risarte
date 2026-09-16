import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APP_VERSION, LATEST_MIGRATION } from "@/lib/version";
import { abaInicial, ehAba } from "@/lib/system-reports";
import { Problemas } from "./lista";
import { carregarRelatos, instanteDoPedido } from "./dados";

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
  if (!pode(session, "menu.sistema")) redirect("/");

  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();
  const { relatos, nivel } = await carregarRelatos(supabase, session.userId);

  const pedida = um(params.aba);
  const aba = ehAba(pedida) ? pedida : abaInicial(relatos, session.isAdminMaster);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Problemas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onde avisar que algo deu errado, tirar uma dúvida ou sugerir uma
          melhoria — e acompanhar a resposta. Você está na versão{" "}
          <strong className="font-medium text-foreground">
            {APP_VERSION} · migração {LATEST_MIGRATION}
          </strong>
          .
        </p>
      </header>

      <Problemas
        relatos={relatos}
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
