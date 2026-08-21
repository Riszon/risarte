import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PASTA DE BUILD SEPARÁVEL POR VARIÁVEL DE AMBIENTE.
  //
  // `next build` e `next dev` gravam na MESMA pasta `.next`. Rodar o build de
  // verificação enquanto o dono está com o servidor local aberto sobrescreve o
  // estado do `next dev` em cima dele, e o sistema passa a dar 404 em páginas
  // que existem — foi exatamente o que aconteceu com /financeiro/configuracao.
  // O sintoma engana: parece bug da tela nova, e não é.
  //
  // Com isto, o portão de entrega roda em `.next-verify` e não encosta no
  // servidor dele. Na Vercel a variável não existe, então continua `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // "Clientes" virou "Prontuários" (rota /clientes → /prontuarios). Mantém
  // links/atalhos antigos funcionando em vez de dar 404.
  async redirects() {
    return [
      { source: "/clientes", destination: "/prontuarios", permanent: false },
      {
        source: "/clientes/:path*",
        destination: "/prontuarios/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
