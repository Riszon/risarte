// ENSAIO DA 4025 (a conta da RisLife só para quem a cadastrou) no banco de
// TREINO, numa transação DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4025-rislife-restrita.mjs --confirmar [--quebrar=regra]
//
// PROVADO QUEBRANDO: `regra` = depois da 4025, volta a regra de leitura antiga
// das contas (todo Admin Master e Financeiro veem); o ensaio tem de reprovar.
import { readFileSync } from "node:fs";
import { connect, testEnv } from "./test-db.mjs";

const ARQ = "supabase/migrations/4025_asa5_conta_da_rislife_restrita.sql";
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const TREINO_REF = "bsnptybalszjjbhxeejo";
{
  const env = testEnv();
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
    if (!String(env[k] ?? "").includes(TREINO_REF)) {
      console.log(`RECUSADO: ${k} não é o banco de treino.`);
      process.exit(3);
    }
  }
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
async function servidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
async function pessoa(id, sql, params = []) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    return `erro: ${e.message}`;
  } finally {
    await servidor();
  }
}

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const conferencia = [].concat(await c.query(sql)).at(-1).rows[0];
  conf("a 4025 roda: 3 regras e 6 funções com a trava, e entra na lista",
    Number(conferencia.regras_com_a_trava) === 3 && Number(conferencia.funcoes_com_a_trava) === 6 && conferencia.na_lista === true);
  await c.query("savepoint dup");
  try { await c.query(sql); await c.query("release savepoint dup"); conf("a 4025 roda duas vezes sem erro", true); }
  catch (e) { await c.query("rollback to savepoint dup"); conf(`a 4025 roda duas vezes sem erro (${e.message})`, false); }

  if (Q === "regra") {
    await c.query(`drop policy if exists "gateway_accounts_select" on public.gateway_accounts;
      create policy "gateway_accounts_select" on public.gateway_accounts for select to authenticated
      using (public.is_admin_master() or public.is_finance_franchisor()
             or (clinic_id is not null and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])))`);
  }

  // As pessoas de teste: o "dono" (admin), um segundo Admin Master (o gerente, promovido
  // só dentro da transação) e o Financeiro da Franqueadora.
  const p = async (email) => (await um("select id from public.profiles where email = $1", [email]))?.id;
  const dono = await p("admin@example.com");
  const outroAdmin = await p("gerente@example.com");
  const financeiro = await p("financeiro@example.com");
  conf("as pessoas de teste existem", Boolean(dono && outroAdmin && financeiro));
  await c.query("update public.profiles set is_admin_master = true where id = $1", [outroAdmin]);
  await c.query("insert into public.user_clinic_roles (user_id, clinic_id, role) select $1, (select id from public.clinics where type = 'franchisor' limit 1), 'finance_franchisor' where not exists (select 1 from public.user_clinic_roles where user_id = $1 and role = 'finance_franchisor')", [financeiro]);

  // A conta da RisLife do treino (sandbox) passa a ser do "dono".
  const rl = await um("select id from public.gateway_accounts where owner_type = 'recipient' and label ilike 'RisLife%' and status <> 'disabled' limit 1");
  conf("há a conta da RisLife no treino", Boolean(rl));
  if (rl) {
    await c.query("update public.gateway_accounts set visible_only_to = $1 where id = $2", [dono, rl.id]);
    await c.query("update public.corporate_gateway_settings set rislife_account_id = $1 where id", [rl.id]);
    await c.query("insert into public.audit_logs (user_id, action, entity_type, entity_id) values ($1, 'update', 'gateway_debit_disabled', $2)", [dono, rl.id]);

    const ve = async (id) => {
      const r = await pessoa(id, "select count(*)::int n from public.gateway_accounts where id = $1", [rl.id]);
      return Array.isArray(r) ? r[0].n === 1 : r;
    };
    conf("quem cadastrou vê a conta", (await ve(dono)) === true);
    conf("o outro Admin Master NÃO vê a conta", (await ve(outroAdmin)) === false);
    conf("o Financeiro da Franqueadora NÃO vê a conta", (await ve(financeiro)) === false);
    await servidor();
    conf("o servidor (emissão, aviso, verificação) vê a conta", (await um("select count(*)::int n from public.gateway_accounts where id = $1", [rl.id])).n === 1);

    const leitura = async (id) => {
      const r = await pessoa(id, "select public.corporate_settings_read() j");
      return Array.isArray(r) ? r[0].j : null;
    };
    const lDono = await leitura(dono);
    const lFin = await leitura(financeiro);
    conf("Empresarial na Central: quem cadastrou vê a conta da RisLife",
      lDono && lDono.rislife_account_id === rl.id && lDono.contas_rislife.some((x) => x.id === rl.id));
    conf("Empresarial na Central: o Financeiro não vê a conta da RisLife",
      lFin && lFin.rislife_account_id === null && !lFin.contas_rislife.some((x) => x.id === rl.id));
    const salvar = await pessoa(financeiro, "select public.corporate_settings_save(null, null)");
    conf("o Financeiro não consegue configurar (nem apagar) a conta da RisLife no Empresarial",
      typeof salvar === "string" && salvar.includes("RISLIFE_ACCOUNT_HIDDEN"));

    const taxas = async (id) => {
      const r = await pessoa(id, "select public.gateway_split_read() j");
      return Array.isArray(r) ? (r[0].j.carteiras ?? []).some((x) => x.accountId === rl.id) : null;
    };
    conf("aba Taxas: a carteira da RisLife some para o outro Admin Master", (await taxas(outroAdmin)) === false);
    conf("aba Taxas: quem cadastrou continua vendo", (await taxas(dono)) === true);

    const lev = await pessoa(outroAdmin, "select public.gateway_surveys_read($1) j", [rl.id]);
    conf("o levantamento da conta não aparece para o outro Admin Master", Array.isArray(lev) && JSON.stringify(lev[0].j) === "[]");

    const aud = async (id) => {
      const r = await pessoa(id, "select count(*)::int n from public.audit_logs where entity_id = $1", [rl.id]);
      return Array.isArray(r) ? r[0].n : null;
    };
    conf("auditoria: o outro Admin Master não vê o que é da conta", (await aud(outroAdmin)) === 0);
    conf("auditoria: quem cadastrou vê", (await aud(dono)) > 0);

    await c.query("savepoint segunda");
    try {
      await c.query("insert into public.gateway_accounts (owner_type, label, environment, created_by) select 'recipient', 'RisLife 2', environment, $1 from public.gateway_accounts where id = $2", [outroAdmin, rl.id]);
      await c.query("release savepoint segunda");
      conf("não nasce uma segunda conta da RisLife no mesmo ambiente", false);
    } catch (e) {
      await c.query("rollback to savepoint segunda");
      conf("não nasce uma segunda conta da RisLife no mesmo ambiente", /ACCOUNT_ALREADY_EXISTS/.test(e.message));
    }
    // Com a de hoje desativada, uma conta nova da RisLife nasce só para quem a cadastra.
    await c.query("update public.gateway_accounts set status = 'disabled' where id = $1", [rl.id]);
    const nova = await um(
      "insert into public.gateway_accounts (owner_type, label, environment, created_by) select 'recipient', 'RisLife nova', environment, $1 from public.gateway_accounts where id = $2 returning visible_only_to",
      [outroAdmin, rl.id]);
    conf("a conta da RisLife nova já nasce só para quem a cadastra", nova?.visible_only_to === outroAdmin);
  }
} catch (e) {
  falha.push(`erro inesperado: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(`Ensaio da 4025${Q ? ` (quebrando: ${Q})` : ""} — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log(`  ✗ ${f}`);
console.log("Nada ficou gravado (transação desfeita).");
process.exit(falha.length ? 1 : 0);
