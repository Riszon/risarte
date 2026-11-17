// ENSAIO DA 0424 (VD3-4: o encaixe e a sala escolhida ao chamar) no banco de
// TREINO, numa transação DESFEITA (rollback).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-encaixe-0424.mjs --confirmar [--quebrar=conflito|sala]
//
// PROVADO QUEBRANDO: `conflito` = a marca de encaixe deixa de passar pelo
// conflito do profissional; `sala` = o chamar deixa de exigir a sala. Os dois
// têm de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0424_encaixe_e_sala_ao_chamar.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
async function tentar(sql, params = [], userId = null) {
  if (userId) await como(userId);
  await c.query("savepoint t");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint t");
    if (userId) await comoServidor();
    return r;
  } catch (e) {
    await c.query("rollback to savepoint t");
    if (userId) await comoServidor();
    return `erro: ${e.message}`;
  }
}
const erro = (r, k) => typeof r === "string" && r.includes(k);
const passou = (r) => Array.isArray(r);

try {
  await c.query("begin");
  let sql = readFileSync(ARQ, "utf8");
  const original = sql;
  if (QUEBRAR === "conflito") sql = sql.replace("or coalesce(new.is_fit_in, false);", ";");
  if (QUEBRAR === "sala") sql = sql.replace("      raise exception 'ROOM_REQUIRED';", "      null;");
  if (QUEBRAR && sql === original) throw new Error(`NÃO QUEBREI: trecho de "${QUEBRAR}" não achado`);
  await c.query(sql);
  const dup = await tentar(sql);
  // SQL com vários comandos: o pg devolve uma lista de resultados (não `.rows`); só o erro conta.
  conf(`a 0424 roda duas vezes sem erro${typeof dup === "string" ? " (" + dup + ")" : ""}`, typeof dup !== "string");

  // O cenário: uma unidade com sala ativa, o dentista de teste com função lá e um cliente.
  const dentista = await um("select id from public.profiles where email = 'dentista@example.com'");
  const unidade = await um(
    `select r.clinic_id from public.user_clinic_roles r
      where r.user_id = $1 and r.role = 'dentist'
        and exists (select 1 from public.clinic_rooms s where s.clinic_id = r.clinic_id and s.is_active and s.deleted_at is null)
      limit 1`, [dentista.id]);
  if (!unidade) throw new Error("NÃO MEDI: o dentista de teste não está numa unidade com sala");
  const salas = (await c.query("select id from public.clinic_rooms where clinic_id = $1 and is_active and deleted_at is null order by sort_order limit 2", [unidade.clinic_id])).rows;
  const cli = (await c.query("select id from public.clients where clinic_id = $1 and anonymized_at is null order by created_at limit 3", [unidade.clinic_id])).rows;
  if (cli.length < 3) throw new Error("NÃO MEDI: faltam clientes na unidade");
  const inicio = new Date(Date.now() + 3 * 864e5);
  inicio.setUTCHours(14, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 30 * 60000);
  const novo = (cliente, extra = "") =>
    tentar(`insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at, provider_user_id, status${extra ? ", is_fit_in" : ""})
            values ($1, $2, 'evaluation', $3, $4, $5, 'scheduled'${extra ? ", true" : ""}) returning id`,
      [unidade.clinic_id, cliente, inicio.toISOString(), fim.toISOString(), dentista.id]);

  // 1) O conflito: o 2º normal no mesmo horário é recusado; o encaixe passa.
  const a1 = await novo(cli[0].id);
  conf("o 1º agendamento entra", passou(a1));
  const a2 = await novo(cli[1].id);
  conf("o 2º normal no mesmo horário do profissional é recusado", erro(a2, "PROVIDER_TIME_CONFLICT"));
  const a3 = await novo(cli[1].id, "encaixe");
  conf("o ENCAIXE (Avaliação com a marca) passa pelo conflito do profissional", passou(a3));
  const a4 = await novo(cli[2].id);
  conf("o encaixe não 'tranca' o horário: outro normal segue recusado só pelo 1º", erro(a4, "PROVIDER_TIME_CONFLICT"));

  // 2) Chamar sem sala, numa unidade com sala: ROOM_REQUIRED.
  if (passou(a3)) {
    const id = a3[0].id;
    await c.query("update public.appointments set starts_at = now(), ends_at = now() + interval '30 minutes', attendance = 'waiting' where id = $1", [id]).catch(() => null);
    const sem = await tentar("select public.update_attendance($1, 'in_service')", [id], dentista.id);
    conf("chamar presencial sem sala é recusado com ROOM_REQUIRED", erro(sem, "ROOM_REQUIRED"));

    // 3) Escolher a sala e chamar: grava a sala e entra em atendimento.
    if (salas.length >= 2) {
      // Uma sala ocupada por outro atendimento em curso não serve.
      await c.query("update public.appointments set room_id = $2, attendance = 'in_service' where id = $1", [a1[0].id, salas[0].id]).catch((e) => falha.push("preparo: " + e.message));
      const ocupada = await tentar("select public.call_attendance_with_room($1, $2)", [id, salas[0].id], dentista.id);
      conf("escolher sala ocupada por atendimento em curso é recusado (ROOM_BUSY)", erro(ocupada, "ROOM_BUSY") || erro(ocupada, "PROVIDER_BUSY"));
      await c.query("update public.appointments set attendance = 'waiting' where id = $1", [a1[0].id]);
      const livre = await tentar("select public.call_attendance_with_room($1, $2)", [id, salas[1].id], dentista.id);
      const depois = await um("select room_id, attendance from public.appointments where id = $1", [id]);
      conf("escolher sala livre grava a sala e chama", passou(livre) && depois.room_id === salas[1].id && depois.attendance === "in_service");
    } else conf("NÃO MEDI a escolha da sala: a unidade tem menos de 2 salas", false);
    const outroDentista = await um("select id from public.profiles where email = 'coordenador@example.com'");
    const alheio = await tentar("select public.call_attendance_with_room($1, $2)", [id, salas[0].id], outroDentista?.id ?? dentista.id);
    conf("quem não é o profissional não chama com sala", erro(alheio, "NOT_PROVIDER") || erro(alheio, "ROOM_BUSY") || erro(alheio, "APPOINTMENT"));
  }

  // 4) Unidade SEM sala: chamar continua como antes.
  const semSala = await um(
    `select c.id from public.clinics c where not exists (select 1 from public.clinic_rooms s where s.clinic_id = c.id and s.is_active and s.deleted_at is null) limit 1`);
  if (semSala) {
    const cliS = await um("select id from public.clients where clinic_id = $1 limit 1", [semSala.id]);
    if (cliS) {
      const ap = await tentar(`insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at, status, attendance)
                               values ($1, $2, 'evaluation', now(), now() + interval '30 minutes', 'scheduled', 'waiting') returning id`, [semSala.id, cliS.id]);
      if (passou(ap)) {
        const r = await tentar("select public.update_attendance($1, 'in_service')", [ap[0].id]);
        conf("unidade sem sala cadastrada: chamar sem sala segue permitido", !erro(r, "ROOM_REQUIRED"));
      } else conf(`NÃO MEDI a unidade sem sala (${ap})`, false);
    } else conf("NÃO MEDI a unidade sem sala: sem cliente", false);
  } else ok.push("(sem unidade sem sala no treino — caso não medido, só declarado)");

  // 5) Sem login, nada.
  await c.query("savepoint anon");
  await c.query("set local role anon");
  const anon = await c.query("select public.call_attendance_with_room($1, $2)", [cli[0].id, salas[0].id]).then(() => "passou", (e) => e.message);
  await c.query("rollback to savepoint anon");
  await c.query("reset role");
  conf("sem login chamar com sala recusa", /permission denied/i.test(anon));
} catch (e) {
  falha.push(`ERRO NO ENSAIO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => null);
  await c.end();
}

for (const n of ok) console.log("OK   ", n);
for (const n of falha) console.log("FALHA", n);
console.log(`\n${ok.length}/${ok.length + falha.length} conferências${QUEBRAR ? ` (quebrado: ${QUEBRAR})` : ""}. Transação desfeita.`);
if (ok.length + falha.length === 0) process.exit(1);
process.exit(falha.length > 0 ? 1 : 0);
