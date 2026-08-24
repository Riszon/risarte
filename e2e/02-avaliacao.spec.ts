// E2E-1, segunda fatia — FASE 2: da Aquisição ao Centro de Planejamento.
//
// Três pessoas encostam no mesmo paciente: a recepção o move para a Conversão
// Clínica, o Coordenador registra o consentimento e a anamnese, e só então o
// caso segue para o Planejamento.
//
// O teste troca de papel de verdade (limpando a sessão anterior). Sem isso ele
// provaria a coisa errada — que o Coordenador consegue fazer o que é da
// recepção.

import { expect, test } from "@playwright/test";
import {
  PESSOAS,
  banco,
  criarPacienteNaRecepcao,
  trocarPara,
} from "./apoio";

test("a jornada anda da Aquisição até o Centro de Planejamento", async ({
  page,
  context,
}) => {
  const paciente = await criarPacienteNaRecepcao(page, context, "Jornada");
  const db = await banco();

  // ---- passo 1: a recepção move para a Conversão Clínica --------------------
  await page.goto(`/prontuarios/${paciente.id}`);
  await page.getByRole("tab", { name: "Jornada" }).click();
  await page.getByRole("button", { name: "Mover de fase" }).click();
  await page.getByRole("menuitem", { name: "Conversão Clínica" }).click();

  await expect
    .poll(async () => (await fase(db, paciente.id)), { timeout: 20_000 })
    .toBe("clinical_conversion");

  // ---- passo 2: o Coordenador assume ---------------------------------------
  await trocarPara(context, PESSOAS.coordenador);
  await page.goto(`/avaliacao/${paciente.id}`);

  // A REGRA DA LGPD NA PRÁTICA: antes do consentimento, o sistema pede o
  // consentimento. Coletar foto, exame ou gravação antes disso é o que a
  // arquitetura proíbe desde o MVP.
  await expect(
    page.getByRole("button", { name: "Registrar consentimento" })
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Registrar consentimento" }).click();
  await expect(page.getByText(/Consentimento registrado em/)).toBeVisible({
    timeout: 20_000,
  });

  // O consentimento tem de existir no banco com hora e autor — é o que se
  // apresenta se alguém questionar depois.
  const { rows: consentimento } = await db.query(
    `select granted_at, recorded_by from public.client_consents
      where client_id = $1`,
    [paciente.id]
  );
  expect(consentimento).toHaveLength(1);
  expect(consentimento[0].granted_at).toBeTruthy();
  expect(consentimento[0].recorded_by).toBeTruthy();

  // ---- passo 3: anamnese ---------------------------------------------------
  // Ela é pré-requisito do envio ao Planejamento: planejar sem saber a saúde do
  // paciente é o risco que a trava existe para impedir.
  //
  // As ferramentas moram DENTRO de cada momento do roteiro — o cockpit é um
  // roteiro de consulta, não uma lista de botões. A anamnese está no momento 2.
  await page
    .getByRole("button", { name: /^Levantamento de informações/ })
    .click();

  await page.getByRole("combobox").first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Preencher", exact: true }).click();

  const rotulo = page.getByText("Está em tratamento ou acompanhamento médico?");
  await expect(rotulo).toBeVisible({ timeout: 20_000 });
  // O bloco da pergunta é o pai do rótulo; é nele que estão os botões Sim/Não.
  await rotulo
    .locator("xpath=..")
    .getByRole("button", { name: "Não", exact: true })
    .click();
  await page.getByRole("button", { name: "Salvar anamnese" }).click();

  await expect
    .poll(
      async () => {
        const { rows } = await db.query(
          "select count(*)::int as n from public.anamnesis_fills where client_id = $1",
          [paciente.id]
        );
        return rows[0].n;
      },
      { timeout: 20_000 }
    )
    .toBe(1);

  // ---- passo 4: envio ao Centro de Planejamento ----------------------------
  await page.goto(`/avaliacao/${paciente.id}`);
  await page.getByRole("button", { name: /^Enviar ao Planejamento/ }).click();
  const enviar = page.getByRole("button", {
    name: "Enviar ao Centro de Planejamento",
  });
  await expect(enviar).toBeEnabled({ timeout: 30_000 });
  await enviar.click();

  await expect
    .poll(async () => await fase(db, paciente.id), { timeout: 20_000 })
    .toBe("planning_center");

  // ---- e a linha do tempo guardou as duas passagens ------------------------
  // Sem histórico de fase não existe SLA, e o Centro de Planejamento é medido
  // por ele (24h). Fase que muda sem deixar registro apaga o indicador.
  const { rows: historico } = await db.query(
    `select phase from public.journey_phase_history
      where client_id = $1 order by entered_at`,
    [paciente.id]
  );
  expect(historico.map((h) => h.phase)).toEqual([
    "acquisition",
    "clinical_conversion",
    "planning_center",
  ]);

  await db.end();
});

async function fase(db: Awaited<ReturnType<typeof banco>>, clientId: string) {
  const { rows } = await db.query(
    "select journey_phase from public.clients where id = $1",
    [clientId]
  );
  return rows[0]?.journey_phase as string;
}
