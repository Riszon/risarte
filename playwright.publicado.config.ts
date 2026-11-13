import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

// TESTE PONTA A PONTA CONTRA O PROJETO DE TESTE PUBLICADO
// (https://risarte-asaas.vercel.app, branch feat/asaas-integration, banco de
// TREINO). Roda com `npm run test:e2e:publicado`.
//
// ⚠️ DIFERENTE DA SUÍTE `npm run test:e2e`: aqui NÃO há preparação global. A
// preparação da suíte local LIMPA o movimento do banco de teste — e o banco do
// projeto publicado é o mesmo treino onde o dono testa (LDN-00066 e cia.). Estes
// testes só LEEM telas: não criam, não apagam, não mudam nada.

const env = Object.fromEntries(
  readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
if (env.NEXT_PUBLIC_SUPABASE_URL?.includes("hvhbijctanrrkxhemlza")) {
  throw new Error("RECUSADO: .env.test.local aponta para o projeto de PRODUÇÃO.");
}

export const APP_PUBLICADO = process.env.APP_PUBLICADO ?? "https://risarte-asaas.vercel.app";

export default defineConfig({
  testDir: "./e2e-publicado",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: APP_PUBLICADO,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
