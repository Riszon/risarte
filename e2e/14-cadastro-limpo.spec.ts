// E2E — O CADASTRO DE TITULAR ABRE LIMPO (relato OC-00056).
//
// ⚠️ ESTE TESTE EXISTE PORQUE NENHUMA CAMADA ANTERIOR PODIA PEGAR O DEFEITO.
//
// O relato: *"ao adicionar o segundo colaborador o sistema puxa os dados do
// colaborador anterior que eu já havia cadastrado"*. A tela abria, o build
// compilava, a varredura de telas dizia "nenhuma tela falhou" — porque o
// defeito não está em abrir a página: está em **abrir a janela pela segunda
// vez**. Os campos são controlados (existem para o autopreenchimento pelo
// CPF) e o componente do botão continua montado depois de salvar, então o
// estado do primeiro titular sobrevivia.
//
// O risco real não é o incômodo de apagar campo: é gravar a pessoa errada.
// Quem não percebe salva o segundo titular com o nome e o telefone do
// primeiro, e só o CPF repetido seria recusado — os outros campos passariam.
//
// O que fica preso aqui: depois de cadastrar um titular, reabrir "Novo
// titular" mostra os campos VAZIOS.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, entrarComo, esperarEFecharAvisos } from "./apoio";

test.setTimeout(300_000);

/**
 * O cenário é criado aqui, não procurado no banco — mesma razão do teste das
 * boas-vindas: a limpeza da suíte atravessa o schema pelo `cascade` e um teste
 * que depende de dado que outra rotina apaga não é teste, é sorteio.
 */
async function cenario() {
  const db = await banco();
  const marca = Date.now().toString().slice(-8);
  const empresa = await db.query(
    `insert into empresarial.companies
       (cnpj, legal_name, trade_name, contract_started_at)
     values ($1, 'Empresa Cadastro Limpo E2E', 'Cadastro Limpo E2E', now())
     returning id`,
    [`${marca}000002`.slice(0, 14)]
  );
  await db.end();
  return empresa.rows[0].id as string;
}

async function desfazerCenario(companyId: string) {
  const db = await banco();
  await db.query("delete from empresarial.companies where id = $1", [companyId]);
  await db.end();
}

let criada: string | null = null;

// A limpeza roda mesmo quando o teste falha: pô-la só no fim deixaria lixo
// justamente nas execuções que quebram.
test.afterEach(async () => {
  if (criada) {
    await desfazerCenario(criada);
    criada = null;
  }
});

test("o segundo titular não herda os dados do primeiro", async ({
  page,
  context,
}) => {
  const companyId = await cenario();
  criada = companyId;
  const cpfUm = "529.982.247-25"; // CPFs válidos quaisquer, só para o formulário
  const cpfDois = "111.444.777-35";

  await entrarComo(context, PESSOAS.admin);
  await page.goto(`/empresarial/${companyId}?aba=colaboradores`);
  await esperarEFecharAvisos(page);

  // --- primeiro titular -----------------------------------------------------
  await page.getByRole("button", { name: "Novo titular" }).click();
  await page.getByLabel("CPF").fill(cpfUm);
  await page.getByLabel("Nome completo").fill("Primeiro Titular");
  await page.getByLabel("Telefone").fill("(43) 90000-0001");
  await page.getByRole("button", { name: "Cadastrar" }).click();

  // Espera o BANCO confirmar, não o relógio: a tela volta do servidor antes de
  // o dado chegar lá (lição registrada no ARQUITETURA-TECNICA).
  await expect(page.getByText("Primeiro Titular")).toBeVisible();

  // --- ⚠️ A SEGUNDA ABERTURA, que é o relato --------------------------------
  await page.getByRole("button", { name: "Novo titular" }).click();

  await expect(page.getByLabel("CPF")).toHaveValue("");
  await expect(page.getByLabel("Nome completo")).toHaveValue("");
  await expect(page.getByLabel("Telefone")).toHaveValue("");

  // E o cadastro seguinte grava o que foi digitado AGORA, não o de antes.
  await page.getByLabel("CPF").fill(cpfDois);
  await page.getByLabel("Nome completo").fill("Segundo Titular");
  await page.getByLabel("Telefone").fill("(43) 90000-0002");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Segundo Titular")).toBeVisible();

  const db = await banco();
  const gravados = await db.query(
    `select full_name, phone from empresarial.employees
      where company_id = $1 order by created_at`,
    [companyId]
  );
  await db.end();
  expect(gravados.rows.map((r) => r.full_name)).toEqual([
    "Primeiro Titular",
    "Segundo Titular",
  ]);
  // O telefone é o que mais engana: ele não é único, então o dado do primeiro
  // passaria em silêncio se tivesse ficado na tela.
  expect(gravados.rows[1].phone).toContain("0002");
});
