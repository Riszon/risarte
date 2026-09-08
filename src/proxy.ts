import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  // Before Supabase is configured (.env.local), let everything through so
  // the setup notice page can render.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and the auth call,
  // otherwise sessions may be terminated unexpectedly.
  //
  // ⚠️ `getClaims()` E NÃO `getUser()`, e a diferença é de SEGUNDOS por clique.
  //
  // `getUser()` vai à REDE perguntar ao servidor de autenticação a cada
  // requisição. Como o porteiro roda em toda navegação e a página pergunta de
  // novo, eram DUAS idas à rede antes de qualquer tela começar a se desenhar —
  // e o sistema inteiro ficava com o mesmo ~1 segundo de piso, da tela mais
  // pesada à mais simples (medido em 08/09/2026: /perfil, que quase não
  // consulta nada, levava 1385ms; a DRE, 1196ms).
  //
  // `getClaims()` confere a ASSINATURA do token localmente, por criptografia,
  // usando a chave pública do projeto (que os dois projetos usam — conferido no
  // `/.well-known/jwks.json`). Ele continua renovando a sessão quando o token
  // está para vencer, que é a outra razão de o porteiro existir.
  //
  // O QUE ISTO CUSTA, e como está pago: o token continua válido até vencer
  // (até 1h), então banir alguém no Supabase deixa de cortar o acesso na hora.
  // Por isso `getSessionContext()` passou a EXIGIR `profiles.is_active` a cada
  // requisição — desativar corta no clique seguinte, por decisão do banco.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all routes except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
