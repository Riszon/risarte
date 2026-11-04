// E2E — ENVIO PARA ASSINATURA DIGITAL, DO BOTÃO AO "ASSINADO" (ZS8).
//
// O caminho que a equipe faz: a ficha do paciente → aba Documentos → "Enviar
// para assinatura" → escolher o documento → quem assina → pré-visualização →
// enviar → os links. Com a ZapSign de MENTIRA (`ZAPSIGN_ENV=fake`, no
// `playwright.config.ts`): o envio percorre o código inteiro sem gastar
// documento nem depender do sandbox.
//
// O retorno da ZapSign é simulado pela MESMA porta que a rota do webhook usa
// (`signature_apply_webhook`), uma assinatura de cada vez, na ordem. O que
// fica preso aqui:
//   - o pacote nasce "enviado" (não rascunho — a corrida achada na ZS8, 0359);
//   - "Minhas assinaturas pendentes" do representante mostra o pacote quando
//     chega a vez dele, e o sino avisa;
//   - assinado por todos, a ficha mostra "Assinado".
//
// O teste real no sandbox (links de verdade, PDF assinado guardado, recusa,
// cancelamento) foi feito à mão na ZS8 e está no ESTADO.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, criarPacienteNaRecepcao, esperarEFecharAvisos, trocarPara } from "./apoio";

test.setTimeout(300_000);

/** A unidade da recepção precisa de razão social: sem ela, o envio é recusado (0350). */
async function garantirRazaoSocial() {
  const db = await banco();
  await db.query(
    `update public.clinics c set legal_name = 'UNIDADE DE TESTE E2E LTDA'
      where (c.legal_name is null or c.legal_name = '')
        and c.id in (select r.clinic_id from public.user_clinic_roles_all r
                       join public.profiles p on p.id = r.user_id
                      where p.email = $1)`,
    [PESSOAS.recepcao]
  );
  await db.end();
}

/** Uma assinatura que a ZapSign confirmaria — pela porta do webhook. */
async function zapsignAssinou(packageId: string, signerName: string) {
  const db = await banco();
  const { rows } = await db.query(
    `select p.zapsign_doc_token as doc, s.zapsign_signer_token as signer
       from public.signature_packages p
       join public.signature_signers s on s.package_id = p.id
      where p.id = $1 and s.name = $2`,
    [packageId, signerName]
  );
  expect(rows.length, `signatário ${signerName} não achado`).toBe(1);
  await db.query(`select public.signature_apply_webhook($1::jsonb)`, [
    JSON.stringify({
      event_key: `e2e-${packageId}-${rows[0].signer}`,
      event_type: "doc_signed",
      doc_token: rows[0].doc,
      external_id: packageId,
      signer_token: rows[0].signer,
      signer_signed_at: new Date().toISOString(),
      payload: { e2e: true },
      signers: [],
    }),
  ]);
  await db.end();
}

test("o termo vai para assinatura, o representante é avisado e o pacote termina assinado", async ({
  page,
  context,
}) => {
  await garantirRazaoSocial();
  const paciente = await criarPacienteNaRecepcao(page, context, "Assinatura");

  // --- o envio, pela tela, como o Gerente ------------------------------------
  await trocarPara(context, PESSOAS.gerente);
  await page.goto(`/prontuarios/${paciente.id}?aba=documentos`);
  await esperarEFecharAvisos(page);
  await page.getByRole("button", { name: "Enviar para assinatura" }).last().click();

  const janela = page.getByRole("dialog", { name: "Enviar para assinatura digital" });
  await expect(janela.getByText("Passo 1 de 3")).toBeVisible();
  // Só o termo de consentimento: não pede testemunha nem tratamento.
  const contrato = janela.getByRole("checkbox", { name: /Contrato de prestação/ });
  if (await contrato.isChecked()) await contrato.uncheck();
  const termo = janela.getByRole("checkbox", { name: /Termo de consentimento/ });
  if (!(await termo.isChecked())) await termo.check();
  await janela.getByRole("button", { name: "Avançar" }).click();

  await expect(janela.getByText("Passo 2 de 3")).toBeVisible();
  await janela.getByRole("button", { name: "Gerar a pré-visualização" }).click();

  await expect(janela.getByText("Passo 3 de 3")).toBeVisible({ timeout: 60_000 });
  await janela.getByRole("button", { name: "Enviar para assinatura" }).click();
  await expect(janela.getByText("Enviado. Agora é entregar o link a cada pessoa.")).toBeVisible({
    timeout: 60_000,
  });

  // --- o banco: nasceu ENVIADO, pela ZapSign de mentira -----------------------
  const db = await banco();
  const pkg = (
    await db.query(
      `select id, number, status, channel_used, sent_by is not null as tem_quem_enviou
         from public.signature_packages
        where client_id = $1 order by created_at desc limit 1`,
      [paciente.id]
    )
  ).rows[0];
  const signatarios = (
    await db.query(
      `select name, order_group from public.signature_signers where package_id = $1 order by sort_order`,
      [pkg.id]
    )
  ).rows as { name: string; order_group: number }[];
  await db.end();
  expect(pkg.status).toBe("sent");
  expect(pkg.channel_used).toBe("fake");
  expect(pkg.tem_quem_enviou).toBe(true);
  expect(signatarios.map((s) => s.order_group)).toEqual([1, 3]); // paciente, depois a Risarte

  // --- o paciente assina → é a vez do representante (o Gerente) --------------
  await zapsignAssinou(pkg.id, paciente.nome);
  await page.goto("/assinaturas/minhas");
  await expect(page.getByText(pkg.number)).toBeVisible();
  await expect(page.getByText("você assina como representante da Risarte")).toBeVisible();

  const db2 = await banco();
  const aviso = await db2.query(
    `select 1 from public.notifications n join public.profiles p on p.id = n.user_id
      where p.email = $1 and n.title = 'É a sua vez de assinar' and n.body like $2`,
    [PESSOAS.gerente, `%${pkg.number}%`]
  );
  await db2.end();
  expect(aviso.rowCount, "o representante não recebeu o aviso").toBe(1);

  // --- o representante assina → assinado por todos ---------------------------
  await zapsignAssinou(pkg.id, signatarios[1].name);
  await page.goto(`/prontuarios/${paciente.id}?aba=documentos`);
  await esperarEFecharAvisos(page);
  const linha = page.getByText(new RegExp(`${pkg.number} · `)).locator("..").locator("..");
  await expect(linha.getByText("Assinado", { exact: true })).toBeVisible();
});
