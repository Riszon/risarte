import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes unitários das regras de negócio puras (src/lib) — rodam sem banco.
// `npm test` faz parte do portão de cada entrega, junto com `npm run build`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
