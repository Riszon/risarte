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

  // A TELA DO MANUAL LÊ UM ARQUIVO DO REPOSITÓRIO.
  //
  // `/manual` serve o próprio `manual-treinamento-riSZon.md` — a mesma fonte do
  // Word, para os dois nunca divergirem. O Next só empacota para o servidor os
  // arquivos que ele enxerga sendo importados, e este é lido em tempo de
  // execução: sem esta linha ele fica de fora da publicação e a tela abre
  // dizendo que não encontrou o texto (ela trata esse caso, mas o certo é o
  // arquivo ir junto).
  outputFileTracingIncludes: {
    "/manual": ["docs/treinamento/manual-treinamento-riSZon.md"],
    "/empresarial/manual": ["docs/treinamento/manual-empresarial.md"],
    // ASSINATURA DIGITAL (ZS2): o PDF é montado no servidor com as fontes da
    // marca e o logotipo, lidos do disco em tempo de execução
    // (`src/lib/signatures/pdf/assets`). Toda rota que envia para assinatura
    // precisa deles no pacote publicado.
    // A Server Action roda na função da ROTA que a chamou: toda tela com o
    // botão "Enviar para assinatura" entra aqui (ficha, apresentação, o
    // cockpit do Consultor e o próprio módulo).
    "/assinaturas/**": ["src/lib/signatures/pdf/assets/**"],
    "/prontuarios/**": ["src/lib/signatures/pdf/assets/**"],
    "/apresentacao/**": ["src/lib/signatures/pdf/assets/**"],
    "/comercial/**": ["src/lib/signatures/pdf/assets/**"],
    // ZS5: o contrato de adesão sai do funil e da ficha da empresa (a ZS5
    // esqueceu esta linha — sem ela o envio pelo Empresarial falharia na
    // Vercel com "arquivo não encontrado"; achado na ZS7).
    "/empresarial/**": ["src/lib/signatures/pdf/assets/**"],
    // ZS7: o relatório mensal (PDF) sai da rotina do dia 1º.
    "/api/cron/**": ["src/lib/signatures/pdf/assets/**"],
  },

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
