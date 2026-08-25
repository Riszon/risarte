// E2E-3, terceira fatia — O SPLIT DAS TAXAS DA REDE (FIN8.1).
//
// É como a franqueadora ganha dinheiro, e a regra é do dono (17/08/2026):
// **a base é o dinheiro que ENTROU**, não a competência. Cada baixa dispara o
// cálculo sobre o valor recebido — parcela nunca paga não gera taxa, e o
// franqueado confere olhando o extrato dele.
//
// Duas coisas ficam presas aqui, e as duas já foram defeito em algum sistema:
//
// 1. **O percentual CONGELA na baixa.** Mudar o royalty de 8% para 10% não
//    reescreve o que já foi cobrado. Sem isso, o histórico deixaria de explicar
//    o valor cobrado, e o franqueado perderia a conferência.
// 2. **A conta a pagar CRESCE a cada recebimento.** Ela nasce no primeiro e vai
//    somando — o `refresh` existe porque a função que lança no razão não
//    reescreve lançamento que já existe, e sem ele a conta ficaria congelada no
//    valor do primeiro recebimento do mês.

import { expect, test } from "@playwright/test";
import {
  PESSOAS,
  banco,
  comoUsuario,
  fecharAvisos,
  trocarPara,
  venderEFechar,
} from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

test.setTimeout(600_000);

/** Liga o royalty em 8% no padrão da REDE. */
async function definirRoyalty(percent: number) {
  // Pelo caminho do app, com as permissões do Financeiro da Franqueadora — a
  // mesma escrita que a tela `/financeiro/taxas-da-rede` faz. Escrever direto
  // no banco passaria por cima da RLS e provaria menos.
  const financeiro = await comoUsuario(PESSOAS.financeiro);
  const { error } = await financeiro.from("network_fees").upsert(
    {
      clinic_id: null,
      fee: "royalty",
      kind: "percent",
      percent,
      amount_cents: 0,
      active: true,
      note: "teste automatizado",
    },
    { onConflict: "clinic_id,fee" }
  );
  if (error) throw new Error(`configurar royalty: ${error.message}`);
}

test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
  await definirRoyalty(8);
});

test.afterAll(async () => {
  // Devolve o padrão da rede ao estado semeado (zero, desligado): taxa ligada
  // sobrando afetaria os números de qualquer teste futuro.
  const financeiro = await comoUsuario(PESSOAS.financeiro);
  await financeiro
    .from("network_fees")
    .update({ percent: 0, active: false, note: null })
    .is("clinic_id", null)
    .eq("fee", "royalty");
});

test("cada recebimento cobra a taxa da rede, e o percentual congela na baixa", async ({
  page,
  context,
}) => {
  const paciente = await venderEFechar(page, context, "Royalty");
  const db = await banco();

  const { rows: dados } = await db.query(
    "select clinic_id from public.clients where id = $1",
    [paciente.id]
  );
  const clinica = dados[0].clinic_id;

  // ---- primeira baixa: R$ 100,00 com royalty a 8% --------------------------
  await trocarPara(context, PESSOAS.gerente);
  await fecharAvisos(page);
  await darBaixa(page, paciente.id, "100,00");

  await expect
    .poll(async () => (await splits(db, clinica)).length, { timeout: 30_000 })
    .toBe(1);

  const [primeiro] = await splits(db, clinica);
  expect(Number(primeiro.percent)).toBe(8);
  expect(Number(primeiro.amount_cents)).toBe(800); // 8% de R$ 100,00

  // ---- a rede reajusta o royalty para 10% ---------------------------------
  await definirRoyalty(10);

  // ---- segunda baixa: o restante, já a 10% --------------------------------
  await page.reload();
  await darBaixa(page, paciente.id, null); // o valor sugerido: o saldo inteiro

  await expect
    .poll(async () => (await splits(db, clinica)).length, { timeout: 30_000 })
    .toBe(2);

  const cobrados = await splits(db, clinica);
  // O PRIMEIRO CONTINUA 8%. Se virar 10, o reajuste reescreveu o passado.
  expect(Number(cobrados[0].percent)).toBe(8);
  expect(Number(cobrados[0].amount_cents)).toBe(800);
  // O segundo nasce com a regra nova: 10% de R$ 180,00.
  expect(Number(cobrados[1].percent)).toBe(10);
  expect(Number(cobrados[1].amount_cents)).toBe(1800);

  // ---- e a conta a pagar da unidade acompanhou -----------------------------
  const { rows: conta } = await db.query(
    `select clinic_id, network_fee, amount_cents, status
       from public.payables
      where clinic_id = $1 and network_fee = 'royalty'`,
    [clinica]
  );
  expect(conta).toHaveLength(1);
  // UMA conta por taxa por mês, que CRESCE — não uma conta por recebimento, e
  // não uma conta congelada no primeiro.
  expect(Number(conta[0].amount_cents)).toBe(800 + 1800);
  // Quem paga é a unidade: a taxa é despesa dela, receita da franqueadora.
  expect(conta[0].clinic_id).toBe(clinica);

  await db.end();
});

/** Dá baixa na primeira cobrança em aberto; `valor` nulo aceita o sugerido. */
async function darBaixa(
  page: import("@playwright/test").Page,
  clientId: string,
  valor: string | null
) {
  await page.goto(`/prontuarios/${clientId}`);
  await page.getByRole("tab", { name: "Financeiro" }).click();
  await page.getByRole("button", { name: "Dar baixa" }).first().click();
  await page.getByRole("dialog").waitFor();
  if (valor) {
    await page.getByRole("textbox", { name: "Valor recebido (R$)" }).fill(valor);
  }
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30_000 });
}

/** As cobranças de taxa da unidade, em ordem de criação. */
async function splits(
  db: Awaited<ReturnType<typeof banco>>,
  clinicId: string
) {
  const { rows } = await db.query(
    `select percent, amount_cents, fee, reversed
       from public.split_charges
      where clinic_id = $1 and fee = 'royalty' and not reversed
      order by created_at`,
    [clinicId]
  );
  return rows;
}
