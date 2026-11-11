/**
 * CONFERÊNCIA DA ASSINATURA DIGITAL (ZapSign) — SÓ LEITURA.
 *
 * Pedido do dono (11/11/2026): conferir a fundo a integração depois da
 * revisão do código (AP150–AP158). Lê o banco (produção, ou treino com
 * `--treino`) e, se houver `ZAPSIGN_API_TOKEN` no arquivo de ambiente, pergunta
 * à própria ZapSign.
 *
 *   node scripts/conferir-assinatura-digital.mjs            (produção, .env.local)
 *   node scripts/conferir-assinatura-digital.mjs --treino   (treino, .env.test.local)
 *
 * ⚠️ NÃO GRAVA NADA: só `select`, `storage.list` e GET na ZapSign. Nenhum nome,
 * CPF, telefone ou e-mail é impresso — só números de pacote (ASS-…), códigos
 * de Risartano (RIS-…), nomes de unidade, situações e contagens.
 *
 * ⚠️ RÉGUA VAZIA GRITA (§0d): leitura que falha imprime "NÃO MEDI", nunca zero.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PRODUCAO = "hvhbijctanrrkxhemlza";
const treino = process.argv.includes("--treino");
const arquivo = treino ? ".env.test.local" : ".env.local";
const env = Object.fromEntries(
  readFileSync(arquivo, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^export\s+/, ""))
    .filter((l) => /^[A-Z_][A-Z0-9_]*\s*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (treino === url.includes(PRODUCAO)) throw new Error(`O arquivo ${arquivo} não aponta para o banco esperado (${treino ? "treino" : "produção"}).`);
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const titulo = (t) => console.log(`\n=== ${t} ===`);
const naoMedi = (o, e) => console.log(`  ❌ NÃO MEDI ${o}: ${e}`);
const conta = (lista, f) => lista.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
const dia = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

function cpfValido(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

console.log(`Conferência da assinatura digital — banco: ${treino ? "TREINO" : "PRODUÇÃO"} — ${new Date().toISOString()}`);

// 1) Pacotes
titulo("Pacotes");
const { data: pacotes, error: ep } = await db
  .from("signature_packages")
  .select("id, number, status, current_stage, audience, clinic_id, sent_at, completed_at, expires_at, client_signed_at, signed_pdf_path, merged_pdf_path, zapsign_doc_token, plan_month, cancel_reason, created_at")
  .order("created_at");
if (ep) naoMedi("os pacotes", ep.message);
const P = pacotes ?? [];
console.log("  por situação:", JSON.stringify(conta(P, (p) => p.status)));
const agora = Date.now();
const alertas = [];
for (const p of P) {
  if (p.status === "signed" && !p.signed_pdf_path) alertas.push(`${p.number}: assinado SEM o PDF guardado`);
  if (["sent", "partially_signed"].includes(p.status) && p.expires_at && Date.parse(p.expires_at) < agora) alertas.push(`${p.number}: aberto e já passou do prazo (${dia(p.expires_at)})`);
  if (p.status === "draft" && p.zapsign_doc_token) alertas.push(`${p.number}: rascunho COM documento na ZapSign`);
  if (p.status !== "draft" && !p.merged_pdf_path) alertas.push(`${p.number}: sem o PDF mesclado`);
  if (p.status === "draft" && agora - Date.parse(p.created_at) > 2 * 86400000) alertas.push(`${p.number}: rascunho parado há mais de 2 dias`);
}
console.log("  pacotes (número · situação · etapa · enviado · concluído · prazo):");
for (const p of P) console.log(`    ${p.number} · ${p.status} · ${p.current_stage ?? "—"} · ${dia(p.sent_at)} · ${dia(p.completed_at)} · ${dia(p.expires_at)}${p.cancel_reason ? ` · cancelado: ${p.cancel_reason}` : ""}`);
console.log(alertas.length ? "  ⚠️ " + alertas.join("\n  ⚠️ ") : "  ✅ nada fora do lugar nos pacotes");

// 2) Signatários
titulo("Signatários");
const { data: sig, error: es } = await db.from("signature_signers").select("package_id, signer_type, order_group, status, sign_url, zapsign_signer_token");
if (es) naoMedi("os signatários", es.message);
const S = sig ?? [];
console.log("  tipo/situação:", JSON.stringify(conta(S, (s) => `${s.signer_type}/${s.status}`)));
const porPacote = new Map(P.map((p) => [p.id, p]));
const semLink = S.filter((s) => ["sent", "partially_signed"].includes(porPacote.get(s.package_id)?.status) && s.status !== "signed" && !s.sign_url);
console.log(semLink.length ? `  ⚠️ ${semLink.length} signatário(s) pendente(s) sem link num pacote aberto` : "  ✅ todo pendente de pacote aberto tem link");

// 3) PDFs no balde
titulo("PDFs guardados (balde signature-documents)");
let faltam = 0;
let medidos = 0;
for (const p of P.filter((x) => x.signed_pdf_path || x.merged_pdf_path)) {
  for (const caminho of [p.signed_pdf_path, p.merged_pdf_path].filter(Boolean)) {
    const pasta = caminho.split("/").slice(0, -1).join("/");
    const nome = caminho.split("/").pop();
    const { data: l, error } = await db.storage.from("signature-documents").list(pasta, { limit: 100 });
    if (error) {
      naoMedi(`o arquivo de ${p.number}`, error.message);
      continue;
    }
    medidos++;
    if (!(l ?? []).some((f) => f.name === nome)) {
      faltam++;
      console.log(`  ⚠️ ${p.number}: o arquivo ${nome} não está no balde`);
    }
  }
}
console.log(medidos === 0 && P.some((p) => p.merged_pdf_path) ? "  ❌ NÃO MEDI nenhum arquivo" : `  ${medidos} arquivo(s) conferido(s), ${faltam} faltando`);

// 4) Eventos
titulo("Eventos (história dos pacotes)");
const { data: ev, error: ee } = await db.from("signature_events").select("event_type, error, created_at, package_id").order("created_at", { ascending: false }).limit(2000);
if (ee) naoMedi("os eventos", ee.message);
const E = ev ?? [];
console.log("  por tipo:", JSON.stringify(conta(E, (e) => e.event_type)));
const comErro = E.filter((e) => e.error);
for (const e of comErro.slice(0, 30)) console.log(`  ⚠️ ${dia(e.created_at)} ${e.event_type}: ${String(e.error).slice(0, 140)}`);
console.log(`  ${comErro.length} evento(s) com erro; ${E.filter((e) => !e.package_id).length} sem pacote (aviso que não casou)`);
const graves = ["closing_failed", "lead_seal_failed", "pending_download", "send_failed", "send_mark_skipped", "copy_failed", "reconcile_failed"];
const achados = E.filter((e) => graves.includes(e.event_type));
console.log(achados.length ? `  ⚠️ eventos de falha: ${JSON.stringify(conta(achados, (e) => e.event_type))}` : "  ✅ nenhum evento de falha");

// 5) Fila de e-mail
titulo("Fila de e-mail (signature_outbox)");
const { data: ob, error: eo } = await db.from("signature_outbox").select("kind, status, attempts, attachment_path, created_at, last_error");
if (eo) naoMedi("a fila", eo.message);
const O = ob ?? [];
console.log("  tipo/situação:", JSON.stringify(conta(O, (o) => `${o.kind}/${o.status}`)));
const copiaSemAnexo = O.filter((o) => o.kind === "signed_copy" && !o.attachment_path);
if (copiaSemAnexo.length) console.log(`  ⚠️ ${copiaSemAnexo.length} cópia(s) na fila SEM anexo (AP153)`);
for (const o of O.filter((x) => x.last_error).slice(0, 10)) console.log(`  ⚠️ ${o.kind} ${dia(o.created_at)}: ${String(o.last_error).slice(0, 120)}`);
console.log(`  e-mail configurado neste arquivo de ambiente: ${env.RESEND_API_KEY ? "sim" : "não (a Vercel pode ter)"}`);

// 6) Rotinas
titulo("Rotinas (diária no banco, horária e mensal na Vercel)");
const { data: jr, error: ej } = await db.from("signature_job_runs").select("job, ran_at, error, stats").order("ran_at", { ascending: false }).limit(200);
if (ej) naoMedi("o rastro das rotinas", ej.message);
const J = jr ?? [];
for (const job of ["daily", "hourly", "monthly"]) {
  const ult = J.find((j) => j.job === job);
  const erros = J.filter((j) => j.job === job && j.error).length;
  const horas = ult ? ((agora - Date.parse(ult.ran_at)) / 3600000).toFixed(1) : null;
  const limite = { daily: 26, hourly: 2, monthly: 24 * 32 }[job];
  const mark = !ult ? "❌" : Number(horas) > limite ? "⚠️" : "✅";
  console.log(`  ${mark} ${job}: última ${ult ? `${dia(ult.ran_at)} (há ${horas} h)` : "NUNCA RODOU"}; ${erros} com erro nas últimas ${J.filter((j) => j.job === job).length}`);
  if (ult?.error) console.log(`     último erro: ${String(ult.error).slice(0, 140)}`);
  if (ult?.stats) console.log(`     o que fez: ${JSON.stringify(ult.stats).slice(0, 220)}`);
}

// 7) Configuração
titulo("Configuração (Assinaturas → Configurações)");
const { data: cfg, error: ec } = await db.from("signature_settings").select("*").maybeSingle();
if (ec || !cfg) naoMedi("a configuração", ec?.message ?? "sem linha");
else {
  const rec = Array.isArray(cfg.monthly_report_recipients) ? cfg.monthly_report_recipients.length : "?";
  console.log(`  plano: ${cfg.zapsign_plan_name ?? "—"} · limite mensal: ${cfg.zapsign_monthly_limit ?? "NÃO DEFINIDO"} · alerta em ${cfg.zapsign_alert_percent}%`);
  console.log(`  destinatários do relatório mensal: ${rec} · e-mails da ZapSign: ${cfg.zapsign_emails_enabled ? "ligados" : "desligados"}`);
  console.log(`  prazos: paciente ${cfg.patient_expiry_days} d, empresa ${cfg.company_expiry_days} d · lembretes ${JSON.stringify(cfg.reminder_days)} · corte da autenticação forte R$ ${(cfg.strong_auth_threshold_cents / 100).toFixed(2)}`);
  const mes = new Date().toISOString().slice(0, 7);
  const usados = P.filter((p) => String(p.plan_month ?? "").startsWith(mes)).length;
  console.log(`  documentos contados neste mês (${mes}): ${usados}`);
}

// 8) Unidades
titulo("Unidades (razão social e CNPJ — sem eles o documento do paciente não sai)");
const { data: cl, error: ecl } = await db.from("clinics").select("name, legal_name, cnpj, is_active").order("name");
if (ecl) naoMedi("as unidades", ecl.message);
for (const c of cl ?? []) console.log(`  ${c.legal_name ? "✅" : "⚠️"} ${c.name}${c.is_active === false ? " (inativa)" : ""}: razão social ${c.legal_name ? "ok" : "FALTA"} · CNPJ ${c.cnpj ? "ok" : "FALTA"}`);

// 9) Modelos
titulo("Modelos de documento");
const { data: tp, error: et } = await db.from("signature_templates").select("code, name, audience, is_active, is_provisional_text, risarte_signer_mode, risarte_signer_role, witness_count, auth_level").order("sort_order");
if (et) naoMedi("os modelos", et.message);
for (const t of tp ?? []) console.log(`  ${t.is_provisional_text ? "⚠️ PROVISÓRIO" : "✅"} ${t.code} (${t.audience}) ${t.is_active ? "ativo" : "inativo"} · assina pela Risarte: ${t.risarte_signer_mode}${t.risarte_signer_role ? `/${t.risarte_signer_role}` : ""} · testemunhas ${t.witness_count} · autenticação ${t.auth_level}`);

// 10) Risartanos (testemunhas e representantes)
titulo("Risartanos ativos (CPF, WhatsApp, RG)");
const { data: st, error: est } = await db.from("staff_members").select("code, cpf, whatsapp, rg, is_active, user_id").eq("is_active", true);
if (est) naoMedi("os Risartanos", est.message);
const ST = st ?? [];
const cpfRuim = ST.filter((s) => s.cpf && !cpfValido(s.cpf)).map((s) => s.code);
const semCpf = ST.filter((s) => !s.cpf).length;
const semZap = ST.filter((s) => !s.whatsapp).length;
const semRg = ST.filter((s) => !s.rg).length;
console.log(`  ${ST.length} ativos · CPF inválido: ${cpfRuim.length ? cpfRuim.join(", ") : "nenhum"} · sem CPF: ${semCpf} · sem WhatsApp: ${semZap} · sem RG: ${semRg}`);

// 11) A ZapSign (só GET)
titulo("ZapSign (pergunta à própria ZapSign)");
const token = env.ZAPSIGN_API_TOKEN;
if (!token) console.log(`  ⏭️ sem ZAPSIGN_API_TOKEN em ${arquivo}: parte não conferida`);
else {
  const base = treino ? "https://sandbox.api.zapsign.com.br/api/v1" : "https://api.zapsign.com.br/api/v1";
  const get = async (caminho) => {
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "riSZon" } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${caminho} -> ${r.status}`);
    return JSON.parse(t);
  };
  try {
    const plano = await get("/info-plan");
    console.log(`  plano: ${plano.name ?? "—"} · situação ${plano.status ?? "—"} · créditos ${plano.number_of_credits ?? "—"} · período até ${plano.current_period_end ?? "—"}`);
  } catch (e) {
    naoMedi("o plano", e.message);
  }
  try {
    const docs = [];
    for (let pagina = 1; pagina <= 30; pagina++) {
      const r = await get(`/docs/?page=${pagina}`);
      docs.push(...(r.results ?? []));
      if (!r.next) break;
    }
    const nossos = new Set(P.map((p) => p.zapsign_doc_token).filter(Boolean));
    const nossosIds = new Set(P.map((p) => p.id));
    const fora = docs.filter((d) => !nossos.has(d.token));
    console.log(`  ${docs.length} documento(s) na ZapSign · ${docs.length - fora.length} conhecidos pelo riSZon`);
    console.log(`  por situação na ZapSign: ${JSON.stringify(conta(docs, (d) => d.status))}`);
    for (const d of fora) {
      const pac = nossosIds.has(d.external_id) ? P.find((p) => p.id === d.external_id)?.number : null;
      console.log(`  ⚠️ documento FORA do riSZon: criado ${dia(d.created_at)} · situação ${d.status} · ${pac ? `aponta para o ${pac} (AP151)` : "não aponta para pacote nosso"}`);
    }
    const porToken = new Map(docs.map((d) => [d.token, d]));
    const mapa = { pending: ["sent", "partially_signed"], signed: ["signed"], refused: ["refused", "cancelled", "expired"] };
    for (const p of P.filter((x) => x.zapsign_doc_token && porToken.has(x.zapsign_doc_token))) {
      const z = porToken.get(p.zapsign_doc_token).status;
      if (mapa[z] && !mapa[z].includes(p.status)) console.log(`  ⚠️ ${p.number}: riSZon diz ${p.status}, ZapSign diz ${z}`);
    }
    for (const p of P.filter((x) => x.zapsign_doc_token && !porToken.has(x.zapsign_doc_token))) console.log(`  ⚠️ ${p.number}: o documento não aparece na listagem da ZapSign`);
  } catch (e) {
    naoMedi("os documentos da ZapSign", e.message);
  }
}
console.log("\nFim da conferência (nada foi gravado).");
