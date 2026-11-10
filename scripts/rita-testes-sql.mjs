// TESTES SQL DA RITA (assistente virtual de SDR) — as regras do schema `rita`
// provadas no PostgreSQL de verdade, no banco de TREINO, SEM DEIXAR RASTRO.
//
// Tudo roda numa transação só, DESFEITA no fim (rollback) — passe ou falhe.
// Cada seção é uma entrega da Fase 0A (docs/sdr/PLANO-FASE-0A.md); entrega
// nova acrescenta a sua seção aqui. Exige as migrações 3000+ já aplicadas no
// treino (`npm run migrar:teste`) e a Rita criada lá
// (`scripts/rita-criar-identidade.mjs`).
//
// Age como as pessoas: cada passo troca o usuário da sessão
// (`request.jwt.claims`). Sem usuário = a chave de serviço (a Rita).
// Só ids e contagens saem na tela — nenhum dado de pessoa.
//
// Uso:  npm run test:rita

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, testEnv } from "./test-db.mjs";

const db = await connect();
const env = testEnv();
let passou = 0;
const falhas = [];

function ok(cond, descricao, detalhe = "") {
  if (cond) {
    passou++;
    console.log(`  ✔ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✘ ${descricao}${detalhe ? `\n      ${detalhe}` : ""}`);
  }
}
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => (await q(sql, p))[0];
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
/** Troca quem está "logado". null = sem pessoa; "servico" = a chave de serviço. */
async function como(quem) {
  const claims =
    quem === null ? "" : quem === "servico" ? { role: "service_role" } : { role: "authenticated", sub: quem };
  await q("select set_config('request.jwt.claims', $1, true), set_config('rita.actor', '', true)", [
    claims === "" ? "" : JSON.stringify(claims),
  ]);
}
function naoMedi(motivo) {
  throw new Error(`NÃO MEDI: ${motivo}`);
}

console.log(`Banco de teste: ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n`);

