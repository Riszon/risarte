// E2E-1 — A JORNADA COMEÇA: da porta da frente ao paciente cadastrado.
//
// Primeira fatia do teste profundo. Ela prova o caminho que todo o resto usa:
// entrar no sistema e criar o paciente que vai andar pelas sete fases.
//
// Cada passo termina perguntando ao BANCO, não só olhando a tela. Tela que diz
// "cadastrado" com o registro errado por trás é exatamente o defeito que um
// teste de aparência não pega.

import { expect, test } from "@playwright/test";
import {
  AMBIENTE,
  PESSOAS,
  banco,
  cpfDeTeste,
  entrarComo,
  fecharAvisos,
  mascaraCpf,
  nomeDeTeste,
} from "./apoio";

test.describe("A porta da frente", () => {
  test("a recepção entra com e-mail e senha", async ({ page }) => {
    // O único teste que usa a tela de login de verdade. Os outros entram por
    // sessão pronta: uma jornada passa por cinco papéis, e digitar cinco logins
    // em cada teste faria da tela de login a parte mais testada do sistema.
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(PESSOAS.recepcao);
    await page.getByLabel("Senha").fill(AMBIENTE.TEST_USER_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test("senha errada não entra, e o aviso não diz se o e-mail existe", async ({
    page,
  }) => {
    // LGPD e segurança: mensagem que diferencia "e-mail não existe" de "senha
    // errada" entrega a lista de quem é cliente da rede.
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(PESSOAS.recepcao);
    await page.getByLabel("Senha").fill("senha-errada-de-proposito");
    await page.getByRole("button", { name: "Entrar" }).click();

    const aviso = page.getByRole("alert");
    await expect(aviso).toBeVisible();
    await expect(aviso).not.toContainText(/não existe|não encontrado|não cadastrad/i);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Fase 1 — Aquisição", () => {
  test("a recepção cadastra o paciente e ele nasce na Aquisição", async ({
    page,
    context,
  }) => {
    await entrarComo(context, PESSOAS.recepcao);

    const cpf = cpfDeTeste();
    const nome = nomeDeTeste();

    await page.goto("/prontuarios/novo");
    await fecharAvisos(page);
    await expect(page.getByRole("heading", { name: "Novo cliente" })).toBeVisible();

    await page.getByLabel("CPF").first().fill(mascaraCpf(cpf));
    await page.getByLabel("Nome completo").fill(nome);
    await page.getByLabel("Data de nascimento").fill("1990-05-12");
    await page.getByLabel("Telefone / WhatsApp").fill("(43) 99999-0001");
    await page.getByLabel("E-mail").fill("paciente.teste@example.com");
    await page.getByLabel("Endereço (rua/avenida)").fill("Rua de Teste");
    await page.getByLabel("Número").fill("100");
    await page.getByLabel("Bairro").fill("Centro");
    await page.getByLabel("Cidade").fill("Cambé");
    await page.getByLabel("UF").fill("PR");
    await page.getByLabel("CEP").fill("86180-000");

    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    // A tela confirma...
    await expect(page).toHaveURL(/\/prontuarios\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    await expect(page.getByText(nome).first()).toBeVisible();

    // ...e o banco confirma o mesmo. É aqui que mora a diferença entre "a tela
    // disse que salvou" e "salvou".
    const db = await banco();
    // O CPF é guardado COM máscara. A busca tira a pontuação dos dois lados de
    // propósito: o teste está perguntando "existe este CPF?", não "existe esta
    // string?" — e amarrá-lo ao formato faria ele quebrar no dia em que a
    // gravação mudasse, sem nada de errado ter acontecido.
    const { rows } = await db.query(
      `select c.journey_phase, c.status, cl.code as unidade
         from public.clients c
         join public.clinics cl on cl.id = c.clinic_id
        where regexp_replace(c.cpf, '\\D', '', 'g') = $1`,
      [cpf]
    );
    await db.end();

    expect(rows).toHaveLength(1);
    // Fase 1 da jornada. Nascer em outra fase pularia etapa de gente.
    expect(rows[0].journey_phase).toBe("acquisition");
    expect(rows[0].status).toBe("active");
    // Cadastrado pela recepção da unidade, ele pertence à unidade — não à rede.
    expect(rows[0].unidade).toBe("CAM");
  });

  test("o mesmo CPF não vira dois pacientes na rede", async ({
    page,
    context,
  }) => {
    // "Cliente é único na rede" é regra estrutural: o mesmo CPF em duas
    // unidades quebraria histórico clínico, financeiro e compartilhamento.
    await entrarComo(context, PESSOAS.recepcao);

    const cpf = cpfDeTeste();
    const nome = nomeDeTeste("Repetido");

    for (const tentativa of [1, 2]) {
      await page.goto("/prontuarios/novo");
      await fecharAvisos(page);
      await page.getByLabel("CPF").first().fill(mascaraCpf(cpf));
      // O aviso de duplicado nasce ao sair do campo do CPF.
      await page.getByLabel("Nome completo").click();
      await page.getByLabel("Nome completo").fill(nome);
      await page.getByLabel("Data de nascimento").fill("1985-03-20");
      await page.getByLabel("Telefone / WhatsApp").fill("(43) 99999-0002");
      await page.getByLabel("E-mail").fill("repetido.teste@example.com");
      await page.getByLabel("Endereço (rua/avenida)").fill("Rua de Teste");
      await page.getByLabel("Número").fill("200");
      await page.getByLabel("Bairro").fill("Centro");
      await page.getByLabel("Cidade").fill("Cambé");
      await page.getByLabel("UF").fill("PR");
      await page.getByLabel("CEP").fill("86180-000");

      if (tentativa === 1) {
        await page.getByRole("button", { name: "Cadastrar cliente" }).click();
        await expect(page).toHaveURL(/\/prontuarios\/[0-9a-f-]{36}/, {
          timeout: 30_000,
        });
      } else {
        // Na segunda, o sistema tem de avisar ANTES de deixar salvar.
        await expect(
          page.getByText("Cliente já cadastrado na rede")
        ).toBeVisible({ timeout: 20_000 });
      }
    }

    const db = await banco();
    const { rows } = await db.query(
      `select count(*)::int as n from public.clients
        where regexp_replace(cpf, '\\D', '', 'g') = $1`,
      [cpf]
    );
    await db.end();
    expect(rows[0].n).toBe(1);
  });
});
