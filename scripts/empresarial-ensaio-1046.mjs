// Ensaio da 1046 (a implantação medida pelo sistema) — NO TREINO, numa
// transação DESFEITA. Nada fica gravado.
// Uso: node scripts/empresarial-ensaio-1046.mjs
//      QUEBRA=cancelada | QUEBRA=guarda  provam que reprova.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const db = await connect();
let ok = 0;
let falhas = 0;
const confere = (nome, cond, extra = "") => {
  if (cond) {
    ok++;
    console.log(`  ✔ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✘ ${nome} ${extra ?? ""}`);
  }
};
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
async function erroDe(sql, p = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, p);
    await db.query("release savepoint s");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint s");
    return e.message;
  }
}
async function como(id, role = "authenticated") {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(id ? { sub: id, role } : { role }),
  ]);
  await db.query(`set local role ${role}`);
}
async function superusuario() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1046_implantacao_medida_pelo_sistema.sql", "utf8");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.replace(de, () => para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "cancelada") quebrar("and ap.status <> 'cancelled'", "");
  if (process.env.QUEBRA === "guarda") quebrar("and empresarial.can_access_lead(l.id)", "");
  confere("a 1046 roda de novo sem erro (idempotente)", (await erroDe(sql)) === null);

  const adm = (await q("select id from public.profiles where is_admin_master and is_active limit 1"))[0]?.id;
  const comAg = (await q("select client_id from public.appointments where status <> 'cancelled' group by client_id limit 1"))[0]?.client_id;
  const soCancelada = (
    await q(
      `select client_id from public.appointments group by client_id
       having bool_and(status = 'cancelled') limit 1`
    )
  )[0]?.client_id;
  // Alguém logado que NÃO enxerga o lead: um dentista (só dentista).
  const estranho = (
    await q(
      `select p.id from public.profiles p
       where p.is_active and not p.is_admin_master
         and exists (select 1 from public.user_clinic_roles_all r
                     where r.user_id = p.id and r.role = 'dentist')
         and not exists (select 1 from public.user_clinic_roles_all r
                         where r.user_id = p.id and r.role <> 'dentist')
       limit 1`
    )
  )[0]?.id;
  if (!adm || !comAg || !estranho) throw new Error("NÃO MEDI: faltam dados no treino (admin, cliente com agendamento, usuário sem acesso)");

  const company = (
    await q(
      `insert into empresarial.companies (cnpj, legal_name, contracted_holders)
       values ('99999999000199', 'Ensaio 1046 (desfeito)', 4) returning id`
    )
  )[0].id;
  const lead = (
    await q(
      `insert into empresarial.commercial_leads (company_name, company_id, contract_signed_at)
       values ('Ensaio 1046 (desfeito)', $1, now() - interval '5 days') returning id`,
      [company]
    )
  )[0].id;
  const ganho = "2026-11-10T12:00:00Z";
  await q(
    `insert into empresarial.commercial_lead_stage_history (lead_id, stage, entered_at, left_at) values ($1, 'CLOSED_WON', $2, $2::timestamptz + interval '3 minutes')`,
    [lead, ganho]
  );
  const emp = async (cpf, status, client) =>
    (
      await q(
        `insert into empresarial.employees (company_id, cpf, full_name, phone, status, dependent_plan, client_id)
         values ($1, $2, 'Titular ensaio', '(43) 99999-0000', $3, 'NONE', $4) returning id`,
        [company, cpf, status, client]
      )
    )[0].id;
  const e1 = await emp("900.000.001-01", "ACTIVE", comAg);
  // Cliente só com agendamento CANCELADO: o treino pode não ter; aqui ele nasce
  // cancelando, dentro da transação desfeita, os agendamentos de outro cliente.
  let cancelado = soCancelada;
  if (!cancelado) {
    cancelado = (await q("select client_id from public.appointments where status <> 'cancelled' and client_id <> $1 group by client_id limit 1", [comAg]))[0]?.client_id;
    if (!cancelado) throw new Error("NÃO MEDI: falta um 2º cliente com agendamento no treino");
    await q("alter table public.appointments disable trigger user");
    await q("update public.appointments set status = 'cancelled' where client_id = $1", [cancelado]);
    await q("alter table public.appointments enable trigger user");
  }
  const e2 = await emp("900.000.001-02", "ACTIVE", cancelado);
  const e3 = await emp("900.000.001-03", "INACTIVE", null);

  await q(`insert into empresarial.welcome_contacts (company_id, employee_id, outcome) values ($1, $2, 'CONTACTED')`, [company, e1]);
  await q(`insert into empresarial.welcome_contacts (company_id, employee_id, outcome) values ($1, $2, 'NO_ANSWER')`, [company, e2]);
  await q(`insert into empresarial.welcome_contacts (company_id, employee_id, outcome) values ($1, $2, 'CONTACTED')`, [company, e3]);

  await q(`insert into empresarial.lead_dispatches (lead_id, channel, items, sent_at) values ($1, 'WHATSAPP', '{CONTRACT}', now() - interval '4 days')`, [lead]);
  await q(`insert into empresarial.lead_meetings (lead_id, starts_at, ends_at, status) values ($1, '2026-11-01T12:00:00Z', '2026-11-01T13:00:00Z', 'DONE')`, [lead]);

  const ler = async () => {
    await como(adm);
    const r = (await q("select * from empresarial.implantacao_dos_leads($1)", [[lead]]))[0];
    await superusuario();
    return r;
  };

  console.log("\nAntes das orientações e da apresentação:");
  let r = await ler();
  confere("o Admin lê a linha do lead", Boolean(r));
  confere("ganho_em = a entrada em Fechamento (ganho)", r && new Date(r.ganho_em).toISOString() === new Date(ganho).toISOString(), String(r?.ganho_em));
  confere("contratados = 4", r?.contratados === 4, String(r?.contratados));
  confere("ativos = 2 (o inativo não conta)", r?.ativos === 2, String(r?.ativos));
  confere("boas-vindas = 1 (sem resposta não conta; inativo não conta)", r?.boas_vindas === 1, String(r?.boas_vindas));
  confere(
    "com agendamento = 1 (só cancelada não conta)",
    r?.com_agendamento === 1,
    String(r?.com_agendamento)
  );
  confere("envio sem orientações não conta", r?.orientacoes_em === null);
  confere("reunião ANTES do ganho não conta como apresentação", r?.apresentacao_em === null);

  await q(`insert into empresarial.lead_dispatches (lead_id, channel, items) values ($1, 'EMAIL', '{GUIDELINES}')`, [lead]);
  await q(`insert into empresarial.lead_meetings (lead_id, starts_at, ends_at, status) values ($1, '2026-11-12T12:00:00Z', '2026-11-12T13:00:00Z', 'SCHEDULED')`, [lead]);
  r = await ler();
  confere("envio com GUIDELINES conta", r?.orientacoes_em !== null);
  confere("reunião depois do ganho, mas só AGENDADA, não conta", r?.apresentacao_em === null);
  await q(`update empresarial.lead_meetings set status = 'DONE' where lead_id = $1 and status = 'SCHEDULED'`, [lead]);
  r = await ler();
  confere("reunião REALIZADA depois do ganho conta", r?.apresentacao_em !== null);

  console.log("\nQuem não enxerga o lead:");
  await como(estranho);
  const rs = await q("select * from empresarial.implantacao_dos_leads($1)", [[lead]]);
  await superusuario();
  confere("usuário sem acesso ao lead não recebe linha", rs.length === 0, `${rs.length} linha(s)`);
  await como(null, "anon");
  const anon = await erroDe("select * from empresarial.implantacao_dos_leads($1)", [[lead]]);
  await superusuario();
  confere("sem login recusa", /permission denied/.test(anon ?? ""), anon);
  confere("lista vazia não quebra", (await como(adm), (await q("select * from empresarial.implantacao_dos_leads('{}')")).length === 0));
  await superusuario();
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