try {
  await db.query("begin");

  // RITA_REAPLICAR=3001,3002 → roda de novo, DENTRO da transação desfeita, as
  // migrações como estão no disco (para provar uma mudança — ou uma quebra de
  // propósito — antes de gravá-la no treino).
  for (const n of (process.env.RITA_REAPLICAR ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const arq = readdirSync("supabase/migrations").find((f) => f.startsWith(`${n}_`) && f.endsWith(".sql"));
    if (!arq) naoMedi(`RITA_REAPLICAR: migração ${n} não encontrada`);
    await db.query(readFileSync(join("supabase/migrations", arq), "utf8"));
    console.log(`(reaplicada na transação: ${arq})`);
  }

  // --------------------------------------------------------------- o elenco
  const rita = (await um("select rita.agent_id() id")).id;
  if (!rita) naoMedi("a Rita não existe no treino — rodar scripts/rita-criar-identidade.mjs");
  const admin = (await um(
    "select id from public.profiles where is_admin_master and is_active and kind = 'person' order by created_at limit 1"
  ))?.id;
  const ger = await um(`
    select u.user_id, u.clinic_id from public.user_clinic_roles_all u
    join public.clinics cl on cl.id = u.clinic_id
    join public.profiles p on p.id = u.user_id
    where u.role = 'unit_manager' and cl.type::text <> 'franchisor' and p.is_active and not p.is_admin_master
    order by u.clinic_id limit 1`);
  if (!admin || !ger) naoMedi("faltou Admin Master ou Gerente de unidade no treino");
  const X = ger.clinic_id;
  // "De fora" = da equipe, mas SEM a unidade no escopo — perguntado ao próprio
  // banco (quem tem função na Franqueadora enxerga as unidades de propósito).
  let fora = null;
  for (const cand of await q(`
    select distinct u.user_id from public.user_clinic_roles_all u
    join public.profiles p on p.id = u.user_id
    where p.is_active and not p.is_admin_master and p.kind = 'person'
      and not exists (select 1 from public.user_clinic_roles_all v where v.user_id = u.user_id and v.clinic_id = $1)
    limit 50`, [X])) {
    await como(cand.user_id);
    const ve = await um("select $1::uuid in (select public.user_full_access_clinic_ids()) ve", [X]);
    if (!ve.ve) {
      fora = cand.user_id;
      break;
    }
  }
  await como(null);
  if (!fora) naoMedi("faltou uma pessoa da equipe sem esta unidade no escopo");
  const ultimaDaUnidade = async () =>
    um(`select actor, user_id from public.audit_changes
         where schema_name = 'public' and table_name = 'clinics' and row_id = $1
         order by id desc limit 1`, [X]);

  // =========================================================== 0A.1 (3000)
  console.log("0A.1 — a identidade e a auditoria");
  await como("servico");
  await q("update public.clinics set city = coalesce(city, '') || ' ·r1' where id = $1", [X]);
  let u = await ultimaDaUnidade();
  ok(u?.actor === "servico" && u.user_id === null, "chave de serviço sem declarar → servico", JSON.stringify(u));
  const dev = (await um("select rita.begin_as_agent() id")).id;
  await q("update public.clinics set city = city || ' ·r2' where id = $1", [X]);
  u = await ultimaDaUnidade();
  ok(dev === rita && u?.actor === "assistente" && u.user_id === rita, "begin_as_agent → autora 'assistente' = a Rita", JSON.stringify(u));
  await como("servico");
  await q("select set_config('rita.actor', $1, true)", [admin]);
  await q("update public.clinics set city = city || ' ·r3' where id = $1", [X]);
  u = await ultimaDaUnidade();
  ok(u?.actor === "servico", "id de pessoa no rita.actor é ignorado", JSON.stringify(u));
  await como(admin);
  await q("select set_config('rita.actor', $1, true)", [rita]);
  await q("update public.clinics set city = city || ' ·r4' where id = $1", [X]);
  u = await ultimaDaUnidade();
  ok(u?.actor === "usuario" && u.user_id === admin, "pessoa logada nunca vira a Rita", JSON.stringify(u));
  const eNA = await erroDe("select rita.begin_as_agent()");
  ok(/NOT_ALLOWED/.test(eNA ?? ""), "pessoa logada não chama begin_as_agent", eNA ?? "passou");
  const eKind = await erroDe("update public.profiles set kind = 'agent' where id = $1", [fora]);
  ok(/PROFILE_KIND_LOCKED/.test(eKind ?? ""), "logado não muda o tipo do perfil", eKind ?? "passou");
  await como(null);

  // =========================================================== 0A.2 (3001)
  console.log("\n0A.2 — interruptor, modo e portão");
  await como(null);
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.set_enabled($1, false, null)", [X])) ?? ""), "sem login não liga nem desliga");
  await como(admin);
  const gaps = await q("select item, ok from rita.activation_gaps($1)", [X]);
  ok(gaps.length >= 5, "o portão responde item a item", String(gaps.length));
  ok(/NETWORK_OFF/.test((await erroDe("select rita.set_enabled($1, true, null)", [X])) ?? ""), "rede desligada → a unidade não liga");
  await como(ger.user_id);
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.set_enabled(null, true, null)")) ?? ""), "Gerente não liga a rede");
  await como(admin);
  ok((await erroDe("select rita.set_enabled(null, true, null)")) === null, "Admin liga a rede");
  const pend = await q("select item from rita._pending_items()");
  if (pend.length) {
    const e = await erroDe("select rita.set_enabled($1, true, null)", [X]);
    ok(/ACTIVATION_GAPS:/.test(e ?? ""), `com ${pend.length} item(ns) pendente(s), nenhuma unidade liga`, e ?? "passou");
  }
  await como(fora);
  ok(/NOT_ALLOWED/.test((await erroDe("select * from rita.activation_gaps($1)", [X])) ?? ""), "pessoa de fora não lê o portão");
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.set_enabled($1, false, 'x')", [X])) ?? ""), "pessoa de fora não desliga");
  await como(ger.user_id);
  ok((await erroDe("select rita.set_enabled($1, false, 'ensaio')", [X])) === null, "Gerente da unidade desliga");
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.set_mode($1, 'ativo')", [X])) ?? ""), "Gerente não muda o modo");
  // Pausa automática: força a unidade ligada e apaga o número do endereço.
  await como(null);
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]);
  await q("update public.clinics set address_number = '' where id = $1", [X]);
  const s = await um("select enabled, paused_by, paused_reason from rita.settings where clinic_id = $1", [X]);
  ok(s.enabled === false && s.paused_by === null && /Pausada sozinha/.test(s.paused_reason ?? ""), "dado essencial apagado → pausa sozinha", JSON.stringify(s));

  // =========================================================== 0A.3 (3002)
  console.log("\n0A.3 — consentimento e descadastro");
  const fones = await q(`select
      rita.phone_e164('(43) 99999-1234') a, rita.phone_e164('+55 43 3333-1234') b,
      rita.phone_e164('5543999991234') c, rita.phone_e164('99999-1234') d,
      rita.phone_e164('0 43 99999 1234') e, rita.phone_e164('') f`);
  ok(
    fones.length === 1 && fones[0].a === "+5543999991234" && fones[0].b === "+554333331234" && fones[0].c === "+5543999991234" &&
      fones[0].d === null && fones[0].e === "+5543999991234" && fones[0].f === null,
    "telefone normalizado; sem DDD é recusado",
    JSON.stringify(fones[0])
  );
  const T = "+5543900000001"; // número de ensaio (não existe)
  await como("servico");
  let r = await um("select * from rita.can_contact($1, 'contato')", [T]);
  ok(r.allowed === false && r.reason === "sem_consentimento", "telefone novo: sem consentimento → não pode", JSON.stringify(r));
  const eTxt = await erroDe("select rita.register_consent($1, 'contato', 'ensaio-1', 'whatsapp')", [T]);
  ok(/CONSENT_TEXT_NOT_APPROVED/.test(eTxt ?? ""), "sem texto aprovado, a Rita não grava consentimento", eTxt ?? "passou");
  await como(ger.user_id);
  ok(
    /NOT_ALLOWED/.test((await erroDe("select rita.approve_consent_text('ensaio-1', 'contato', 'Texto de ensaio do consentimento — pode ignorar.')")) ?? ""),
    "Gerente não aprova texto"
  );
  await como(admin);
  ok(
    (await erroDe("select rita.approve_consent_text('ensaio-1', 'contato', 'Texto de ensaio do consentimento — pode ignorar.')")) === null,
    "Admin aprova o texto"
  );
  ok(
    /CONSENT_TEXT_EXISTS/.test((await erroDe("select rita.approve_consent_text('ensaio-1', 'contato', 'Outro texto para a mesma versão, não pode.')")) ?? ""),
    "texto aprovado não muda (versão nova)"
  );
  await como("servico");
  ok(
    /INVALID_INPUT/.test((await erroDe("select rita.register_consent($1, 'contato', 'ensaio-1', 'presencial')", [T])) ?? ""),
    "a Rita só registra consentimento recebido pelo WhatsApp"
  );
  const idC = (await um("select rita.register_consent($1, 'contato', 'ensaio-1', 'whatsapp', $2) id", [T, X])).id;
  const c1 = await um("select registered_by from rita.contact_consents where id = $1", [idC]);
  const aud = await um(
    "select actor, user_id from public.audit_changes where schema_name = 'rita' and table_name = 'contact_consents' and row_id = $1 order by id desc limit 1",
    [idC]
  );
  ok(c1.registered_by === rita && aud?.actor === "assistente" && aud.user_id === rita, "consentimento da Rita: autora a Rita, na trilha também", JSON.stringify(aud));
  r = await um("select * from rita.can_contact($1, 'contato')", [T]);
  ok(r.allowed === true && r.reason === "consentimento", "com consentimento → pode", JSON.stringify(r));
  r = await um("select * from rita.can_contact($1, 'marketing')", [T]);
  ok(r.allowed === false, "consentimento de contato não vale para marketing", JSON.stringify(r));
  await q("select rita.register_opt_out($1, 'whatsapp', 'ensaio')", [T]);
  r = await um("select * from rita.can_contact($1, 'contato')", [T]);
  ok(r.allowed === false && r.reason === "descadastro", "descadastro bloqueia", JSON.stringify(r));
  await q("select rita.register_consent($1, 'contato', 'ensaio-1', 'whatsapp', $2)", [T, X]);
  r = await um("select * from rita.can_contact($1, 'contato')", [T]);
  ok(r.allowed === true, "consentimento POSTERIOR reabre (na mesma transação, pelo relógio do comando)", JSON.stringify(r));
  await q("select rita.revoke_consent($1, 'contato', 'whatsapp')", [T]);
  r = await um("select * from rita.can_contact($1, 'contato')", [T]);
  ok(r.allowed === false && r.reason === "consentimento_revogado", "revogar bloqueia", JSON.stringify(r));
  ok(/RITA_NEVER_DELETE/.test((await erroDe("delete from rita.opt_outs where phone_e164 = $1", [T])) ?? ""), "descadastro não se apaga (nem pela chave de serviço)");
  ok(/RITA_NEVER_DELETE/.test((await erroDe("delete from rita.contact_consents where phone_e164 = $1", [T])) ?? ""), "consentimento não se apaga");
  ok(/INVALID_PHONE/.test((await erroDe("select rita.register_opt_out('12345', 'whatsapp', null)")) ?? ""), "telefone inválido recusado no descadastro");

  // Pessoas logadas
  const T2 = "+5543900000002";
  await como(fora);
  ok(
    /NOT_ALLOWED/.test((await erroDe("select rita.register_consent($1, 'contato', 'ensaio-1', 'presencial', $2)", [T2, X])) ?? ""),
    "pessoa de outra unidade não registra consentimento ali"
  );
  ok((await erroDe("select rita.register_opt_out($1, 'presencial', 'pediu na recepção')", [T2])) === null, "qualquer pessoa da equipe registra descadastro");
  await como(ger.user_id);
  ok(
    (await erroDe("select rita.register_consent($1, 'contato', 'ensaio-1', 'presencial', $2)", [T2, X])) === null,
    "Gerente da unidade registra consentimento presencial"
  );
  const semFuncao = (await um(`select id from public.profiles p where p.kind = 'person' and p.is_active and not p.is_admin_master
      and not exists (select 1 from public.user_clinic_roles_all r where r.user_id = p.id) limit 1`))?.id;
  if (semFuncao) {
    await como(semFuncao);
    ok(/NOT_ALLOWED/.test((await erroDe("select rita.register_opt_out($1, 'presencial', null)", [T2])) ?? ""), "logado sem função na equipe não registra nada");
    ok(/NOT_ALLOWED/.test((await erroDe("select * from rita.can_contact($1, 'contato')", [T2])) ?? ""), "logado sem função não consulta");
  } else {
    console.log("  · (sem perfil sem função no treino: conferência pulada)");
  }

  // Integração com o Indica +Risos (leitura)
  await como("servico");
  const ind = await um(`
    select rita.phone_e164(i.indicado_telefone_digitos) fone, k.indicacao_id
    from indica.consentimentos k join indica.indicacoes i on i.id = k.indicacao_id
    where k.aceito_em is not null and k.revogado_em is null and rita.phone_e164(i.indicado_telefone_digitos) is not null
      and not exists (select 1 from indica.consentimentos k2 join indica.indicacoes i2 on i2.id = k2.indicacao_id
                      where k2.revogado_em is not null and rita.phone_e164(i2.indicado_telefone_digitos) = rita.phone_e164(i.indicado_telefone_digitos))
      and not exists (select 1 from rita.opt_outs o where o.phone_e164 = rita.phone_e164(i.indicado_telefone_digitos))
      and not exists (select 1 from rita.contact_consents c where c.phone_e164 = rita.phone_e164(i.indicado_telefone_digitos))
    limit 1`);
  if (!ind) naoMedi("o treino não tem aceite do Indica com telefone");
  r = await um("select * from rita.can_contact($1, 'contato')", [ind.fone]);
  ok(r.allowed === true && r.reason === "aceite_indica", "aceite do indicado no Indica conta como consentimento de contato", JSON.stringify(r));
  r = await um("select * from rita.can_contact($1, 'marketing')", [ind.fone]);
  ok(r.allowed === false, "aceite do Indica não vale para marketing", JSON.stringify(r));
  await q("select rita.register_opt_out($1, 'whatsapp', 'não quero contato (ensaio)')", [ind.fone]);
  r = await um("select * from rita.can_contact($1, 'contato')", [ind.fone]);
  ok(r.allowed === false && r.reason === "descadastro", "'não quero contato' depois do aceite do Indica bloqueia", JSON.stringify(r));
  await q("update indica.consentimentos set revogado_em = clock_timestamp() where indicacao_id = $1", [ind.indicacao_id]);
  r = await um("select * from rita.can_contact($1, 'contato')", [ind.fone]);
  ok(r.allowed === false && r.reason === "aceite_indica_revogado", "aceite revogado no Indica bloqueia (o mais recente vale)", JSON.stringify(r));

  // Permissões
  const p = await um(`select
    has_schema_privilege('anon', 'rita', 'usage') anon_usa,
    has_table_privilege('authenticated', 'rita.contact_consents', 'select') le_consent,
    has_table_privilege('authenticated', 'rita.opt_outs', 'select') le_optout,
    has_function_privilege('authenticated', 'rita._can_contact(text,text)', 'execute') conta,
    has_function_privilege('authenticated', 'rita._author(uuid)', 'execute') autor,
    has_function_privilege('authenticated', 'rita.can_contact(text,text)', 'execute') porta`);
  ok(
    !p.anon_usa && !p.le_consent && !p.le_optout && !p.conta && !p.autor && p.porta,
    "tabelas fechadas a quem loga; só as portas abrem",
    JSON.stringify(p)
  );

  // =========================================================== 0A.4 (0368 + 3003)
  console.log("\n0A.4 — dados públicos, horário por dia e feriados");
  await como(null);
  // Semente do horário por dia = a mesma conta da agenda de hoje.
  const rede = await q("select weekday, closed from public.clinic_weekday_hours where clinic_id is null order by weekday");
  ok(rede.length === 7, "a rede tem os 7 dias", String(rede.length));
  const diverge = await q(`
    select s.clinic_id from public.clinic_agenda_settings s
    where exists (
      select 1 from generate_series(0, 6) d
      left join public.clinic_weekday_hours w on w.clinic_id is not distinct from s.clinic_id and w.weekday = d
      where w.id is null
         or w.closed = (d = any (coalesce(nullif(s.weekdays, '{}'), '{1,2,3,4,5,6}')))
         or (not w.closed and (w.open_time <> s.open_time or w.close_time <> s.close_time))
    )`);
  ok(diverge.length === 0, "a semente bate com a agenda (dias abertos e horário), rede e unidades", JSON.stringify(diverge));
  const nac = await um("select count(*)::int n from public.holidays where scope = 'national' and holiday_date between '2026-01-01' and '2029-12-31'");
  ok(nac.n === 48, "48 feriados nacionais semeados (2026–2029)", String(nac.n));
  const pend4 = (await q("select item from rita._pending_items()")).map((x) => x.item);
  ok(!pend4.includes("maps") && !pend4.includes("horario_por_dia"), "mapa e horário por dia saíram dos pendentes", pend4.join(","));

  // Regras de linha valendo: o papel do banco vira `authenticated`.
  async function comoLogado(uid, sql, p = []) {
    await como(uid);
    await db.query("savepoint rls");
    try {
      await db.query("set local role authenticated");
      await db.query(sql, p);
      await db.query("reset role");
      await db.query("release savepoint rls");
      return null;
    } catch (e) {
      await db.query("rollback to savepoint rls");
      return e.message;
    } finally {
      await db.query("reset role");
    }
  }
  const Y = (await um("select id from public.clinics where id <> $1 and type::text <> 'franchisor' order by created_at limit 1", [X]))?.id;
  if (!Y) naoMedi("faltou uma segunda unidade no treino");
  const upsertInfo = `insert into public.clinic_public_info (clinic_id, maps_url) values ($1, 'https://maps.example/ensaio')
    on conflict (clinic_id) do update set maps_url = excluded.maps_url`;
  ok((await comoLogado(ger.user_id, upsertInfo, [X])) === null, "Gerente grava os dados públicos da unidade dele");
  ok((await comoLogado(ger.user_id, upsertInfo, [Y])) !== null, "Gerente NÃO grava os dados públicos de outra unidade");
  ok((await comoLogado(fora, upsertInfo, [X])) !== null, "pessoa de fora não grava os dados públicos");
  ok(
    (await comoLogado(ger.user_id, "update public.clinic_weekday_hours set closed = true where clinic_id is null and weekday = 0")) === null &&
      (await um("select closed from public.clinic_weekday_hours where clinic_id is null and weekday = 0")).closed ===
        rede.find((d) => d.weekday === 0).closed,
    "Gerente não muda o horário da REDE (a regra filtra: nada muda)"
  );
  const insHoliday = "insert into public.holidays (holiday_date, name, scope, state, city) values ($1, 'Feriado de ensaio', $2, $3, $4)";
  const uf = (await um("select upper(btrim(state)) uf, btrim(city) cidade from public.clinics where id = $1", [X]));
  if (!uf.uf) naoMedi("a unidade do Gerente não tem estado no treino");
  ok((await comoLogado(ger.user_id, insHoliday, ["2027-03-19", "state", uf.uf, null])) === null, "Gerente cadastra feriado do estado dele");
  ok((await comoLogado(ger.user_id, insHoliday, ["2027-03-20", "state", uf.uf === "SP" ? "RJ" : "SP", null])) !== null, "Gerente NÃO cadastra feriado de outro estado");
  ok((await comoLogado(ger.user_id, insHoliday, ["2027-03-21", "national", null, null])) !== null, "Gerente NÃO cadastra feriado nacional");
  ok((await comoLogado(admin, insHoliday, ["2027-03-22", "national", null, null])) === null, "Admin cadastra feriado nacional");
  await como(null);
  ok(/holidays_unique|duplicate/.test((await erroDe(insHoliday, ["2027-03-22", "national", null, null])) ?? ""), "feriado repetido é recusado");

  // O calendário da Rita
  await como(null);
  await q("delete from public.clinic_weekday_hours where clinic_id = $1", [X]);
  await q(`insert into public.clinic_weekday_hours (clinic_id, weekday, closed, open_time, close_time, lunch_start, lunch_end)
           select $1, d, d in (0, 6), case when d not in (0, 6) then '08:00'::time end, case when d not in (0, 6) then '18:00'::time end,
                  case when d not in (0, 6) then '12:00'::time end, case when d not in (0, 6) then '13:00'::time end
           from generate_series(0, 6) d`, [X]);
  let dia = await um("select * from rita.unit_day($1, '2026-12-21')", [X]); // segunda
  ok(dia.is_open && dia.open_time === "08:00:00" && dia.lunch_start === "12:00:00" && dia.reason === "aberto", "dia útil: aberto, com horário e almoço", JSON.stringify(dia));
  dia = await um("select * from rita.unit_day($1, '2026-12-20')", [X]); // domingo
  ok(!dia.is_open && dia.reason === "dia_fechado", "domingo fechado no horário por dia", JSON.stringify(dia));
  await q("delete from public.clinic_holiday_decisions where clinic_id = $1 and holiday_date = '2026-12-25'", [X]);
  dia = await um("select * from rita.unit_day($1, '2026-12-25')", [X]); // Natal, sexta
  ok(!dia.is_open && dia.reason === "feriado_sem_decisao" && dia.holiday_name === "Natal", "feriado SEM decisão = fechado para a Rita (decisão 9)", JSON.stringify(dia));
  await q("insert into public.clinic_holiday_decisions (clinic_id, holiday_date, will_attend) values ($1, '2026-12-25', true)", [X]);
  dia = await um("select * from rita.unit_day($1, '2026-12-25')", [X]);
  ok(dia.is_open && dia.reason === "feriado_com_atendimento", "feriado com 'vai atender' abre", JSON.stringify(dia));
  await q("update public.clinic_holiday_decisions set will_attend = false where clinic_id = $1 and holiday_date = '2026-12-25'", [X]);
  dia = await um("select * from rita.unit_day($1, '2026-12-25')", [X]);
  ok(!dia.is_open && dia.reason === "feriado_fechado", "feriado com 'não vai atender' fecha", JSON.stringify(dia));
  if (uf.cidade) {
    await q("insert into public.holidays (holiday_date, name, scope, state, city) values ('2027-06-15', 'Aniversário da cidade (ensaio)', 'city', $1, $2)", [uf.uf, uf.cidade]);
    dia = await um("select * from rita.unit_day($1, '2027-06-15')", [X]);
    const dY = await um("select * from rita.unit_day($1, '2027-06-15')", [Y]);
    const outraCidade = (await um("select lower(btrim(city)) = lower($2) mesma from public.clinics where id = $1", [Y, uf.cidade])).mesma;
    ok(
      dia.reason === "feriado_sem_decisao" && (outraCidade || dY.holiday_name === null),
      "feriado municipal vale só para a cidade da unidade",
      `${JSON.stringify(dia)} | ${JSON.stringify(dY)}`
    );
  }

  // O portão enxerga o mapa e a pausa vigia as tabelas novas
  await q("create or replace function rita._pending_items() returns table (ordem integer, item text, rotulo text, detalhe text) language sql immutable security definer set search_path = '' as $f$ select 0, ''::text, ''::text, ''::text where false $f$");
  await q(`update public.clinics set address = coalesce(nullif(address,''),'Rua Ensaio'), address_number = coalesce(nullif(address_number,''),'1'),
      neighborhood = coalesce(nullif(neighborhood,''),'Centro'), city = coalesce(nullif(city,''),'Cidade'),
      state = coalesce(nullif(state,''),'PR'), zip_code = coalesce(nullif(zip_code,''),'86000-000'), is_active = true where id = $1`, [X]);
  if ((await q("select 1 from public.clinic_agenda_settings where clinic_id = $1", [X])).length === 0) {
    await q("insert into public.clinic_agenda_settings (clinic_id, open_time, close_time, weekdays) values ($1, '08:00', '18:00', '{1,2,3,4,5}')", [X]);
  }
  if ((await q("select 1 from public.user_clinic_roles_all u join public.profiles p on p.id = u.user_id where u.clinic_id = $1 and u.role = 'clinical_coordinator' and p.is_active", [X])).length === 0) {
    await q("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'clinical_coordinator')", [fora, X]);
  }
  // Desde a 0A.6 as transferências são conferidas: o Gerente vira a reserva
  // da rota da unidade na simulação (a seção 0A.6 mede a regra de verdade).
  if ((await um("select to_regclass('rita.escalation_routes') t")).t) {
    await q(`insert into rita.escalation_routes (clinic_id, fallback_profile_id) values ($1, $2)
             on conflict on constraint escalation_routes_clinic_key do update set fallback_profile_id = $2`, [X, ger.user_id]);
  }
  await q("update public.clinic_public_info set maps_url = null where clinic_id = $1", [X]);
  let g = await um("select ok from rita._gaps($1) where item = 'maps'", [X]);
  ok(g.ok === false, "sem link do mapa → item 'maps' falta");
  await q("update public.clinic_public_info set maps_url = 'https://maps.example/ensaio' where clinic_id = $1", [X]);
  // Desde a 0A.5 "o que a avaliação inclui" é conferido: o texto entra na simulação.
  if ((await um("select to_regclass('public.patient_texts') t")).t) {
    await q(`insert into public.patient_texts (text_key, clinic_id, content, status, approved_at)
             values ('evaluation_includes', null, 'Exame clínico completo (ensaio).', 'approved', now())
             on conflict on constraint patient_texts_unique do update set status = 'approved', approved_at = now()`);
  }
  const faltam = await q("select item from rita._gaps($1) where not ok", [X]);
  ok(faltam.length === 0, "unidade completa (com as próximas entregas simuladas): portão vazio", JSON.stringify(faltam));
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]);
  await q("update public.clinic_public_info set maps_url = null where clinic_id = $1", [X]);
  let st = await um("select enabled, paused_reason from rita.settings where clinic_id = $1", [X]);
  ok(st.enabled === false && /mapa/.test(st.paused_reason ?? ""), "link do mapa apagado → pausa sozinha", JSON.stringify(st));
  await q("update public.clinic_public_info set maps_url = 'https://maps.example/ensaio' where clinic_id = $1", [X]);
  await q("delete from public.clinic_weekday_hours where clinic_id = $1", [X]); // passa a herdar a rede
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]);
  await q("update public.clinic_weekday_hours set closed = true, open_time = null, close_time = null, lunch_start = null, lunch_end = null where clinic_id is null");
  st = await um("select enabled, paused_reason from rita.settings where clinic_id = $1", [X]);
  ok(st.enabled === false && /Horário/.test(st.paused_reason ?? ""), "rede toda fechada no horário por dia → unidade que herda pausa", JSON.stringify(st));

  // =========================================================== 0A.5 (0369 + 3004)
  console.log("\n0A.5 — a avaliação como dado");
  await como(null);
  // Desfaz o "rede toda fechada" da seção anterior (tudo na mesma transação).
  await q("update public.clinic_weekday_hours set closed = false, open_time = '08:00', close_time = '18:00' where clinic_id is null and weekday between 1 and 5");
  // ⚠️ No treino, um Admin pôs as urgências no rol pela tela (10/11/2026,
  // AP132): a conferência da semente parte do que a 0369 gravou.
  await q("update public.procedures set rita_can_offer = false where rita_role = 'urgency'");
  const marcas = await q("select name, rita_role, rita_can_offer from public.procedures where rita_role is not null order by rita_role, name");
  const m = (nome) => marcas.find((x) => x.name.trim() === nome);
  ok(
    m("Consulta odontológica inicial")?.rita_role === "evaluation_new" && m("Consulta odontológica inicial")?.rita_can_offer === true &&
      m("Consulta odontológica")?.rita_role === "evaluation_returning" && m("Consulta odontológica")?.rita_can_offer === true &&
      m("Consulta odontológica de Urgência")?.rita_role === "urgency" && m("Consulta odontológica de Urgência")?.rita_can_offer === false &&
      m("Consulta odontológica de Urgência 24 hs")?.rita_role === "urgency" && marcas.length === 4,
    "decisão 38: as 4 consultas marcadas pelo nome (2 no rol, 2 urgências fora)",
    JSON.stringify(marcas)
  );
  const aval = (await um("select id from public.procedures where rita_role = 'evaluation_new'")).id;
  const urg = (await um("select id from public.procedures where rita_role = 'urgency' order by name limit 1")).id;
  await como(ger.user_id);
  ok(/RITA_FIELDS_ADMIN_ONLY/.test((await erroDe("update public.procedures set rita_can_offer = true where id = $1", [urg])) ?? ""), "Gerente não mexe no rol da Rita");
  await como(admin);
  ok((await erroDe("update public.procedures set patient_name = 'Avaliação odontológica' where id = $1", [aval])) === null, "Admin dá o nome para o paciente");
  await como("servico");
  let cat = await q("select procedure_id, patient_name, rita_role, price_cents, minutes from rita.catalog($1)", [X]);
  const cAval = cat.find((x) => x.procedure_id === aval);
  ok(cAval?.patient_name === "Avaliação odontológica" && cAval.price_cents > 0 && cAval.minutes === 60, "catálogo: avaliação com nome do paciente, preço e 60 min", JSON.stringify(cAval));
  ok(!cat.some((x) => x.rita_role === "urgency") && cat.every((x) => x.rita_role || x.price_cents === null), "urgência fora do rol; preço só de avaliação/consulta", JSON.stringify(cat));
  await como(null);
  await q("insert into public.clinic_procedure_prices (clinic_id, procedure_id, price_cents) values ($1, $2, 25000) on conflict (clinic_id, procedure_id) do update set price_cents = 25000", [X, aval]);
  let fee = await um("select * from rita.evaluation_fee($1)", [X]);
  ok(fee.price_cents === 25000 && fee.offered === true && fee.free_for_indica === true, "preço da unidade vence o da rede", JSON.stringify(fee));
  await q("update public.clinic_agenda_settings set evaluation_minutes = 45 where clinic_id = $1", [X]);
  fee = await um("select * from rita.evaluation_fee($1)", [X]);
  ok(fee.minutes === 45, "duração da unidade vence a da rede", String(fee.minutes));
  // Oferta por unidade: o Gerente marca que a unidade não faz.
  ok(
    (await comoLogado(ger.user_id, "insert into public.clinic_procedure_availability (clinic_id, procedure_id, offered) values ($1, $2, false)", [X, aval])) === null,
    "Gerente marca que a unidade não faz"
  );
  ok((await comoLogado(ger.user_id, "insert into public.clinic_procedure_availability (clinic_id, procedure_id, offered) values ($1, $2, false)", [Y, aval])) !== null, "Gerente não marca em outra unidade");
  await como("servico");
  cat = await q("select procedure_id from rita.catalog($1)", [X]);
  fee = await um("select * from rita.evaluation_fee($1)", [X]);
  let gA = await um("select ok, detalhe from rita._gaps($1) where item = 'avaliacao'", [X]);
  ok(!cat.some((x) => x.procedure_id === aval) && fee.offered === false && gA.ok === false && /não faz/.test(gA.detalhe), "unidade que não faz: some do catálogo e o portão acusa", JSON.stringify(gA));
  await como(null);
  await q("delete from public.clinic_procedure_availability where clinic_id = $1", [X]);

  // Valor zero só passa com campanha ativa
  await q("delete from public.clinic_procedure_prices where clinic_id = $1 and procedure_id = $2", [X, aval]);
  await q("update public.procedures set default_price_cents = 0 where id = $1", [aval]);
  gA = await um("select ok, detalhe from rita._gaps($1) where item = 'avaliacao'", [X]);
  ok(gA.ok === false && /valor zero/.test(gA.detalhe), "valor zero sem campanha = lacuna", JSON.stringify(gA));
  const hoje = (await um("select (now() at time zone 'America/Sao_Paulo')::date::text d")).d;
  await como(ger.user_id);
  const eOutra = await erroDe("select rita.propose_fee_campaign(array[$1]::uuid[], 'Campanha de ensaio', 'Avaliação gratuita neste mês (ensaio).', $2::date, $2::date + 30)", [Y, hoje]);
  ok(/NOT_ALLOWED/.test(eOutra ?? ""), "Gerente não propõe campanha para outra unidade", eOutra ?? "passou");
  const camp = (await um("select rita.propose_fee_campaign(array[$1]::uuid[], 'Campanha de ensaio', 'Avaliação gratuita neste mês (ensaio).', $2::date, $2::date + 30) id", [X, hoje])).id;
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.set_fee_campaign_status($1, 'active')", [camp])) ?? ""), "Gerente não aprova campanha");
  await como("servico");
  ok((await um("select campaign_id from rita.evaluation_fee($1)", [X])).campaign_id === null, "campanha proposta (rascunho) não vale");
  await como(admin);
  await q("select rita.set_fee_campaign_status($1, 'active')", [camp]);
  await como("servico");
  fee = await um("select * from rita.evaluation_fee($1)", [X]);
  gA = await um("select ok from rita._gaps($1) where item = 'avaliacao'", [X]);
  ok(fee.campaign_id === camp && /gratuita/.test(fee.campaign_text) && gA.ok === true, "campanha aprovada: aparece e cobre o valor zero", JSON.stringify(fee));
  await como(null);
  await q("update rita.evaluation_fee_campaigns set starts_on = $1::date - 40, ends_on = $1::date - 1 where id = $2", [hoje, camp]);
  await como("servico");
  ok((await um("select campaign_id from rita.evaluation_fee($1)", [X])).campaign_id === null, "campanha vencida some");
  ok(/INVALID_INPUT/.test((await erroDe("select rita.propose_fee_campaign(null, 'x', 'curto', current_date, current_date)")) ?? "") ||
     /NOT_ALLOWED/.test((await erroDe("select rita.propose_fee_campaign(null, 'x', 'curto', current_date, current_date)")) ?? ""),
     "sem pessoa logada, ninguém propõe campanha");
  await como(null);
  await q("update public.procedures set default_price_cents = 30000 where id = $1", [aval]);

  // Textos para o paciente
  const insTexto = "insert into public.patient_texts (text_key, clinic_id, content, status, approved_at) values ($1, $2, $3, $4, $5)";
  ok(/PATIENT_TEXT_ADMIN_APPROVES/.test((await comoLogado(ger.user_id, insTexto, ["evaluation_includes", X, "Exame clínico completo e conversa sobre o plano.", "approved", new Date().toISOString()])) ?? ""), "Gerente não aprova texto");
  ok((await comoLogado(ger.user_id, insTexto, ["evaluation_includes", X, "Exame clínico completo e conversa sobre o plano.", "draft", null])) === null, "Gerente propõe o texto da unidade (rascunho)");
  ok((await comoLogado(ger.user_id, insTexto, ["evaluation_bring", null, "Documento com foto.", "draft", null])) !== null, "Gerente não escreve o texto da rede");
  await como(null);
  let gI = await um("select ok from rita._gaps($1) where item = 'avaliacao_inclui'", [X]);
  ok(gI.ok === false, "texto em rascunho não vale para o portão");
  ok(
    (await comoLogado(admin, "update public.patient_texts set status = 'approved', approved_at = now(), approved_by = $2 where text_key = 'evaluation_includes' and clinic_id = $1", [X, admin])) === null,
    "Admin aprova o texto da unidade"
  );
  await como(null);
  gI = await um("select ok from rita._gaps($1) where item = 'avaliacao_inclui'", [X]);
  ok(gI.ok === true, "texto aprovado: o portão aceita");
  await comoLogado(ger.user_id, "update public.patient_texts set content = 'Exame clínico, radiografia e a conversa sobre o plano.' where text_key = 'evaluation_includes' and clinic_id = $1", [X]);
  await como(null);
  const t = await um("select status, version, approved_at from public.patient_texts where text_key = 'evaluation_includes' and clinic_id = $1", [X]);
  ok(t.status === "draft" && t.version === 2 && t.approved_at === null, "Gerente mudou o texto: volta a rascunho, versão 2", JSON.stringify(t));
  const pol = await um("select count(*)::int n from public.patient_texts where clinic_id is null and status = 'approved' and text_key in ('late_tolerance','reschedule_policy','no_show_policy','minors_policy')");
  ok(pol.n === 4, "decisão 42: as 4 políticas padrão da rede, aprovadas", String(pol.n));
  const pend5 = (await q("select item from rita._pending_items()")).map((x) => x.item);
  // (o _pending_items foi trocado por "nenhum" na seção 0A.4; a conferência
  // real lê a definição gravada, que não muda dentro desta transação)
  const def = (await um("select prosrc from pg_proc where oid = 'rita._pending_items()'::regprocedure")).prosrc;
  ok(pend5.length === 0 || (!/'avaliacao'/.test(def) && !/'avaliacao_inclui'/.test(def)), "avaliação e 'o que inclui' saíram dos pendentes");

  // Pausa: a unidade ligada deixa de fazer a avaliação
  await q("update public.patient_texts set status = 'approved', approved_at = now() where text_key = 'evaluation_includes' and clinic_id = $1", [X]);
  const faltam5 = await q("select item from rita._gaps($1) where not ok", [X]);
  if (faltam5.length) naoMedi("a unidade não ficou completa para a prova da pausa: " + JSON.stringify(faltam5));
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]);
  await q("insert into public.clinic_procedure_availability (clinic_id, procedure_id, offered) values ($1, $2, false)", [X, aval]);
  st = await um("select enabled, paused_reason from rita.settings where clinic_id = $1", [X]);
  ok(st.enabled === false && /avaliação/.test(st.paused_reason ?? ""), "unidade deixa de fazer a avaliação → pausa sozinha", JSON.stringify(st));
  await q("delete from public.clinic_procedure_availability where clinic_id = $1", [X]);

  // =========================================================== 0A.6 (3005)
  console.log("\n0A.6 — escalonamento, avisos e o registro da Rita");
  await como(null);
  const rotaRede = await um("select * from rita.escalation_routes where clinic_id is null");
  ok(
    rotaRede && rotaRede.business_hours_roles === "{receptionist}" && rotaRede.sla_alert_roles === "{unit_manager}" &&
      rotaRede.sla_alert_after_minutes === 15 && rotaRede.sla_escalate_to_admin_after_minutes === 60,
    "decisão 28: a rede nasce com Recepção, alerta ao Gerente em 15 min e ao Admin em 60",
    JSON.stringify(rotaRede)
  );
  const nItens = (await um("select count(*)::int n from rita._gaps($1)", [X])).n;
  const pend6 = await q("select item from rita._pending_items()");
  ok(pend6.length === 0 && nItens === 10, "nenhum item pendente: os 10 do portão são conferidos", `${pend6.length} pendentes, ${nItens} itens`);

  // Ninguém recebe: sem a rota da unidade e sem Recepção ativa
  await q("delete from rita.escalation_routes where clinic_id = $1", [X]);
  await q("update rita.settings set enabled = false where clinic_id = $1", [X]);
  await q("delete from public.user_clinic_roles_all where clinic_id = $1 and role = 'receptionist'", [X]);
  let gT = await um("select ok, detalhe from rita._gaps($1) where item = 'transferencias'", [X]);
  ok(gT.ok === false && /rota rede/.test(gT.detalhe ?? ""), "sem Recepção ativa e sem reserva: 'transferências' falta", JSON.stringify(gT));

  // Gravar a rota: quem pode e quem não
  const salvar = "select rita.save_escalation_route($1, '{receptionist}', '{unit_manager}', 20, 90, $2)";
  await como(null);
  ok(/NOT_ALLOWED/.test((await erroDe(salvar, [X, null])) ?? ""), "sem login, ninguém grava a rota");
  await como(ger.user_id);
  ok(/NOT_ALLOWED/.test((await erroDe(salvar, [Y, null])) ?? ""), "Gerente não grava a rota de outra unidade");
  ok(/NOT_ALLOWED/.test((await erroDe(salvar, [null, null])) ?? ""), "Gerente não grava a rota da rede");
  ok(/FALLBACK_NOT_IN_CLINIC/.test((await erroDe(salvar, [X, fora])) ?? ""), "reserva tem de ter função na unidade");
  ok(/escalation_routes_admin_minutes/.test((await erroDe("select rita.save_escalation_route($1, '{receptionist}', '{unit_manager}', 30, 10, null)", [X])) ?? ""), "subir ao Admin antes do alerta ao Gerente é recusado");
  ok((await erroDe(salvar, [X, ger.user_id])) === null, "Gerente grava a rota da unidade dele, com ele de reserva");
  await como(null);
  gT = await um("select ok from rita._gaps($1) where item = 'transferencias'", [X]);
  ok(gT.ok === true, "com a reserva ativa: 'transferências' completo");
  const aRota = await um("select actor_kind, actor_id, payload from rita.actions where kind = 'rota' and clinic_id = $1 order by id desc limit 1", [X]);
  ok(aRota?.actor_kind === "pessoa" && aRota.actor_id === ger.user_id && aRota.payload.alerta_minutos === 20, "registro: rota alterada pelo Gerente", JSON.stringify(aRota));

  // A pausa automática avisa o Gerente e os Admins
  const faltam6 = await q("select item from rita._gaps($1) where not ok", [X]);
  if (faltam6.length) naoMedi("a unidade não ficou completa para a prova da pausa: " + JSON.stringify(faltam6));
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]);
  const antes = (await um("select coalesce(max(id), 0) id from rita.actions")).id;
  // Só os avisos DESTA pausa (as seções anteriores também pausaram a unidade).
  const avisosAntes = (await q("select user_id from public.notifications where clinic_id = $1 and title like 'Rita: pausada em %'", [X])).map((a) => a.user_id);
  await q("update rita.escalation_routes set fallback_profile_id = null where clinic_id = $1", [X]);
  st = await um("select enabled, paused_reason from rita.settings where clinic_id = $1", [X]);
  ok(st.enabled === false && /transferências/.test(st.paused_reason ?? ""), "reserva tirada e ninguém na Recepção → pausa sozinha", JSON.stringify(st));
  const esperados = (await um(`
    select count(distinct u)::int n from (
      select r.user_id u from public.user_clinic_roles_all r join public.profiles p on p.id = r.user_id
       where r.clinic_id = $1 and r.role = 'unit_manager' and p.is_active and p.kind = 'person'
      union
      select id from public.profiles where is_admin_master and is_active and kind = 'person') t`, [X])).n;
  const todos = await q("select user_id from public.notifications where clinic_id = $1 and title like 'Rita: pausada em %' and link = $2", [X, `/rita/${X}`]);
  const avisos = todos.filter((a) => { const i = avisosAntes.indexOf(a.user_id); if (i >= 0) { avisosAntes.splice(i, 1); return false; } return true; });
  ok(avisos.length === esperados && esperados > 0 && avisos.some((a) => a.user_id === ger.user_id) && avisos.some((a) => a.user_id === admin),
     `aviso da pausa: Gerente(s) e Admin(s), um cada (${esperados})`, `${avisos.length} avisos`);
  ok(!avisos.some((a) => a.user_id === rita), "a Rita não recebe aviso");
  const aPausa = await um("select kind, actor_kind from rita.actions where id > $1 and clinic_id = $2 and kind = 'pausada'", [antes, X]);
  ok(aPausa?.actor_kind === "sistema", "registro: pausada sozinha, pelo sistema", JSON.stringify(aPausa));
  const nov = await um("select recipients from rita.notices where clinic_id = $1 and kind = 'pausa' order by id desc limit 1", [X]);
  ok(nov?.recipients === esperados, "a trava do aviso guarda quantos receberam", JSON.stringify(nov));

  // _notify: a trava contra repetir, o link e quem pode chamar
  await como("servico");
  const chave = `ensaio:${Date.now()}`;
  const env1 = (await um("select rita._notify($1, 'ensaio', '{unit_manager}', 'Ensaio', 'Corpo', $2, $3) n", [X, `/rita/${X}`, chave])).n;
  const env2 = (await um("select rita._notify($1, 'ensaio', '{unit_manager}', 'Ensaio', 'Corpo', $2, $3) n", [X, `/rita/${X}`, chave])).n;
  const nGer = (await um(`select count(*)::int n from public.user_clinic_roles_all r join public.profiles p on p.id = r.user_id
                           where r.clinic_id = $1 and r.role = 'unit_manager' and p.is_active and p.kind = 'person'`, [X])).n;
  ok(env1 === nGer && env1 > 0 && env2 === 0, `_notify para os Gerentes: ${nGer} avisos; a mesma chave não repete`, `${env1} e ${env2}`);
  const tit = await um("select title from public.notifications where title like 'Rita: Ensaio' limit 1");
  ok(tit?.title === "Rita: Ensaio", "o título ganha o 'Rita: '");
  ok(/RITA_NOTICE_LINK/.test((await erroDe("select rita._notify($1, 'ensaio', '{unit_manager}', 'x', 'y', '/clientes/1')", [X])) ?? ""), "link fora de /rita é recusado");
  ok(/permission denied/.test((await comoLogado(ger.user_id, "select rita._notify($1, 'x', '{unit_manager}', 'x', 'y', '/rita')", [X])) ?? ""), "logado, ninguém chama o _notify direto");
  await db.query("savepoint anon");
  let eAnon;
  try {
    await db.query("set local role anon");
    await db.query("select rita._notify(null, 'x', '{}', 'x', 'y', '/rita')");
  } catch (e) {
    eAnon = e.message;
  }
  await db.query("rollback to savepoint anon");
  await db.query("reset role");
  ok(/permission denied/.test(eAnon ?? ""), "sem login, o _notify recusa");

  // Desligar pela tela avisa os outros, nunca quem clicou
  await q("update public.clinic_public_info set maps_url = coalesce(maps_url, 'https://maps.example/ensaio') where clinic_id = $1", [X]);
  await q("update rita.settings set enabled = true where clinic_id = $1", [X]); // estava ligada
  await como(ger.user_id);
  await q("select rita.set_enabled($1, false, 'Ensaio do pânico')", [X]);
  await como(null);
  const desl = await q("select user_id from public.notifications where clinic_id = $1 and title like 'Rita: desligada em %'", [X]);
  ok(desl.some((a) => a.user_id === admin) && !desl.some((a) => a.user_id === ger.user_id), "Gerente desligou: o Admin é avisado, o Gerente não", `${desl.length} avisos`);
  const aDesl = await um("select actor_kind, actor_id, summary from rita.actions where clinic_id = $1 and kind = 'desligada' order by id desc limit 1", [X]);
  ok(aDesl?.actor_id === ger.user_id && /pânico/.test(aDesl.summary), "registro: desligada pelo Gerente, com o motivo", JSON.stringify(aDesl));

  // O registro só cresce e não guarda telefone
  ok(/RITA_ACTIONS_APPEND_ONLY/.test((await erroDe("update rita.actions set summary = 'x' where id = (select max(id) from rita.actions)")) ?? ""), "rita.actions recusa alteração");
  ok(/RITA_ACTIONS_APPEND_ONLY/.test((await erroDe("delete from rita.actions where id = (select max(id) from rita.actions)")) ?? ""), "rita.actions recusa apagar");
  ok(/permission denied/.test((await comoLogado(admin, "select count(*) from rita.actions")) ?? ""), "nem o Admin lê o registro direto (só por função, na 0A.7)");
  const comFone = (await um("select count(*)::int n from rita.actions where payload::text ~ '\\+55' or summary ~ '\\+55'")).n;
  ok(comFone === 0, "nenhum telefone no registro", String(comFone));

  // ------------------------------------------- 0A.7a — a leitura da tela (3006)
  console.log("\n0A.7a — a leitura da tela \"O que a Rita sabe\"");
  if (!Y) naoMedi("não há uma segunda unidade para provar o escopo");
  await como(null);
  ok(/NOT_ALLOWED/.test((await erroDe("select * from rita.screen_units()")) ?? ""), "sem login, a lista recusa");
  ok(/NOT_ALLOWED/.test((await erroDe("select rita.screen_unit($1)", [X])) ?? ""), "sem login, a unidade recusa");
  await db.query("savepoint anon7");
  let eAnon7;
  try {
    await db.query("set local role anon");
    await db.query("select rita.screen_unit($1)", [X]);
  } catch (e) {
    eAnon7 = e.message;
  }
  await db.query("rollback to savepoint anon7");
  await db.query("reset role");
  ok(/permission denied/.test(eAnon7 ?? ""), "sem login (anon), a função nem abre");
  ok(/permission denied/.test((await comoLogado(ger.user_id, "select rita._can_read_unit($1)", [X])) ?? ""), "a guarda interna não é chamável por quem loga");
  ok((await comoLogado(ger.user_id, "select rita.screen_unit($1)", [X])) === null, "logado (papel authenticated), o Gerente lê a unidade dele");

  await como(ger.user_id);
  const listaGer = await q("select * from rita.screen_units()");
  ok(listaGer.some((u) => u.clinic_id === X), "a lista do Gerente tem a unidade dele");
  const verY = (await q("select clinic_id from public.user_full_access_clinic_ids() clinic_id")).some((r) => r.clinic_id === Y);
  ok(verY || !listaGer.some((u) => u.clinic_id === Y), "a lista do Gerente não tem unidade que ele não enxerga");
  if (!verY) ok(/NOT_ALLOWED/.test((await erroDe("select rita.screen_unit($1)", [Y])) ?? ""), "o Gerente não lê a unidade de outro");
  const tela = (await um("select rita.screen_unit($1) j", [X])).j;
  const nGaps = (await um("select count(*)::int n from rita._gaps($1)", [X])).n;
  const nFalta = (await um("select count(*)::int n from rita._gaps($1) where not ok", [X])).n;
  ok(Array.isArray(tela.gaps) && tela.gaps.length === nGaps && nGaps > 0, `o portão da tela = o da Rita (${nGaps} itens)`);
  ok(listaGer.find((u) => u.clinic_id === X)?.gaps === nFalta, `a lista conta as lacunas (${nFalta})`);
  const linhaX = listaGer.find((u) => u.clinic_id === X);
  ok(linhaX?.enabled === false && linhaX.paused_auto === false && tela.settings?.paused_by, "desligada pelo Gerente: não conta como pausa automática, e diz quem", JSON.stringify(linhaX));
  await q("update rita.settings set paused_by = null where clinic_id = $1", [X]);
  ok((await um("select paused_auto from rita.screen_units() where clinic_id = $1", [X]))?.paused_auto === true, "sem pessoa no desligar: pausa automática");
  ok(Array.isArray(tela.hours) && tela.hours.length === 7, "os 7 dias da semana");
  const nCat = (await um("select count(*)::int n from rita.catalog($1)", [X])).n;
  ok((tela.catalog ?? []).length === nCat, `o catálogo da tela = o da Rita (${nCat})`);
  ok(tela.route && ["rede", "unidade"].includes(tela.route.scope), "a rota vem com o escopo", JSON.stringify(tela.route?.scope));
  ok(tela.fee && "price_cents" in tela.fee, "o valor da avaliação vem");
  ok(tela.effective_mode === (await um("select rita.effective_mode($1) m", [X])).m, "o modo da tela = o da Rita");
  ok(Array.isArray(tela.actions) && tela.actions.length > 0 && tela.actions.length <= 30, `o registro vem (${tela.actions?.length ?? 0}, no máximo 30)`);
  ok(!JSON.stringify(tela.actions).includes("+55"), "nenhum telefone no registro da tela");
  ok(tela.actions.every((a, i, arr) => i === 0 || arr[i - 1].created_at >= a.created_at), "o registro vem do mais novo para o mais velho");

  await como(admin);
  const listaAdm = await q("select * from rita.screen_units()");
  ok(listaAdm.some((u) => u.clinic_id === X) && listaAdm.some((u) => u.clinic_id === Y), "o Admin vê todas as unidades");
  const nFranq = (await um("select count(*)::int n from public.clinics where type = 'franchisor'")).n;
  const franqIds = (await q("select id from public.clinics where type = 'franchisor'")).map((r) => r.id);
  ok(nFranq === 0 || !listaAdm.some((u) => franqIds.includes(u.clinic_id)), "a Franqueadora não entra na lista (não atende paciente)");
  ok(/NOT_FOUND|NOT_ALLOWED/.test((await erroDe("select rita.screen_unit(gen_random_uuid())")) ?? ""), "unidade inexistente: recusa, nada vazio");
} catch (e) {
  falhas.push(e.message);
  console.log(`\n  ✘ ${e.message}`);
} finally {
  await db.query("rollback");
  await db.end();
}

console.log(`\n${passou} conferências OK, ${falhas.length} falha(s). Transação DESFEITA (nada ficou no treino).`);
if (passou === 0) {
  console.error("NÃO MEDI NADA");
  process.exit(2);
}
process.exit(falhas.length ? 1 : 0);
