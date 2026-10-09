import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lerMotivo } from "@/lib/acesso";

/**
 * ENCERRA O ACESSO — o único caminho de saída do sistema (0287).
 *
 * Passam por aqui o botão Sair, a tela quando o tempo de inatividade acaba, a
 * virada do dia e o servidor quando o banco diz que o acesso venceu. Um caminho
 * só, para a saída ficar REGISTRADA com o motivo em todos os casos — antes o
 * "Sair" apagava a sessão no navegador e a trilha nunca soube.
 *
 * ⚠️ É UMA ROTA, e não um componente, porque só aqui dá para apagar o cookie
 * da sessão: componente de servidor não escreve cookie.
 *
 * ⚠️ OS COOKIES SÃO APAGADOS À MÃO, além do `signOut`. Se a chamada de saída
 * falhar (rede), a biblioteca pode deixar o cookie — e aí o porteiro devolveria
 * a pessoa para dentro, o servidor a mandaria para cá de novo, e ela ficaria
 * presa num vai e volta sem fim.
 *
 * ⚠️ NUNCA USAR `<Link>` PARA ESTE ENDEREÇO: o Next pré-carrega os links que
 * estão à vista, e pré-carregar esta rota desconectaria a pessoa sem clique.
 * Quem sai usa `window.location`.
 */
export async function GET(request: NextRequest) {
  const motivo = lerMotivo(request.nextUrl.searchParams.get("motivo"));

  try {
    const supabase = await createClient();
    // Registra a saída (se o banco já não tiver encerrado) ANTES de derrubar a
    // sessão: depois dela o token não identifica mais ninguém.
    const { error } = await supabase.rpc("access_session_end", { p_reason: motivo });
    if (error) console.error("encerrar acesso: registro da saída —", error.message);
    // `local`: encerra ESTE aparelho. A pessoa logada também no consultório
    // não cai lá porque saiu aqui.
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("encerrar acesso:", e instanceof Error ? e.message : e);
  }

  const destino = new URL("/login", request.url);
  if (motivo !== "saiu") destino.searchParams.set("motivo", motivo);
  const resposta = NextResponse.redirect(destino);
  for (const c of request.cookies.getAll()) {
    if (/^sb-.+-auth-token(\.\d+)?$/.test(c.name)) resposta.cookies.delete(c.name);
  }
  return resposta;
}
