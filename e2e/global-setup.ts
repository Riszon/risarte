// A CONFERÊNCIA QUE RODA ANTES DE QUALQUER TESTE.
//
// Ela existe para responder uma pergunta só, e a mais importante de todas:
// **este app está mesmo falando com o banco de TESTE?**
//
// A prova é elegante porque não depende de eu conferir endereço nenhum: o
// cookie de sessão é assinado pelo projeto de teste. Se o app estivesse
// apontando para a produção, ele recusaria esse cookie e mandaria para o
// login — e o teste para aqui, antes de escrever qualquer coisa. Além disso, o
// usuário `admin@example.com` só existe no projeto de teste.

import { chromium } from "@playwright/test";
import { AMBIENTE, PESSOAS, banco, entrarComo } from "./apoio";
import { APP_TESTE } from "../playwright.config";

export default async function globalSetup() {
  const projeto = AMBIENTE.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "").slice(0, 12);
  console.log(`\n  Banco de teste: ${projeto}…`);

  // O cenário precisa estar semeado, senão os testes falhariam por ausência de
  // dado e pareceria defeito do sistema.
  const db = await banco();
  const { rows } = await db.query(
    "select (select count(*) from clinics) as clinicas, (select count(*) from procedures) as procedimentos"
  );
  await db.end();
  if (Number(rows[0].clinicas) === 0 || Number(rows[0].procedimentos) === 0) {
    throw new Error(
      "O banco de teste está vazio. Rode `node scripts/seed-test.mjs` antes."
    );
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: APP_TESTE });
  await entrarComo(context, PESSOAS.admin);
  const page = await context.newPage();
  const resposta = await page.goto("/prontuarios", { waitUntil: "domcontentloaded" });

  const caiuNoLogin = page.url().includes("/login");

  if (caiuNoLogin || !resposta || resposta.status() >= 400) {
    await browser.close();
    throw new Error(
      "O app na porta 3100 NÃO aceitou a sessão do banco de teste. " +
        "Provavelmente está apontando para outro projeto — nenhum teste vai rodar."
    );
  }
  console.log("  App de teste conferido: sessão do banco de teste aceita.");

  // AQUECE AS ROTAS. O servidor de desenvolvimento monta cada tela na primeira
  // vez que ela é pedida, e uma tela pedida antes de estar pronta responde 404 —
  // já aconteceu com `/prontuarios/novo`. Sem isto, a primeira execução do dia
  // falharia por causa do compilador, não do sistema.
  for (const rota of ["/prontuarios/novo", "/jornada", "/agenda"]) {
    await page.goto(rota, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  console.log("  Telas principais aquecidas.\n");
  await browser.close();
}
