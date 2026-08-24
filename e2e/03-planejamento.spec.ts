// E2E-1, terceira fatia — FASE 3: o Centro de Planejamento.
//
// É o núcleo do sistema: onde o caso vira diagnóstico, plano, orçamento e
// aprovação. Duas pessoas com poderes DIFERENTES de propósito — o Planner monta
// e o Coordenador aprova, e nenhum dos dois faz o papel do outro.

import { expect, test } from "@playwright/test";
import {
  PESSOAS,
  banco,
  fecharAvisos,
  levarAoPlanejamento,
  trocarPara,
} from "./apoio";

test("o Planner monta o plano, o Coordenador aprova e o caso segue ao Comercial", async ({
  page,
  context,
}) => {
  const paciente = await levarAoPlanejamento(page, context, "Plano");
  const db = await banco();

  // ---- o Planner monta o plano ---------------------------------------------
  await trocarPara(context, PESSOAS.planner);
  await fecharAvisos(page);
  await page.goto(`/planejamento/${paciente.id}`);

  await page
    .getByRole("button", { name: "Iniciar plano de tratamento" })
    .click();

  const diagnostico = page.getByRole("textbox", { name: "Diagnóstico" });
  await diagnostico.waitFor();
  await diagnostico.fill("Cárie em elemento 26, sem comprometimento pulpar.");
  await page
    .getByRole("textbox", { name: "Objetivos do tratamento" })
    .fill("Devolver função mastigatória e evitar progressão da lesão.");
  // Sai do campo para o texto ser gravado.
  await page.getByRole("heading", { name: "Opções de tratamento" }).click();

  // A opção de tratamento...
  await page
    .getByRole("button", { name: "Adicionar opção de tratamento" })
    .click();
  await page
    .getByRole("textbox", { name: /Título da opção/ })
    .fill("Plano principal");
  await page.getByRole("checkbox", { name: /Plano principal/ }).check();
  await page
    .getByRole("button", { name: "Adicionar opção", exact: true })
    .click();

  // ESPERAR O BANCO CONFIRMAR ANTES DE RECARREGAR. Recarregar por tempo é a
  // corrida que derrubou este teste três vezes: a tela voltava do servidor
  // antes de o dado chegar lá, e o passo seguinte procurava algo que ainda não
  // existia. O banco é quem sabe quando o salvamento terminou.
  await expect
    .poll(async () => await contar(db, "treatment_plan_options", paciente.id), {
      timeout: 20_000,
    })
    .toBe(1);

  // ...e o procedimento dentro dela. Sem item lançado o plano não vai adiante:
  // aprovar plano sem orçamento seria aprovar um valor que ninguém viu.
  await page.reload();
  // A opção pode voltar recolhida depois de recarregar, e o orçamento mora
  // dentro dela. Esperar a lista aparecer antes de decidir evita a corrida com
  // o carregamento — sem isso o teste às vezes procurava o botão antes de a
  // opção existir na tela, e falhava por pressa, não por defeito.
  await page.getByRole("heading", { name: "Opções de tratamento" }).waitFor();
  const adicionarItem = page
    .getByRole("button", { name: "Procedimento", exact: true })
    .first();
  if (!(await adicionarItem.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Expandir opção" }).first().click();
  }
  await adicionarItem.waitFor({ state: "visible" });
  await adicionarItem.click();
  await page
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Restauração em resina 1 face (R$ 280,00)" });
  await page.getByRole("button", { name: "Item", exact: true }).click();

  await expect
    .poll(
      async () => await contar(db, "treatment_plan_option_items", paciente.id),
      { timeout: 20_000 }
    )
    .toBe(1);

  // O pilar da Metodologia — todo plano é classificado em um dos seis.
  await page.reload();
  await page
    .locator("select")
    .filter({ hasText: "Selecione..." })
    .first()
    .selectOption({ label: "Saúde" });
  await page.getByRole("button", { name: "Salvar pilar" }).click();

  // Espera o BANCO confirmar antes de recarregar. Recarregar por tempo é a
  // corrida que fez este teste falhar com o plano inteiro salvo: a tela voltava
  // do servidor antes de o pilar chegar lá, e o botão continuava desligado
  // mostrando um estado que já não era verdade.
  await expect
    .poll(
      async () => {
        const { rows } = await db.query(
          "select methodology_pillar from public.clients where id = $1",
          [paciente.id]
        );
        return rows[0]?.methodology_pillar;
      },
      { timeout: 20_000 }
    )
    .toBe("health");

  // ---- envio para aprovação -------------------------------------------------
  await page.reload();
  const enviarAprovacao = page.getByRole("button", {
    name: "Enviar para aprovação do Coordenador",
  });
  await expect(enviarAprovacao).toBeEnabled({ timeout: 20_000 });
  await enviarAprovacao.click();

  await expect
    .poll(async () => await statusDoPlano(db, paciente.id), { timeout: 20_000 })
    .toBe("submitted");

  // ---- o Coordenador aprova -------------------------------------------------
  // Quem monta não aprova: é a separação que dá sentido à aprovação clínica.
  await trocarPara(context, PESSOAS.coordenador);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${paciente.id}`);
  await page.getByRole("tab", { name: "Plano", exact: true }).click();
  // O Coordenador tem de ABRIR a opção para decidir: aprovar sem ver o que está
  // dentro seria assinar em branco, e a tela impede isso por construção.
  //
  // ⚠️ CONTORNO DE DEFEITO CONHECIDO (item 2 de docs/CORRECOES-TESTES.md): o
  // PRIMEIRO clique não abre nada para o Coordenador. Clicamos até abrir para o
  // teste seguir cobrindo a aprovação; o defeito em si está preso pelo teste
  // logo abaixo, que falha de propósito enquanto ele existir.
  await abrirOpcao(page);
  const aprovar = page.getByRole("button", { name: /Aprovar opção/ }).first();
  await expect(aprovar).toBeVisible({ timeout: 20_000 });
  await aprovar.click();

  const confirmar = page
    .getByRole("dialog")
    .getByRole("button", { name: /Aprovar/ });
  if (await confirmar.count()) await confirmar.first().click();

  await expect
    .poll(async () => await statusDoPlano(db, paciente.id), { timeout: 20_000 })
    .toBe("approved");

  await db.end();
});

test("um clique devia abrir a opção para o Coordenador", async ({
  page,
  context,
}) => {
  // ESTE TESTE FALHA DE PROPÓSITO enquanto o defeito existir — e é essa a
  // graça: quando a correção sair, ele vira verde e AVISA que o contorno lá em
  // cima pode ser removido. Defeito conhecido sem teste vira defeito esquecido.
  test.fail();

  const db = await banco();
  const { rows } = await db.query(
    `select client_id from public.treatment_plans
      where status = 'submitted' order by created_at desc limit 1`
  );
  await db.end();
  test.skip(rows.length === 0, "nenhum plano aguardando aprovação");

  await trocarPara(context, PESSOAS.coordenador);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${rows[0].client_id}`);
  await page.getByRole("tab", { name: "Plano", exact: true }).click();
  await page.getByRole("button", { name: "Expandir opção" }).first().click();

  await expect(
    page.getByRole("button", { name: /Aprovar opção/ }).first()
  ).toBeVisible({ timeout: 10_000 });
});

