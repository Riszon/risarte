import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build de verificação do portão de entrega (NEXT_DIST_DIR). Sem isto o
    // lint analisa a saída do build e devolve milhares de problemas que não
    // são do nosso código — e o baseline de zero erro perde o sentido.
    ".next-verify/**",
    // App de teste da camada 3 (porta 3100) e saída do Playwright — pela mesma
    // razão: é código gerado, não é nosso.
    ".next-test/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
