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
