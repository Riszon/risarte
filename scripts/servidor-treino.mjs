// SERVIDOR LOCAL CONTRA O BANCO DE TREINO — porta 3100, pasta `.next-test`.
//
// Uso (na pasta risarte):  npm run servidor:treino
//
// É o servidor que se sobe para conferir uma tela antes de entregar, sem
// encostar no servidor do dono (porta 3000, pasta `.next`, banco de produção).
//
// ⚠️ POR QUE ESTE ARQUIVO MORA NO REPOSITÓRIO (AP40, 10/11/2026). Ele vivia na
// pasta temporária de cada sessão e NUNCA limpava a `.next-test`: em 13/10/2026
// a pasta chegou a 18 GB e o disco C: ficou com zero livre ("No space left on
// device" no meio dos portões). Limpar era hábito de quem lembrava. Agora a
// pasta é apagada ANTES de subir e DEPOIS de encerrar, pelo mesmo script que o
// teste ponta a ponta já usa.
//
// ⚠️ RECUSA A PRODUÇÃO. Em 30/10/2026 um roteiro feito à mão falhou calado ao
// ler o `.env.test.local` e o `next dev` caiu no `.env.local` — a produção.
// Aqui o banco é conferido e IMPRESSO antes de qualquer coisa subir.
import { readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

const PRODUCAO = "hvhbijctanrrkxhemlza";
const PASTA = ".next-test";

let texto;
try {
  texto = readFileSync(".env.test.local", "utf8");
} catch {
  console.error("RECUSADO: não achei o .env.test.local nesta pasta.");
  process.exit(1);
}
const env = Object.fromEntries(
  texto
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes(PRODUCAO)) {
  console.error("RECUSADO: o .env.test.local não aponta para o treino.");
  process.exit(1);
}
console.log("banco:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname);

function limpar(quando) {
  try {
    rmSync(PASTA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    console.log(`  ${PASTA} apagada (${quando}).`);
  } catch (e) {
    // Não conseguir limpar não pode passar por "limpo": diz, com o motivo.
    console.error(`  NÃO consegui apagar a ${PASTA} (${quando}): ${e.message}`);
  }
}

limpar("antes de subir");

const filho = spawn("npx", ["next", "dev", "--port", "3100"], {
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_AMBIENTE: "treino",
    NEXT_DIST_DIR: PASTA,
    ZAPSIGN_ENV: "fake",
  },
});

let encerrando = false;
function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  limpar("ao encerrar");
  process.exit(codigo);
}
filho.on("exit", (c) => encerrar(c ?? 0));
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => {
    filho.kill();
    // Se o filho não avisar a saída a tempo, limpa mesmo assim.
    setTimeout(() => encerrar(0), 3000);
  });
}
