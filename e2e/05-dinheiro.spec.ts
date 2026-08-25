// E2E-3 — O DINHEIRO: a baixa, o razão e a DRE.
//
// A pergunta que este teste responde é a que já custou o defeito mais caro do
// projeto: **receber dinheiro muda o RESULTADO do mês?**
//
// Não muda. A receita foi reconhecida quando a venda foi fechada (competência);
// receber é caixa. A migração 0225 somava as duas linhas e a DRE mostrava o
// dobro — R$ 4.416 + R$ 5.096 das MESMAS parcelas. A 0226 corrigiu, e aqui a
// correção fica presa: **a DRE antes da baixa tem de ser idêntica à DRE depois
// da baixa.**
//
// É a formulação mais afiada da regra: relatório de competência lê uma linha,
// relatório de caixa lê a outra, nunca as duas.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, fecharAvisos, trocarPara, venderEFechar } from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

// Passa pela jornada inteira antes de chegar ao dinheiro.
test.setTimeout(600_000);

/**
 * ESTE TESTE COMEÇA COM O MÊS ZERADO, e por dois motivos:
 *
 * 1. **Ele mede o resultado do MÊS.** Com vendas de outros testes no mesmo
 *    período, a receita da DRE vira uma soma de coisas alheias — a comparação
 *    antes/depois ainda funcionaria, mas o número deixaria de ser explicável, e
 *    número que ninguém consegue explicar é o que faz a conferência ser
 *    abandonada.
 * 2. Rodando por último, depois de a suíte encher o banco, ele levava mais de
 *    10 minutos contra 6 sozinho — telas mais pesadas, não sistema mais lento.
 *
 * Como ele é o último da fila, limpar aqui não tira o chão de ninguém.
 */
test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
});

test("receber não mexe no resultado do mês — mexe no caixa", async ({
  page,
  context,
}) => {
  const paciente = await venderEFechar(page, context, "Dinheiro");
  const db = await banco();

  const { rows: dados } = await db.query(
    `select c.clinic_id, u.id as gerente
       from public.clients c
       cross join lateral (
         select p.id from public.profiles p where p.email = $2
       ) u
      where c.id = $1`,
    [paciente.id, PESSOAS.gerente]
  );
  const { clinic_id: clinica, gerente } = dados[0];

  // O gerente é quem enxerga o financeiro da própria unidade — as funções de
  // relatório recusam quem não tem esse direito, então o teste pergunta COMO
  // ELE, não como dono do banco.
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: gerente, role: "authenticated" }),
  ]);

  const receitaAntes = await receitaDoMes(db, clinica);
  expect(receitaAntes).toBeGreaterThan(0); // a venda entrou no resultado

  const { rows: parcelas } = await db.query(
    `select id, amount_cents from public.payment_installments
      where client_id = $1 order by seq`,
    [paciente.id]
  );
  expect(parcelas).toHaveLength(1);
  const parcela = parcelas[0];

  // ---- a baixa, pela tela ---------------------------------------------------
  await trocarPara(context, PESSOAS.gerente);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${paciente.id}`);
  await page.getByRole("tab", { name: "Financeiro" }).click();
  await page.getByRole("button", { name: "Dar baixa" }).first().click();
  await page.getByRole("button", { name: "Registrar", exact: true }).click();

  await expect
    .poll(
      async () => {
        const { rows } = await db.query(
          "select status from public.payment_installments where id = $1",
          [parcela.id]
        );
        return rows[0]?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("paga");

  // ---- o razão guardou as DUAS metades, separadas --------------------------
  const { rows: lancamentos } = await db.query(
    `select source_type, cash_date, amount_cents
       from public.financial_entries
      where source_id = $1 or source_id in (
        select id from public.payment_receipts where installment_id = $1
      )
      order by source_type`,
    [parcela.id]
  );

  const competencia = lancamentos.filter(
    (l) => l.source_type === "installment_accrual"
  );
  const caixa = lancamentos.filter((l) => l.source_type === "receipt_cash");

  expect(competencia).toHaveLength(1);
  expect(caixa).toHaveLength(1);
  // A separação que faz os dois relatórios lerem metades diferentes do mesmo
  // razão: competência não tem data de caixa, liquidação tem.
  expect(competencia[0].cash_date).toBeNull();
  expect(caixa[0].cash_date).not.toBeNull();

  // ---- E A DRE NÃO MUDOU ----------------------------------------------------
  const receitaDepois = await receitaDoMes(db, clinica);
  expect(receitaDepois).toBe(receitaAntes);
  // Se algum dia isto falhar somando o dobro, é a 0226 desfeita.
  expect(receitaDepois).not.toBe(receitaAntes + Number(parcela.amount_cents));

  await db.end();
});

/**
 * Receita bruta do mês corrente, pela DRE — a função de verdade, a mesma que a
 * tela usa. Reimplementar a soma aqui testaria a minha conta, não a do sistema.
 */
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
      where block = 'receita_bruta'`,
    [clinicId]
  );
  return Number(rows[0].total);
}
