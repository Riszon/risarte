import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