/** Abre a opção, insistindo enquanto o defeito do primeiro clique existir. */
async function abrirOpcao(page: import("@playwright/test").Page) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const revisao = page.getByRole("button", { name: /Aprovar opção/ });
    if (await revisao.count()) return;
    await page
      .getByRole("button", { name: /^(Expandir|Recolher) opção$/ })
      .first()
      .click();
    await page.waitForTimeout(800);
  }
}

/** Quantas linhas daquela tabela existem para o plano deste paciente. */
async function contar(
  db: Awaited<ReturnType<typeof banco>>,
  tabela: "treatment_plan_options" | "treatment_plan_option_items",
  clientId: string
): Promise<number> {
  const consulta =
    tabela === "treatment_plan_options"
      ? `select count(*)::int as n from public.treatment_plan_options o
           join public.treatment_plans p on p.id = o.plan_id
          where p.client_id = $1`
      : `select count(*)::int as n from public.treatment_plan_option_items i
           join public.treatment_plan_options o on o.id = i.option_id
           join public.treatment_plans p on p.id = o.plan_id
          where p.client_id = $1`;
  const { rows } = await db.query(consulta, [clientId]);
  return rows[0].n as number;
}

async function statusDoPlano(
  db: Awaited<ReturnType<typeof banco>>,
  clientId: string
) {
  const { rows } = await db.query(
    `select status from public.treatment_plans
      where client_id = $1 order by created_at desc limit 1`,
    [clientId]
  );
  return rows[0]?.status as string;
}
