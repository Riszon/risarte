// ENSAIO DA 0403 no banco de TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/recebiveis-ensaio-0403.mjs --confirmar  (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// Prova em três tempos, com cada conta de teste agindo como ela mesma
// (papel `authenticated` + `auth.uid()` dela — o mesmo que a API faz):
//   1. ANTES (políticas de antes da 0403, recriadas na transação): o teste de recorte FALHA — ASB, TSB, Comprador
//      etc. leem parcelas. É a prova de que o teste pega o vazamento.
//   2. Aplica a migração duas vezes (idempotente).
//   3. DEPOIS: o recorte vale e quem precisa continua lendo o que a tela usa.
// Gerente, Franqueado e Coordenador do treino estão em unidades sem dados; o
// ensaio dá a eles, DENTRO da transação, o papel na Londrina - Centro.
// Só contagens na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0403_recebiveis_so_para_quem_ve_o_financeiro.sql";
if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
async function como(uid, fn) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await fn(); } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
const PESSOAS = ["admin","financeiro","rede","gerente","franqueado","recepcao","coordenador","dentista","asb","tsb","sdr","planner","consultor","assistente","comprador","rislife"];

async function medir(ids, ldn) {
  const out = {};
  for (const p of PESSOAS) {
    out[p] = await como(ids[p], () => um(`
      select (select count(*) from public.payment_installments)::int as parc,
             (select count(*) from public.payment_installments where negotiation_id is not null)::int as parc_neg,
             (select count(*) from public.payment_installments where direct_sale_id is not null)::int as parc_vd,
             (select count(*) from public.payment_installments where negotiation_id is null and direct_sale_id is null)::int as parc_outras,
             (select count(*) from public.payment_installments where client_id = $1)::int as parc_ldn66,
             (select count(*) from public.payment_receipts)::int as receb,
             (select count(*) from public.payment_renegotiations)::int as reneg,
             (select count(*) from public.charges)::int as charges,
             (select count(*) from public.client_overdue_badges(array[$1]::uuid[]))::int as selo`, [ldn]));
  }
  return out;
}
const tabela = (t) => { for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(11)} ${JSON.stringify(v)}`); };

// O critério do recorte (o mesmo nos dois tempos).
function conferir(t, tot) {
  const f = [];
  const ok = (n, v) => { if (!v) f.push(n); };
  for (const p of ["admin", "financeiro", "rede"]) ok(`${p} lê todas as parcelas`, t[p].parc === tot.parc && t[p].receb === tot.receb && t[p].reneg === tot.reneg);
  for (const p of ["gerente", "franqueado", "recepcao"]) ok(`${p} lê parcelas, recebimentos, renegociações e cobranças da unidade`, t[p].parc_ldn66 === tot.parc_ldn66 && t[p].receb > 0 && t[p].reneg > 0 && t[p].charges > 0);
  for (const p of ["dentista", "asb", "tsb", "comprador", "rislife"]) ok(`${p} não lê nada do financeiro`, t[p].parc + t[p].receb + t[p].reneg + t[p].charges === 0);
  for (const p of ["consultor", "assistente"]) ok(`${p} lê só parcelamento de venda`, t[p].parc === tot.parc_neg + tot.parc_vd && t[p].parc_outras === 0 && t[p].receb + t[p].reneg + t[p].charges === 0);
  ok("planner lê só parcelamento de negociação", t.planner.parc === tot.parc_neg && t.planner.parc_vd === 0 && t.planner.receb + t.planner.reneg + t.planner.charges === 0);
  for (const p of ["sdr", "coordenador"]) ok(`${p} lê só parcelamento de venda direta`, t[p].parc_neg === 0 && t[p].parc_outras === 0 && t[p].parc_vd > 0 && t[p].receb + t[p].reneg + t[p].charges === 0);
  ok("o selo continua só do Admin (função SECURITY DEFINER, não muda)", t.admin.selo === 1 && PESSOAS.filter((p) => p !== "admin").every((p) => t[p].selo === 0 || ["financeiro","gerente","franqueado"].includes(p)));
  return f;
}

const POLITICAS_ANTIGAS = `
drop policy if exists "payment_installments_select" on public.payment_installments;
create policy "payment_installments_select" on public.payment_installments for select to authenticated
  using (public.is_admin_master() or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p where p.user_id = (select auth.uid())));
