// Ensaio da 0370 (AP69, etapa 1) — NO TREINO, numa transação DESFEITA.
// Uso: node scripts/ap69-ensaio-0370.mjs        (QUEBRA=taxas | QUEBRA=guarda provam que reprova)
// As taxas da rede no treino estão em 0%: o ensaio liga royalty 10% e fundo 2%
// DENTRO da transação, e nada fica.
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

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/0370_ppr_no_razao_e_taxas_nas_mensalidades.sql", "utf8");
  if (process.env.QUEBRA === "taxas") {
    const antes = sql;
    sql = sql.replace(
      "drop trigger if exists ppr_charges_fee_split on public.ppr_charges;\ncreate trigger ppr_charges_fee_split",
      () => "drop trigger if exists ppr_charges_fee_split on public.ppr_charges;\ncreate trigger ppr_charges_fee_split_quebrado"
    );
    sql = sql.replace("perform public._apply_fee_split(\n      new.clinic_id, 'ppr_charge', new.id, new.amount_cents,", () => "perform null; perform public._apply_fee_split(\n      new.clinic_id, 'ppr_charge', new.id, 0,");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  if (process.env.QUEBRA === "guarda") {
    const antes = sql;
    sql = sql.replace("    if old.status in ('open', 'settled') and new.status in ('open', 'settled')", () => "    if false and old.status in ('open', 'settled')");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  confere("a 0370 roda de novo sem erro", (await erroDe(sql)) === null, await erroDe("select 1"));

  // Taxas da rede: royalty 10%, fundo 2% (só nesta transação).
  await q("update public.network_fees set percent = 10, active = true where clinic_id is null and fee = 'royalty'");
  await q("update public.network_fees set percent = 2, active = true where clinic_id is null and fee = 'fundo'");

  // ---------------- PPR+ ----------------
  const mem = (await q(
    "select m.id, m.clinic_id from public.ppr_memberships m join public.clinics c on c.id = m.clinic_id where c.type <> 'franchisor' limit 1"
  ))[0];
  if (!mem) throw new Error("NÃO MEDI: nenhuma adesão de PPR+ numa unidade no treino");
  const mes = (await q("select date_trunc('month', public.today_br())::date as m"))[0].m;
  const ch = (await q(
    "insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1,$2,$3::date - interval '13 months', ($3::date - interval '13 months')::date + 10, 15000, 'em_aberto') returning id",
    [mem.id, mem.clinic_id, mes]
  ))[0].id;
  const lanc = async () => (await q("select status, account_code, amount_cents, cash_date, accrual_date from public.financial_entries where source_type = 'ppr_charge' and source_id = $1", [ch]))[0];
  let e = await lanc();
  confere("PPR+: a cobrança nasce no razão, conta 1.2.01, aberta, R$ 150,00", e && e.account_code === "1.2.01" && e.status === "open" && Number(e.amount_cents) === 15000, JSON.stringify(e));

  const taxas = async (id, tipo) => await q("select fee, amount_cents::int a, reversed, base_cents::int b from public.split_charges where source_type = $2 and source_id = $1 order by fee", [id, tipo]);
  confere("PPR+: em aberto não gera taxa", (await taxas(ch, "ppr_charge")).length === 0);

  await q("update public.ppr_charges set status = 'paga', paid_at = now() where id = $1", [ch]);
  e = await lanc();
  confere("PPR+: paga → lançamento quitado com data de caixa", e.status === "settled" && e.cash_date !== null, JSON.stringify(e));
  let t = await taxas(ch, "ppr_charge");
  confere("PPR+: paga → royalty 10% (R$ 15,00) e fundo 2% (R$ 3,00)", t.length === 2 && t.find((x) => x.fee === "royalty")?.a === 1500 && t.find((x) => x.fee === "fundo")?.a === 300 && t.every((x) => !x.reversed && x.b === 15000), JSON.stringify(t));
  const conta = async (fee) => (await q(
    "select coalesce(sum(amount_cents), 0)::int s from public.payables where clinic_id = $1 and network_fee = $2 and status <> 'cancelada' and fee_period = date_trunc('month', public.today_br())::date", [mem.clinic_id, fee]
  ))[0].s;
  const royaltyAntes = await conta("royalty");
  confere("PPR+: a conta a pagar do royalty do mês inclui a taxa", royaltyAntes >= 1500, `(${royaltyAntes})`);

  await q("update public.ppr_charges set status = 'em_aberto', paid_at = null where id = $1", [ch]);
  e = await lanc();
  t = await taxas(ch, "ppr_charge");
  confere("PPR+: desfazer → lançamento volta a aberto, sem data de caixa", e.status === "open" && e.cash_date === null, JSON.stringify(e));
  confere("PPR+: desfazer → taxas estornadas", t.length === 2 && t.every((x) => x.reversed), JSON.stringify(t));
  confere("PPR+: desfazer → a conta a pagar do royalty diminui R$ 15,00", (await conta("royalty")) === royaltyAntes - 1500);

  await q("update public.ppr_charges set status = 'paga', paid_at = now() where id = $1", [ch]);
  t = await taxas(ch, "ppr_charge");
  confere("PPR+: pagar de novo → as taxas voltam a valer (sem duplicar)", t.length === 2 && t.every((x) => !x.reversed), JSON.stringify(t));
  confere("PPR+: pagar de novo → a conta a pagar volta ao valor", (await conta("royalty")) === royaltyAntes);

  // Mês fechado: a cobrança é de 13 meses atrás; fecha esse mês e desfaz/paga.
  await q("insert into public.fiscal_periods (clinic_id, year, month, status, closed_at) values ($1, extract(year from $2::date)::int, extract(month from $2::date)::int, 'closed', now()) on conflict (clinic_id, year, month) do update set status = 'closed'", [mem.clinic_id, e.accrual_date]);
  let err = await erroDe("update public.ppr_charges set status = 'em_aberto', paid_at = null where id = $1", [ch]);
  confere("mês fechado: desfazer a baixa passa (o resultado do mês não muda)", err === null, err);
  err = await erroDe("update public.ppr_charges set status = 'paga', paid_at = now() where id = $1", [ch]);
  confere("mês fechado: pagar passa", err === null, err);
  // Volta a aberta (passa) e muda o VALOR da cobrança: o gatilho leva o valor
  // ao lançamento aberto — isso muda o resultado do mês fechado.
  err = await erroDe("update public.ppr_charges set status = 'em_aberto', paid_at = null where id = $1", [ch]);
  confere("mês fechado: desfazer de novo passa", err === null, err);
  err = await erroDe("update public.ppr_charges set amount_cents = amount_cents + 100 where id = $1", [ch]);
  confere("mês fechado: mudar o VALOR continua barrado", /PERIOD_CLOSED/.test(err ?? ""), err);
  err = await erroDe("update public.ppr_charges set status = 'cancelada' where id = $1", [ch]);
  confere("mês fechado: cancelar (muda o resultado) continua barrado", /PERIOD_CLOSED/.test(err ?? ""), err);

  // Cancelar num mês aberto.
  const ch2 = (await q(
    "insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1,$2,$3::date + interval '2 months', ($3::date + interval '2 months')::date + 10, 9000, 'em_aberto') returning id",
    [mem.id, mem.clinic_id, mes]
  ))[0].id;
  await q("update public.ppr_charges set status = 'cancelada' where id = $1", [ch2]);
  const e2 = (await q("select status from public.financial_entries where source_type = 'ppr_charge' and source_id = $1", [ch2]))[0];
  confere("PPR+: cancelar → lançamento cancelado", e2?.status === "cancelled", JSON.stringify(e2));

  // ---------------- Ortodontia ----------------
  const oc = (await q("select id, clinic_id, amount_cents from public.ortho_charges where status = 'paga' limit 1"))[0];
  if (!oc) throw new Error("NÃO MEDI: nenhuma mensalidade de ortodontia paga no treino");
  await q("update public.ortho_charges set status = 'em_aberto', paid_at = null, paid_on = null, paid_amount_cents = null where id = $1", [oc.id]);
  await q("update public.ortho_charges set status = 'paga', paid_at = now(), paid_on = public.today_br(), paid_amount_cents = amount_cents - 2000, discount_cents = 2000 where id = $1", [oc.id]);
  t = await taxas(oc.id, "ortho_charge");
  const liquido = Number(oc.amount_cents) - 2000;
  confere("Ortodontia: paga → royalty sobre o que ENTROU (líquido do desconto)", t.find((x) => x.fee === "royalty")?.b === liquido && t.find((x) => x.fee === "royalty")?.a === Math.round(liquido * 0.1), JSON.stringify(t));

  // ---------------- Baixa de parcela (não pode ter mudado) ----------------
  const rec = (await q("select * from public.payment_receipts where reversal_of is null and not coalesce(reversed, false) limit 1"))[0];
  if (!rec) throw new Error("NÃO MEDI: nenhuma baixa de parcela no treino");
  const novo = (await q(
    "insert into public.payment_receipts select * from jsonb_populate_record(null::public.payment_receipts, (select to_jsonb(r) from public.payment_receipts r where r.id = $1) || jsonb_build_object('id', gen_random_uuid(), 'client_token', null, 'received_at', public.today_br())) returning id",
    [rec.id]
  ))[0].id;
  t = await taxas(novo, "receipt");
  const tr = await q("select receipt_id from public.split_charges where receipt_id = $1", [novo]);
  confere("Parcela: a baixa nova gera as taxas com a origem 'receipt' e o receipt_id", t.length === 2 && tr.length === 2, JSON.stringify(t));
  await q("update public.payment_receipts set reversed = true where id = $1", [novo]);
  t = await taxas(novo, "receipt");
  confere("Parcela: estornar a baixa estorna as taxas", t.every((x) => x.reversed));

  // ---------------- Franqueadora e segurança ----------------
  const franq = (await q("select id from public.clinics where type = 'franchisor' limit 1"))[0];
  await q("select public._apply_fee_split($1, 'ppr_charge', gen_random_uuid(), 10000, public.today_br(), false)", [franq.id]);
  const nf = (await q("select count(*)::int n from public.split_charges where clinic_id = $1 and source_type = 'ppr_charge'", [franq.id]))[0].n;
  confere("a Franqueadora não paga taxa a si mesma", nf === 0);
  err = await erroDe("insert into public.split_charges (clinic_id, source_type, source_id, fee, percent, base_cents, amount_cents, period_month) values ($1, 'outra', gen_random_uuid(), 'royalty', 1, 1, 1, public.today_br())", [mem.clinic_id]);
  confere("origem desconhecida é recusada", /split_charges_source_ok/.test(err ?? ""), err);
  await q("set local role anon");
  err = await erroDe("select public._apply_fee_split(gen_random_uuid(), 'ppr_charge', gen_random_uuid(), 1, public.today_br(), false)");
  confere("sem login: a conta das taxas não executa", /permission denied/.test(err ?? ""), err);
  await q("reset role");
  const semOrigem = (await q("select count(*)::int n from public.split_charges where source_id is null"))[0].n;
  confere("nenhuma taxa sem origem", semOrigem === 0);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} de ${ok + falhas} conferências passaram.`);
if (falhas || ok === 0) process.exit(1);
