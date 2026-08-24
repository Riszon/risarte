// APOIO DOS TESTES PONTA A PONTA — entrar como cada papel, inventar dado de
// pessoa e perguntar ao banco o que a tela não mostra.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";

export const AMBIENTE = Object.fromEntries(
  readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
) as Record<string, string>;

export const PRODUCAO = "hvhbijctanrrkxhemlza";
if (AMBIENTE.TEST_DB_URL?.includes(PRODUCAO)) {
  throw new Error("RECUSADO: os testes nunca rodam contra a produção.");
}

/** Os apelidos criados pela semeadura (`scripts/seed-test.mjs`). */
export const PESSOAS = {
  admin: "admin@example.com",
  recepcao: "recepcao@example.com",
  coordenador: "coordenador@example.com",
  planner: "planner@example.com",
  consultor: "consultor@example.com",
  dentista: "dentista@example.com",
  gerente: "gerente@example.com",
  financeiro: "financeiro@example.com",
  comprador: "comprador@example.com",
  sdr: "sdr@example.com",
} as const;

/**
 * Entra no sistema SEM passar pela tela de login.
 *
 * Pede ao Supabase um link de acesso de uso único e troca por sessão — o mesmo
 * caminho da varredura de telas. Serve para chegar rápido ao passo que
 * interessa: uma jornada passa por cinco papéis, e digitar cinco logins em cada
 * teste transformaria a tela de login no que mais é testado no sistema.
 *
 * A tela de login de verdade tem um teste só para ela, onde ela é o assunto.
 */
export async function entrarComo(
  context: BrowserContext,
  email: string,
  clinicId?: string
) {
  const admin = createClient(
    AMBIENTE.NEXT_PUBLIC_SUPABASE_URL,
    AMBIENTE.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`link de acesso de ${email}: ${error.message}`);

  const pote = new Map<string, string>();
  const ssr = createServerClient(
    AMBIENTE.NEXT_PUBLIC_SUPABASE_URL,
    AMBIENTE.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () =>
          [...pote].map(([name, value]) => ({ name, value })),
        setAll: (lista) => lista.forEach((c) => pote.set(c.name, c.value)),
      },
    }
  );
  const { error: erroSessao } = await ssr.auth.verifyOtp({
    token_hash: data.properties!.hashed_token,
    type: "email",
  });
  if (erroSessao) throw new Error(`sessão de ${email}: ${erroSessao.message}`);

  await context.addCookies(
    [...pote]
      .map(([name, value]) => ({ name, value }))
      .concat(clinicId ? [{ name: "risarte_active_clinic", value: clinicId }] : [])
      .map((c) => ({ ...c, domain: "localhost", path: "/" }))
  );
}

/**
 * Troca de papel na MESMA aba.
 *
 * A jornada passa por cinco pessoas diferentes, e cada uma faz a sua parte no
 * mesmo paciente. Sem limpar os biscoitos antes, a sessão anterior continuaria
 * valendo e o teste provaria a coisa errada: que o coordenador consegue fazer o
 * que a recepção fez.
 */
export async function trocarPara(
  context: BrowserContext,
  email: string,
  clinicId?: string
) {
  await context.clearCookies();
  await entrarComo(context, email, clinicId);
}

/**
 * Fecha os avisos que aparecem por cima da tela.
 *
 * A recepção recebe um aviso MODAL quando há paciente esperando o agendamento
 * da apresentação comercial — e ele é insistente de propósito: é assim que o
 * sistema garante que ninguém fica parado no meio da jornada. Para o robô ele é
 * um obstáculo real, exatamente como é para a pessoa: enquanto está aberto, o
 * resto da tela não existe.
 *
 * Fecha pelo "Fechar", nunca pelo "Já agendei" — este último AFIRMA um fato que
 * não aconteceu, e o teste passaria a mentir sobre o estado da unidade.
 *
 * Fechar UMA vez não resolve: o aviso nasce depois que a página carrega, e a
 * primeira versão desta função limpava a tela antes de ele existir. Por isso o
 * tratador fica ARMADO — o Playwright o dispara toda vez que o modal aparecer
 * na frente de uma ação, quantas vezes for preciso.
 */
export async function fecharAvisos(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addLocatorHandler(
    page.getByRole("dialog").filter({ hasText: "Agendar apresentação" }),
    async (aviso) => {
      await aviso.getByRole("button", { name: "Fechar" }).click();
    },
    { times: 20 }
  );
}

