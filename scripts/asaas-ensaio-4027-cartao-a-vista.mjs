// ENSAIO DA 4027 (o cartão à vista na venda direta) NO TREINO, numa transação
// DESFEITA (rollback). Confere: a 4027 roda duas vezes; o cartão em 1× passa;
// o boleto em 1× continua recusado; o cartão em 2× continua valendo.
// Provado quebrando: `--quebrar=sem` roda sem a 4027 (o cartão em 1× é recusado).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4027-cartao-a-vista.mjs --confirmar [--quebrar=sem]
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
const ARQ = "supabase/migrations/4027_asa4_cartao_a_vista_na_venda_direta.sql";
const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];

async function tenta(id, parcelas, meio) {
  await c.query("savepoint t");
  try {
    await c.query("update public.direct_sales set installments = $2, payment_method = $3 where id = $1", [id, parcelas, meio]);
    await c.query("rollback to savepoint t");
    return "ok";
  } catch (e) {
    await c.query("rollback to savepoint t");
    return e.message;
  }
}

try {
  await c.query("begin");
  if (Q === "sem") {
    // Sem a 4027: o banco como estava (a 4027 desfeita, se o treino já a tiver).
    await c.query(readFileSync("docs/asaas/desfazer-4027.sql", "utf8"));
    console.log("   (QUEBRADO de propósito: sem a 4027)");
  } else {
    const r1 = [].concat(await c.query(readFileSync(ARQ, "utf8"))).at(-1).rows[0];
    conf("a 4027 roda: a função trocada e na lista", Number(r1.funcao_trocada) === 1 && r1.na_lista === true);
    const r2 = [].concat(await c.query(readFileSync(ARQ, "utf8"))).at(-1).rows[0];
    conf("a 4027 roda duas vezes sem erro", Number(r2.funcao_trocada) === 1);
  }
  const venda = await um(`select id from public.direct_sales where method_rule = 'asa4' and closed_at is null order by created_at desc limit 1`);
  if (!venda) throw new Error("NÃO MEDI: nenhuma venda direta nova aberta no treino.");
  const cartao1 = await tenta(venda.id, 1, "cartao");
  conf(`o cartão em 1× passa (${cartao1})`, cartao1 === "ok");
  const boleto1 = await tenta(venda.id, 1, "boleto");
  conf(`o boleto em 1× continua recusado (${boleto1})`, boleto1.includes("CASH_METHOD_ONLY"));
  const parc1 = await tenta(venda.id, 1, "cartao_parcelado_asaas");
  conf(`o cartão parcelado em 1× continua recusado (${parc1})`, parc1.includes("CASH_METHOD_ONLY"));
  const cartao2 = await tenta(venda.id, 2, "cartao");
  conf(`o cartão em 2× continua valendo (${cartao2})`, cartao2 === "ok");
  const pix1 = await tenta(venda.id, 1, "pix");
  conf(`o Pix em 1× continua valendo (${pix1})`, pix1 === "ok");
} catch (e) {
  falha.push(`erro: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`Ensaio da 4027 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  ✗", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
