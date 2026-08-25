// E2E-4 — O CANCELAMENTO DO TRATAMENTO (0206).
//
// Três passos, e a regra que os une (decisão do dono, 07/08/2026):
//
//   **NADA É DESFEITO ANTES DO ÚLTIMO.**
//   apurar (congela o acerto) → assinar (o paciente assina) → efetivar
//
// É o que impede o pior cenário: alguém abrir o termo para ver quanto daria,
// desistir no meio, e o tratamento já ter sido desmontado por trás. Por isso o
// teste confere DUAS VEZES que o mundo continua intacto — depois de apurar e
// depois de assinar — antes de deixar o terceiro passo acontecer.
//
// Se um dia a cobrança sumir logo no primeiro passo, este teste acusa.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, fecharAvisos, trocarPara, venderEFechar } from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

test.setTimeout(600_000);

test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
});

test("o cancelamento só desfaz no terceiro passo", async ({
  page,
  context,
}) => {
  const paciente = await venderEFechar(page, context, "Cancelamento");
  const db = await banco();

  // O retrato de antes: é contra ele que os dois primeiros passos são medidos.
  const antes = await retrato(db, paciente.id);
  expect(antes.cobrancasEmAberto).toBe(1);
  expect(antes.fase).toBe("treatment_start");

  // ---- passo 1: APURAR (gerar o termo) -------------------------------------
  await trocarPara(context, PESSOAS.gerente);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${paciente.id}`);
  await page.getByRole("tab", { name: "Plano", exact: true }).click();

  await page.getByRole("button", { name: "Cancelar tratamento" }).click();
  await page
    .getByPlaceholder("Motivo do cancelamento (obrigatório)")
    .fill("Mudança de cidade — teste automatizado");
  // Quem já fechou precisa de destino: voltar à Fase 4 seria fingir que o
  // clínico não aconteceu.
  await page
    .getByRole("combobox")
    .filter({ hasText: "Escolher" })
    .first()
    .selectOption({ label: "Reavaliação com o Coordenador Clínico" });
  await page
    .getByRole("button", { name: "Gerar termo de cancelamento" })
    .click();

  await expect
    .poll(async () => await termo(db, paciente.id), { timeout: 30_000 })
    .toMatchObject({ status: "rascunho" });

  // NADA MUDOU. O termo existe, o tratamento segue de pé.
  expect(await retrato(db, paciente.id)).toMatchObject({
    cobrancasEmAberto: antes.cobrancasEmAberto,
    fase: antes.fase,
    sessoesConcluidas: antes.sessoesConcluidas,
  });

  // ---- passo 2: ASSINAR ----------------------------------------------------
  const emAndamento = await termo(db, paciente.id);
  await page.goto(`/cancelamentos/${emAndamento.id}/termo`);

  // O termo tem código próprio, e ele não some: é o que amarra o cancelamento
  // ao plano, às cobranças e ao razão.
  expect(emAndamento.code).toMatch(/^CN-/);
  await expect(page.getByText(emAndamento.code).first()).toBeVisible();

  await page
    .getByRole("button", { name: "Marcar termo como assinado" })
    .click();

  await expect
    .poll(async () => (await termo(db, paciente.id)).status, { timeout: 30_000 })
    .toBe("assinado");

  // E CONTINUA SEM MUDAR NADA. Assinar é o consentimento, não a execução.
  expect(await retrato(db, paciente.id)).toMatchObject({
    cobrancasEmAberto: antes.cobrancasEmAberto,
    fase: antes.fase,
    sessoesConcluidas: antes.sessoesConcluidas,
  });

  // ---- passo 3: EFETIVAR ---------------------------------------------------
  await page.reload();
  await page.getByRole("button", { name: "Efetivar cancelamento" }).click();

  await expect
    .poll(async () => (await termo(db, paciente.id)).status, { timeout: 30_000 })
    .toBe("efetivado");

  // AGORA sim o mundo muda.
  const depois = await retrato(db, paciente.id);
  // A cobrança em aberto do que não foi executado deixa de ser cobrada.
  expect(depois.cobrancasEmAberto).toBe(0);
  // O paciente foi para a Reavaliação, como o Gerente escolheu.
  expect(depois.fase).toBe("reevaluation");
  // SESSÃO CONCLUÍDA NUNCA É DESFEITA — é histórico clínico, não cobrança.
  expect(depois.sessoesConcluidas).toBe(antes.sessoesConcluidas);

  await db.end();
});

/** O estado do mundo em torno deste paciente. */
async function retrato(
  db: Awaited<ReturnType<typeof banco>>,
  clientId: string
) {
  const { rows } = await db.query(
    `select
       (select count(*)::int from public.payment_installments
         where client_id = $1 and status in ('em_aberto', 'parcial')) as cobrancas,
       (select journey_phase from public.clients where id = $1) as fase,
       (select count(*)::int from public.treatment_sessions
         where client_id = $1 and status = 'done') as sessoes`,
    [clientId]
  );
  return {
    cobrancasEmAberto: rows[0].cobrancas as number,
    fase: rows[0].fase as string,
    sessoesConcluidas: rows[0].sessoes as number,
  };
}

async function termo(
  db: Awaited<ReturnType<typeof banco>>,
  clientId: string
) {
  const { rows } = await db.query(
    `select id, code, status from public.plan_cancellations
      where client_id = $1 order by created_at desc limit 1`,
    [clientId]
  );
  return rows[0] ?? { status: null };
}
