// E2E-3, segunda fatia — BAIXA PARCIAL E ATRASO.
//
// A regra mais sutil do financeiro, e a que o dono corrigiu depois de tê-la
// escrito de outro jeito (04/08/2026):
//
//   **Multa e juros incidem sobre o valor CHEIO da parcela, nunca sobre o
//   saldo.** Receber metade não pode cortar a multa pela metade — se cortasse,
//   a baixa parcial viraria desconto disfarçado, e quem deve teria vantagem em
//   pagar em pedaços.
//
// O teste prova isso com o número exato: numa parcela de R$ 280,00 já paga
// parcialmente (restam R$ 180,00), a multa cobrada é **R$ 5,60** (2% de 280) e
// não R$ 3,60 (2% de 180).
//
// E prova o contraste com o teste anterior: receber a PARCELA não mexe na DRE
// (a receita já foi reconhecida na venda), mas multa e juros MEXEM — eles são
// fato novo, nascem no atraso e no razão são receita financeira (4.1.01).

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, fecharAvisos, trocarPara, venderEFechar } from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

test.setTimeout(600_000);

// Mede o resultado do mês, como o 05: começa do zero para o número ser
// explicável.
test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
});

test("multa e juros incidem sobre o valor cheio, mesmo depois de baixa parcial", async ({
  page,
  context,
}) => {
  const paciente = await venderEFechar(page, context, "Atraso");
  const db = await banco();

  const { rows: dados } = await db.query(
    `select c.clinic_id, (select p.id from public.profiles p where p.email = $2) as gerente
       from public.clients c where c.id = $1`,
    [paciente.id, PESSOAS.gerente]
  );
  const { clinic_id: clinica, gerente } = dados[0];
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: gerente, role: "authenticated" }),
  ]);

  const { rows: cobrancas } = await db.query(
    `select id, amount_cents from public.payment_installments
      where client_id = $1 order by seq`,
    [paciente.id]
  );
  const parcela = cobrancas[0];
  expect(Number(parcela.amount_cents)).toBe(28_000);

  const receitaAntes = await receitaDoMes(db, clinica);

  // ---- 1. baixa parcial de R$ 100,00 ---------------------------------------
  await trocarPara(context, PESSOAS.gerente);
  await fecharAvisos(page);
  await abrirBaixa(page, paciente.id);
  await page.getByRole("textbox", { name: "Valor recebido (R$)" }).fill("100,00");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();

  await expect
    .poll(async () => await situacao(db, parcela.id), { timeout: 30_000 })
    .toMatchObject({ status: "parcial", paid_amount_cents: "10000" });

  // Receber parte não muda o resultado do mês — a receita foi reconhecida na
  // venda. Mesma lei do teste anterior.
  expect(await receitaDoMes(db, clinica)).toBe(receitaAntes);

  // ---- 2. o tempo passa (40 dias) ------------------------------------------
  // Ninguém espera 40 dias para rodar um teste. Mexer no vencimento é a única
  // parte simulada, e ela representa exatamente o que aconteceria sozinho.
  await db.query(
    `update public.payment_installments
        set due_date = public.today_br() - 40
      where id = $1`,
    [parcela.id]
  );

  // ---- 3. A REGRA: multa sobre o valor cheio -------------------------------
  await page.reload();
  await abrirBaixa(page, paciente.id);

  const janela = page.getByRole("dialog");
  // A LINHA da multa, não o valor solto: R$ 5,60 aparece mais de uma vez na
  // janela (na linha e no resumo), e procurar pelo número sem dizer onde
  // acertaria qualquer um dos dois.
  await expect(janela).toBeVisible();
  // O resumo é uma lista, e a linha da multa começa por "Multa". Filtro simples
  // de propósito: a versão anterior aninhava um localizador dentro do outro, e o
  // Playwright resolve isso relativo ao elemento de fora — não achava nada.
  const linhaMulta = janela.locator("li", { hasText: /^Multa/ });
  // 2% de R$ 280,00 = R$ 5,60. Se algum dia aparecer R$ 3,60, a multa passou a
  // incidir sobre o SALDO e a baixa parcial virou desconto disfarçado.
  await expect(linhaMulta).toContainText("R$ 5,60", { timeout: 20_000 });
  await expect(linhaMulta).not.toContainText("R$ 3,60");

  // ---- 4. paga o total atualizado ------------------------------------------
  await page.getByRole("button", { name: "Registrar", exact: true }).click();

  await expect
    .poll(async () => (await situacao(db, parcela.id)).status, {
      timeout: 30_000,
    })
    .toBe("paga");

  const final = await situacao(db, parcela.id);
  // A multa cobrada é a do valor cheio, e o banco guarda quanto dela foi pago.
  expect(Number(final.paid_fee_cents)).toBe(560);
  expect(Number(final.paid_interest_cents)).toBeGreaterThan(0);

  // ---- 5. multa e juros SÃO fato novo — e a DRE sente ----------------------
  const { rows: financeira } = await db.query(
    `select coalesce(sum(amount_cents), 0)::bigint as total
       from public.financial_entries
      where clinic_id = $1 and account_code = '4.1.01'
        and reversal_of is null`,
    [clinica]
  );
  expect(Number(financeira[0].total)).toBe(
    560 + Number(final.paid_interest_cents)
  );

  // Ao contrário da parcela, isto MUDA o resultado: a multa não existia antes
  // do atraso. Receita financeira é receita.
  expect(await receitaDoMes(db, clinica)).toBeGreaterThan(receitaAntes);

  await db.end();
});

/** Abre a janela de baixa da primeira cobrança em aberto do paciente. */
async function abrirBaixa(
  page: import("@playwright/test").Page,
  clientId: string
) {
  await page.goto(`/prontuarios/${clientId}`);
  await page.getByRole("tab", { name: "Financeiro" }).click();
  await page.getByRole("button", { name: "Dar baixa" }).first().click();
  await page.getByRole("dialog").waitFor();
}

async function situacao(
  db: Awaited<ReturnType<typeof banco>>,
  installmentId: string
) {
  const { rows } = await db.query(
    `select status, paid_amount_cents, paid_fee_cents, paid_interest_cents
       from public.payment_installments where id = $1`,
    [installmentId]
  );
  return rows[0];
}

async function receitaDoMes(
  db: Awaited<ReturnType<typeof banco>>,
  clinicId: string
): Promise<number> {
  const { rows } = await db.query(
    `select coalesce(sum(amount_cents), 0)::bigint as total
       from public.dre_lines(
         $1,
         date_trunc('month', public.today_br())::date,
         (date_trunc('month', public.today_br()) + interval '1 month - 1 day')::date
       )
      where block in ('receita_bruta', 'resultado_financeiro')`,
    [clinicId]
  );
  return Number(rows[0].total);
}
