// E2E-1, quarta fatia — FASE 4: a Conversão Comercial e A REGRA DE OURO.
//
// "Só é venda com documentos assinados E pagamento confirmado."
//
// Esta regra já foi burlada de verdade: o teste do dono, em agosto, achou
// R$ 869,00 recebidos numa negociação que ninguém tinha aceitado. A regra
// existia na documentação e na tela — e não no banco. Desde a 0203 ela mora no
// banco, e é isso que este teste prova: **a mesma cobrança é RECUSADA antes do
// fechamento e ACEITA depois dele.**
//
// Provar só que "recusa" seria fraco: uma trava que recusa tudo também recusaria
// o caso legítimo, e ninguém perceberia até a recepção não conseguir receber.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, fecharAvisos, levarAoComercial, trocarPara } from "./apoio";

// O caminho até aqui passa por cinco papéis e três fases; é o teste mais longo
// da suíte por natureza, não por lentidão.
test.setTimeout(600_000);

test("a venda só fecha com contrato e pagamento — e o banco impõe isso", async ({
  page,
  context,
}) => {
  const paciente = await levarAoComercial(page, context, "Fechamento");
  const db = await banco();

  // ---- o Consultor negocia --------------------------------------------------
  await trocarPara(context, PESSOAS.consultor);
  await fecharAvisos(page);
  await page.goto(`/comercial/${paciente.id}`);

  await page
    .getByRole("combobox", { name: /Forma de pagamento/ })
    .selectOption({ label: "PIX" });
  await page.getByRole("button", { name: "Salvar negociação" }).click();

  const aceitou = page.getByRole("button", { name: "Cliente aceitou" });
  await expect(aceitou).toBeEnabled({ timeout: 30_000 });
  await aceitou.click();

  // A negociação aceita gera as COBRANÇAS — e é sobre elas que a regra de ouro
  // vale.
  await expect
    .poll(async () => await parcelas(db, paciente.id), { timeout: 30_000 })
    .toBeGreaterThan(0);

  const { rows: cobranca } = await db.query(
    `select id, clinic_id, amount_cents from public.payment_installments
      where client_id = $1 order by seq limit 1`,
    [paciente.id]
  );
  const parcela = cobranca[0];

  // ---- a regra de ouro, ANTES do fechamento ---------------------------------
  // O documento não foi assinado e o pagamento não foi confirmado. Receber
  // agora é exatamente o que aconteceu de verdade em agosto.
  const recusa = await tentarReceber(db, parcela);
  expect(recusa).toContain("SALE_NOT_CLOSED");

  // ---- o fechamento ---------------------------------------------------------
  await page.goto(`/apresentacao/${paciente.id}`);
  await marcarPasso(page, "Contrato assinado");
  await expect
    .poll(async () => await vendaFechada(db, paciente.id), { timeout: 20_000 })
    .toBe(false); // só o contrato ainda NÃO fecha a venda

  await marcarPasso(page, "Pagamento confirmado");
  await expect
    .poll(async () => await vendaFechada(db, paciente.id), { timeout: 20_000 })
    .toBe(true);

  // ---- a mesma cobrança, agora aceita ---------------------------------------
  const aceita = await tentarReceber(db, parcela);
  expect(aceita).toBeNull();

  // ---- e o paciente segue para o Início de Tratamento -----------------------
  // É o que dispara o aviso para a recepção agendar. Venda fechada que não move
  // a fase deixa o paciente parado sem ninguém saber.
  await expect
    .poll(
      async () => {
        const { rows } = await db.query(
          "select journey_phase from public.clients where id = $1",
          [paciente.id]
        );
        return rows[0]?.journey_phase;
      },
      { timeout: 20_000 }
    )
    .toBe("treatment_start");

  await db.end();
});

/**
 * Marca um dos três passos do fechamento.
 *
 * O rótulo aparece em mais de um lugar da tela (no cartão e no aviso do que
 * falta), então o clique tem de ser no BOTÃO daquele cartão — clicar no texto
 * acertaria o aviso e não mudaria nada.
 */
async function marcarPasso(
  page: import("@playwright/test").Page,
  rotulo: string
) {
  const cartao = page
    .locator("div")
    .filter({ has: page.getByText(rotulo, { exact: true }) })
    .last();
  await cartao.getByRole("button", { name: "Marcar como concluído" }).click();
}

/**
 * Tenta registrar um recebimento e devolve a mensagem de recusa (ou `null`).
 *
 * Sempre desfeito: o teste quer saber se o banco DEIXA, não deixar a cobrança
 * paga. Sem o desfazimento, o passo seguinte encontraria uma parcela quitada
 * que ninguém pagou.
 */
async function tentarReceber(
  db: Awaited<ReturnType<typeof banco>>,
  parcela: { id: string; clinic_id: string; amount_cents: number }
): Promise<string | null> {
  try {
    await db.query("begin");
    await db.query(
      `insert into public.payment_receipts
         (clinic_id, installment_id, amount_cents, received_at, payment_method)
       values ($1, $2, $3, public.today_br(), 'pix')`,
      [parcela.clinic_id, parcela.id, parcela.amount_cents]
    );
    await db.query("rollback");
    return null;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    return (e as Error).message;
  }
}

async function parcelas(
  db: Awaited<ReturnType<typeof banco>>,
  clientId: string
): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.payment_installments where client_id = $1",
    [clientId]
  );
  return rows[0].n as number;
}

/**
 * A venda está fechada quando `closed_at` foi carimbado.
 *
 * A negociação continua `aceita` de propósito — aceitar e fechar são fatos
 * diferentes: o cliente aceitou a proposta (aceita) e depois assinou e pagou
 * (fechada). Guardar os dois no mesmo campo apagaria a distinção que a regra de
 * ouro protege.
 */
async function vendaFechada(
  db: Awaited<ReturnType<typeof banco>>,
  clientId: string
): Promise<boolean> {
  const { rows } = await db.query(
    `select closed_at from public.commercial_sales
      where client_id = $1 order by created_at desc limit 1`,
    [clientId]
  );
  return Boolean(rows[0]?.closed_at);
}