/**
 * Espera o aviso aparecer e o fecha AGORA, antes de abrir menus.
 *
 * O tratador armado resolve o aviso que chega no meio de um clique, mas não
 * resolve um caso: o aviso aparecendo em cima de um MENU já aberto. Ele fecha o
 * aviso e o menu junto, e a ação seguinte procura um item que sumiu. Por isso,
 * antes de mexer em menu, esvazia-se a tela de propósito.
 */
export async function esperarEFecharAvisos(
  page: import("@playwright/test").Page
): Promise<void> {
  const aviso = page.getByRole("dialog").filter({ hasText: "Agendar apresentação" });
  await aviso
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  for (let i = 0; i < 3 && (await aviso.count()) > 0; i++) {
    await aviso
      .first()
      .getByRole("button", { name: "Fechar" })
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * Cadastra um paciente pela tela da recepção e devolve o que o teste precisa.
 *
 * Pela TELA de propósito: é assim que um paciente nasce de verdade. Inserir
 * direto no banco pularia máscara, duplicidade, fase inicial e auditoria — e o
 * teste passaria a encenar um começo que não existe.
 */
export async function criarPacienteNaRecepcao(
  page: import("@playwright/test").Page,
  context: BrowserContext,
  prefixo = "Paciente"
): Promise<{ id: string; nome: string; cpf: string }> {
  await trocarPara(context, PESSOAS.recepcao);
  const cpf = cpfDeTeste();
  const nome = nomeDeTeste(prefixo);

  await page.goto("/prontuarios/novo");
  await fecharAvisos(page);
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

  await page.waitForURL(/\/prontuarios\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const id = page.url().split("/prontuarios/")[1].split(/[?#]/)[0];
  return { id, nome, cpf };
}

/**
 * Leva um paciente novo da Aquisição até o Centro de Planejamento.
 *
 * Vive aqui porque **três testes diferentes precisam de um caso que já chegou
 * ao Planejamento**, e refazer o caminho em cada um deixaria três cópias que
 * envelhecem em ritmos diferentes. Quem PROVA que este caminho funciona é o
 * `02-avaliacao.spec.ts`; aqui ele é só o meio de chegar.
 *
 * Sem `expect` de propósito: apoio que afirma esconde a afirmação do teste que
 * deveria fazê-la.
 */
export async function levarAoPlanejamento(
  page: import("@playwright/test").Page,
  context: BrowserContext,
  prefixo = "Jornada"
): Promise<{ id: string; nome: string; cpf: string }> {
  const paciente = await criarPacienteNaRecepcao(page, context, prefixo);

  // A recepção move para a Conversão Clínica.
  await page.goto(`/prontuarios/${paciente.id}`);
  await esperarEFecharAvisos(page);
  await page.getByRole("tab", { name: "Jornada" }).click();
  await page.getByRole("button", { name: "Mover de fase" }).click();
  await page.getByRole("menuitem", { name: "Conversão Clínica" }).click();
  await page.getByText("Conversão Clínica").first().waitFor();

  // O Coordenador registra consentimento e anamnese, e envia.
  await trocarPara(context, PESSOAS.coordenador);
  await fecharAvisos(page);
  await page.goto(`/avaliacao/${paciente.id}`);
  await page.getByRole("button", { name: "Registrar consentimento" }).click();
  await page.getByText(/Consentimento registrado em/).waitFor();

  await page
    .getByRole("button", { name: /^Levantamento de informações/ })
    .click();
  await page.getByRole("combobox").first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Preencher", exact: true }).click();
  const pergunta = page.getByText(
    "Está em tratamento ou acompanhamento médico?"
  );
  await pergunta.waitFor();
  await pergunta
    .locator("xpath=..")
    .getByRole("button", { name: "Não", exact: true })
    .click();
  await page.getByRole("button", { name: "Salvar anamnese" }).click();
  await page.getByText(/Anamnese/).first().waitFor();

  await page.goto(`/avaliacao/${paciente.id}`);
  await page.getByRole("button", { name: /^Enviar ao Planejamento/ }).click();
  const enviar = page.getByRole("button", {
    name: "Enviar ao Centro de Planejamento",
  });
  await enviar.waitFor();
  await enviar.click();
  await page.getByText("Centro de Planejamento").first().waitFor();

  return paciente;
}

/**
 * Leva um paciente novo até a Conversão Comercial, com plano aprovado.
 *
 * Quem PROVA que este caminho funciona é o `03-planejamento.spec.ts`; aqui ele
 * é o meio de chegar ao assunto seguinte. O caminho é longo porque o sistema é
 * assim de propósito: não existe negociação sem aprovação clínica.
 */
export async function levarAoComercial(
  page: import("@playwright/test").Page,
  context: BrowserContext,
  prefixo = "Venda"
): Promise<{ id: string; nome: string; cpf: string }> {
  const paciente = await levarAoPlanejamento(page, context, prefixo);

  // O Planner monta o plano.
  await trocarPara(context, PESSOAS.planner);
  await fecharAvisos(page);
  await page.goto(`/planejamento/${paciente.id}`);
  await page.getByRole("button", { name: "Iniciar plano de tratamento" }).click();

  const diagnostico = page.getByRole("textbox", { name: "Diagnóstico" });
  await diagnostico.waitFor();
  await diagnostico.fill("Cárie em elemento 26, sem comprometimento pulpar.");
  await page.getByRole("heading", { name: "Opções de tratamento" }).click();

  await page.getByRole("button", { name: "Adicionar opção de tratamento" }).click();
  await page
    .getByRole("textbox", { name: /Título da opção/ })
    .fill("Plano principal");
  await page.getByRole("checkbox", { name: /Plano principal/ }).check();
  await page.getByRole("button", { name: "Adicionar opção", exact: true }).click();
  await page.getByText("Opção adicionada.").waitFor().catch(() => {});

  await page.reload();
  await page.getByRole("heading", { name: "Opções de tratamento" }).waitFor();
  const item = page.getByRole("button", { name: "Procedimento", exact: true }).first();
  if (!(await item.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Expandir opção" }).first().click();
  }
  await item.waitFor({ state: "visible" });
  await item.click();
  await page
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Restauração em resina 1 face (R$ 280,00)" });
  await page.getByRole("button", { name: "Item", exact: true }).click();
  await page.getByText(/adicionad/i).first().waitFor().catch(() => {});

  await page.reload();
  await page
    .locator("select")
    .filter({ hasText: "Selecione..." })
    .first()
    .selectOption({ label: "Saúde" });
  await page.getByRole("button", { name: "Salvar pilar" }).click();
  await page.getByText(/Atual: Saúde/).waitFor().catch(() => {});

  await page.reload();
  const enviarAprovacao = page.getByRole("button", {
    name: "Enviar para aprovação do Coordenador",
  });
  await enviarAprovacao.waitFor();
  await enviarAprovacao.click();
  await page.getByText(/Aguardando aprovação/).first().waitFor();

  // O Coordenador aprova (contorno do defeito conhecido: ver item 2 de
  // docs/CORRECOES-TESTES.md — o primeiro clique não abre a opção).
  await trocarPara(context, PESSOAS.coordenador);
  await fecharAvisos(page);
  await page.goto(`/prontuarios/${paciente.id}`);
  await esperarEFecharAvisos(page);
  await page.getByRole("tab", { name: "Plano", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    if (await page.getByRole("button", { name: /Aprovar opção/ }).count()) break;
    await page
      .getByRole("button", { name: /^(Expandir|Recolher) opção$/ })
      .first()
      .click();
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: /Aprovar opção/ }).first().click();
  await page.getByText(/aprovada/i).first().waitFor();

  // O Planner envia ao Comercial.
  await trocarPara(context, PESSOAS.planner);
  await fecharAvisos(page);
  await page.goto(`/planejamento/${paciente.id}`);
  const enviarComercial = page.getByRole("button", {
    name: /Enviar ao Comercial/,
  });
  await enviarComercial.waitFor();
  await enviarComercial.click();
  await page.getByText(/Conversão Comercial/).first().waitFor();

  return paciente;
}

/** Conexão com o banco de teste, para perguntar o que a tela não mostra. */
export async function banco() {
  const client = new pg.Client({
    connectionString: AMBIENTE.TEST_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

/**
 * CPF válido e diferente a cada rodada.
 *
 * Diferente porque o sistema recusa CPF repetido de propósito (cliente é único
 * na rede) — reaproveitar o mesmo faria o segundo teste falhar por acerto do
 * sistema. Válido porque a máscara e o cadastro conferem o dígito: um número
 * qualquer seria recusado antes de o teste chegar onde interessa.
 */
export function cpfDeTeste(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digito = (numeros: number[]) => {
    const peso = numeros.length + 1;
    const soma = numeros.reduce((s, n, i) => s + n * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base);
  const d2 = digito([...base, d1]);
  return [...base, d1, d2].join("");
}

/** Nome fictício, marcado como tal — ninguém confunde com paciente de verdade. */
export function nomeDeTeste(prefixo = "Paciente"): string {
  const carimbo = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `${prefixo} Teste ${carimbo}`;
}

export const mascaraCpf = (cpf: string) =>
  cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
