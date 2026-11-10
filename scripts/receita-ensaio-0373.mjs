// Ensaio da 0373 (receita só com a venda fechada; cobrança apagada leva a
// receita junto) — NO TREINO, numa transação DESFEITA. Nada fica gravado.
//
// Reproduz o caso do dono (CBE-00001, 09/11/2026): negociação aberta, cobranças
// salvas DUAS vezes → receita em dobro na DRE, sem contrato assinado.
//
// Uso: node scripts/receita-ensaio-0373.mjs
//      QUEBRA=receita  → a receita volta a nascer com a cobrança (tem de reprovar)
//      QUEBRA=apagar   → cobrança apagada deixa a receita aberta (tem de reprovar)
//      QUEBRA=fechar   → fechar a venda não lança a receita (tem de reprovar)
//      QUEBRA=acerto   → o acerto dos dados não roda (tem de reprovar)
// Só ids internos e valores saem na tela — nenhum dado de pessoa.
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
const um = async (sql, p = []) => (await q(sql, p))[0];

const ARQ = "supabase/migrations/0373_receita_so_com_a_venda_fechada.sql";
let sql = readFileSync(ARQ, "utf8");
const trocar = (de, para) => {
  if (!sql.includes(de)) throw new Error(`QUEBRA não achou o trecho: ${de.slice(0, 60)}`);
  sql = sql.replace(de, () => para);
};
if (process.env.QUEBRA === "receita") {
  trocar("if v_closed_on is null then return; end if;", "v_closed_on := coalesce(v_closed_on, current_date);");
}
if (process.env.QUEBRA === "apagar") {
  trocar(
    "create trigger payment_installments_cancel_accrual\n  before delete",
    "create trigger payment_installments_cancel_accrual\n  before update of seq"
  );
}
if (process.env.QUEBRA === "fechar") {
  trocar("perform public.post_installment_accrual(v_id);", "null;");
}
if (process.env.QUEBRA === "acerto") {
  trocar("-- 6a) Receita", "/* 6a) Receita");
  trocar("-- Conferência (só contagens", "*/ -- Conferência (só contagens");
}

// Soma da receita ABERTA (o que a DRE soma) das cobranças de uma negociação,
// incluindo as que já foram apagadas (é aí que a receita em dobro morava).
const receitaAberta = async (ids) =>
  Number(
    (
      await um(
        `select coalesce(sum(amount_cents), 0) as s from public.financial_entries
          where source_type = 'installment_accrual' and status = 'open'
            and source_id = any($1::uuid[])`,
        [ids]
      )
    ).s
  );

async function criarCobrancas(neg, valores) {
  const ids = [];
  let seq = 0;
  for (const v of valores) {
    seq++;
    const r = await um(
      `insert into public.payment_installments
         (clinic_id, client_id, negotiation_id, seq, kind, due_date, amount_cents)
       values ($1, $2, $3, $4, 'parcela', current_date + ($4 * 30), $5)
       returning id`,
      [neg.clinic_id, neg.client_id, neg.id, seq, v]
    );
    ids.push(r.id);
  }
  return ids;
}

