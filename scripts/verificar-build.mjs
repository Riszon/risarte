// O PORTÃO DE MONTAGEM — sempre do zero, nunca reaproveitando cache.
//
// ⚠️ POR QUE ISTO EXISTE (07/09/2026). A entrega v0.229.0 passou no meu build
// local e **quebrou na Vercel**. A causa do defeito era uma constante exportada
// de um arquivo `"use server"`; a causa de eu NÃO TER VISTO foi o cache: o
// Turbopack reaproveitou a compilação anterior da rota `/comercial` e nunca
// reexecutou a parte que falhava. O portão disse "verde" sem ter olhado.
//
// **Portão que passa por ausência não é portão** — é a mesma lição das
// invariantes (camada 1) e dos ensaios de limpeza que passaram por falta de
// dado. Aqui ela custou uma publicação quebrada e uma ida e volta com o dono.
//
// A Vercel monta sempre do zero. Para o portão valer alguma coisa, ele precisa
// montar do zero também.
//
// Também resolve o `NEXT_DIST_DIR` de uma vez: a variável é definida aqui, e
// não na linha de comando, então não há como esquecê-la e derrubar o servidor
// que o dono deixa aberto (ver o comentário no `next.config.ts`).
//
// Uso: npm run verificar

import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PASTA = ".next-verify";

rmSync(PASTA, { recursive: true, force: true });
console.log(`${PASTA} apagada — a montagem começa do zero.\n`);

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: PASTA },
});

if (r.status !== 0) {
  console.error(
    "\nA montagem FALHOU. Este é o mesmo erro que a Vercel daria — corrija" +
      " antes de publicar."
  );
}
process.exit(r.status ?? 1);
