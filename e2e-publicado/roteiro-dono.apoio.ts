// APOIO DO ROTEIRO DO DONO (16/11/2026): o registro de cada passo, o banco de
// treino, a leitura do Asaas sandbox (só pela chave do Vault, nunca impressa) e
// as fotos de cada tela.
import { expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { banco } from "../e2e/apoio";

export const PASTA = process.env.ROTEIRO_PASTA ?? "roteiro-dono-saida";
if (!existsSync(PASTA)) mkdirSync(PASTA, { recursive: true });
export const CENARIO = JSON.parse(readFileSync(process.env.ROTEIRO_CENARIO ?? "roteiro-dono.json", "utf8"));

type Passo = { passo: string; ok: boolean; visto: string };
const RESULTADOS = `${PASTA}/resultados.json`;
const lidos: Passo[] = existsSync(RESULTADOS) ? JSON.parse(readFileSync(RESULTADOS, "utf8")) : [];

/** Registra o passo (OK ou o que se viu) e não para o roteiro. */
export function anotar(passo: string, ok: boolean, visto: string) {
  const i = lidos.findIndex((x) => x.passo === passo);
  const linha = { passo, ok, visto: visto.slice(0, 600) };
  if (i >= 0) lidos[i] = linha;
  else lidos.push(linha);
  writeFileSync(RESULTADOS, JSON.stringify(lidos, null, 2));
  console.log(`${ok ? "OK   " : "FALHA"} ${passo} — ${visto.slice(0, 300)}`);
}

export async function foto(page: Page, nome: string) {
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: true }).catch(() => {});
}

export async function sql<T = Record<string, unknown>>(texto: string, params: unknown[] = []): Promise<T[]> {
  const db = await banco();
  try {
    return (await db.query(texto, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** O Asaas sandbox de uma conta (a chave sai do Vault e não é impressa). */
export async function asaas(contaId: string, caminho: string, metodo = "GET", corpo?: unknown) {
  const [k] = await sql<{ api_key: string }>("select api_key from public._gateway_read_key($1, 'roteiro_do_dono', null)", [contaId]);
  if (!String(k?.api_key ?? "").startsWith("$aact_hmlg_")) throw new Error("RECUSADO: a chave não é de sandbox.");
  const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
    method: metodo,
    headers: { access_token: k.api_key, "User-Agent": "riSZon - roteiro do dono", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return r.json();
}

export const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** O cartão da parcela na aba Financeiro, pelo número da parcela e o vencimento. */
export function linhaDaParcela(page: Page, vencimentoISO: string) {
  return page
    .locator("div")
    .filter({ hasText: new RegExp(`Parcela · ${dataBR(vencimentoISO).replace(/\//g, "\\/")}`) })
    .filter({ has: page.getByRole("checkbox") })
    .last();
}

export async function textoDaTela(page: Page) {
  return page.locator("body").innerText();
}

export async function esperar(cond: () => Promise<boolean>, ms = 60_000, passo = 3000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, passo));
  }
  return false;
}

export { expect };
