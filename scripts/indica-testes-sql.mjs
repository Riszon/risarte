// TESTES SQL DO INDICA +RISOS (IND0) — as regras de pontuação provadas no
// PostgreSQL de verdade, no banco de TREINO, SEM DEIXAR RASTRO.
//
// Tudo roda numa transação só, que é DESFEITA no fim (rollback) — passe ou
// falhe. Se o schema `indica` ainda não existe no treino, as migrações 2000+
// são aplicadas DENTRO da transação e somem junto: dá para provar a migração
// antes de gravá-la no banco (`npm run migrar:teste` é quem grava).
//
// Age como as pessoas de verdade: cada passo troca o usuário da sessão
// (`request.jwt.claims`) e o papel do banco (`authenticated`), então as
// guardas das funções e a RLS respondem como responderiam no navegador.
//
// Uso:  npm run test:indica

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, testEnv } from "./test-db.mjs";

const DIR = "supabase/migrations";
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

async function q(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}
async function um(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0];
}

/** Espera ERRO com o código dado; o savepoint mantém a transação de pé. */
async function falha(sql, params, codigo, descricao) {
  await db.query("savepoint espera_erro");
  try {
    await db.query(sql, params);
    await db.query("release savepoint espera_erro");
    ok(false, descricao, `esperava ${codigo}, mas passou`);
  } catch (e) {
    await db.query("rollback to savepoint espera_erro");
    ok(
      String(e.message).includes(codigo),
      descricao,
      `esperava ${codigo}, veio: ${e.message}`
    );
  }
}

/** Passa a agir como `userId` (null = rotina do sistema / superusuário). */
async function como(userId, papel = "authenticated") {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    userId ? JSON.stringify({ sub: userId, role: papel }) : "",
  ]);
  if (papel) await db.query(`set local role ${papel}`);
}
async function sistema() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}

/** Escrita de bastidor (preparar cenário), furando a trava do motor de propósito. */
async function bastidor(sql, params = []) {
  await sistema();
  await db.query("select set_config('indica.motor', 'sim', true)");
  const r = await q(sql, params);
  await db.query("select set_config('indica.motor', '', true)");
  return r;
}

const saldo = (embId) =>
  um("select * from indica.v_saldo_embaixador where embaixador_id = $1", [embId]);

