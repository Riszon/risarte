// ENSAIO DA 4003 (ASA1, entrega 1) no banco de TREINO, numa transação DESFEITA
// (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa1-entrega1.mjs --confirmar
//
// Confere: o pagador marcado sozinho só no menor com UM responsável; no máximo
// um pagador por cliente; a carência presa em zero (e a migração que PARA se
// achar outro valor); o histórico das abas Financeiro e Comercial por papel.
// Os clientes do ensaio são inventados e somem no rollback. Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4003_asa1_responsavel_financeiro_e_carencia.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa1-entrega1.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
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
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");

  const pessoa = async (conta) =>
    (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const admin = await pessoa("admin");
  const gerente = await pessoa("gerente");
  const financeiro = await pessoa("financeiro");
  const coordenador = await pessoa("coordenador");
  if (!admin || !gerente || !financeiro || !coordenador) throw new Error("NÃO MEDI: faltam contas de teste.");
  const unidade = (
    await um("select r.clinic_id from public.user_clinic_roles_all r where r.user_id = $1 and r.role = 'unit_manager' limit 1", [gerente])
  )?.clinic_id;
  const outra = (await um("select id from public.clinics where type = 'franchise_unit' and id <> $1 order by name limit 1", [unidade]))?.id;
  if (!unidade || !outra) throw new Error("NÃO MEDI: faltam unidades.");

  // ---- clientes inventados, ANTES da migração (para provar o preenchimento) --
  const novoCliente = async (nome, nascimento) =>
    (await um(
      "insert into public.clients (clinic_id, full_name, birth_date, no_cpf) values ($1, $2, $3, true) returning id",
      [unidade, nome, nascimento]
    )).id;
  const resp = (cliente, nome) =>
    c.query("insert into public.client_guardians (client_id, full_name, relationship) values ($1, $2, 'mãe')", [cliente, nome]);

  const menorUm = await novoCliente("Ensaio Menor Um", "2015-03-01");
  await resp(menorUm, "Ensaio Mãe Um");
  const menorDois = await novoCliente("Ensaio Menor Dois", "2016-03-01");
  await resp(menorDois, "Ensaio Mãe Dois");
  await resp(menorDois, "Ensaio Pai Dois");
  const adulto = await novoCliente("Ensaio Adulto", "1980-03-01");
  await resp(adulto, "Ensaio Cônjuge");

  // A carência já tem de estar em zero para a migração rodar.
  conf("o treino não tem carência diferente de zero",
    (await um("select count(*)::int n from public.finance_settings where grace_days <> 0")).n === 0);

  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4003 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);

  // ---- 1) o pagador marcado sozinho ---------------------------------------
  const marcados = async (cli) =>
    (await um("select count(*) filter (where is_financial)::int n from public.client_guardians where client_id = $1", [cli])).n;
  conf("menor com UM responsável: ele vira o pagador", (await marcados(menorUm)) === 1);
  conf("menor com DOIS responsáveis: ninguém é marcado sozinho", (await marcados(menorDois)) === 0);
  conf("adulto com responsável: não é marcado sozinho", (await marcados(adulto)) === 0);

  // ---- 2) no máximo um pagador ----------------------------------------------
  await c.query("update public.client_guardians set is_financial = true where client_id = $1 and full_name = 'Ensaio Mãe Dois'", [menorDois]);
  let e = await recusa("update public.client_guardians set is_financial = true where client_id = $1 and full_name = 'Ensaio Pai Dois'", [menorDois]);
  conf("dois pagadores no mesmo cliente é recusado", /client_guardians_one_financial|duplicate|conflicting/.test(e ?? ""));
  // Trocar o pagador numa gravação só (desmarca um, marca o outro) passa.
  e = await recusa(
    "update public.client_guardians set is_financial = (full_name = 'Ensaio Pai Dois') where client_id = $1",
    [menorDois]
  );
  conf("trocar o pagador num comando só passa", e === null);
  // O mesmo pela regra de linha (a recepção mantém os responsáveis).
  const recep = (await um("select r.user_id from public.user_clinic_roles_all r where r.clinic_id = $1 and r.role = 'receptionist' limit 1", [unidade]))?.user_id;
  if (recep) {
    await como(recep);
    e = await recusa("update public.client_guardians set is_financial = true where client_id = $1 and full_name = 'Ensaio Cônjuge'", [adulto]);
    conf("a recepção marca o pagador do adulto", e === null);
    await comoServidor();
  }

  // ---- 3) carência presa em zero ---------------------------------------------
  e = await recusa("update public.finance_settings set grace_days = 3 where clinic_id is null");
  conf("carência 3 na rede é recusada", /finance_settings_grace_zero/.test(e ?? ""));
  e = await recusa("insert into public.finance_settings (clinic_id, grace_days) values ($1, 5) on conflict (clinic_id) do update set grace_days = 5", [unidade]);
  conf("carência 5 na unidade é recusada", /finance_settings_grace_zero/.test(e ?? ""));
  e = await recusa("insert into public.finance_settings (clinic_id, grace_days) values ($1, null) on conflict (clinic_id) do update set grace_days = null", [unidade]);
  conf("carência vazia na unidade (segue a rede) passa", e === null);
  // A migração PARA (sem mudar o dado) se achar carência diferente de zero.
  await c.query("savepoint antes_da_trava");
  await c.query("alter table public.finance_settings drop constraint finance_settings_grace_zero");
  await c.query("update public.finance_settings set grace_days = 2 where clinic_id is null");
  e = await recusa(sql);
  conf("a 4003 para com GRACE_NOT_ZERO se houver carência", /GRACE_NOT_ZERO/.test(e ?? ""));
  await c.query("rollback to savepoint antes_da_trava");
  conf("a trava continua de pé depois do teste",
    (await um("select count(*)::int n from pg_constraint where conname = 'finance_settings_grace_zero'")).n === 1);

  // ---- 4) histórico das abas ---------------------------------------------------
  await como(admin);
  await c.query("update public.finance_settings set monthly_interest_percent = monthly_interest_percent where clinic_id is null");
  await c.query("update public.finance_settings set late_fee_percent = 1.5 where clinic_id is null");
  await c.query(
    "insert into public.finance_settings (clinic_id, late_fee_percent) values ($1, 1) on conflict (clinic_id) do update set late_fee_percent = 1",
    [unidade]
  );
  await c.query("update public.commercial_rules set max_installments = coalesce(max_installments, 12) + 1 where clinic_id is null");
  const hist = async (aba, cli) => (await c.query("select table_name from public.central_history($1, $2)", [aba, cli])).rows;

  const redeAdmin = await hist("financeiro", null);
  conf("Admin: o histórico Financeiro da rede traz a mudança", redeAdmin.some((r) => r.table_name === "finance_settings"));
  const unidAdmin = await hist("financeiro", unidade);
  conf("Admin: o histórico Financeiro da unidade traz o ajuste dela", unidAdmin.length > 0);
  conf("o histórico da rede não mistura o da unidade", redeAdmin.length > 0 && unidAdmin.length > 0 &&
    (await um("select count(*)::int n from public.central_history('financeiro', null) h join public.audit_changes a on a.id = h.id where a.clinic_id is not null")).n === 0);
  conf("Admin: o histórico Comercial traz a regra", (await hist("comercial", null)).some((r) => r.table_name === "commercial_rules"));

  await como(financeiro);
  conf("Financeiro: vê o histórico Financeiro da rede", (await hist("financeiro", null)).length > 0);
  conf("Financeiro: NÃO vê o histórico Comercial", (await hist("comercial", null)).length === 0);

  await como(gerente);
  conf("Gerente: vê o histórico Financeiro da própria unidade", (await hist("financeiro", unidade)).length > 0);
  conf("Gerente: não vê o da rede", (await hist("financeiro", null)).length === 0);
  conf("Gerente: não vê o de outra unidade", (await hist("financeiro", outra)).length === 0);

  await como(coordenador);
  conf("Coordenador: não vê histórico nenhum", (await hist("financeiro", unidade)).length === 0);

  await como(admin);
  e = await recusa("select * from public.central_history('fiscal', null)");
  conf("aba desconhecida é recusada", /TAB_UNKNOWN/.test(e ?? ""));
  conf("a aba Conta continua respondendo", (await recusa("select * from public.central_history('conta', null)")) === null);
} catch (e) {
  falha.push(`EXCEÇÃO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nENSAIO ASA1 (entrega 1) — ${ok.length} conferências passaram, ${falha.length} falharam.`);
for (const f of falha) console.log("  ✗", f);
if (falha.length === 0) console.log("  (transação desfeita: nada ficou gravado no treino)");
process.exit(falha.length === 0 ? 0 : 1);