await db.query("begin");
try {
  // Uma negociação do treino SEM venda fechada, numa unidade com o mês aberto.
  const neg = await um(`
    select n.id, n.clinic_id, n.client_id, n.plan_id
      from public.plan_negotiations n
     where not exists (select 1 from public.commercial_sales cs
                        where cs.negotiation_id = n.id)
       and not exists (select 1 from public.fiscal_periods p
                        where p.clinic_id = n.clinic_id and p.status = 'closed'
                          and p.year = extract(year from current_date)::int
                          and p.month = extract(month from current_date)::int)
     limit 1`);
  if (!neg) throw new Error("NÃO MEDI: o treino não tem negociação sem venda para o ensaio.");
  console.log(`negociação de ensaio: ${neg.id}`);
  // Começa limpa: sem cobranças dela (dentro da transação desfeita).
  await q("delete from public.payment_installments where negotiation_id = $1", [neg.id]);

  // ---- 1) O ESTADO ANTIGO (antes da 0373): o caso do dono ------------------
  // Se o treino já recebeu a 0373, volta (dentro da transação) às versões
  // anteriores, lidas das próprias migrações — senão não há defeito a mostrar.
  const ja = await um("select to_regprocedure('public.installment_sale_closed_on(public.payment_installments)') is not null as sim");
  if (ja.sim) {
    const funcaoDe = (arquivo, nome) => {
      const txt = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
      const i = txt.indexOf(`create or replace function public.${nome}(`);
      const abre = txt.indexOf("$$", i);
      const fim = txt.indexOf("$$;", abre + 2) + 3;
      if (i < 0 || abre < i || fim <= abre) throw new Error(`não achei ${nome} em ${arquivo}`);
      const def = txt.slice(i, fim);
      if (!/end;\s*\$\$;$/.test(def)) throw new Error(`recorte estranho de ${nome}`);
      return def;
    };
    await db.query(funcaoDe("0189_renegotiation.sql", "post_installment_accrual"));
    await db.query(funcaoDe("0226_dre_accrual_only.sql", "sync_installment_accrual_status"));
    for (const [g, t] of [
      ["payment_installments_cancel_accrual", "payment_installments"],
      ["commercial_sales_post_accruals_upd", "commercial_sales"],
      ["commercial_sales_post_accruals_ins", "commercial_sales"],
      ["direct_sales_post_accruals_upd", "direct_sales"],
      ["direct_sales_post_accruals_ins", "direct_sales"],
    ]) await db.query(`drop trigger if exists ${g} on public.${t}`);
    console.log("(o treino já tinha a 0373: voltei às versões antigas nesta transação)");
  }
  console.log("\nAntes da 0373 (como estava na produção):");
  const v1 = await criarCobrancas(neg, [50000, 50000]); // 1º "Salvar negociação"
  await q("delete from public.payment_installments where negotiation_id = $1", [neg.id]);
  const v2 = await criarCobrancas(neg, [50000, 50000]); // 2º "Salvar negociação"
  const antes = await receitaAberta([...v1, ...v2]);
  confere("reproduz o defeito: venda de R$ 1.000 sem fechar vira R$ 2.000 de receita", antes === 200000, `(deu ${antes})`);

  // ---- 2) Aplica a 0373 (com o acerto dos dados) ---------------------------
  await db.query(sql);
  console.log("\n0373 aplicada (na transação). O acerto:");
  confere("a receita em dobro some da DRE (órfã + venda não fechada → cancelada)", (await receitaAberta([...v1, ...v2])) === 0);
  const canceladas = Number(
    (await um(`select count(*) c from public.financial_entries where source_type='installment_accrual'
                and status='cancelled' and source_id = any($1::uuid[])`, [[...v1, ...v2]])).c
  );
  confere("nenhum lançamento apagado: os 4 continuam no razão, cancelados", canceladas === 4, `(deu ${canceladas})`);

  // ---- 3) O comportamento novo --------------------------------------------
  console.log("\nDepois da 0373:");
  await q("delete from public.payment_installments where negotiation_id = $1", [neg.id]);
  const v3 = await criarCobrancas(neg, [30000, 30000, 40000]);
  confere("salvar a negociação NÃO lança receita (venda não fechada)", (await receitaAberta(v3)) === 0);

  await q("delete from public.payment_installments where negotiation_id = $1", [neg.id]);
  const v4 = await criarCobrancas(neg, [60000, 40000]);
  confere("salvar de novo continua sem receita (nada em dobro)", (await receitaAberta([...v3, ...v4])) === 0);

  // Cobrança de proposta que muda de situação não ressuscita a receita.
  await q("update public.payment_installments set status='cancelada' where id=$1", [v4[0]]);
  await q("update public.payment_installments set status='em_aberto' where id=$1", [v4[0]]);
  confere("cancelar e reabrir a cobrança da proposta não cria receita", (await receitaAberta(v4)) === 0);

  // Fecha a venda (contrato assinado + pagamento confirmado = closed_at).
  await q(
    `insert into public.commercial_sales (negotiation_id, client_id, clinic_id, plan_id, final_cents)
     values ($1, $2, $3, $4, 100000)`,
    [neg.id, neg.client_id, neg.clinic_id, neg.plan_id]
  );
  confere("venda criada mas ainda não fechada: sem receita", (await receitaAberta(v4)) === 0);
  await q("update public.commercial_sales set closed_at = now() where negotiation_id = $1", [neg.id]);
  confere("ao FECHAR a venda, a receita entra uma vez: R$ 1.000", (await receitaAberta(v4)) === 100000, `(deu ${await receitaAberta(v4)})`);
  const datas = await q(
    `select distinct accrual_date = current_date as hoje from public.financial_entries
      where source_type='installment_accrual' and status='open' and source_id = any($1::uuid[])`,
    [v4]
  );
  confere("a competência é a data do fechamento", datas.length === 1 && datas[0].hoje === true);

  // Fechar de novo (idempotência) não dobra.
  await q("select public.post_installment_accrual(id) from public.payment_installments where negotiation_id=$1", [neg.id]);
  confere("lançar de novo não dobra a receita", (await receitaAberta(v4)) === 100000);

  // A receita que o acerto cancelou volta com a venda fechada (legado).
  await q("update public.financial_entries set status='cancelled' where source_type='installment_accrual' and source_id=$1", [v4[1]]);
  await q("select public.post_installment_accrual($1)", [v4[1]]);
  confere("receita cancelada pelo acerto volta quando a venda está fechada", (await receitaAberta(v4)) === 100000);

  // Venda fechada: apagar a cobrança cancela a receita dela.
  await q("delete from public.payment_installments where id = $1", [v4[0]]);
  confere("cobrança apagada leva a própria receita (fica R$ 400)", (await receitaAberta(v4)) === 40000, `(deu ${await receitaAberta(v4)})`);

  // Cobrança nova numa venda já fechada lança na hora.
  const v5 = await criarCobrancas(neg, [60000]);
  confere("cobrança nova em venda fechada lança na hora", (await receitaAberta(v5)) === 60000);
} catch (e) {
  falhas++;
  console.log(`  ✘ o ensaio quebrou: ${e.message}`);
} finally {
  await db.query("rollback");
  await db.end();
}

console.log(`\n${ok} conferências OK, ${falhas} falha(s). Transação desfeita — nada gravado.`);
if (ok === 0) {
  console.log("NÃO MEDI: nenhuma conferência rodou.");
  process.exit(2);
}
process.exit(falhas > 0 ? 1 : 0);
