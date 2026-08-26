// PASTA DE COMPILAÇÃO NOVA A CADA EXECUÇÃO DOS TESTES PONTA A PONTA.
//
// Ao terminar, o Playwright MATA o servidor de teste — inclusive no meio de uma
// compilação. O que fica gravado em `.next-test` não é confiável, e a execução
// seguinte responde **404 em páginas que existem**. O sintoma engana igual ao
// caso do servidor do dono descrito no CLAUDE.md (`/financeiro/configuracao`):
// parece permissão negada ou rota que sumiu, e já custou uma investigação
// inteira em `/prontuarios/[id]` (26/08/2026).
//
// Roda ANTES do Playwright, nunca de dentro dele: o `playwright.config.ts` é
// lido de novo por cada processo de trabalho, com o servidor já no ar, e apagar
// de lá derruba o servidor no meio do caminho.
//
// O preço é alguns minutos de compilação a mais. É barato perto de passar uma
// tarde acusando o sistema de um defeito que era lixo de compilação.

import { rmSync } from "node:fs";

rmSync(".next-test", { recursive: true, force: true });
console.log("  .next-test apagada — o servidor de teste compila do zero.");
