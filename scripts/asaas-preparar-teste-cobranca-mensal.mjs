// PREPARA O TREINO para o teste de ponta a ponta da cobrança mensal (4021 e 4021a)
// pelo dono, em CAMBÉ (Londrina já tem a cobrança de exemplo de outubro).
// GRAVA no treino (de verdade). Só treino; nada vai ao Asaas.
//
//   RISARTE_TREINO_POOLER=1 node scripts/asaas-preparar-teste-cobranca-mensal.mjs --confirmar
//
// O que faz (tudo marcado como exemplo):
//   1. Cambé ganha um CNPJ de exemplo (se estiver sem) e a configuração da unidade:
//      e-mail financeiro @example.com (não entrega a ninguém), 1º mês = 10/2026.
//   2. O Gerente de teste (gerente@example.com) passa a ser Gerente também de Cambé
//      (para contestar).
//   3. Três recebimentos à mão em 20/10/2026, de meios diferentes (dinheiro,
//      maquininha e depósito), pela porta de quem dá baixa (o Admin de teste):
//      viram linhas "a cobrar" de outubro.
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
try {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes("hvhbijctanrrkxhemlza")) throw new Error("RECUSADO: produção.");
  const cambe = (await um("select id, cnpj, legal_name from public.clinics where name = 'Risarte Cambé - Centro'"));
  const adm = (await um("select id from public.profiles where email = 'admin@example.com'")).id;
  const ger = (await um("select id from public.profiles where email = 'gerente@example.com'")).id;
  if (!cambe.cnpj) {
    await c.query("update public.clinics set cnpj = '11.222.333/0001-81', legal_name = coalesce(legal_name, 'Risarte Cambé (exemplo de treino)') where id = $1", [cambe.id]);
  }
  await c.query(
    `insert into public.franchise_billing_unit_settings (clinic_id, finance_email, monthly_from, example_values)
     values ($1, 'financeiro.cambe@example.com', '2026-10-01', true)
     on conflict (clinic_id) do update set finance_email = excluded.finance_email, monthly_from = excluded.monthly_from, example_values = true, updated_at = now()`,
    [cambe.id]);
  await c.query(
    `insert into public.user_clinic_roles_all (user_id, clinic_id, role) select $1, $2, 'unit_manager'
      where not exists (select 1 from public.user_clinic_roles_all where user_id = $1 and clinic_id = $2 and role = 'unit_manager')`,
    [ger, cambe.id]);

  // A venda direta nova só aceita dinheiro ou permuta à mão (4011); o plano aceita os outros meios.
  const recebimentos = [
    ["CBE-00055", 2, "dinheiro", 20000],
    ["CBE-00033", 1, "cartao", 27434],
    ["CBE-00033", 2, "deposito_avista", 27434],
  ];
  for (const [codigo, seq, meio, valor] of recebimentos) {
    const i = await um(
      `select i.id, i.status from public.payment_installments i join public.clients k on k.id = i.client_id
        where i.clinic_id = $1 and k.code = $2 and i.seq = $3`, [cambe.id, codigo, seq]);
    if (!i || i.status !== "em_aberto") {
      console.log(`  pulado: ${codigo} parcela ${seq} (${i?.status ?? "não achada"})`);
      continue;
    }
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adm, role: "authenticated" })]);
      await c.query("set local role authenticated");
      await c.query("select public.register_payment_receipt($1, $2, '2026-10-20', $3, 'Teste da cobrança mensal (exemplo)', null, gen_random_uuid())", [i.id, valor, meio]);
      await c.query("commit");
      console.log(`  ok: ${codigo} parcela ${seq}, ${meio}, R$ ${valor / 100} em 20/10/2026`);
    } catch (e) {
      await c.query("rollback");
      console.log(`  falhou: ${codigo} parcela ${seq}: ${e.message}`);
    }
  }
  const linhas = (await c.query("select fee, sum(amount_cents) s from public.split_charges where clinic_id = $1 and period_month = '2026-10-01' and not reversed group by fee order by fee", [cambe.id])).rows;
  console.log("Linhas \"a cobrar\" de outubro em Cambé:", linhas.map((l) => `${l.fee} R$ ${Number(l.s) / 100}`).join(", "));
  const falta = (await um("select missing from public._franchise_billing_cfg($1)", [cambe.id])).missing;
  console.log("O que ainda falta configurar em Cambé:", falta.length ? falta.join(", ") : "nada");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
