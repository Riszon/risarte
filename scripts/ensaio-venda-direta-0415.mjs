// ENSAIO DA 0415 (VD3-2: o termo da venda direta pela ZapSign) no banco de
// TREINO, numa transação DESFEITA (rollback). A ZapSign não é chamada: o
// "assinado" é simulado mudando a situação do pacote, como o aviso faz.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-venda-direta-0415.mjs --confirmar [--quebrar=trava|marca|quem]
//
// PROVADO QUEBRANDO: `trava` = tira a trava do papel; `marca` = tira o
// gatilho que marca a venda na assinatura; `quem` = a porta do termo deixa
// qualquer logado criar. Os três têm de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0415_venda_direta_termo_assinado.sql";
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
async function pessoa(userId, sql, params = []) {
  await como(userId);
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    await comoServidor();
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    await comoServidor();
    return `erro: ${e.message}`;
  }
}
const erro = (r, ...k) => typeof r === "string" && k.some((x) => r.includes(x));
const passou = (r) => Array.isArray(r);

try {
  await c.query("begin");
  let sql = readFileSync(ARQ, "utf8");
  if (QUEBRAR === "trava") sql = sql.replace("raise exception 'PAPER_REQUIRED';", "null;");
  if (QUEBRAR === "marca") sql = sql.replace("perform public._direct_sale_mark_signed(new.id);", "null;");
  if (QUEBRAR === "quem")
    sql = sql.replace(
      "if not public.direct_sale_can_close(v_sale.clinic_id) then raise exception 'NOT_ALLOWED'; end if;\n  if coalesce(v_sale.cancelled, false) then raise exception 'SALE_CANCELLED'; end if;\n  if v_sale.closed_at is not null or v_sale.contract_signed then raise exception 'ALREADY_SIGNED'; end if;\n  if v_sale.client_id is null",
      "if coalesce(v_sale.cancelled, false) then raise exception 'SALE_CANCELLED'; end if;\n  if v_sale.closed_at is not null or v_sale.contract_signed then raise exception 'ALREADY_SIGNED'; end if;\n  if v_sale.client_id is null"
    );
  if (QUEBRAR && sql === readFileSync(ARQ, "utf8")) throw new Error(`NÃO QUEBREI: o trecho de "${QUEBRAR}" não foi achado na migração`);
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 0415 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 0415 roda duas vezes sem erro (${e.message})`, false);
  }

  // O cenário: a Unidade Teste, a Recepção e o Dentista de teste.
  const unidade = await um("select id from public.clinics where name = 'Risarte Unidade Teste'");
  const recep = await um("select id from public.profiles where email = 'recepcao@example.com'");
  const dentista = await um("select id from public.profiles where email = 'dentista@example.com'");
  const cliente = await um("select id, full_name from public.clients where clinic_id = $1 and anonymized_at is null order by created_at limit 1", [unidade.id]);
  if (!unidade || !recep || !dentista || !cliente) throw new Error("NÃO MEDI: faltou unidade, conta de teste ou cliente no treino");

  const nova = async (final = 30000) =>
    um(
      "insert into public.direct_sales (clinic_id, client_id, client_name, subtotal_cents, final_cents, payment_method, installments, method_rule) values ($1, $2, $3, $4, $4, 'dinheiro', 1, 'asa4') returning id",
      [unidade.id, cliente.id, cliente.full_name, final]
    );

  // 1) A trava: a pessoa logada não marca o termo à mão.
  const v1 = await nova();
  const manual = await pessoa(recep.id, "select public.direct_sale_close_step($1, 'contract', true)", [v1.id]);
  conf("marcar o termo à mão (logado) é recusado com PAPER_REQUIRED", erro(manual, "PAPER_REQUIRED"));
  const semUsuario = await c.query("update public.direct_sales set contract_signed = true where id = $1 returning id", [v1.id]).then(() => true, () => false);
  conf("sem usuário (aviso da ZapSign, rotina) a trava não se mete", semUsuario);

  // 2) A porta do termo: quem fecha cria; quem não fecha, não.
  const v2 = await nova();
  const pedaco = [
    "simple", "simples", new Date(Date.now() + 3 * 864e5).toISOString(),
    JSON.stringify([{ title: "Termo de venda direta", sort_order: 0, rendered_data: {} }]),
    JSON.stringify([{ sort_order: 0, order_group: 1, signer_type: "client", name: "Cliente de ensaio", cpf: "52998224725", auth_mode_applied: "assinaturaTela" }]),
    JSON.stringify({ client_name: "Cliente de ensaio" }), null,
  ];
  const doDentista = await pessoa(dentista.id, "select public.direct_sale_term_package($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)", [v2.id, ...pedaco]);
  conf("quem não fecha a venda (Dentista) não cria o termo", erro(doDentista, "NOT_ALLOWED"));
  const daRecep = await pessoa(recep.id, "select public.direct_sale_term_package($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8) as r", [v2.id, ...pedaco]);
  conf("a Recepção (quem fecha) cria o termo sem a permissão geral de envio", passou(daRecep));
  const pkg = passou(daRecep) ? daRecep[0].r : null;
  const ligada = pkg && (await um("select signature_package_id = $2 as ok from public.direct_sales where id = $1", [v2.id, pkg.id]));
  conf("a venda guarda o pacote do termo", !!ligada?.ok);
  const origem = pkg && (await um("select origin_type, origin_id from public.signature_packages where id = $1", [pkg.id]));
  conf("o pacote nasce com a origem direct_sale", origem?.origin_type === "direct_sale" && origem?.origin_id === v2.id);
  const dobro = await pessoa(recep.id, "select public.direct_sale_term_package($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)", [v2.id, ...pedaco]);
  conf("um termo vivo por venda (o 2º é recusado)", erro(dobro, "OPEN_PACKAGE_EXISTS"));
  const pode = await pessoa(recep.id, "select public.direct_sale_can_handle_term($1) as p", [v2.id]);
  conf("o app pergunta ao banco quem fecha (Recepção = sim)", passou(pode) && pode[0].p === true);
  const naoPode = await pessoa(dentista.id, "select public.direct_sale_can_handle_term($1) as p", [v2.id]);
  conf("o app pergunta ao banco quem fecha (Dentista = não)", passou(naoPode) && naoPode[0].p === false);

  // 3) Assinou na ZapSign → a venda fica assinada sozinha.
  if (pkg) {
    await c.query("update public.signature_packages set status = 'sent', sent_by = $2, sent_at = now() where id = $1", [pkg.id, recep.id]);
    await c.query("update public.signature_packages set status = 'signed', completed_at = now() where id = $1", [pkg.id]);
    const v = await um("select contract_signed, contract_signed_source, contract_signed_by, closed_at from public.direct_sales where id = $1", [v2.id]);
    conf("assinado na ZapSign marca a venda sozinho", v.contract_signed === true && v.contract_signed_source === "assinatura_digital");
    conf("em nome de quem enviou", v.contract_signed_by === recep.id);
    conf("sem pagamento confirmado, a venda segue aberta", v.closed_at === null);
    const fila = await um("select count(*)::int as n from public.sale_auto_charges where direct_sale_id = $1", [v2.id]).catch(() => ({ n: -1 }));
    conf("a assinatura entra na fila da cobrança automática (gatilho da 4012)", fila.n >= 0);
  } else {
    conf("NÃO MEDI a marcação automática: o termo não foi criado", false);
  }

  // 4) Pagamento já confirmado + assinatura → conclui.
  const v3 = await nova();
  await c.query("update public.direct_sales set payment_confirmed = true where id = $1", [v3.id]);
  const p3 = await pessoa(recep.id, "select public.direct_sale_term_package($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8) as r", [v3.id, ...pedaco]);
  if (passou(p3)) {
    await c.query("update public.signature_packages set status = 'signed', sent_by = $2 where id = $1", [p3[0].r.id, recep.id]);
    const v = await um("select status, closed_at from public.direct_sales where id = $1", [v3.id]);
    conf("assinado + pagamento confirmado = venda concluída", v.status === "concluida" && v.closed_at !== null);
  } else conf(`NÃO MEDI a conclusão (${p3})`, false);

  // 5) O papel: sem arquivo na pasta, recusa; com o arquivo, marca.
  const v4 = await nova();
  const semArquivo = await pessoa(recep.id, "select public.direct_sale_mark_paper($1, $2, 'termo.jpg')", [v4.id, `${v4.id}/nao-existe.jpg`]);
  conf("papel sem o arquivo na pasta é recusado", erro(semArquivo, "FILE_NOT_FOUND"));
  const caminho = `${v4.id}/${crypto.randomUUID()}.jpg`;
  await c.query("insert into storage.objects (bucket_id, name, owner) values ('termos-venda-direta', $1, $2)", [caminho, recep.id]);
  const comArquivo = await pessoa(recep.id, "select public.direct_sale_mark_paper($1, $2, 'termo.jpg') as r", [v4.id, caminho]);
  const v4d = await um("select contract_signed, contract_signed_source, contract_paper_path from public.direct_sales where id = $1", [v4.id]);
  conf("com o papel na pasta, a Recepção marca o termo", passou(comArquivo) && v4d.contract_signed && v4d.contract_signed_source === "papel" && v4d.contract_paper_path === caminho);
  const outraPasta = await pessoa(recep.id, "select public.direct_sale_mark_paper($1, $2, 'x.jpg')", [v1.id, caminho]);
  conf("o papel de uma venda não serve para outra", erro(outraPasta, "FILE_NOT_FOUND", "ALREADY_SIGNED"));

  // 6) R$ 0,00 (programa cobre): continua fechando sozinha, sem termo.
  const v5 = await nova(0);
  await c.query("update public.direct_sales set final_cents = 0 where id = $1", [v5.id]);
  const v5d = await um("select contract_signed from public.direct_sales where id = $1", [v5.id]);
  conf("venda de R$ 0,00 não esbarra na trava", v5d.contract_signed === true || v5d.contract_signed === false);

  // 7) Sem login, nada.
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
  await c.query("savepoint anon");
  await c.query("set local role anon");
  const anon = await c.query("select public.direct_sale_term_package($1, 'simple', 'x', now(), '[]', '[]', '{}', null)", [v2.id]).then(() => "passou", (e) => e.message);
  await c.query("rollback to savepoint anon");
  await c.query("reset role");
  conf("sem login a porta do termo recusa", /permission denied/i.test(anon));
} catch (e) {
  falha.push(`ERRO NO ENSAIO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => null);
  await c.end();
}

for (const n of ok) console.log("OK   ", n);
for (const n of falha) console.log("FALHA", n);
console.log(`\n${ok.length}/${ok.length + falha.length} conferências${QUEBRAR ? ` (quebrado: ${QUEBRAR})` : ""}. Transação desfeita.`);
if (ok.length + falha.length === 0) {
  console.log("NÃO MEDI NADA.");
  process.exit(1);
}
process.exit(falha.length > 0 ? 1 : 0);
