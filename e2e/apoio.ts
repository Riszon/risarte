// APOIO DOS TESTES PONTA A PONTA — entrar como cada papel, inventar dado de
// pessoa e perguntar ao banco o que a tela não mostra.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";

export const AMBIENTE = Object.fromEntries(
  readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
) as Record<string, string>;

export const PRODUCAO = "hvhbijctanrrkxhemlza";
if (AMBIENTE.TEST_DB_URL?.includes(PRODUCAO)) {
  throw new Error("RECUSADO: os testes nunca rodam contra a produção.");
}

/** Os apelidos criados pela semeadura (`scripts/seed-test.mjs`). */
export const PESSOAS = {
  admin: "admin@example.com",
  recepcao: "recepcao@example.com",
  coordenador: "coordenador@example.com",
  planner: "planner@example.com",
  consultor: "consultor@example.com",
  dentista: "dentista@example.com",
  gerente: "gerente@example.com",
  financeiro: "financeiro@example.com",
  comprador: "comprador@example.com",
  sdr: "sdr@example.com",
} as const;

/**
 * Entra no sistema SEM passar pela tela de login.
 *
 * Pede ao Supabase um link de acesso de uso único e troca por sessão — o mesmo
 * caminho da varredura de telas. Serve para chegar rápido ao passo que
 * interessa: uma jornada passa por cinco papéis, e digitar cinco logins em cada
 * teste transformaria a tela de login no que mais é testado no sistema.
 *
 * A tela de login de verdade tem um teste só para ela, onde ela é o assunto.
 */
export async function entrarComo(
  context: BrowserContext,
  email: string,
  clinicId?: string
) {
  const admin = createClient(
    AMBIENTE.NEXT_PUBLIC_SUPABASE_URL,
    AMBIENTE.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`link de acesso de ${email}: ${error.message}`);

  const pote = new Map<string, string>();
  const ssr = createServerClient(
    AMBIENTE.NEXT_PUBLIC_SUPABASE_URL,
    AMBIENTE.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () =>
          [...pote].map(([name, value]) => ({ name, value })),
        setAll: (lista) => lista.forEach((c) => pote.set(c.name, c.value)),
      },
    }
  );
  const { error: erroSessao } = await ssr.auth.verifyOtp({
    token_hash: data.properties!.hashed_token,
    type: "email",
  });
  if (erroSessao) throw new Error(`sessão de ${email}: ${erroSessao.message}`);

  await context.addCookies(
    [...pote]
      .map(([name, value]) => ({ name, value }))
      .concat(clinicId ? [{ name: "risarte_active_clinic", value: clinicId }] : [])
      .map((c) => ({ ...c, domain: "localhost", path: "/" }))
  );
}

/** Conexão com o banco de teste, para perguntar o que a tela não mostra. */
export async function banco() {
  const client = new pg.Client({
    connectionString: AMBIENTE.TEST_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

/**
 * CPF válido e diferente a cada rodada.
 *
 * Diferente porque o sistema recusa CPF repetido de propósito (cliente é único
 * na rede) — reaproveitar o mesmo faria o segundo teste falhar por acerto do
 * sistema. Válido porque a máscara e o cadastro conferem o dígito: um número
 * qualquer seria recusado antes de o teste chegar onde interessa.
 */
export function cpfDeTeste(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digito = (numeros: number[]) => {
    const peso = numeros.length + 1;
    const soma = numeros.reduce((s, n, i) => s + n * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base);
  const d2 = digito([...base, d1]);
  return [...base, d1, d2].join("");
}

/** Nome fictício, marcado como tal — ninguém confunde com paciente de verdade. */
export function nomeDeTeste(prefixo = "Paciente"): string {
  const carimbo = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `${prefixo} Teste ${carimbo}`;
}

export const mascaraCpf = (cpf: string) =>
  cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
