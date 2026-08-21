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
  ]),
]);

export default eslintConfig;
