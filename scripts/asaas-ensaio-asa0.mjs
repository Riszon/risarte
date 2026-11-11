// ENSAIO DA ASA0 (4000, 4001 e 4002) no banco de TREINO, numa transação
// DESFEITA (rollback): nada fica gravado — nem conta, nem segredo no Vault.
// Uso: node scripts/asaas-ensaio-asa0.mjs --confirmar
//
// Aplica as três migrações dentro da transação (prova também que rodar de
// novo não quebra) e percorre: quem pode abrir conta, a trava de produção, o
// termo antes da chave do Gerente, a ida e volta no Vault, o registro de uso,
// a regra de linha por papel, o webhook, as tarifas com vigência, a
// prontidão que cai sozinha, o aviso ao Admin Master e a desativação.
//
// As chaves usadas aqui são INVENTADAS (não abrem conta nenhuma). A saída só
// tem nomes de conferência e contagens — nunca chave, token ou dado pessoal.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const MIGRACOES = [
  "supabase/migrations/4000_asaas_fundacao_contas_e_vault.sql",
  "supabase/migrations/4001_asaas_tarifas_no_adquirente.sql",
  "supabase/migrations/4002_central_prontidao_historico_e_verificacao.sql",
];

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa0.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);

/** Roda e devolve o texto do erro (ou null se passou). */
async function recusa(sql, params = []) {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    await c.query("release savepoint s");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return `${e.code ?? ""} ${e.message}`;
  }
}
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];

/** Passa a agir como a pessoa, com o papel de usuário logado (a RLS vale). */
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await c.query("set local role authenticated");
}
/** Volta a ser o servidor (chave de serviço não é pessoa). */
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

const CHAVE_TESTE = "$aact_hmlg_" + "ensaio".repeat(8);
const CHAVE_TESTE_2 = "$aact_hmlg_" + "troca0".repeat(8);
const CHAVE_PROD = "$aact_prod_" + "ensaio".repeat(8);
const TOKEN = "tok" + "0123456789abcdef".repeat(3);

