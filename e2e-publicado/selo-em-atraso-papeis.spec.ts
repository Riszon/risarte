// ASA2, entrega 2 (4006) — QUEM VÊ O SELO "EM ATRASO" (spec 17.1).
//
// Pedido do dono (13/11/2026): conferir, na tela de verdade, que Dentista, ASB
// e TSB nunca veem o atraso; que a Recepcionista ainda não vê o selo (etapa 1)
// nem o Painel de cobranças; que o SDR não vê selo nenhum. E o CONTROLE: o
// Admin Master vê o selo em todos os lugares. Sem o controle, um teste que não
// acha o selo não prova nada (o paciente podia nem estar em atraso).
//
// O paciente é o LDN-00066 (Londrina - Centro), com parcela em aberto vencida
// há mais que a tolerância e uma avaliação na agenda. O teste confere isso no
// banco antes de olhar as telas, para falhar com o motivo certo.
//
// Só LÊ telas. Roda contra o projeto de teste publicado
// (`npm run test:e2e:publicado`), com a sessão aberta pelo link de acesso de
// uso único (nenhuma senha é digitada nem impressa).

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { AMBIENTE, banco, entrarComo } from "../e2e/apoio";
import { APP_PUBLICADO } from "../playwright.publicado.config";

const CODIGO = "LDN-00066";
const DOMINIO = new URL(APP_PUBLICADO).hostname;

type Cenario = { clientId: string; nome: string; clinicId: string; diaDaAvaliacao: string };
let cenario: Cenario;

test.beforeAll(async () => {
  const db = await banco();
  try {
    const { rows } = await db.query(
      `select c.id, c.full_name, c.clinic_id,
              (select public.overdue_badge_cutoff()) as corte,
              (select min(i.due_date) from public.payment_installments i
                where i.client_id = c.id and i.status in ('em_aberto','parcial')) as mais_antiga,
              (select to_char(a.starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
                 from public.appointments a
                where a.client_id = c.id and a.type = 'evaluation' and a.status <> 'cancelled'
                order by abs(extract(epoch from a.starts_at - now())) limit 1) as dia
         from public.clients c where c.code = $1`,
      [CODIGO]
    );
    const r = rows[0];
    if (!r) throw new Error(`${CODIGO} não existe no banco de treino`);
    if (!r.mais_antiga || !r.corte || r.mais_antiga > r.corte) {
      throw new Error(`${CODIGO} não está em atraso pela tolerância do selo hoje — o teste não provaria nada`);
    }
    if (!r.dia) throw new Error(`${CODIGO} não tem avaliação na agenda`);
    cenario = { clientId: r.id, nome: r.full_name, clinicId: r.clinic_id, diaDaAvaliacao: r.dia };
  } finally {
    await db.end();
  }
});

/** O selo, em qualquer das formas: o completo, o compacto da agenda e o quadro do cockpit. */
function selo(raiz: Page | ReturnType<Page["locator"]>) {
  return raiz.locator('[aria-label^="Em atraso há"]').or(raiz.getByText(/Em atraso há \d+ dias?|atraso \d+d/));
}