async function main() {
  console.log(
    `Banco de treino: ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n` +
      "Tudo numa transação que será DESFEITA no fim.\n"
  );
  await db.query("begin");

  // --- Migrações 2000+ que o treino ainda não tem: dentro da transação ----
  const todas = readdirSync(DIR).filter((f) => /^2\d{3}_.*\.sql$/.test(f)).sort();
  if (todas.length === 0) throw new Error("nenhuma migração 2000+ encontrada");
  const gravadas = new Set(
    (await q("select filename from public.schema_migrations")).map((r) => r.filename)
  );
  const pendentes = todas.filter((f) => !gravadas.has(f));
  for (const f of pendentes) {
    await db.query(readFileSync(join(DIR, f), "utf8"));
    console.log(`(aplicada só nesta transação: ${f})`);
  }
  if (pendentes.length > 0) {
    // Idempotência: rodar de novo não pode dar erro nem duplicar padrões.
    for (const f of pendentes) await db.query(readFileSync(join(DIR, f), "utf8"));
    const dup = await um(
      "select count(*)::int n from indica.config group by unidade_id, chave, vigente_desde order by 1 desc limit 1"
    );
    ok(dup.n === 1, "migrações novas rodam duas vezes sem erro e sem duplicar os padrões");
  } else {
    console.log("(todas as migrações 2000+ já estão no treino — testando o que está gravado)");
  }

  // --- Pessoas e unidades do cenário de teste (falha ALTO se faltar) ------
  const pessoa = async (email, papel) => {
    const r = await um(
      `select p.id, r.clinic_id from public.profiles p
         join public.user_clinic_roles_all r on r.user_id = p.id
        where p.email = $1 and r.role = $2 limit 1`,
      [email, papel]
    );
    if (!r) throw new Error(`usuário de teste ausente: ${email} (${papel}) — rode npm run seed:teste`);
    return r;
  };
  const recepcao = await pessoa("recepcao@example.com", "receptionist");
  const gerente = await pessoa("gerente@example.com", "unit_manager");
  const franqueado = await pessoa("franqueado@example.com", "franchisee");
  const rede = await pessoa("rede@example.com", "franchisor_staff");
  const consultor = await pessoa("consultor@example.com", "commercial_consultant").catch(
    () => rede
  );
  const U = recepcao.clinic_id;
  ok(gerente.clinic_id === U, "gerente e recepção de teste são da mesma unidade");
  ok(franqueado.clinic_id !== U, "franqueado de teste é de OUTRA unidade");

  // Telefones/CPFs únicos por execução: não colidir com dado do treino.
  const sufixo = String(Date.now()).slice(-7);
  const tel = (n) => `(43) 9${n}${sufixo}`.slice(0, 15);
  const cpf = (n) => {
    const d = `${n}${sufixo}`.padEnd(11, "0").slice(0, 11);
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };

  await sistema();
  const novoCliente = async (nome, telefone, doc = null) =>
    (
      await um(
        `insert into public.clients (clinic_id, full_name, phone, cpf)
         values ($1, $2, $3, $4) returning id`,
        [U, nome, telefone, doc]
      )
    ).id;
  const avaliacao = async (clienteId, chegou = false, quando = "now()") =>
    (
      await um(
        `insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at,
                                          checked_in_at, attendance)
         values ($1, $2, 'evaluation', ${quando}, ${quando} + interval '1 hour',
                 ${chegou ? quando : "null"}, ${chegou ? "'waiting'" : "null"})
         returning id`,
        [U, clienteId]
      )
    ).id;
  const venda = async (clienteId, centavos, fechada = true) => {
    const plano = await um(
      "insert into public.treatment_plans (client_id, clinic_id) values ($1, $2) returning id",
      [clienteId, U]
    );
    const opcao = await um(
      "insert into public.treatment_plan_options (plan_id, clinic_id, title) values ($1, $2, 'Plano teste') returning id",
      [plano.id, U]
    );
    const neg = await um(
      `insert into public.plan_negotiations (plan_id, option_id, client_id, clinic_id, consultant_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [plano.id, opcao.id, clienteId, U, consultor.id]
    );
    const s = await um(
      `insert into public.commercial_sales (negotiation_id, client_id, clinic_id, final_cents, closed_at)
       values ($1, $2, $3, $4, ${fechada ? "now()" : "null"}) returning id`,
      [neg.id, clienteId, U, centavos]
    );
    return { vendaId: s.id, negId: neg.id };
  };

  const avancar = (id, status, motivo = null, dados = {}) =>
    um("select indica.avancar_status($1, $2, $3, $4) as s", [id, status, motivo, dados]);
  const registrar = (dados) =>
    um("select indica.registrar_indicacao($1) as id", [{ unidade_id: U, ...dados }]);

  // =========================================================================
  console.log("\n1. Embaixador");
  const cliEmb = await novoCliente("Joana Embaixadora Teste", tel(1), cpf(1));
  await como(recepcao.id);
  await falha(
    "select indica.criar_embaixador($1, '1999.1')",
    [cliEmb],
    "INDICA_REGULAMENTO_DESATUALIZADO",
    "aceite de regulamento antigo é recusado"
  );
  const emb = (await um("select indica.criar_embaixador($1, '2026.1') as id", [cliEmb])).id;
  const embRow = await um(
    "select e.codigo, n.codigo nivel from indica.embaixadores e join indica.niveis n on n.id = e.nivel_id where e.id = $1",
    [emb]
  );
  ok(/^JOANA\d{2}$/.test(embRow.codigo), `código pessoal gerado pelo nome (${embRow.codigo})`);
  ok(embRow.nivel === "amigo", "nasce no primeiro nível (Amigo +Risos)");
  const emb2 = (await um("select indica.criar_embaixador($1, '2026.1') as id", [cliEmb])).id;
  ok(emb2 === emb, "criar de novo devolve o mesmo Embaixador (carteira única)");

  // =========================================================================
  console.log("\n2. Registro, pendente e duplicidade");
  const ind1 = (
    await registrar({
      embaixador_id: emb,
      canal: "agendamento",
      indicado_nome: "Bruno Indicado",
      indicado_telefone: tel(2),
    })
  ).id;
  let s = await saldo(emb);
  ok(s.pendente === 50 && s.disponivel === 0, "registro gera 50 PENDENTES e nada disponível", JSON.stringify(s));
  const r1 = await um("select regra_congelada, status from indica.indicacoes where id = $1", [ind1]);
  ok(r1.status === "registrada" && r1.regra_congelada.pontos.registro === 50, "a regra do registro fica congelada na indicação");
  const ev1 = await um("select count(*)::int n from indica.indicacao_eventos where indicacao_id = $1", [ind1]);
  ok(ev1.n === 1, "o registro grava o 1º evento da linha do tempo");

  await falha(
    "select indica.registrar_indicacao($1)",
    [{ unidade_id: U, embaixador_id: emb, canal: "agendamento", indicado_nome: "Bruno de Novo", indicado_telefone: tel(2) }],
    "INDICA_DUPLICADA",
    "mesmo telefone em aberto: vale o primeiro registro"
  );
  await falha(
    "select indica.registrar_indicacao($1)",
    [{ unidade_id: U, embaixador_id: emb, canal: "agendamento", indicado_nome: "Eu Mesma", indicado_telefone: tel(1) }],
    "INDICA_AUTOINDICACAO",
    "autoindicação pelo telefone é recusada"
  );

  await sistema();
  const cliAntigo = await novoCliente("Carlos Já Cliente", tel(3), cpf(3));
  await avaliacao(cliAntigo, true, "now() - interval '3 months'");
  await como(recepcao.id);
  await falha(
    "select indica.registrar_indicacao($1)",
    [{ unidade_id: U, embaixador_id: emb, canal: "agendamento", indicado_nome: "Carlos", indicado_cpf: cpf(3) }],
    "INDICA_JA_E_CLIENTE",
    "quem teve atendimento nos últimos 24 meses não pode ser indicado"
  );
  await falha(
    "select indica.avancar_status($1, 'fechou')",
    [ind1],
    "INDICA_TRANSICAO_INVALIDA",
    "registrada → fechou é recusado (máquina de estados)"
  );

  // =========================================================================
  console.log("\n3. Jornada completa: comparecimento, carência e conversão");
  await avancar(ind1, "validada");
  await sistema();
  const cliB = await novoCliente("Bruno Indicado", tel(2));
  const agB = await avaliacao(cliB, false, "now() + interval '1 day'");
  await como(recepcao.id);
  await avancar(ind1, "agendada", null, { agendamento_id: agB });
  const refB = await um("select referred_by_client_id from public.clients where id = $1", [cliB]);
  await sistema();
  ok(refB.referred_by_client_id === cliEmb, "o cadastro do indicado ganha o \"Indicado por\" (campo do PPR+)");

  await como(recepcao.id);
  await falha(
    "select indica.avancar_status($1, 'compareceu')",
    [ind1],
    "INDICA_SEM_COMPARECIMENTO",
    "sem check-in da avaliação não há comparecimento"
  );
  await sistema();
  await q("update public.appointments set checked_in_at = now(), attendance = 'waiting' where id = $1", [agB]);
  await como(recepcao.id);
  await avancar(ind1, "compareceu");
  s = await saldo(emb);
  ok(s.disponivel === 200 && s.pendente === 0, "comparecimento: +150 e os 50 pendentes liberados (200 disponíveis)", JSON.stringify(s));

  await sistema();
  const vB = await venda(cliB, 1_250_000, false);
  await como(recepcao.id);
  await falha(
    "select indica.avancar_status($1, 'fechou', null, $2)",
    [ind1, { venda_id: vB.vendaId }],
    "INDICA_VENDA_NAO_FECHADA",
    "venda sem contrato + pagamento confirmados não é fechamento"
  );
  await sistema();
  await q("update public.commercial_sales set closed_at = now() where id = $1", [vB.vendaId]);
  await como(recepcao.id);
  await avancar(ind1, "fechou", null, { venda_id: vB.vendaId });
  s = await saldo(emb);
  ok(s.em_carencia === 200 && s.disponivel === 200, "fechamento: +200 EM CARÊNCIA", JSON.stringify(s));
  const f1 = await um(
    `select i.valor_fechado_centavos, i.risartano_conversao_id, l.libera_em - i.fechou_em as prazo
       from indica.indicacoes i join indica.pontos_lancamentos l on l.indicacao_id = i.id and l.tipo = 'carencia'
      where i.id = $1`,
    [ind1]
  );
  ok(Number(f1.valor_fechado_centavos) === 1_250_000, "valor fechado vem da venda, em centavos");
  ok(f1.risartano_conversao_id === consultor.id, "quem converteu = consultor da negociação");
  ok(f1.prazo.days === 30, "carência de 30 dias contada do fechamento");

  await falha(
    "select indica.avancar_status($1, 'convertida')",
    [ind1],
    "INDICA_CARENCIA",
    "antes do prazo e sem 1ª parcela paga, os pontos seguem em carência"
  );
  await sistema();
  await q(
    `insert into public.payment_installments (clinic_id, negotiation_id, seq, kind, due_date, amount_cents, status, paid_at)
     values ($1, $2, 1, 'entrada', current_date, 250000, 'paga', now())`,
    [U, vB.negId]
  );
  await como(recepcao.id);
  await avancar(ind1, "convertida");
  s = await saldo(emb);
  ok(s.disponivel === 400 && s.em_carencia === 0, "1ª parcela paga libera a carência: 400 Riso Coins", JSON.stringify(s));

  const somaLedger = await um(
    "select coalesce(sum(riso_coins),0)::int n from indica.pontos_lancamentos where embaixador_id = $1",
    [emb]
  );
  ok(
    somaLedger.n === s.disponivel + s.pendente + s.em_carencia,
    "saldo da visão = soma do extrato"
  );

  // =========================================================================
  console.log("\n4. Estorno (cancelamento na carência)");
  const ind2 = (
    await registrar({ embaixador_id: emb, canal: "embaixador", indicado_nome: "Carla Estorno", indicado_telefone: tel(4) })
  ).id;
  await avancar(ind2, "validada");
  await sistema();
  const cliC = await novoCliente("Carla Estorno", tel(4));
  const agC = await avaliacao(cliC, true);
  await como(recepcao.id);
  await avancar(ind2, "agendada", null, { agendamento_id: agC });
  await avancar(ind2, "compareceu");
  await sistema();
  const vC = await venda(cliC, 500_000);
  await como(recepcao.id);
  await avancar(ind2, "fechou", null, { venda_id: vC.vendaId });
  await falha(
    "select indica.avancar_status($1, 'cancelada', 'desistiu')",
    [ind2],
    "INDICA_SEM_PERMISSAO",
    "recepção não cancela (estorno é do gestor)"
  );
  await como(gerente.id);
  await falha(
    "select indica.avancar_status($1, 'cancelada')",
    [ind2],
    "INDICA_MOTIVO_OBRIGATORIO",
    "cancelar exige motivo"
  );
  await avancar(ind2, "cancelada", "Cliente desistiu do tratamento na carência");
  s = await saldo(emb);
  ok(s.em_carencia === 0 && s.disponivel === 600, "cancelamento estorna os 200 da carência; o que já liberou fica", JSON.stringify(s));

  // =========================================================================
  console.log("\n5. Multiplicador de nível e campanha");
  await bastidor(
    "update indica.embaixadores set nivel_id = (select id from indica.niveis where codigo = 'ouro') where id = $1",
    [emb]
  );
  await como(recepcao.id);
  const ind3 = (
    await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Diego Ouro", indicado_telefone: tel(5) })
  ).id;
  const p3 = await um(
    "select riso_coins, regra_aplicada from indica.pontos_lancamentos where indicacao_id = $1 and tipo = 'pendente'",
    [ind3]
  );
  ok(p3.riso_coins === 60 && Number(p3.regra_aplicada.multiplicador_nivel) === 1.2, "nível Ouro (1,2x): 50 → 60 pendentes, multiplicador registrado");

  await sistema();
  const camp = await um(
    `insert into indica.campanhas (nome, escopo, inicio, fim, status, regras)
     values ('Riso Coins em Dobro (teste)', 'rede', now() - interval '1 day', now() + interval '30 days', 'ativa',
             '{"multiplicador": 2}') returning id`
  );
  await como(recepcao.id);
  const ind4 = (
    await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Elisa Campanha", indicado_telefone: tel(6), campanha_id: camp.id })
  ).id;
  const p4 = await um(
    "select riso_coins from indica.pontos_lancamentos where indicacao_id = $1 and tipo = 'pendente'",
    [ind4]
  );
  ok(p4.riso_coins === 100, "campanha 2x com nível 1,2x: usa o MAIOR (100), sem somar multiplicadores");

  // =========================================================================
  console.log("\n6. Trava de atribuição");
  await bastidor("update indica.indicacoes set trava_ate = now() - interval '1 day' where id = $1", [ind3]);
  await como(recepcao.id);
  await falha(
    "select indica.avancar_status($1, 'validada')",
    [ind3],
    "INDICA_TRAVA_VENCIDA",
    "com a trava vencida a indicação não anda"
  );
  await falha(
    "select indica.avancar_status($1, 'expirada')",
    [ind4],
    "INDICA_TRAVA_ATIVA",
    "não se expira indicação com a trava ainda valendo"
  );
  const antes = await saldo(emb);
  const ind5 = (
    await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Diego de Novo", indicado_telefone: tel(5) })
  ).id;
  const st3 = await um("select status from indica.indicacoes where id = $1", [ind3]);
  ok(st3.status === "expirada", "registrar a mesma pessoa expira a indicação com trava vencida");
  const depois = await saldo(emb);
  ok(
    depois.pendente === antes.pendente - 60 + 60,
    "os 60 pendentes da expirada são estornados; a nova gera os seus",
    `${JSON.stringify(antes)} → ${JSON.stringify(depois)}`
  );
  ok(Boolean(ind5), "a pessoa fica livre para uma nova indicação");

  // =========================================================================
  console.log("\n7. Travas do motor (nem a chave de serviço escreve por fora)");
  await sistema();
  await falha(
    "insert into indica.pontos_lancamentos (embaixador_id, tipo, saldo, riso_coins, regra_aplicada) values ($1, 'ajuste', 'disponivel', 1000, '{}')",
    [emb],
    "INDICA_FORA_DO_MOTOR",
    "lançar Riso Coins por fora do motor é recusado"
  );
  await falha(
    "update indica.pontos_lancamentos set riso_coins = 9999 where embaixador_id = $1",
    [emb],
    "INDICA_REGISTRO_IMUTAVEL",
    "o extrato não se edita"
  );
  await falha(
    "update indica.indicacoes set status = 'convertida' where id = $1",
    [ind4],
    "INDICA_FORA_DO_MOTOR",
    "status não muda por update direto"
  );
  await falha(
    "delete from indica.indicacoes where id = $1",
    [ind4],
    "INDICA_INDICACAO_NAO_SE_APAGA",
    "indicação não se apaga"
  );

  // =========================================================================
  console.log("\n8. RLS e perfis");
  await como(franqueado.id);
  const vistoOutra = await um("select count(*)::int n from indica.indicacoes where id = any($1)", [[ind1, ind2, ind4]]);
  ok(vistoOutra.n === 0, "franqueado de outra unidade não vê as indicações desta");
  await falha(
    "select indica.avancar_status($1, 'validada')",
    [ind4],
    "INDICA_SEM_PERMISSAO",
    "nem mexe nelas"
  );
  await falha(
    "insert into indica.indicacoes (indicado_nome, unidade_id, canal, trava_ate, regra_congelada, embaixador_id) values ('x', $1, 'agendamento', now(), '{}', $2)",
    [U, emb],
    "",
    "insert direto na tabela é barrado para quem está logado"
  );
  await como(rede.id);
  const vistoRede = await um("select count(*)::int n from indica.indicacoes where id = any($1)", [[ind1, ind2, ind4]]);
  ok(vistoRede.n === 3, "a franqueadora vê a rede toda");
  await como(recepcao.id);
  const extrato = await um("select count(*)::int n from indica.pontos_lancamentos where embaixador_id = $1", [emb]);
  ok(extrato.n > 0, "recepção da unidade vê o extrato do Embaixador que atende");
  const funil = await um("select sum(convertidas)::int c, sum(canceladas)::int x from indica.v_funil where unidade_id = $1", [U]);
  ok(funil.c >= 1 && funil.x >= 1, "v_funil conta convertidas e canceladas", JSON.stringify(funil));

  // =========================================================================
  console.log("\n9. Configuração em cascata (e regra só para o futuro)");
  await como(gerente.id);
  await falha(
    "insert into indica.config (escopo, unidade_id, chave, valor) values ('unidade', $1, 'carencia_dias', '10')",
    [U],
    "INDICA_CONFIG_TRAVADA",
    "a unidade não mexe em parâmetro travado pela rede"
  );
  await q(
    "insert into indica.config (escopo, unidade_id, grupo, chave, valor) values ('unidade', $1, 'pontuacao', 'pontos_registro', '80')",
    [U]
  );
  const cU = await um("select indica.config_numero('pontos_registro', $1) as u, indica.config_numero('pontos_registro') as r", [U]);
  ok(Number(cU.u) === 80 && Number(cU.r) === 50, "a unidade sobrescreve (80) sem mudar a rede (50)");
  await como(franqueado.id);
  await falha(
    "insert into indica.config (escopo, unidade_id, grupo, chave, valor) values ('unidade', $1, 'pontuacao', 'pontos_comparecimento', '999')",
    [U],
    "row-level security",
    "gestor de outra unidade não configura esta"
  );
  await como(recepcao.id);
  const ind6 = (
    await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Fabio Futuro", indicado_telefone: tel(7) })
  ).id;
  const p6 = await um(
    "select riso_coins from indica.pontos_lancamentos where indicacao_id = $1 and tipo = 'pendente'",
    [ind6]
  );
  ok(p6.riso_coins === 96, "indicação nova usa a regra nova (80 × 1,2 = 96)");
  const p1 = await um("select regra_congelada->'pontos'->>'registro' as v from indica.indicacoes where id = $1", [ind1]);
  ok(p1.v === "50", "a indicação antiga continua com a regra dela (50)");
  await falha(
    "select indica.config_valor('parametro_que_nao_existe')",
    [],
    "INDICA_CONFIG_AUSENTE",
    "parâmetro inexistente falha alto (nada de padrão escondido)"
  );

  // =========================================================================
  console.log("\n10. Portal do Embaixador (link mágico)");
  await como(recepcao.id);
  const token = (await um("select indica.gerar_link_portal($1) as t", [emb])).t;
  ok(typeof token === "string" && token.length >= 60, "link gerado com 64 caracteres aleatórios");
  const hash = await um("select encode(portal_token_hash, 'hex') h from indica.embaixadores where id = $1", [emb]);
  ok(!hash.h.includes(token), "o banco guarda só o hash, nunca o link");
  await falha(
    "select indica.portal_embaixador($1)",
    [token],
    "permission denied",
    "um Risartano logado NÃO lê o portal (só o servidor)"
  );
  await como(null, "service_role");
  const portal = (await um("select indica.portal_embaixador($1) as p", [token])).p;
  const sAgora = await um("select disponivel from indica.v_saldo_embaixador where embaixador_id = $1", [emb]);
  ok(portal && portal.saldo.disponivel === sAgora.disponivel, "o portal mostra o saldo do extrato");
  const textoPortal = JSON.stringify(portal);
  ok(
    !/valor|centavos|diagn|plano|cpf|telefone/i.test(textoPortal),
    "o portal não expõe valor, plano, CPF nem telefone do indicado"
  );
  ok(portal.indicacoes.every((i) => !String(i.indicado ?? "").includes(" ")), "do indicado, só o primeiro nome");
  const nulo = (await um("select indica.portal_embaixador($1) as p", ["x".repeat(64)])).p;
  ok(nulo === null, "link errado não devolve nada");

  // =========================================================================
  console.log("\n11. Nível e teto");
  await sistema();
  const nivel = (await um("select indica.recalcular_nivel($1) as n", [emb])).n;
  ok(nivel === "embaixador", "1 conversão em 12 meses → nível Embaixador");
  await q(
    `insert into indica.config (escopo, grupo, chave, valor, travado, vigente_desde)
     values ('rede', 'pontuacao', 'teto_conversoes_12_meses', '1', true, now())`
  );
  await como(recepcao.id);
  const ind7 = (
    await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Gabi Teto", indicado_telefone: tel(8) })
  ).id;
  const p7 = await um("select count(*)::int n from indica.pontos_lancamentos where indicacao_id = $1", [ind7]);
  const e7 = await um("select dados from indica.indicacao_eventos where indicacao_id = $1", [ind7]);
  ok(p7.n === 0 && e7.dados.pontos_pendentes === 0, "teto atingido: a indicação vale, mas não gera pontos");

  // =========================================================================
  console.log("\n12. Telas da recepção (2003): busca, código e conferência");
  await como(recepcao.id);
  const porTel = await q("select * from indica.buscar_indicador($1)", [tel(1).replace(/\D/g, "").slice(-9)]);
  ok(porTel.some((r) => r.cliente_id === cliEmb && r.embaixador_id === emb), "acha quem indica pelo TELEFONE (sem DDD)");
  const porCodigo = await q("select * from indica.buscar_indicador($1)", [embRow.codigo.toLowerCase()]);
  ok(porCodigo.some((r) => r.embaixador_id === emb), "acha pelo código pessoal, sem ligar para maiúsculas");
  await como(franqueado.id);
  const rede1 = await um("select * from indica.embaixador_pelo_codigo($1)", [embRow.codigo]);
  ok(rede1?.embaixador_id === emb && rede1.primeiro_nome === "Joana", "o código vale na rede toda (outra unidade acha, só com o 1º nome)");
  await como(recepcao.id);
  const conf = async (dados) =>
    (await um("select indica.conferir_indicacao($1) as r", [{ unidade_id: U, ...dados }])).r;
  // tel(6) = Elisa (ind4): em aberto e ainda sem cadastro. (tel(2) já virou
  // cliente atendido — ali a resposta certa é "já é cliente", não "duplicada".)
  const cDup = await conf({ indicado_telefone: tel(6), embaixador_id: emb });
  ok(cDup.situacao === "duplicada" && /^IND-\d{6}$/.test(cDup.codigo), `já indicado: diz o código (${cDup.codigo})`);
  ok(!("cliente_id" in cDup), "a conferência nunca devolve o cadastro encontrado");
  const cLivre = await conf({ indicado_telefone: tel(9), embaixador_id: emb });
  ok(cLivre.situacao === "livre" && cLivre.cadastro_encontrado === false, "número novo: livre");
  const cMeio = await conf({ indicado_telefone: "(43) 99", embaixador_id: emb });
  ok(cMeio.situacao === "incompleto", "número pela metade: 'ainda não sei', não 'livre'");
  const cAuto = await conf({ indicado_telefone: tel(1), embaixador_id: emb });
  ok(cAuto.situacao === "autoindicacao", "a tela avisa a autoindicação antes de gravar");
  const cCli = await conf({ indicado_cpf: cpf(3), embaixador_id: emb });
  ok(cCli.situacao === "ja_e_cliente", "a tela avisa quem já é cliente");
  const linha = await um("select embaixador_rotulo, trava_vencida from indica.v_indicacoes where id = $1", [ind4]);
  ok(linha?.embaixador_rotulo === `${embRow.codigo} · Joana` && linha.trava_vencida === false, "a lista mostra o Embaixador como 'CÓDIGO · 1º nome'");

  // =========================================================================
  console.log("\n13. Ajuste manual, catálogo, resgate e voucher (2004)");
  await como(recepcao.id);
  await falha(
    "select indica.ajustar_pontos($1, 5000, 'Campanha de teste')",
    [emb],
    "INDICA_SEM_PERMISSAO",
    "recepção não faz ajuste manual"
  );
  await como(gerente.id);
  await falha("select indica.ajustar_pontos($1, 5000, 'x')", [emb], "INDICA_MOTIVO_OBRIGATORIO", "ajuste exige motivo");
  const s0 = await saldo(emb);
  await falha(
    "select indica.ajustar_pontos($1, $2, 'Tirar demais')",
    [emb, -(s0.disponivel + 1)],
    "INDICA_SALDO_INSUFICIENTE",
    "ajuste negativo não deixa saldo abaixo de zero"
  );
  await q("select indica.ajustar_pontos($1, 5000, 'Crédito de teste do resgate')", [emb]);
  const s1 = await saldo(emb);
  ok(s1.disponivel === s0.disponivel + 5000, "gerente credita 5.000 com motivo (vai para a auditoria)");

  await como(rede.id);
  const itemCredito = (await um(
    `insert into indica.catalogo_itens (tipo, nome, custo_riso_coins, valor_centavos)
     values ('credito_risarte', 'Crédito Risarte R$ 100 (teste)', 1000, 10000) returning id`
  )).id;
  const itemCaro = (await um(
    `insert into indica.catalogo_itens (tipo, nome, custo_riso_coins, valor_centavos, estoque)
     values ('produto', 'Escova elétrica (teste)', 2500, 30000, 1) returning id`
  )).id;
  const itemDiamante = (await um(
    `insert into indica.catalogo_itens (tipo, nome, custo_riso_coins, nivel_minimo_id)
     values ('experiencia', 'Evento Diamante (teste)', 100, (select id from indica.niveis where codigo = 'diamante')) returning id`
  )).id;
  ok(Boolean(itemCredito && itemCaro), "franqueadora cadastra itens no catálogo da rede");
  await como(recepcao.id);
  await falha(
    "insert into indica.catalogo_itens (tipo, nome, custo_riso_coins) values ('produto', 'x', 10)",
    [],
    "row-level security",
    "recepção não mexe no catálogo"
  );

  const pedir = (item, extra = {}) =>
    um("select indica.solicitar_resgate($1) as id", [{ embaixador_id: emb, item_id: item, unidade_id: U, ...extra }]);
  await falha("select indica.solicitar_resgate($1)", [{ embaixador_id: emb, item_id: itemDiamante, unidade_id: U }],
    "INDICA_NIVEL_INSUFICIENTE", "item de nível acima não sai");
  await falha("select indica.solicitar_resgate($1)", [{ embaixador_id: emb, item_id: itemCredito, unidade_id: U, cedido_para_nome: "Ana" }],
    "INDICA_DADOS", "ceder o prêmio exige nome, CPF e telefone");

  const rs1 = (await pedir(itemCredito)).id;
  const res1 = await um("select status, item_nome, valor_centavos from indica.resgates where id = $1", [rs1]);
  const s2 = await saldo(emb);
  ok(res1.status === "aprovado" && s2.disponivel === s1.disponivel - 1000,
    "resgate até o limite nasce aprovado e RESERVA os pontos na hora");
  ok(res1.item_nome.startsWith("Crédito Risarte") && Number(res1.valor_centavos) === 10000, "o resgate grava o item e o valor da época");

  const rs2 = (await pedir(itemCaro, { cedido_para_nome: "Ana Presenteada", cedido_para_cpf: cpf(8), cedido_para_telefone: tel(8) })).id;
  const res2 = await um("select status, cedido_para_nome from indica.resgates where id = $1", [rs2]);
  ok(res2.status === "solicitado" && res2.cedido_para_nome === "Ana Presenteada",
    "acima de 2.000 fica aguardando o gestor; prêmio cedido com os dados de quem recebe");
  await falha("select indica.solicitar_resgate($1)", [{ embaixador_id: emb, item_id: itemCaro, unidade_id: U }],
    "INDICA_SEM_ESTOQUE", "estoque 1 já reservado: o segundo pedido é recusado");
  await falha("select indica.mudar_resgate($1, 'aprovar')", [rs2], "INDICA_SEM_PERMISSAO", "recepção não aprova");
  await como(gerente.id);
  await q("select indica.mudar_resgate($1, 'recusar', 'Item fora de linha')", [rs2]);
  const s3 = await saldo(emb);
  const est = await um("select estoque from indica.catalogo_itens where id = $1", [itemCaro]);
  ok(s3.disponivel === s2.disponivel && est.estoque === 1,
    "recusar devolve os pontos (linha nova 'devolucao') e o estoque");
  ok(s3.total_resgatado === 1000, `total resgatado desconta a devolução (${s3.total_resgatado})`);

  await como(recepcao.id);
  const status1 = (await um("select indica.mudar_resgate($1, 'entregar') as s", [rs1])).s;
  const v1 = await um("select codigo_voucher, voucher_valido_ate - entregue_em as validade from indica.resgates where id = $1", [rs1]);
  ok(status1 === "entregue" && /^RIS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(v1.codigo_voucher),
    `entregar gera o voucher (${v1.codigo_voucher})`);
  ok(v1.validade.days === 90, "voucher de Crédito Risarte vale 90 dias (parâmetro)");
  await falha("select indica.mudar_resgate($1, 'cancelar', 'desisti')", [rs1], "INDICA_TRANSICAO_INVALIDA",
    "resgate entregue não volta");

  await sistema();
  const negB = (await um("select id from public.plan_negotiations where client_id = $1 limit 1", [cliB])).id;
  await como(recepcao.id);
  const valor = (await um("select indica.usar_voucher($1, $2) as v", [v1.codigo_voucher.toLowerCase(), negB])).v;
  ok(Number(valor) === 10000, "usar o voucher numa negociação devolve o valor (R$ 100)");
  await falha("select indica.usar_voucher($1, $2)", [v1.codigo_voucher, negB], "INDICA_VOUCHER_USADO",
    "voucher usado não vale de novo");

  await sistema();
  await falha("update indica.resgates set riso_coins = 1 where id = $1", [rs1], "INDICA_FORA_DO_MOTOR",
    "resgate não muda por update direto");

  await como(gerente.id);
  await falha("select indica.definir_status_embaixador($1, 'suspenso', 'x')", [emb], "INDICA_MOTIVO_OBRIGATORIO",
    "suspender exige motivo");
  await q("select indica.definir_status_embaixador($1, 'suspenso', 'Conferência de fraude')", [emb]);
  await como(recepcao.id);
  await falha("select indica.solicitar_resgate($1)", [{ embaixador_id: emb, item_id: itemCredito, unidade_id: U }],
    "INDICA_EMBAIXADOR_INATIVO", "Embaixador suspenso não resgata");
  const ve = await um("select disponivel, nivel_nome, indicacoes, total_resgatado from indica.v_embaixadores where id = $1", [emb]);
  ok(ve && ve.indicacoes >= 5 && ve.disponivel === (await saldo(emb)).disponivel,
    "v_embaixadores mostra saldo, nível e indicações");
}

try {
  await main();
} catch (e) {
  falhas.push(`erro inesperado: ${e.message}`);
  console.log(`\n✘ ERRO INESPERADO: ${e.message}`);
  if (e.where) console.log(`  onde: ${e.where.split("\n")[0]}`);
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(
  `\n${passou} conferência(s) certa(s), ${falhas.length} falha(s). ` +
    "Transação desfeita: nada ficou gravado no treino."
);
// Régua que não conferiu nada tem de gritar (§0d do CLAUDE.md).
if (passou === 0) console.log("⚠️ NENHUMA conferência rodou — isto não é aprovação.");
process.exitCode = falhas.length > 0 || passou === 0 ? 1 : 0;
