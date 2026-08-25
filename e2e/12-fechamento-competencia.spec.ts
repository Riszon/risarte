// E2E-7 — O FECHAMENTO DE COMPETÊNCIA (FIN7.4).
//
// A trava que protege o resultado já publicado: mês fechado não recebe
// lançamento novo. E a exceção que a torna viável na prática:
//
//   **A TRAVA NÃO VALE PARA PAGAMENTO E RECEBIMENTO.**
//
// Pagar hoje uma conta de janeiro não altera o resultado de janeiro — desde a
// 0226 essas linhas nem entram na DRE. Se a trava pegasse nelas, fechar o mês
// quebraria o trabalho da recepção no dia seguinte, e aí ninguém fecharia mês
// nenhum. Uma trava que atrapalha o balcão vira uma trava que ninguém usa.
//
// E a separação de poderes (decisão do dono, 17/08/2026): **a unidade fecha, a
// franqueadora reabre**. Trava que quem está travado destrava sozinho vira
// lembrete, não controle.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, comoUsuario } from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

test.setTimeout(300_000);

test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
});

test("mês fechado recusa lançamento novo, mas nunca recusa receber", async () => {
  const db = await banco();
  const { rows: base } = await db.query(
    "select id from public.clinics where code = 'CAM'"
  );
  const cambe = base[0].id;

  // Um mês que JÁ TERMINOU — não se fecha mês em andamento.
  const { rows: quando } = await db.query(
    `select extract(year from d)::int as ano, extract(month from d)::int as mes,
            d::date as dia
       from (select date_trunc('month', public.today_br()) - interval '1 month' as d) t`
  );
  const { ano, mes, dia } = quando[0];

  // ---- a UNIDADE fecha -----------------------------------------------------
  const gerente = await comoUsuario(PESSOAS.gerente);
  const { error: erroFechar } = await gerente.rpc("close_fiscal_period", {
    p_clinic_id: cambe,
    p_year: ano,
    p_month: mes,
  });
  expect(erroFechar, erroFechar?.message).toBeNull();

  // PERGUNTAR COMO O GERENTE. `is_period_closed` termina com
  // `and can_see_clinic_finance(...)`: quem não pode ver o financeiro da
  // unidade recebe "não" em vez da verdade — a função não entrega nem essa
  // informação a estranhos. Perguntar pela conexão do banco (que não é
  // ninguém) devolvia falso com o período fechado.
  const { data: fechado, error: erroConsulta } = await gerente.rpc(
    "is_period_closed",
    { p_clinic_id: cambe, p_date: dia }
  );
  expect(erroConsulta, erroConsulta?.message).toBeNull();
  expect(fechado).toBe(true);

  // ---- 1. lançamento de COMPETÊNCIA no mês fechado é recusado --------------
  const recusa = await tentarLancar(db, {
    clinicId: cambe,
    accrualDate: dia,
    sourceType: "installment_accrual",
    cashDate: null,
  });
  expect(recusa ?? "").toMatch(/PERIOD_CLOSED|fechad/i);

  // ---- 2. RECEBER no mês fechado PASSA -------------------------------------
  // É a exceção que faz a trava ser usável: o dinheiro que entra não reescreve
  // o resultado do mês, então travá-lo só atrapalharia quem está no balcão.
  const aceito = await tentarLancar(db, {
    clinicId: cambe,
    accrualDate: dia,
    sourceType: "receipt_cash",
    cashDate: dia,
  });
  expect(aceito).toBeNull();

  // ---- 3. e PAGAR também ---------------------------------------------------
  const aceitoPagamento = await tentarLancar(db, {
    clinicId: cambe,
    accrualDate: dia,
    sourceType: "payable_cash",
    cashDate: dia,
  });
  expect(aceitoPagamento).toBeNull();

  // ---- 4. quem fecha NÃO reabre -------------------------------------------
  // A unidade fechou; se ela mesma destravasse, a trava seria um lembrete.
  const { error: erroReabrirUnidade } = await gerente.rpc(
    "reopen_fiscal_period",
    {
      p_clinic_id: cambe,
      p_year: ano,
      p_month: mes,
      p_reason: "tentativa da própria unidade",
    }
  );
  expect(erroReabrirUnidade).not.toBeNull();

  // ---- 5. a FRANQUEADORA reabre, com justificativa ------------------------
  const financeiro = await comoUsuario(PESSOAS.financeiro);
  const { error: erroReabrir } = await financeiro.rpc("reopen_fiscal_period", {
    p_clinic_id: cambe,
    p_year: ano,
    p_month: mes,
    p_reason: "reabertura para o teste automatizado",
  });
  expect(erroReabrir, erroReabrir?.message).toBeNull();

  // ---- 6. e o mês volta a aceitar competência ------------------------------
  const depoisDeReabrir = await tentarLancar(db, {
    clinicId: cambe,
    accrualDate: dia,
    sourceType: "installment_accrual",
    cashDate: null,
  });
  expect(depoisDeReabrir).toBeNull();

  await db.end();
});

/**
 * Tenta gravar um lançamento e devolve a recusa (ou `null` se passou).
 *
 * Sempre desfeito: o teste quer saber se o banco DEIXA, não deixar lançamento
 * inventado no razão — ele contaminaria a DRE de qualquer teste seguinte.
 */
async function tentarLancar(
  db: Awaited<ReturnType<typeof banco>>,
  entrada: {
    clinicId: string;
    accrualDate: string;
    sourceType: string;
    cashDate: string | null;
  }
): Promise<string | null> {
  try {
    await db.query("begin");
    await db.query(
      `insert into public.financial_entries
         (clinic_id, account_code, accrual_date, cash_date, amount_cents,
          direction, status, source_type, description)
       values ($1, '1.1.01', $2, $3, 12345, 'inflow', 'settled', $4,
               'lançamento do teste de fechamento')`,
      [
        entrada.clinicId,
        entrada.accrualDate,
        entrada.cashDate,
        entrada.sourceType,
      ]
    );
    await db.query("rollback");
    return null;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    return (e as Error).message;
  }
}