async function abrir(page: Page, caminho: string) {
  const resposta = await page.goto(caminho, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  expect(page.url(), `a sessão caiu no login em ${caminho}`).not.toContain("/login");
  return resposta;
}

type Visto = {
  cardDaAgenda: boolean;
  seloNaAgenda: number;
  seloNaJanela: number | null;
  fichaAbriu: boolean;
  seloNaFicha: number;
  avisoNaFicha: number;
  numeroNaAba: number;
  cockpitAbriu: boolean;
  seloNoCockpit: number;
  filtroNaLista: number;
  marcaNaLista: number;
  itemCobrancasNoMenu: number;
  painelAbriu: boolean;
};

async function olharComo(context: BrowserContext, page: Page, email: string): Promise<Visto> {
  await context.clearCookies();
  await entrarComo(context, email, cenario.clinicId, DOMINIO);
  const v = {} as Visto;

  // 1) Agenda da semana: o card da avaliação e a janela do agendamento.
  await abrir(page, `/agenda?vista=semana&ref=${cenario.diaDaAvaliacao}&unidade=${cenario.clinicId}`);
  // O card é o menor bloco com o nome do paciente E o botão "Ver informações"
  // (o nome é link para a ficha; a janela abre pelo botão). Ancestrais vêm
  // antes na ordem do documento: o último é o mais de dentro.
  const card = page
    .locator("div")
    .filter({ has: page.getByText(cenario.nome, { exact: false }) })
    .filter({ has: page.getByRole("button", { name: "Ver informações" }) })
    .last();
  v.cardDaAgenda = await card.isVisible().catch(() => false);
  v.seloNaAgenda = v.cardDaAgenda ? await selo(card).count() : 0;
  v.seloNaJanela = null;
  if (v.cardDaAgenda) {
    await card.getByRole("button", { name: "Ver informações" }).first().click();
    const janela = page.getByRole("dialog");
    if (await janela.isVisible({ timeout: 10_000 }).catch(() => false)) {
      v.seloNaJanela = await selo(janela).count();
      await page.keyboard.press("Escape");
    }
  }

  // 2) Ficha: selo no alto, aviso "cobrança(s) em atraso", número vermelho da aba.
  await abrir(page, `/prontuarios/${cenario.clientId}`);
  v.fichaAbriu = await page.getByText(CODIGO).first().isVisible().catch(() => false);
  v.seloNaFicha = await selo(page.locator("main")).count();
  v.avisoNaFicha = await page.getByText(/\d+ cobranças? em atraso/).count();
  v.numeroNaAba = await page.locator('[title="Cobranças em atraso"]').count();

  // 3) Cockpit da avaliação: o quadro Financeiro com o atraso.
  await abrir(page, `/avaliacao/${cenario.clientId}`);
  v.cockpitAbriu = await page.getByText(cenario.nome, { exact: false }).first().isVisible().catch(() => false);
  v.seloNoCockpit = await selo(page.locator("main")).count();

  // 4) Lista de Prontuários: o filtro e a marca "em atraso".
  await abrir(page, `/prontuarios?q=${encodeURIComponent(CODIGO)}`);
  v.filtroNaLista = await page.locator('select[name="cobranca"]').count();
  v.marcaNaLista = await page.getByText(/\d+ cobranças? em atraso/).count();

  // 5) Painel de cobranças: o item do menu Financeiro e o endereço digitado.
  await page.goto("/financeiro", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  v.itemCobrancasNoMenu = await page.locator('a[href="/financeiro/cobrancas"]').count();
  await page.goto("/financeiro/cobrancas", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  v.painelAbriu = new URL(page.url()).pathname === "/financeiro/cobrancas";

  console.log(`  ${email}: ${JSON.stringify(v)}`);
  return v;
}

function semAtrasoNenhum(v: Visto, quem: string) {
  expect(v.seloNaAgenda, `${quem}: selo no card da agenda`).toBe(0);
  expect(v.seloNaJanela ?? 0, `${quem}: selo na janela do agendamento`).toBe(0);
  expect(v.seloNaFicha, `${quem}: selo no alto da ficha`).toBe(0);
  expect(v.avisoNaFicha, `${quem}: aviso "cobranças em atraso" na ficha`).toBe(0);
  expect(v.numeroNaAba, `${quem}: número vermelho na aba Financeiro`).toBe(0);
  expect(v.seloNoCockpit, `${quem}: atraso no quadro Financeiro do cockpit`).toBe(0);
  expect(v.filtroNaLista, `${quem}: filtro "em atraso" na lista de Prontuários`).toBe(0);
  expect(v.marcaNaLista, `${quem}: marca "em atraso" na lista de Prontuários`).toBe(0);
}

/**
 * A FONTE de todo selo: `client_overdue_badges` (o banco só devolve o paciente
 * a quem pode ver o selo) e as parcelas do paciente (o aviso da ficha, o número
 * da aba e a marca da lista contam as parcelas que a pessoa enxerga). Pergunta
 * com a sessão DA PESSOA, não com a chave de serviço.
 */
async function aFonteDiz(email: string) {
  const admin = createClient(AMBIENTE.NEXT_PUBLIC_SUPABASE_URL, AMBIENTE.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`link de acesso de ${email}: ${error.message}`);
  const pessoa = createClient(AMBIENTE.NEXT_PUBLIC_SUPABASE_URL, AMBIENTE.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: e2 } = await pessoa.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "email" });
  if (e2) throw new Error(`sessão de ${email}: ${e2.message}`);
  const selos = await pessoa.rpc("client_overdue_badges", { p_client_ids: [cenario.clientId] });
  const parcelas = await pessoa.from("payment_installments").select("id").eq("client_id", cenario.clientId);
  await pessoa.auth.signOut();
  return {
    selo: selos.error ? `erro: ${selos.error.message}` : (selos.data as unknown[]).length,
    parcelasVistas: parcelas.error ? `erro: ${parcelas.error.message}` : (parcelas.data ?? []).length,
  };
}

test.describe.configure({ mode: "serial" });

test("A FONTE DO SELO — só o Admin recebe o atraso do LDN-00066; os demais, nada", async () => {
  const admin = await aFonteDiz("admin@example.com");
  console.log(`  fonte admin@example.com: ${JSON.stringify(admin)}`);
  expect(admin.selo, "CONTROLE: o Admin recebe o selo").toBe(1);
  expect(admin.parcelasVistas as number, "CONTROLE: o Admin vê as parcelas").toBeGreaterThan(0);

  for (const email of ["dentista@example.com", "asb@example.com", "tsb@example.com", "sdr@example.com"]) {
    const f = await aFonteDiz(email);
    console.log(`  fonte ${email}: ${JSON.stringify(f)}`);
    expect(f.selo, `${email}: selo pela fonte`).toBe(0);
    // ⚠️ ACHADO de 13/11/2026, ANTERIOR à 4006: a política de leitura de
    // `payment_installments` (acesso total à unidade) deixa ASB, TSB, SDR (e
    // outros) lerem as parcelas pela API, embora a tela não as mostre. Fica só
    // registrado aqui (sem afirmar), até o dono decidir a correção.
    if (typeof f.parcelasVistas === "number" && f.parcelasVistas > 0) {
      test.info().annotations.push({ type: "achado", description: `${email} lê ${f.parcelasVistas} parcela(s) do ${CODIGO} pela API` });
    }
  }
  const r = await aFonteDiz("recepcao@example.com");
  console.log(`  fonte recepcao@example.com: ${JSON.stringify(r)}`);
  expect(r.selo, "recepção: selo pela fonte (etapa 1)").toBe(0);
});

test("CONTROLE — o Admin Master vê o selo em todos os lugares", async ({ context, page }) => {
  const v = await olharComo(context, page, "admin@example.com");
  expect(v.cardDaAgenda, "o card da avaliação aparece na agenda").toBe(true);
  expect(v.seloNaAgenda, "selo no card da agenda").toBeGreaterThan(0);
  expect(v.seloNaJanela, "selo na janela do agendamento").toBeGreaterThan(0);
  expect(v.fichaAbriu).toBe(true);
  expect(v.seloNaFicha, "selo no alto da ficha").toBeGreaterThan(0);
  expect(v.avisoNaFicha, "aviso na ficha").toBeGreaterThan(0);
  expect(v.numeroNaAba, "número na aba Financeiro").toBeGreaterThan(0);
  expect(v.cockpitAbriu).toBe(true);
  expect(v.seloNoCockpit, "atraso no cockpit").toBeGreaterThan(0);
  expect(v.filtroNaLista, "filtro na lista").toBeGreaterThan(0);
  expect(v.marcaNaLista, "marca na lista").toBeGreaterThan(0);
  expect(v.itemCobrancasNoMenu, "item Cobranças no menu Financeiro").toBeGreaterThan(0);
  expect(v.painelAbriu, "Painel de cobranças abre").toBe(true);
});

for (const email of ["dentista@example.com", "asb@example.com", "tsb@example.com"]) {
  test(`${email} — nunca vê o atraso`, async ({ context, page }) => {
    const v = await olharComo(context, page, email);
    // Sem atendimento marcado com ele, o clínico nem chega ao paciente (ficha
    // "Acesso restrito", cockpit 404, card fora da agenda dele). Fica anotado:
    // nesse caso, a prova de que o selo não viria é o teste da FONTE, acima.
    if (!v.cardDaAgenda && !v.fichaAbriu && !v.cockpitAbriu) {
      test.info().annotations.push({ type: "acesso", description: `${email} não alcança o ${CODIGO} nas telas` });
    }
    semAtrasoNenhum(v, email);
    expect(v.painelAbriu, "Painel de cobranças").toBe(false);
  });
}

test("recepcao@example.com — sem o selo (etapa 1) e sem o Painel de cobranças", async ({ context, page }) => {
  const v = await olharComo(context, page, "recepcao@example.com");
  expect(v.cardDaAgenda, "a recepção vê o card da avaliação").toBe(true);
  expect(v.seloNaAgenda, "selo no card da agenda").toBe(0);
  expect(v.seloNaJanela ?? 0, "selo na janela do agendamento").toBe(0);
  expect(v.fichaAbriu, "a recepção abre a ficha").toBe(true);
  expect(v.seloNaFicha, "selo no alto da ficha").toBe(0);
  expect(v.seloNoCockpit, "atraso no cockpit").toBe(0);
  expect(v.itemCobrancasNoMenu, "item Cobranças no menu Financeiro").toBe(0);
  expect(v.painelAbriu, "/financeiro/cobrancas digitado direto").toBe(false);
});

test("sdr@example.com — sem selo em lugar nenhum", async ({ context, page }) => {
  const v = await olharComo(context, page, "sdr@example.com");
  semAtrasoNenhum(v, "sdr@example.com");
  expect(v.painelAbriu, "Painel de cobranças").toBe(false);
});