try {
  await c.query("begin");

  for (const arq of MIGRACOES) await c.query(readFileSync(arq, "utf8"));
  // De novo: idempotente.
  let rodouDeNovo = true;
  for (const arq of MIGRACOES) {
    const e = await recusa(readFileSync(arq, "utf8"));
    if (e) {
      rodouDeNovo = false;
      console.log("  reaplicar falhou em", arq, "→", e);
    }
  }
  conf("as três migrações rodam duas vezes sem erro", rodouDeNovo);

  const pessoa = async (conta) =>
    (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const admin = await pessoa("admin");
  const gerente = await pessoa("gerente");
  const financeiro = await pessoa("financeiro");
  const coordenador = await pessoa("coordenador");
  if (!admin || !gerente || !financeiro || !coordenador) {
    throw new Error("NÃO MEDI: faltam as contas de teste (admin, gerente, financeiro, coordenador).");
  }
  const unidade = (
    await um(
      "select r.clinic_id from public.user_clinic_roles_all r where r.user_id = $1 and r.role = 'unit_manager' limit 1",
      [gerente]
    )
  )?.clinic_id;
  // O treino tem contas de teste DE VERDADE (as do sandbox) em algumas
  // unidades: o ensaio usa só unidades que ainda não têm conta em uso.
  const SEM_CONTA =
    "not exists (select 1 from public.gateway_accounts a where a.clinic_id = c.id and a.status <> 'disabled')";
  const outraUnidade = (
    await um(
      `select c.id from public.clinics c where c.type = 'franchise_unit' and c.id <> $1 and ${SEM_CONTA} order by c.name limit 1`,
      [unidade]
    )
  )?.id;
  const franqueadora = (
    await um(`select c.id from public.clinics c where c.type = 'franchisor' and ${SEM_CONTA} order by c.name limit 1`)
  )?.id;
  const unidadeLivre = unidade
    ? (await um(`select c.id from public.clinics c where c.id = $1 and ${SEM_CONTA}`, [unidade]))?.id
    : null;
  if (!unidade || !unidadeLivre || !outraUnidade || !franqueadora) {
    throw new Error("NÃO MEDI: o ensaio precisa de duas unidades e uma franqueadora SEM conta Asaas em uso no treino.");
  }

  // ---- 1) Funções internas fechadas -----------------------------------------
  const internas = await c.query(`
    select p.oid::regprocedure::text as f,
           has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as logado
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '\\_gateway\\_%' or p.proname like '\\_central\\_%'
            or p.proname in ('gateway_accounts_guard', 'gateway_accounts_no_delete', 'gateway_accounts_refresh_mark'))`);
  if (internas.rows.length < 10) throw new Error("NÃO MEDI: não achei as funções internas.");
  conf("nenhuma função interna responde a anon nem a logado", internas.rows.every((r) => !r.anon && !r.logado));
  const publicas = await c.query(`
    select has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'gateway\\_%' or p.proname like 'central\\_%')`);
  conf("nenhuma função da Central responde sem login", publicas.rows.length > 5 && publicas.rows.every((r) => !r.anon));

  // ---- 2) Abrir conta: só o Admin Master -------------------------------------
  await como(gerente);
  let e = await recusa("select public.gateway_create_account($1, 'unit', 'Ensaio', null, 'sandbox')", [unidade]);
  conf("Gerente não abre cadastro de conta", /NOT_ALLOWED/.test(e ?? ""));

  await como(admin);
  e = await recusa("select public.gateway_create_account($1, 'unit', 'Ensaio prod', null, 'production')", [unidade]);
  conf("conta de PRODUÇÃO é recusada pelo banco", /GATEWAY_PRODUCTION_LOCKED/.test(e ?? ""));
  e = await recusa("select public.gateway_create_account($1, 'franchisor', 'Tipo trocado', null, 'sandbox')", [unidade]);
  conf("unidade não vira conta raiz", /OWNER_TYPE_MISMATCH/.test(e ?? ""));

  const conta = (await um("select public.gateway_create_account($1, 'unit', 'Ensaio unidade', null, 'sandbox') as id", [unidade])).id;
  const contaOutra = (await um("select public.gateway_create_account($1, 'unit', 'Ensaio outra', null, 'sandbox') as id", [outraUnidade])).id;
  const contaRaiz = (await um("select public.gateway_create_account($1, 'franchisor', 'Ensaio raiz', null, 'sandbox') as id", [franqueadora])).id;
  e = await recusa("select public.gateway_create_account($1, 'unit', 'Ensaio repetida', null, 'sandbox')", [unidade]);
  conf("uma conta em uso por unidade e ambiente", /ACCOUNT_ALREADY_EXISTS/.test(e ?? ""));

  // ---- 3) Usuário logado nunca alcança o segredo -----------------------------
  e = await recusa("select * from public._gateway_read_key($1, 'ensaio', null)", [conta]);
  conf("Admin logado não chama a leitura da chave", /permission denied/.test(e ?? ""));
  e = await recusa("select count(*) from vault.decrypted_secrets");
  conf("Admin logado não lê o Vault", /permission denied/.test(e ?? ""));
  e = await recusa("insert into public.gateway_accounts (owner_type, clinic_id, label) values ('unit', $1, 'direto')", [outraUnidade]);
  conf("ninguém grava direto na tabela de contas", e !== null);
  e = await recusa("update public.gateway_accounts set wallet_id = 'x' where id = $1 returning id", [conta]);
  const mudou = (await um("select wallet_id from public.gateway_accounts where id = $1", [conta])).wallet_id;
  conf("ninguém altera a conta direto na tabela", mudou === null);

  // ---- 4) O termo antes da chave do Gerente ----------------------------------
  await comoServidor();
  const guardar = (contaId, ator, chave) =>
    recusa(
      "select public._gateway_store_credentials($1, $2, $3, 'wallet-ensaio', 'acc-ensaio', 'Conta Ensaio', null, '{\"general\":\"APPROVED\"}'::jsonb, null)",
      [contaId, ator, chave]
    );
  e = await guardar(conta, gerente, CHAVE_TESTE);
  conf("Gerente SEM termo registrado não grava a chave", /NOT_ALLOWED/.test(e ?? ""));

  await como(gerente);
  e = await recusa("select public.gateway_register_term($1, current_date, 'Fulano de Tal', null)", [conta]);
  conf("Gerente não registra o próprio termo", /NOT_ALLOWED/.test(e ?? ""));
  await como(admin);
  e = await recusa("select public.gateway_register_term($1, current_date + 3, 'Fulano de Tal', null)", [conta]);
  conf("termo com data futura é recusado", /TERM_DATE_INVALID/.test(e ?? ""));
  await c.query("select public.gateway_register_term($1, current_date, 'Franqueado de Ensaio', 'ensaio')", [conta]);
  conf("a tela sabe que o Gerente passou a poder", true);

  await como(gerente);
  conf(
    "gateway_can_link: Gerente da unidade sim, de outra não",
    (await um("select public.gateway_can_link($1) as v", [conta])).v === true &&
      (await um("select public.gateway_can_link($1) as v", [contaOutra])).v === false
  );

  await comoServidor();
  e = await guardar(contaOutra, gerente, CHAVE_TESTE);
  conf("Gerente não grava a chave de OUTRA unidade", /NOT_ALLOWED/.test(e ?? ""));
  e = await guardar(conta, gerente, CHAVE_PROD);
  conf("chave de produção numa conta de teste é recusada", /API_KEY_WRONG_ENVIRONMENT/.test(e ?? ""));
  e = await guardar(conta, coordenador, CHAVE_TESTE);
  conf("outro papel da unidade não grava a chave", /NOT_ALLOWED/.test(e ?? ""));
  e = await guardar(conta, gerente, CHAVE_TESTE);
  conf("Gerente COM termo grava a chave da própria unidade", e === null);

  // ---- 5) Vault: ida e volta, e o uso registrado ------------------------------
  const lida = await um("select * from public._gateway_read_key($1, 'ensaio', $2)", [conta, admin]);
  conf("a chave volta igual do Vault (só para o servidor)", lida.api_key === CHAVE_TESTE && lida.environment === "sandbox");
  const usos = await um("select count(*)::int n, bool_and(actor = $2) as ator from public.gateway_key_usage where account_id = $1", [conta, admin]);
  conf("cada leitura da chave fica registrada com quem e para quê", usos.n === 1 && usos.ator === true);
  conf("o último uso da chave fica na conta", (await um("select api_key_last_used_at is not null as v from public.gateway_accounts where id = $1", [conta])).v);
  e = await recusa("select * from public._gateway_read_key($1, '', null)", [conta]);
  conf("leitura da chave sem finalidade é recusada", /PURPOSE_REQUIRED/.test(e ?? ""));

  const antes = (await um("select api_key_secret_id as id from public.gateway_accounts where id = $1", [conta])).id;
  await guardar(conta, admin, CHAVE_TESTE_2);
  const depois = await um("select api_key_secret_id as id from public.gateway_accounts where id = $1", [conta]);
  const lida2 = await um("select * from public._gateway_read_key($1, 'ensaio', null)", [conta]);
  conf("trocar a chave reaproveita o mesmo segredo do Vault", depois.id === antes && lida2.api_key === CHAVE_TESTE_2);

  const naTrilha = await um(
    "select count(*)::int n from public.audit_changes where table_name = 'gateway_accounts' and (changes::text like '%aact_%')"
  );
  conf("a trilha de auditoria não guarda a chave", naTrilha.n === 0);
  const linhas = await um("select count(*)::int n from public.audit_changes where table_name = 'gateway_accounts' and row_id = $1", [conta]);
  conf("a conta entrou na auditoria", linhas.n >= 2);

  // ---- 6) Regra de linha por papel --------------------------------------------
  await como(gerente);
  const vg = await c.query("select id from public.gateway_accounts");
  conf("Gerente lê só a conta da própria unidade", vg.rows.length === 1 && vg.rows[0].id === conta);
  conf("Gerente não lê o registro de uso da chave", (await um("select count(*)::int n from public.gateway_key_usage")).n === 0);
  await como(coordenador);
  conf("Coordenador não lê conta nenhuma", (await um("select count(*)::int n from public.gateway_accounts")).n === 0);
  await como(financeiro);
  conf("Financeiro da Franqueadora lê todas", (await um("select count(*)::int n from public.gateway_accounts where id = any($1)", [[conta, contaOutra, contaRaiz]])).n === 3);

  // ---- 7) Webhook ---------------------------------------------------------------
  await comoServidor();
  await c.query("select public._gateway_store_webhook($1, 'wh-ensaio', $2)", [conta, TOKEN]);
  const ref = (await um("select webhook_ref from public.gateway_accounts where id = $1", [conta])).webhook_ref;
  const seg = await um("select * from public._gateway_webhook_secret($1)", [ref]);
  conf("o endereço opaco leva à conta e ao token", seg?.account_id === conta && seg?.token === TOKEN);
  conf("endereço desconhecido não leva a nada", (await c.query("select * from public._gateway_webhook_secret('nao-existe')")).rows.length === 0);
  const ev = (id) => um("select public._gateway_record_event($1, $2, 'PAYMENT_CREATED', '{\"event\":\"PAYMENT_CREATED\"}'::jsonb) as novo", [conta, id]);
  const novo1 = (await ev("evt_ensaio_1")).novo;
  const novo2 = (await ev("evt_ensaio_1")).novo;
  conf("evento repetido não é gravado duas vezes", novo1 === true && novo2 === false && (await um("select count(*)::int n from public.gateway_webhook_events where account_id = $1", [conta])).n === 1);
  await como(admin);
  conf("ninguém logado lê o evento bruto", (await um("select count(*)::int n from public.gateway_webhook_events")).n === 0);

  // ---- 8) Tarifas com vigência ---------------------------------------------------
  await comoServidor();
  const tarifas = (boleto) =>
    JSON.stringify([
      { modality: "boleto", fee_percent: 0, fixed_fee_cents: boleto, settlement_days: 1 },
      { modality: "pix", fee_percent: 0.99, fixed_fee_cents: 0, min_fee_cents: 50, max_fee_cents: 500, settlement_days: 0, free_monthly_count: 30 },
      { modality: "credito_parcelado", min_installments: 2, max_installments: 6, fee_percent: 3.49, fixed_fee_cents: 49, settlement_days: 32 },
    ]);
  const s1 = (await um("select public._gateway_sync_fees($1, $2::jsonb) as n", [conta, tarifas(199)])).n;
  const s2 = (await um("select public._gateway_sync_fees($1, $2::jsonb) as n", [conta, tarifas(199)])).n;
  conf("as tarifas entram na primeira vez e não se repetem na segunda", s1 === 3 && s2 === 0);
  const adq = await um("select id, is_default, scope, clinic_id from public.card_acquirers where gateway_account_id = $1", [conta]);
  conf("o adquirente Asaas é da unidade e NÃO vira o padrão", adq && adq.is_default === false && adq.clinic_id === unidade);
  // Faz a tarifa "ter valido desde ontem" para provar o fechamento da vigência.
  await c.query("update public.acquirer_rates set valid_from = current_date - 10 where acquirer_id = $1", [adq.id]);
  const s3 = (await um("select public._gateway_sync_fees($1, $2::jsonb) as n", [conta, tarifas(249)])).n;
  const boletos = await c.query("select fixed_fee_cents, valid_from, valid_to, source from public.acquirer_rates where acquirer_id = $1 and modality = 'boleto' order by valid_from", [adq.id]);
  conf(
    "tarifa que mudou fecha a vigência antiga e abre a nova (não sobrescreve)",
    s3 === 2 && boletos.rows.length === 2 && Number(boletos.rows[0].fixed_fee_cents) === 199 && boletos.rows[0].valid_to !== null &&
      Number(boletos.rows[1].fixed_fee_cents) === 249 && boletos.rows[1].valid_to === null
  );
  const vigente = await um("select * from public.acquirer_rate_for($1, 'boleto', 1, current_date)", [adq.id]);
  conf("a consulta de tarifa que a baixa usa devolve a nova", Number(vigente.fixed_fee_cents) === 249);
  await c.query("insert into public.acquirer_rates (acquirer_id, modality, fee_percent, source) values ($1, 'debito', 1.5, 'manual')", [adq.id]);
  await c.query("select public._gateway_sync_fees($1, $2::jsonb)", [conta, tarifas(249)]);
  conf("tarifa digitada à mão não é tocada pela sincronização", (await um("select count(*)::int n from public.acquirer_rates where acquirer_id = $1 and source = 'manual' and valid_to is null", [adq.id])).n === 1);

  // ---- 9) Prontidão ----------------------------------------------------------------
  const faltam = async () =>
    (await c.query("select item from public._central_readiness_raw($1) where not ok order by sort_order", [unidade])).rows.map((r) => r.item);
  conf("faltam chave Pix, split e antecipação", JSON.stringify(await faltam()) === JSON.stringify(["chave_pix", "split_habilitado", "antecipacao_desligada"]));

  await como(admin);
  e = await recusa("select public.central_mark_ready($1, true)", [unidade]);
  conf("não dá para marcar como pronta faltando item", /NOT_READY/.test(e ?? ""));
  await c.query("select public.gateway_declare_split_enabled($1, true)", [conta]);
  await comoServidor();
  await c.query("select public._gateway_record_check($1, true, null, null, null, true, false)", [conta]);
  conf("com tudo conferido não falta nada", (await faltam()).length === 0);
  conf("pronta só depois da marcação do Admin Master", (await um("select public.central_is_ready($1) as v", [unidade])).v === false);

  await como(gerente);
  e = await recusa("select public.central_mark_ready($1, true)", [unidade]);
  conf("Gerente não marca a unidade como pronta", /NOT_ALLOWED/.test(e ?? ""));
  conf("Gerente vê a lista de prontidão da própria unidade", (await c.query("select 1 from public.central_readiness($1)", [unidade])).rows.length === 8);
  conf("Gerente não vê a lista de outra unidade", (await c.query("select 1 from public.central_readiness($1)", [outraUnidade])).rows.length === 0);
  await como(admin);
  await c.query("select public.central_mark_ready($1, true)", [unidade]);
  conf("marcada: a unidade está pronta para cobrar", (await um("select public.central_is_ready($1) as v", [unidade])).v === true);

  // ---- 10) A verificação que falha derruba a prontidão e avisa -----------------------
  await comoServidor();
  const avisosAntes = (await um("select count(*)::int n from public.notifications where title like 'Asaas:%'")).n;
  await c.query("select public._gateway_record_check($1, false, 'unauthorized')", [conta]);
  const caiu = await um("select marked_ready_at, unmarked_reason from public.central_unit_readiness where clinic_id = $1", [unidade]);
  conf("verificação que falha derruba a marcação sozinha", caiu.marked_ready_at === null && /conta_validada/.test(caiu.unmarked_reason ?? ""));
  conf("e a unidade deixa de estar pronta", (await um("select public.central_is_ready($1) as v", [unidade])).v === false);
  const admins = (await um("select count(*)::int n from public.profiles where is_admin_master and is_active")).n;
  const avisos1 = (await um("select count(*)::int n from public.notifications where title like 'Asaas:%'")).n - avisosAntes;
  await c.query("select public._gateway_record_check($1, false, 'unauthorized')", [conta]);
  const avisos2 = (await um("select count(*)::int n from public.notifications where title like 'Asaas:%'")).n - avisosAntes;
  conf("cada Admin Master recebe UM aviso por falha (não um por semana)", admins > 0 && avisos1 === admins && avisos2 === admins);
  await c.query("select public._gateway_record_check($1, true, null, null, null, true, false)", [conta]);
  await c.query("select public._gateway_record_check($1, false, 'timeout')", [conta]);
  const avisos3 = (await um("select count(*)::int n from public.notifications where title like 'Asaas:%'")).n - avisosAntes;
  conf("verificação boa rearma o aviso para a próxima falha", avisos3 === admins * 2);
  await c.query("select public._gateway_record_check($1, true, null, null, null, true, true)", [conta]);
  conf("antecipação automática ligada volta a faltar na lista", (await faltam()).includes("antecipacao_desligada"));

  // ---- 11) Histórico por aba ------------------------------------------------------------
  await como(admin);
  const hist = await c.query("select table_name from public.central_history('conta', $1)", [unidade]);
  const tabelas = new Set(hist.rows.map((r) => r.table_name));
  conf("o histórico da aba traz conta, prontidão e tarifas", tabelas.has("gateway_accounts") && tabelas.has("central_unit_readiness") && tabelas.has("acquirer_rates"));
  await como(coordenador);
  conf("quem não vê a Central não vê o histórico", (await c.query("select 1 from public.central_history('conta', $1)", [unidade])).rows.length === 0);
  await como(gerente);
  conf("Gerente não vê o histórico de outra unidade", (await c.query("select 1 from public.central_history('conta', $1)", [outraUnidade])).rows.length === 0);
  conf("Gerente não vê o histórico do nível Rede", (await c.query("select 1 from public.central_history('conta', null)")).rows.length === 0);

  // ---- 12) Desativar apaga os segredos; conta nunca é apagada ---------------------------
  e = await recusa("select public.gateway_disable_account($1, 'ensaio de desativação')", [conta]);
  conf("Gerente não desativa a conta", /NOT_ALLOWED/.test(e ?? ""));
  await comoServidor();
  const segredos = await um("select api_key_secret_id k, webhook_token_secret_id t from public.gateway_accounts where id = $1", [conta]);
  await como(admin);
  await c.query("select public.gateway_disable_account($1, 'ensaio de desativação')", [conta]);
  await comoServidor();
  const restam = (await um("select count(*)::int n from vault.secrets where id = any($1)", [[segredos.k, segredos.t]])).n;
  conf("desativar apaga a chave e o token do Vault", restam === 0);
  e = await recusa("select * from public._gateway_read_key($1, 'ensaio', null)", [conta]);
  conf("conta desativada não entrega chave", /ACCOUNT_DISABLED/.test(e ?? ""));
  e = await recusa("delete from public.gateway_accounts where id = $1", [conta]);
  conf("conta nunca é apagada, nem pelo servidor", /GATEWAY_ACCOUNT_NO_DELETE/.test(e ?? ""));
  e = await recusa("update public.gateway_accounts set environment = 'production' where id = $1", [contaOutra]);
  conf("trocar o ambiente de uma conta é recusado", /GATEWAY_PRODUCTION_LOCKED|GATEWAY_ENVIRONMENT_IMMUTABLE/.test(e ?? ""));
  await como(admin);
  const nova = await recusa("select public.gateway_create_account($1, 'unit', 'Ensaio de novo', null, 'sandbox')", [unidade]);
  conf("depois de desativar, a unidade pode ter outra conta", nova === null);
} catch (e) {
  falha.push(`EXCEÇÃO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nENSAIO ASA0 — ${ok.length} conferências passaram, ${falha.length} falharam.`);
for (const f of falha) console.log("  ✗", f);
if (falha.length === 0) console.log("  (transação desfeita: nada ficou gravado no treino)");
process.exit(falha.length === 0 ? 0 : 1);
