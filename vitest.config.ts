import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes unitários das regras de negócio puras (src/lib) — rodam sem banco.
// `npm test` faz parte do portão de cada entrega, junto com `npm run build`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      // ⚠️ `server-only` é uma TRAVA DE EMPACOTAMENTO, não uma regra de
      // execução: ela existe para o código de servidor nunca ir parar no
      // pacote do navegador, e para isso ela levanta erro ao ser importada
      // fora dali — inclusive aqui. Sem este atalho, toda regra que mora em
      // módulo de servidor ficaria SEM TESTE, que é o preço mais caro
      // possível por uma proteção de build. O Next continua aplicando a trava
      // de verdade no build; aqui ela vira um módulo vazio.
      "server-only": path.resolve(process.cwd(), "src/lib/__tests__/server-only-vazio.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
