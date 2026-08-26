import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

// TESTE PONTA A PONTA (camada 3) — o robô usa o sistema como uma pessoa usa.
//
// ⚠️ O APP DE TESTE SOBE NA PORTA 3100, COM O BANCO DE TESTE. O servidor do
// dono continua na 3000, apontando para a produção, e os dois não se encostam:
// portas diferentes, pastas de compilação diferentes (`.next-test`) e bancos
// diferentes. Um teste que criasse paciente no banco de verdade seria pior que
// nenhum teste.

const env = Object.fromEntries(
  readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// A trava, de novo e aqui. Ela se repete de propósito: este arquivo é quem
// escolhe a qual banco o app inteiro vai falar, e é o lugar onde um engano
// custaria caro.
if (env.NEXT_PUBLIC_SUPABASE_URL?.includes("hvhbijctanrrkxhemlza")) {
  throw new Error(
    "RECUSADO: .env.test.local aponta para o projeto de PRODUÇÃO."
  );
}

// ⚠️ NÃO APAGAR `.next-test` AQUI. Este arquivo é lido de novo por CADA processo
// de trabalho do Playwright, já com o servidor no ar: a limpeza aconteceria com
// o servidor rodando e ele passaria a errar em tudo
// (`ENOENT: build-manifest.json`). Tentado em 26/08/2026 e derrubou a suíte
// inteira. A limpeza é feita ANTES, pelo `npm run test:e2e`
// (`scripts/limpar-build-teste.mjs`).

export const APP_TESTE = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  // A jornada é sequencial por natureza: o mesmo paciente anda de fase em fase.
  // Rodar em paralelo faria um teste ver o cliente do outro no meio do caminho.
  fullyParallel: false,
  workers: 1,
  // Sem repetição automática. Teste que só passa na segunda tentativa está
  // escondendo instabilidade — e é justamente ela que precisa aparecer.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: APP_TESTE,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Para ASSISTIR: `--headed` abre o navegador e SLOW_MO deixa o robô lento o
    // bastante para acompanhar com o olho. Em velocidade normal ele clica mais
    // rápido do que dá para ler.
    launchOptions: { slowMo: Number(process.env.SLOW_MO ?? 0) },
    // O rastro só é guardado quando falha: é o que permite ver o que o robô
    // via na hora do erro, sem encher o disco nas passagens boas.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npx next dev --port 3100",
    url: `${APP_TESTE}/login`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      // Pasta própria: `next dev` e `next build` gravam na mesma `.next`, e
      // compartilhá-la com o servidor do dono já quebrou o sistema dele uma vez
      // (404 em página que existe).
      NEXT_DIST_DIR: ".next-test",
    },
  },
});
