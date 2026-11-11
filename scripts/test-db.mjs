// LIGAÇÃO COM O BANCO DE TESTE — a porta única, com a trava.
//
// Todo script que ESCREVE no banco de teste (aplicar migrações, semear cenário,
// limpar entre os testes) passa por aqui. Uma porta só, porque a trava abaixo
// tem de ser impossível de contornar por esquecimento.
//
// A TRAVA: o projeto de produção é recusado pelo `ref`, não por convenção de
// nome de arquivo. Um script que apaga dados não pode depender de disciplina —
// basta uma variável de ambiente errada, um copiar-colar de terminal, e o
// "banco de teste" vira o banco dos pacientes.

import { readFileSync } from "node:fs";
import pg from "pg";

/** O projeto de VERDADE. Nunca pode ser destino de escrita automática. */
export const PRODUCTION_REF = "hvhbijctanrrkxhemlza";

export function testEnv() {
  const env = Object.fromEntries(
    readFileSync(".env.test.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );

  // CAMINHO ALTERNATIVO (11/11/2026): o endereço direto do banco só responde
  // por IPv6, e houve dia em que a rede deste PC não alcançou. Quem precisar
  // passa `TEST_DB_URL` pelo ambiente (o pooler do Supabase, por IPv4). A trava
  // de produção abaixo vale igual: o endereço do pooler leva o `ref` do projeto.
  if (process.env.TEST_DB_URL) env.TEST_DB_URL = process.env.TEST_DB_URL;

  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TEST_DB_URL",
  ]) {
    if (!env[key]) throw new Error(`falta ${key} em .env.test.local`);
  }

  // A trava, nos dois endereços: o da API e o do banco.
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
    if (env[key].includes(PRODUCTION_REF)) {
      throw new Error(
        `RECUSADO: ${key} aponta para o projeto de PRODUÇÃO. ` +
          `Estes scripts escrevem e apagam dados — eles nunca rodam lá.`
      );
    }
  }

  return env;
}

/**
 * Passa a agir COMO um usuário do sistema, dentro desta conexão.
 *
 * `auth.uid()` lê o `sub` da reivindicação do token; definindo a reivindicação
 * à mão, toda função guardada (`is_admin_master`, `can_manage_stock`…) responde
 * exatamente como responderia para aquela pessoa no navegador.
 *
 * É isso que faz a semeadura **entrar pela porta da frente**: se um cadastro só
 * funcionasse com o superusuário, ele não funcionaria para ninguém de verdade —
 * e a gente descobriria isso três telas adiante, num teste que passou por
 * privilégio em vez de por estar certo.
 */
export async function actAs(client, userId) {
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

/**
 * O endereço da conexão. A conexão DIRETA do Supabase (`db.<projeto>…:5432`)
 * só responde por IPv6; quando a rede da máquina perde o IPv6 (11/11/2026:
 * "connect ETIMEDOUT 2600:…"), tudo que fala com o treino para. Com
 * `RISARTE_TREINO_POOLER=1` a mesma conta entra pelo pooler de sessão da
 * região (IPv4), com o mesmo usuário e senha. A trava contra a produção já
 * foi conferida no endereço original, e o nome do projeto vai no usuário.
 */
function enderecoDoBanco(original) {
  if (process.env.RISARTE_TREINO_POOLER !== "1") return original;
  const u = new URL(original);
  const projeto = u.hostname.split(".")[1];
  if (!projeto || projeto === PRODUCTION_REF) {
    throw new Error("RECUSADO: não consegui ler o projeto de teste no endereço do banco.");
  }
  u.hostname = "aws-0-sa-east-1.pooler.supabase.com";
  u.port = "5432";
  u.username = `postgres.${projeto}`;
  return u.toString();
}

/** Conexão aberta com o banco de teste, já com a trava conferida. */
export async function connect() {
  const env = testEnv();
  const client = new pg.Client({
    connectionString: enderecoDoBanco(env.TEST_DB_URL),
    ssl: { rejectUnauthorized: false },
    // Migração pesada (índice, backfill) leva tempo; desistir no meio deixaria
    // o banco num estado que ninguém sabe explicar.
    statement_timeout: 300_000,
  });
  await client.connect();
  return client;
}
