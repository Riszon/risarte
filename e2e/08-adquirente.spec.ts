// E2E-3, quarta fatia — A TAXA DA ADQUIRENTE (FIN4b/4c).
//
// A regra que este teste prende (decisão do dono, migração 0204):
//
//   **A modalidade vem do meio da BAIXA, não do meio da VENDA.**
//   Parcela vendida como PIX, mas paga no cartão do balcão, custou o CARTÃO.
//
// É o tipo de coisa que passa despercebida para sempre: os dois caminhos
// existem, os dois têm taxa, e usar o errado dá um número plausível — só que a
// unidade paga a conta da diferença todo mês sem saber por quê.
//
// O teste vende por PIX (1%) e recebe no cartão (4%). Se a taxa cobrada for
// R$ 2,80, o sistema olhou a venda; o certo é R$ 11,20.

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

let adquirenteId: string;

test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  const { rows } = await db.query(
    "select id from public.clinics where code = 'CAM'"
  );
  const cambe = rows[0].id;
  await db.end();

  // Cadastro pelo caminho do app, com as permissões do Financeiro da
  // Franqueadora — a mesma escrita da tela `/financeiro/adquirentes`.
  const financeiro = await comoUsuario(PESSOAS.financeiro);
  const { data, error } = await financeiro
    .from("card_acquirers")
    .insert({
      clinic_id: cambe,
      scope: "unidade",
      name: "Adquirente de Teste",
      is_default: true,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`adquirente: ${error.message}`);
  adquirenteId = data.id as string;

  // Duas faixas com preços BEM diferentes, de propósito: é a diferença que
  // denuncia qual das duas o sistema escolheu.
  const { error: erroFaixas } = await financeiro.from("acquirer_rates").insert([
    {
      acquirer_id: adquirenteId,
      modality: "pix",
      min_installments: 1,
      max_installments: 1,
      fee_percent: 1,
      fixed_fee_cents: 0,
      settlement_days: 1,
      settlement_business_days: false,
      // Nulo, não zero: o banco recusa 0 de propósito — "zero franquias
      // gratuitas" não é um conceito, é ausência de franquia.
      free_monthly_count: null,
      fee_charged_on: "pagamento",
      valid_from: "2020-01-01",
    },
    {
      acquirer_id: adquirenteId,
      modality: "credito_avista",
      min_installments: 1,
      max_installments: 1,
      fee_percent: 4,
      fixed_fee_cents: 0,
      settlement_days: 30,
      settlement_business_days: false,
      // Nulo, não zero: o banco recusa 0 de propósito — "zero franquias
      // gratuitas" não é um conceito, é ausência de franquia.
      free_monthly_count: null,
      fee_charged_on: "pagamento",
      valid_from: "2020-01-01",
    },
  ]);
  if (erroFaixas) throw new Error(`faixas: ${erroFaixas.message}`);
});

test.afterAll(async () => {
  // A adquirente sai de cena: deixada ligada, ela cobraria taxa em toda baixa
  // dos outros testes e mudaria números que não são sobre ela.
  const financeiro = await comoUsuario(PESSOAS.financeiro);
  await financeiro
    .from("card_acquirers")
    .update({ active: false, is_default: false })
    .eq("id", adquirenteId);
});

test("a taxa vem do meio da BAIXA, não do meio da venda", async ({
  page,
  context,
}) => {
  // A venda nasce como PIX (é o que `venderEFechar` escolhe).
  const paciente = await venderEFechar(page, context, "Adquirente");
  const db = await banco();

  // ---- a baixa acontece no CARTÃO ------------------------------------------
  await trocarPara(context, PESSOAS.gerente);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${paciente.id}`);
  await page.getByRole("tab", { name: "Financeiro" }).click();
  await page.getByRole("button", { name: "Dar baixa" }).first().click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("combobox", { name: "Forma de pagamento" })
    .selectOption({ label: "Cartão" });
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30_000 });

  // ---- o que foi cobrado ---------------------------------------------------
  const buscarRecebimentos = async () => {
    const { rows } = await db.query(
      `select pr.amount_cents, pr.acquirer_fee_cents, pr.acquirer_fee_percent,
              pr.acquirer_modality, pr.settlement_date
         from public.payment_receipts pr
         join public.payment_installments pi on pi.id = pr.installment_id
        where pi.client_id = $1 and not coalesce(pr.reversed, false)`,
      [paciente.id]
    );
    return rows;
  };

  await expect
    .poll(async () => (await buscarRecebimentos()).length, { timeout: 30_000 })
    .toBe(1);

  const [recebimento] = await buscarRecebimentos();
  expect(Number(recebimento.amount_cents)).toBe(28_000);

  // A PROVA: 4% do cartão (R$ 11,20), não 1% do PIX (R$ 2,80).
  expect(Number(recebimento.acquirer_fee_percent)).toBe(4);
  expect(Number(recebimento.acquirer_fee_cents)).toBe(1_120);
  expect(recebimento.acquirer_modality).toBe("credito_avista");

  // E o dinheiro entra em D+30, não hoje: é essa data que a projeção de caixa
  // usa. Usar o vencimento mostraria o dinheiro um mês antes de ele existir.
  const liquidacao = new Date(recebimento.settlement_date);
  const hoje = new Date();
  const dias = Math.round(
    (liquidacao.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
  );
  expect(dias).toBeGreaterThanOrEqual(29);
  expect(dias).toBeLessThanOrEqual(31);

  // ---- e a despesa é da UNIDADE -------------------------------------------
  // Conta 2.4.01: a taxa do cartão é despesa de quem vendeu, nunca da
  // franqueadora — senão a unidade não teria incentivo para negociar a taxa
  // nem para puxar o cliente para o PIX.
  const { rows: despesa } = await db.query(
    `select coalesce(sum(amount_cents), 0)::bigint as total
       from public.financial_entries e
       join public.clients c on c.clinic_id = e.clinic_id
      where c.id = $1 and e.account_code = '2.4.01' and e.reversal_of is null`,
    [paciente.id]
  );
  expect(Number(despesa[0].total)).toBe(1_120);

  await db.end();
});
