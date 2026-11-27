// ENSAIO DA 4029 (o combinado no cartão à vista: débito ou crédito) NO TREINO,
// numa transação DESFEITA (rollback). Confere: a 4029 roda duas vezes; a porta
// `direct_sale_set_card_choice` grava e limpa para quem fecha a venda; recusa
// valor inválido, meio que não é o cartão à vista, venda concluída, quem não é
// da unidade e quem não tem login.
// Provado quebrando: `--quebrar=sem` roda sem a 4029 (a porta não existe).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4029-combinado.mjs --confirmar [--quebrar=sem]
import { readFileSync } from "node:fs";
import { connect, testEnv } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const TREINO_REF = "bsnptybalszjjbhxeejo";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
  if (!String(testEnv()[k] ?? "").includes(TREINO_REF)) { console.log(`RECUSADO: ${k} não é o banco de treino.`); process.exit(3); }
}
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";
const ARQ = "supabase/migrations/4029_asa4_combinado_no_cartao_a_vista.sql";
const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];

/** Chama a porta vestido de um usuário (ou sem login); devolve "ok" ou a mensagem do banco. */
async function comoQuem(quem, saleId, escolha) {
  await c.query("savepoint t");
  try {
    if (quem === "anon") {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await c.query("set local role anon");
    } else {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: quem, role: "authenticated" })]);
      await c.query("set local role authenticated");
    }
    await c.query("select public.direct_sale_set_card_choice($1, $2)", [saleId, escolha]);
    await c.query("reset role");
    const v = (await um("select card_choice from public.direct_sales where id = $1", [saleId])).card_choice;
    await c.query("rollback to savepoint t");
    return `ok:${v}`;
  } catch (e) {
    await c.query("rollback to savepoint t");
    return e.message;
  }
}

try {
  await c.query("begin");
  if (Q === "sem") {
    await c.query(readFileSync("docs/asaas/desfazer-4029.sql", "utf8"));
    console.log("   (QUEBRADO de propósito: sem a 4029)");
  } else {
    const r1 = [].concat(await c.query(readFileSync(ARQ, "utf8"))).at(-1).rows[0];
    conf("a 4029 roda: a coluna, a porta e a lista", Number(r1.coluna) === 1 && r1.porta === true && r1.na_lista === true);
    const r2 = [].concat(await c.query(readFileSync(ARQ, "utf8"))).at(-1).rows[0];
    conf("a 4029 roda duas vezes sem erro", Number(r2.coluna) === 1 && r2.porta === true);
  }
  const adm = (await um("select id from public.profiles where is_admin_master and is_active limit 1")).id;
  const venda = await um(`select id, clinic_id from public.direct_sales where method_rule = 'asa4' and closed_at is null and not coalesce(cancelled, false) order by created_at desc limit 1`);
  if (!venda) throw new Error("NÃO MEDI: nenhuma venda direta nova aberta no treino.");
  // A venda no cartão à vista (1×), para a porta aceitar a escolha.
  await c.query("update public.direct_sales set installments = 1, payment_method = 'cartao' where id = $1", [venda.id]);

  const deb = await comoQuem(adm, venda.id, "debito");
  conf(`quem fecha a venda grava "débito" (${deb})`, deb === "ok:debito");
  const cre = await comoQuem(adm, venda.id, "credito");
  conf(`grava "crédito" (${cre})`, cre === "ok:credito");
  const limpa = await comoQuem(adm, venda.id, null);
  conf(`limpa a escolha (${limpa})`, limpa === "ok:null");
  const inval = await comoQuem(adm, venda.id, "pix");
  conf(`recusa valor que não é débito nem crédito (${inval})`, inval.includes("INVALID_CHOICE"));

  const anon = await comoQuem("anon", venda.id, "debito");
  conf(`sem login não executa (${anon.slice(0, 60)})`, /permission denied/i.test(anon));
  // Alguém ativo que não fecha venda nesta unidade (sem função nela e sem ser Admin Master).
  const fora = await um(
    `select p.id from public.profiles p
      where p.is_active and not coalesce(p.is_admin_master, false)
        and not exists (select 1 from public.user_clinic_roles r where r.user_id = p.id and r.clinic_id = $1)
      limit 1`, [venda.clinic_id]).catch(() => null);
  if (fora) {
    const r = await comoQuem(fora.id, venda.id, "debito");
    conf(`quem não é da unidade é recusado (${r})`, r.includes("NOT_ALLOWED"));
  } else console.log("   NÃO MEDI: não achei um usuário de fora da unidade no treino.");

  // Fora do cartão à vista só limpa.
  await c.query("update public.direct_sales set payment_method = 'pix' where id = $1", [venda.id]);
  const pix = await comoQuem(adm, venda.id, "debito");
  conf(`no Pix a escolha é recusada (${pix})`, pix.includes("NOT_CARD"));
  const pixLimpa = await comoQuem(adm, venda.id, null);
  conf(`no Pix, limpar passa (${pixLimpa})`, pixLimpa === "ok:null");

  // Venda concluída não muda.
  const fechada = await um(`select id from public.direct_sales where method_rule = 'asa4' and closed_at is not null and not coalesce(cancelled, false) limit 1`);
  if (fechada) {
    const r = await comoQuem(adm, fechada.id, null);
    conf(`venda concluída não muda (${r})`, r.includes("ALREADY_CLOSED"));
  } else console.log("   NÃO MEDI: nenhuma venda direta nova concluída no treino.");
} catch (e) {
  falha.push(`erro: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`Ensaio da 4029 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log(`  ✗ ${f}`);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
