// E2E — A LISTA DE BOAS-VINDAS DO RISARTE EMPRESARIAL (migração 1006).
//
// ⚠️ ESTE TESTE EXISTE PORQUE UM DEFEITO CHEGOU AO DONO, e nenhuma das camadas
// anteriores podia tê-lo pego.
//
// A tela abria. O build compilava. A varredura de telas (camada 2) abria a
// página e dizia "nenhuma tela falhou". E ela quebrava **no clique**: as
// constantes dos resultados da ligação moravam num arquivo `"use server"`, de
// onde todo export tem de ser função async — o navegador recebia outra coisa no
// lugar da lista, e ela só é usada DENTRO do diálogo, que só existe depois de
// clicar em "Registrar".
//
// É a mesma armadilha registrada no CLAUDE.md (a v0.229.0 quebrou na Vercel por
// uma constante exportada de um arquivo `"use server"`). Abrir não é clicar, e a
// única camada que clica é esta.
//
// O que fica preso aqui:
//   1. o diálogo ABRE (o defeito exato que o dono viu);
//   2. o contato GRAVA no banco;
//   3. "não atendeu" MANTÉM a pessoa na fila e "falei" a TIRA — a regra que faz
//      a lista não esvaziar com o trabalho por fazer.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, entrarComo, esperarEFecharAvisos } from "./apoio";

test.setTimeout(300_000);

/**
 * O CENÁRIO É CRIADO AQUI, não procurado no banco.
 *
 * ⚠️ A PRIMEIRA VERSÃO PROCURAVA UMA EMPRESA EXISTENTE E NÃO ACHAVA NADA. O
 * preparo da suíte (`limparMovimento`) dá `truncate ... cascade` nas tabelas do
 * `public`, e `empresarial.employees` aponta para `public.clients` — o cascade
 * atravessa o schema e leva os colaboradores junto. É a armadilha do
 * `truncate cascade` que já custou dado real neste projeto (CLAUDE.md §0).
 *
 * Teste que depende de dado que outra rotina apaga não é teste: é sorteio. Cada
 * execução monta o que precisa, com carência de propósito para a tela ter o que
 * mostrar.
 */
async function cenario() {
  const db = await banco();
  const marca = Date.now().toString().slice(-8);

  const empresa = await db.query(
    `insert into empresarial.companies
       (cnpj, legal_name, trade_name, contract_started_at,
        grace_period_days, employee_grace_period_days)
     values ($1, 'Empresa de Teste E2E', 'Teste E2E', now() - interval '90 days', 30, 15)
     returning id`,
    [`${marca}000001`.slice(0, 14)]
  );
  const companyId = empresa.rows[0].id as string;

  // Entrou hoje: a carência do colaborador (15 dias) ainda corre, então a tela
  // precisa mostrar "Carência até ...". Se mostrasse "pode agendar", o teste
  // pegaria a conta errada.
  await db.query(
    `insert into empresarial.employees
       (company_id, cpf, full_name, phone, joined_at)
     values ($1, $2, 'Fulano de Teste', '43999990000', now())`,
    [companyId, `${marca}001`.slice(0, 14)]
  );

  await db.end();
  return companyId;
}

test("a fila de boas-vindas registra a ligação e a pessoa sai da lista", async ({
  page,
  context,
}) => {
  const companyId = await cenario();

  //  grava os biscoitos no contexto; a aba vem do próprio teste.
  await entrarComo(context, PESSOAS.admin);
  await page.goto(`/empresarial/${companyId}/boas-vindas`);
  await esperarEFecharAvisos(page);

  await expect(
    page.getByRole("heading", { name: /Boas-vindas/i })
  ).toBeVisible();
  // A carência tem de estar na tela — foi pedido explícito do dono.
  await expect(page.getByText("Carências desta empresa")).toBeVisible();

  const primeiro = page.getByRole("button", { name: "Registrar" }).first();
  await expect(primeiro).toBeVisible();
  await primeiro.click();

  // ⚠️ AQUI ESTAVA O DEFEITO. Com as constantes vindo do arquivo `"use server"`,
  // o diálogo derrubava a tela inteira no limite de erro em vez de abrir.
  await expect(
    page.getByRole("heading", { name: /Registrar contato/i })
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Não atendeu" })).toBeVisible();

  // 1) "Não atendeu" — a pessoa CONTINUA na fila.
  await page.getByRole("radio", { name: "Não atendeu" }).check();
  await page.getByRole("button", { name: "Registrar", exact: true }).last().click();

  const db = await banco();
  await expect
    .poll(
      async () => {
        const r = await db.query(
          "select outcome from empresarial.welcome_contacts where company_id = $1",
          [companyId]
        );
        return r.rows[0]?.outcome ?? null;
      },
      { timeout: 20_000, message: "o contato precisa chegar ao banco" }
    )
    .toBe("NO_ANSWER");

  await page.reload();
  await esperarEFecharAvisos(page);

  // Com contato registrado, o botão vira "Atualizar" — e continua tendo TEXTO,
  // que é o que permite apontá-lo aqui e o que um leitor de tela anuncia.
  const atualizar = page.getByRole("button", { name: "Atualizar" }).first();
  await expect(atualizar).toBeVisible();

  // 2) "Falei com a pessoa" — agora ela SAI da fila, e o registro é ATUALIZADO
  //    (uma linha, não duas).
  await atualizar.click();
  await page.getByRole("radio", { name: "Falei com a pessoa" }).check();
  await page.getByRole("button", { name: "Registrar", exact: true }).last().click();

  await expect
    .poll(
      async () => {
        const r = await db.query(
          "select count(*)::int as n, max(outcome) as o from empresarial.welcome_contacts where company_id = $1",
          [companyId]
        );
        return `${r.rows[0].n}:${r.rows[0].o}`;
      },
      { timeout: 20_000, message: "registrar de novo ATUALIZA, não duplica" }
    )
    .toBe("1:CONTACTED");

  await db.end();
});