drop policy if exists "payment_receipts_select" on public.payment_receipts;
create policy "payment_receipts_select" on public.payment_receipts for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor() or clinic_id in (select public.user_full_access_clinic_ids()));
drop policy if exists "payment_renegotiations_select" on public.payment_renegotiations;
create policy "payment_renegotiations_select" on public.payment_renegotiations for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor() or clinic_id in (select public.user_full_access_clinic_ids()));
drop policy if exists "charges_select" on public.charges;
create policy "charges_select" on public.charges for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor()
    or exists (select 1 from public.payment_installments i where i.id = payment_installment_id));
drop policy if exists "payment_waivers_select" on public.payment_waivers;
create policy "payment_waivers_select" on public.payment_waivers for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor()
    or exists (select 1 from public.payment_installments i where i.id = installment_id));
`;

let saida = 1;
try {
  await c.query("begin");
  const ids = {};
  for (const p of PESSOAS) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldnClinic = (await um("select clinic_id from public.clients where code = 'LDN-00066'")).clinic_id;
  const ldn = (await um("select id from public.clients where code = 'LDN-00066'")).id;
  const papel = { gerente: "unit_manager", franqueado: "franchisee", coordenador: "clinical_coordinator" };
  for (const [p, r] of Object.entries(papel)) {
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [ids[p], ldnClinic, r]);
  }
  const tot = await um(`select count(*)::int parc,
      count(*) filter (where negotiation_id is not null)::int parc_neg,
      count(*) filter (where direct_sale_id is not null)::int parc_vd,
      count(*) filter (where client_id = $1)::int parc_ldn66,
      (select count(*) from public.payment_receipts)::int receb,
      (select count(*) from public.payment_renegotiations)::int reneg
    from public.payment_installments`, [ldn]);
  console.log("Totais no treino:", JSON.stringify(tot));

  // As políticas de ANTES da 0403 (0178, 0187, 0189, 4004), recriadas dentro
  // da transação: assim a prova de quebra vale mesmo depois de a 0403 estar
  // aplicada no treino.
  await c.query(POLITICAS_ANTIGAS);
  const antes = await medir(ids, ldn);
  console.log("\nANTES (políticas de antes da 0403):"); tabela(antes);
  const fAntes = conferir(antes, tot);
  console.log(`\nO teste do recorte contra as políticas de ANTES: ${fAntes.length} falha(s) — esperado > 0 (prova que pega o vazamento):`);
  fAntes.forEach((x) => console.log("  ✗", x));

  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("\nMigração aplicada duas vezes sem erro (idempotente).");

  const depois = await medir(ids, ldn);
  console.log("\nDEPOIS:"); tabela(depois);
  const fDepois = conferir(depois, tot);
  const anon = await (async () => { await c.query("savepoint a"); await c.query("set local role anon");
    try { await c.query("select public.can_see_receivables(gen_random_uuid())"); return "EXECUTOU"; }
    catch (e) { return e.code; } finally { await c.query("rollback to savepoint a"); } })();
  if (anon !== "42501") fDepois.push(`anon não pode executar can_see_receivables (veio ${anon})`);
  console.log(`\nDEPOIS: ${fDepois.length} falha(s)`); fDepois.forEach((x) => console.log("  ✗", x));
  saida = fAntes.length > 0 && fDepois.length === 0 ? 0 : 1;
  console.log(saida === 0 ? "\nENSAIO OK: o teste quebra antes e passa depois." : "\nENSAIO FALHOU.");
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(transação desfeita — nada ficou no treino)");
}
process.exit(saida);
