// PROVA REAL NO SANDBOX DO ASAAS:  npm run test:asaas
//
// Liga o teste de integração (`asaas-sandbox.integracao.test.ts`), que fica
// pulado no `npm test` do dia a dia: ele fala com o sandbox do Asaas e grava
// no banco de TREINO (verifica as contas de teste pelo caminho real do
// servidor). O próprio teste recusa o banco de produção.
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vitest", "run", "src/lib/__tests__/asaas-sandbox.integracao.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ASAAS_INTEGRACAO: "sim" },
});
process.exit(r.status ?? 1);
