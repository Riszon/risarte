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

  // --- Automação (2005) DESLIGADA nas seções 1–13 --------------------------
  // Elas provam o caminho MANUAL, etapa por etapa; com os gatilhos ligados, o
  // check-in e a venda andariam sozinhos no meio da prova. A seção 14 liga de
  // novo e prova a automação. (Dentro da transação: nada disso sobrevive.)
  const GATILHOS = [
    ["public.appointments", "indica_automacao_agenda"],
    ["public.commercial_sales", "indica_automacao_venda"],
    ["public.payment_installments", "indica_automacao_parcela"],
  ];
  const temAutomacao = (await um("select to_regprocedure('indica.rotina_diaria()') is not null as sim")).sim;
  if (temAutomacao) {
    for (const [tabela, gatilho] of GATILHOS) await db.query(`alter table ${tabela} disable trigger ${gatilho}`);
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
  // 11 dígitos sempre: n de 1 algarismo → "(43) 9n" + sufixo; de 2 → "(43) 8nn"
  // + 6 do sufixo (prefixo 8 para não colidir com os de 1 algarismo).
  const tel = (n) =>
    n < 10 ? `(43) 9${n}${sufixo}` : `(43) 8${n}${sufixo.slice(0, 6)}`;
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

  // Nasce ativa pelo bastidor (desde a 2007, só a porta muda a situação).
  const [camp] = await bastidor(
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
  // Encerra: desde a 2007 a campanha ativa entra SOZINHA nas indicações
  // seguintes, e as seções 6–15 provam as regras sem campanha.
  await bastidor("update indica.campanhas set status = 'encerrada' where id = $1", [camp.id]);

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

  // =========================================================================
  if (!temAutomacao) return;
  console.log("\n14. Automação (2005): agenda, Comercial, Financeiro e rotina diária");
  await sistema();
  for (const [tabela, gatilho] of GATILHOS) await db.query(`alter table ${tabela} enable trigger ${gatilho}`);
  // Volta o teto ao padrão e reativa o Embaixador (seções 11 e 13 mexeram).
  // Dentro da transação o relógio (now()) é o mesmo: apaga-se a versão de
  // teste da seção 11 em vez de criar outra "mais nova".
  await q(
    "delete from indica.config where unidade_id is null and chave = 'teto_conversoes_12_meses' and vigente_desde = now()"
  );
  await como(gerente.id);
  await q("select indica.definir_status_embaixador($1, 'ativo', 'Reativado para o teste')", [emb]);
  await como(recepcao.id);

  const status = async (id) => (await um("select status from indica.indicacoes where id = $1", [id])).status;
  const falhasAntes = (await um("select count(*)::int n from indica.falhas_automacao")).n;

  // --- A: agenda → check-in → venda → 1ª parcela, tudo sozinho ---------------
  const indA = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Auto Silva", indicado_telefone: tel(11) })).id;
  await sistema();
  const cliA = await novoCliente("Auto Silva", tel(11));
  const agA = await avaliacao(cliA, false, "now() + interval '2 days'");
  const a1 = await um("select status, cliente_indicado_id, agendamento_id from indica.indicacoes where id = $1", [indA]);
  ok(a1.status === "agendada" && a1.cliente_indicado_id === cliA && a1.agendamento_id === agA,
    "marcar a avaliação do indicado liga a indicação sozinha (validada → agendada), achando-o pelo telefone");
  await q("update public.appointments set checked_in_at = now(), attendance = 'waiting' where id = $1", [agA]);
  ok((await status(indA)) === "compareceu", "o CHECK-IN da avaliação vira 'Compareceu' sozinho");
  const vA = await venda(cliA, 800_000, false);
  await q("update public.commercial_sales set closed_at = now() where id = $1", [vA.vendaId]);
  ok((await status(indA)) === "fechou", "a venda FECHADA no Comercial vira 'Fechou' sozinha");
  await q(
    `insert into public.payment_installments (clinic_id, negotiation_id, seq, kind, due_date, amount_cents, status, paid_at)
     values ($1, $2, 1, 'entrada', current_date, 100000, 'paga', now())`,
    [U, vA.negId]
  );
  ok((await status(indA)) === "convertida", "a 1ª PARCELA paga converte sozinha (libera a carência)");
  const evA = await um(
    "select count(*)::int n from indica.indicacao_eventos where indicacao_id = $1 and motivo like 'Automático:%'",
    [indA]
  );
  ok(evA.n >= 5, `cada passo automático fica na linha do tempo como 'Automático' (${evA.n})`);

  // --- B: venda cancelada na carência → estorno --------------------------------
  const indB = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Bia Cancela", indicado_telefone: tel(12) })).id;
  await sistema();
  const cliB2 = await novoCliente("Bia Cancela", tel(12));
  const agB2 = await avaliacao(cliB2, true);
  ok((await status(indB)) === "compareceu", "avaliação criada já com check-in (encaixe) também conta");
  const vB2 = await venda(cliB2, 300_000, false);
  await q("update public.commercial_sales set closed_at = now() where id = $1", [vB2.vendaId]);
  const carenciaAntes = (await saldo(emb)).em_carencia;
  await q("update public.commercial_sales set cancelled_at = now(), cancel_reason = 'Desistiu' where id = $1", [vB2.vendaId]);
  ok((await status(indB)) === "cancelada" && (await saldo(emb)).em_carencia < carenciaAntes,
    "venda CANCELADA na carência cancela a indicação e estorna a carência");
  void agB2;

  // --- C: falta ---------------------------------------------------------------
  const indC = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Caio Falta", indicado_telefone: tel(13) })).id;
  await sistema();
  const cliC2 = await novoCliente("Caio Falta", tel(13));
  const agC2 = await avaliacao(cliC2, false, "now() + interval '1 day'");
  await q("update public.appointments set status = 'no_show' where id = $1", [agC2]);
  ok((await status(indC)) === "faltou", "FALTA na avaliação vira 'Faltou' sozinha");

  // --- D: BLINDAGEM — o Indica falha e o check-in acontece mesmo assim ------
  const indD = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Davi Blindado", indicado_telefone: tel(14) })).id;
  await sistema();
  const cliD = await novoCliente("Davi Blindado", tel(14));
  const agD = await avaliacao(cliD, false, "now() + interval '1 day'");
  await bastidor("update indica.indicacoes set trava_ate = now() - interval '1 day' where id = $1", [indD]);
  await sistema();
  await q("update public.appointments set checked_in_at = now(), attendance = 'waiting' where id = $1", [agD]);
  const chegou = await um("select checked_in_at is not null as ok from public.appointments where id = $1", [agD]);
  const falhasDepois = (await um("select count(*)::int n from indica.falhas_automacao")).n;
  ok(chegou.ok && (await status(indD)) === "agendada",
    "com o Indica recusando (trava vencida), o CHECK-IN acontece normalmente");
  ok(falhasDepois > falhasAntes, "e a falha fica registrada em indica.falhas_automacao");

  // --- E: rotina diária -------------------------------------------------------
  await como(recepcao.id);
  await falha("select indica.rotina_diaria()", [], "permission denied", "ninguém logado roda a rotina (só o agendador)");
  await sistema();
  // Carência por prazo: indicação fechada há 40 dias, sem parcela paga.
  const indE = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Eva Prazo", indicado_telefone: tel(15) })).id;
  await sistema();
  const cliE = await novoCliente("Eva Prazo", tel(15));
  await avaliacao(cliE, true);
  const vE = await venda(cliE, 200_000, false);
  await q("update public.commercial_sales set closed_at = now() where id = $1", [vE.vendaId]);
  await bastidor("update indica.indicacoes set fechou_em = now() - interval '40 days' where id = $1", [indE]);
  // Anonimização: encerrada há 13 meses.
  await bastidor(
    "update indica.indicacoes set encerrada_em = now() - interval '13 months' where id = $1",
    [indB]
  );
  // Vencimento: Embaixador novo com 300 vencidos e 200 válidos.
  const cliV = await novoCliente("Vera Vence", tel(16));
  await como(recepcao.id);
  const embV = (await um("select indica.criar_embaixador($1, '2026.1') as id", [cliV])).id;
  await bastidor(
    `insert into indica.pontos_lancamentos (embaixador_id, tipo, saldo, riso_coins, regra_aplicada, expira_em, motivo)
     values ($1, 'ajuste', 'disponivel', 300, '{}', now() - interval '1 day', 'teste vencido'),
            ($1, 'ajuste', 'disponivel', 200, '{}', now() + interval '6 months', 'teste valido')`,
    [embV]
  );
  await sistema();
  const r14_res = (await um("select indica.rotina_diaria() as r")).r;
  ok((await status(indD)) === "expirada", "rotina: trava vencida → expirada");
  ok((await status(indE)) === "convertida", "rotina: carência vencida pelo prazo → convertida");
  const r14_sv = await saldo(embV);
  ok(r14_sv.disponivel === 200, `rotina: Riso Coins vencidos saem (300), os válidos ficam (${r14_sv.disponivel})`);
  const r14_anon = await um("select indicado_nome, indicado_telefone, anonimizada_em from indica.indicacoes where id = $1", [indB]);
  ok(r14_anon.indicado_nome === "Anonimizado" && r14_anon.indicado_telefone === null && r14_anon.anonimizada_em,
    "rotina: indicação encerrada há mais de 12 meses é anonimizada (LGPD)");
  const r14_exec = await um("select resultado from indica.rotinas_execucoes order by id desc limit 1");
  ok(r14_exec && r14_exec.resultado.expiradas >= 1 && JSON.stringify(r14_exec.resultado) === JSON.stringify(r14_res),
    "cada execução da rotina fica registrada com os números");
  const r14_res2 = (await um("select indica.rotina_diaria() as r")).r;
  ok(r14_res2.riso_coins_vencidos === 0 && r14_res2.convertidas_por_prazo === 0, "rodar de novo não repete nada");

  // =========================================================================
  const temConvite = (await um("select to_regprocedure('indica.convite_publico(text)') is not null as sim")).sim;
  if (!temConvite) return;
  console.log("\n15. Aceite LGPD, convite, páginas públicas, portal e mensagens (2006)");
  await como(recepcao.id);
  const msg = (indicacaoId, evento) =>
    um("select * from indica.mensagens where indicacao_id = $1 and evento = $2", [indicacaoId, evento]);

  // Aceite registrado pela recepção
  const indP = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Paula Presente", indicado_telefone: tel(17), consentimento: "presencial" })).id;
  const cP = await um(
    `select c.canal, c.registrado_por, i.convite_token_hash from indica.indicacoes i
       join indica.consentimentos c on c.id = i.consentimento_id where i.id = $1`, [indP]);
  ok(cP?.canal === "presencial" && cP.registrado_por === recepcao.id && cP.convite_token_hash === null,
    "aceite presencial gravado com quem registrou; sem convite");
  const mObrigado = await msg(indP, "registrada");
  ok(mObrigado && mObrigado.destinatario === "embaixador" && mObrigado.texto.includes("Joana") && mObrigado.texto.includes("Paula"),
    "a fila recebe o 'obrigado' ao Embaixador com os nomes (modelo da rede)");
  ok(!(await msg(indP, "convite")), "com aceite, não há convite na fila");

  // Sem aceite: convite pelo link
  const indQ = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Quitéria Convite", indicado_telefone: tel(18) })).id;
  const mConvite = await msg(indQ, "convite");
  ok(mConvite && /^\/c\/[0-9a-f]{64}$/.test(mConvite.link_caminho) && mConvite.texto.includes("Joana indicou você"),
    "sem aceite, o convite ao indicado vai para a fila com o link /c/…");
  const tokenQ = mConvite.link_caminho.slice(3);
  await falha("select indica.ver_convite($1)", [tokenQ], "permission denied", "logado não lê o convite público (só o servidor)");
  await como(null, "service_role");
  const verQ = (await um("select indica.ver_convite($1) as v", [tokenQ])).v;
  ok(verQ?.indicador === "Joana" && verQ.indicado === "Quitéria" && !JSON.stringify(verQ).includes("43"),
    "a página do convite mostra só primeiros nomes e a unidade");
  ok((await um("select indica.aceitar_convite($1, '200.1.2.3') as ok", [tokenQ])).ok === true, "o indicado aceita pelo link");
  const cQ = await um(
    "select c.canal, host(c.ip) ip from indica.indicacoes i join indica.consentimentos c on c.id = i.consentimento_id where i.id = $1", [indQ]);
  ok(cQ?.canal === "link" && cQ.ip === "200.1.2.3", "aceite pelo link grava canal e IP");
  ok((await um("select indica.aceitar_convite($1, null) as ok", [tokenQ])).ok === false, "o link do convite vale uma vez");

  // Página pública /i/[código]
  const pub = (await um("select indica.convite_publico($1) as p", [embRow.codigo.toLowerCase()])).p;
  ok(pub?.indicador === "Joana" && pub.unidades.length > 0 && !JSON.stringify(pub).includes("cpf"),
    "/i/[código] mostra quem convida e as unidades");
  ok((await um("select indica.convite_publico('NAOEXISTE99') as p")).p === null, "código inexistente não mostra nada");
  const semAceite = (await um("select indica.registrar_pelo_link($1, $2, null) as r",
    [embRow.codigo, { unidade_id: U, nome: "Rui Link", telefone: tel(19), aceite: false }])).r;
  ok(semAceite.ok === false, "sem marcar o aceite, a página pública não envia");
  const pelaPagina = (await um("select indica.registrar_pelo_link($1, $2, '177.10.0.1') as r",
    [embRow.codigo, { unidade_id: U, nome: "Rui Link", telefone: tel(19), aceite: true }])).r;
  const indR = await um(
    `select i.canal, c.canal consent, host(c.ip) ip from indica.indicacoes i
       join indica.consentimentos c on c.id = i.consentimento_id where i.indicado_telefone = $1`, [tel(19)]);
  ok(pelaPagina.ok && indR?.canal === "link" && indR.consent === "link" && indR.ip === "177.10.0.1",
    "pela página pública: indicação canal 'link' com o aceite e o IP");
  const repetida = (await um("select indica.registrar_pelo_link($1, $2, null) as r",
    [embRow.codigo, { unidade_id: U, nome: "Rui de Novo", telefone: tel(19), aceite: true }])).r;
  const qtd = await um("select count(*)::int n from indica.indicacoes where indicado_telefone = $1", [tel(19)]);
  ok(repetida.ok === true && repetida.situacao === "recebido" && qtd.n === 1,
    "pessoa já indicada: resposta GENÉRICA (a página não vira consulta de paciente) e nada novo");

  // Portal do Embaixador
  await como(recepcao.id);
  const tokP = (await um("select indica.gerar_link_portal($1) as t", [emb])).t;
  await como(null, "service_role");
  const cat = (await um("select indica.portal_catalogo($1) as c", [tokP])).c;
  ok(Array.isArray(cat) && cat.some((i) => i.nome.startsWith("Crédito Risarte")), "o portal mostra o catálogo");
  const pIndica = (await um("select indica.portal_indicar($1, $2) as r",
    [tokP, { nome: "Sara Portal", telefone: tel(20) }])).r;
  ok(pIndica.ok && /^\/c\//.test(pIndica.link) && pIndica.texto.includes("Sara"),
    "o Embaixador indica pelo portal e recebe o convite pronto para mandar ao amigo");
  const pDup = (await um("select indica.portal_indicar($1, $2) as r", [tokP, { nome: "Sara de Novo", telefone: tel(20) }])).r;
  ok(pDup.ok === false && /já foi indicada/.test(pDup.erro), "no portal, repetir a pessoa avisa sem detalhar");
  const pRes = (await um("select indica.portal_resgatar($1, $2) as r", [tokP, itemCredito])).r;
  ok(pRes.ok === true && /^RES-\d{6}$/.test(pRes.codigo), `o Embaixador pede resgate pelo portal (${pRes.codigo})`);
  const pInv = (await um("select indica.portal_resgatar($1, $2) as r", ["x".repeat(64), itemCredito])).r;
  ok(pInv.ok === false, "link inválido não resgata");

  // Fila: marcar enviada
  await como(recepcao.id);
  await q("select indica.marcar_mensagem($1, 'enviada')", [mObrigado.id]);
  const mk = await um("select status, enviada_por from indica.mensagens where id = $1", [mObrigado.id]);
  ok(mk.status === "enviada" && mk.enviada_por === recepcao.id, "a recepção marca a mensagem como enviada");
  await como(franqueado.id);
  await falha("select indica.marcar_mensagem($1, 'descartada')", [mConvite.id], "INDICA_SEM_PERMISSAO",
    "outra unidade não mexe na fila desta");

  // Rotina: convite sem aceite em 7 dias + lembrete a vencer
  await como(recepcao.id);
  const indS = (await registrar({ embaixador_id: emb, canal: "agendamento", indicado_nome: "Silvio Sem Aceite", indicado_telefone: tel(21) })).id;
  await bastidor("update indica.indicacoes set registrada_em = now() - interval '8 days' where id = $1", [indS]);
  await bastidor(
    `insert into indica.pontos_lancamentos (embaixador_id, tipo, saldo, riso_coins, regra_aplicada, expira_em, motivo)
     values ($1, 'ajuste', 'disponivel', 70, '{}', now() + interval '10 days', 'teste a vencer')`, [embV]);
  await sistema();
  const rot = (await um("select indica.rotina_diaria() as r")).r;
  const sS = await um("select status, indicado_nome, indicado_telefone from indica.indicacoes where id = $1", [indS]);
  const mS = await msg(indS, "convite");
  ok(sS.status === "recusada" && sS.indicado_nome === "Anonimizado" && sS.indicado_telefone === null && mS.status === "descartada",
    "rotina: 7 dias sem aceite → recusada, dados anonimizados e convite descartado");
  const lembrete = await um("select count(*)::int n from indica.mensagens where embaixador_id = $1 and evento = 'a_vencer'", [embV]);
  ok(rot.lembretes_a_vencer >= 1 && lembrete.n === 1, "rotina: lembrete de Riso Coins a vencer vai para a fila");
  await q("select indica.rotina_diaria()");
  const lembrete2 = await um("select count(*)::int n from indica.mensagens where embaixador_id = $1 and evento = 'a_vencer'", [embV]);
  ok(lembrete2.n === 1, "o lembrete não se repete no mesmo mês");

  // =========================================================================
  const temCampanhas = (await um("select to_regprocedure('indica.mudar_campanha(uuid,text,text)') is not null as sim")).sim;
  if (!temCampanhas) return;
  console.log("\n16. Campanhas e metas da equipe (2007)");
  // Embaixador próprio: nível Ouro (1,2x) fixado, sem herdar teto das seções anteriores.
  await sistema();
  const cliX = await novoCliente("Olga Campanha Teste", tel(30));
  await como(recepcao.id);
  const embX = (await um("select indica.criar_embaixador($1, '2026.1') as id", [cliX])).id;
  await bastidor(
    "update indica.embaixadores set nivel_id = (select id from indica.niveis where codigo = 'ouro') where id = $1",
    [embX]
  );
  const campanhaDe = async (id) => (await um("select campanha_id from indica.indicacoes where id = $1", [id])).campanha_id;
  const lancDe = (id, tipo) =>
    um("select riso_coins, regra_aplicada from indica.pontos_lancamentos where indicacao_id = $1 and tipo = $2 order by id limit 1", [id, tipo]);
  const novaCampanha = async (nome, regras, extra = {}) =>
    (
      await um(
        `insert into indica.campanhas (nome, escopo, unidades, inicio, fim, regras, publico, especialidade, orcamento_max_centavos)
         values ($1, 'unidades', array[$2::uuid], ${extra.inicio ?? "now() - interval '1 day'"}, ${extra.fim ?? "now() + interval '20 days'"},
                 $3, $4, $5, $6) returning id`,
        [nome, U, regras, extra.publico ?? {}, extra.especialidade ?? null, extra.orcamento ?? null]
      )
    ).id;
  const publicar = (id) => um("select indica.mudar_campanha($1, 'publicar') as s", [id]);
  const encerrar = (id) => q("select indica.mudar_campanha($1, 'encerrar', 'Fim do teste')", [id]);
  const indicarX = async (nome, n, extra = {}) =>
    (await registrar({ embaixador_id: embX, canal: "agendamento", indicado_nome: nome, indicado_telefone: tel(n), ...extra })).id;

  // --- A: situação e "só amplia" ---------------------------------------------
  await como(gerente.id);
  const c16a = await novaCampanha("Traga sua Família (teste)", { multiplicador: 1.5 });
  await falha(
    `insert into indica.campanhas (nome, escopo, unidades, inicio, fim, status)
     values ('Nasce ativa', 'unidades', array[$1::uuid], now(), now() + interval '1 day', 'ativa')`,
    [U], "INDICA_FORA_DO_MOTOR", "campanha não nasce ativa: nasce rascunho");
  await falha("update indica.campanhas set status = 'ativa' where id = $1", [c16a], "INDICA_FORA_DO_MOTOR",
    "a situação da campanha não muda por update direto");
  await como(recepcao.id);
  await falha("select indica.mudar_campanha($1, 'publicar')", [c16a], "INDICA_SEM_PERMISSAO", "recepção não publica campanha");
  await como(franqueado.id);
  await falha("select indica.mudar_campanha($1, 'publicar')", [c16a], "INDICA_SEM_PERMISSAO", "gestor de outra unidade não publica");
  await como(gerente.id);
  ok((await publicar(c16a)).s === "ativa", "o gestor publica: começo no passado → ativa");
  await falha(`update indica.campanhas set regras = '{"multiplicador": 1.2}' where id = $1`, [c16a], "INDICA_CAMPANHA_REDUZIDA",
    "campanha ativa não reduz o multiplicador");
  await falha(`update indica.campanhas set publico = '{"niveis": ["diamante"]}' where id = $1`, [c16a], "INDICA_CAMPANHA_REDUZIDA",
    "campanha ativa não troca o público");
  await q(`update indica.campanhas set regras = '{"multiplicador": 1.6}' where id = $1`, [c16a]);
  ok((await um("select versao from indica.campanhas where id = $1", [c16a])).versao === 2, "ampliar é permitido e sobe a versão");
  await falha("select indica.mudar_campanha($1, 'encerrar')", [c16a], "INDICA_MOTIVO_OBRIGATORIO", "encerrar exige motivo");

  // --- B: a mais vantajosa, automática ---------------------------------------
  // Termina DEPOIS da 1,6x: na fila (por fim) ela vem por último — só ganha se a conta de vantagem funcionar.
  const c16b = await novaCampanha("Riso Coins em Dobro (teste)", { multiplicador: 2 }, { fim: "now() + interval '40 days'" });
  await publicar(c16b);
  await como(recepcao.id);
  const i16b = await indicarX("Gil Automático", 31);
  ok((await campanhaDe(i16b)) === c16b, "sem escolher, a indicação entra na campanha MAIS VANTAJOSA (2x, não 1,6x)");
  const p16b = await lancDe(i16b, "pendente");
  const base16 = Number(p16b.regra_aplicada.pontos.registro);
  ok(p16b.riso_coins === base16 * 2 && p16b.regra_aplicada.campanha?.id === c16b,
    `os pontos seguem a campanha congelada: ${base16} × 2, sem somar com o nível 1,2x (${p16b.riso_coins})`);

  // --- C: público por nível -----------------------------------------------------
  await como(gerente.id);
  const c16c = await novaCampanha("Maratona Diamante (teste)", { multiplicador: 5 }, { publico: { niveis: ["diamante"] } });
  await publicar(c16c);
  await como(recepcao.id);
  const i16c = await indicarX("Hugo Nível", 32);
  ok((await campanhaDe(i16c)) === c16b, "campanha só para Diamante não alcança Embaixador Ouro");
  await falha("select indica.registrar_indicacao($1)",
    [{ unidade_id: U, embaixador_id: embX, canal: "agendamento", indicado_nome: "Ivo Forçado", indicado_telefone: tel(33), campanha_id: c16c }],
    "INDICA_CAMPANHA_INVALIDA", "escolher à mão campanha fora do público é recusado");
  await como(gerente.id);
  await encerrar(c16c);

  // --- D: público por empresa do Empresarial --------------------------------
  await sistema();
  const temEmpresarial = (await um("select to_regclass('empresarial.companies') is not null as sim")).sim;
  const empresa = temEmpresarial ? (await um("select id from empresarial.companies limit 1"))?.id : null;
  if (!empresa) {
    console.log("  ⚠️ sem empresa do Empresarial no treino — segmento por empresa NÃO conferido");
  } else {
    await como(gerente.id);
    const c16d = await novaCampanha("Empresa Parceira (teste)", { multiplicador: 4 }, { publico: { empresas: [empresa] } });
    await publicar(c16d);
    await como(recepcao.id);
    const i16d1 = await indicarX("Júlia Sem Empresa", 34);
    ok((await campanhaDe(i16d1)) !== c16d, "Embaixador sem vínculo com a empresa fica fora da campanha dela");
    await sistema();
    await q("update public.clients set empresarial_company_id = $1 where id = $2", [empresa, cliX]);
    await como(recepcao.id);
    const i16d2 = await indicarX("Kátia Com Empresa", 35);
    ok((await campanhaDe(i16d2)) === c16d, "colaborador da empresa entra na campanha da empresa");
    await sistema();
    await q("update public.clients set empresarial_company_id = null where id = $1", [cliX]);
    await como(gerente.id);
    await encerrar(c16d);
  }

  // --- E: público por especialidade do tratamento do Embaixador --------------
  await sistema();
  const esp = await q(
    `select distinct on (specialty) id, specialty from public.procedures
      where nullif(btrim(specialty), '') is not null order by specialty, id limit 2`
  );
  if (esp.length < 2) throw new Error("o treino precisa de procedimentos com 2 especialidades");
  const [S1, S2] = esp;
  const itemNaVenda = async (negId, procId) => {
    const opt = await um("select option_id from public.plan_negotiations where id = $1", [negId]);
    const it = await um(
      `insert into public.treatment_plan_option_items (option_id, clinic_id, description, procedure_id)
       values ($1, $2, 'Item de teste', $3) returning id`,
      [opt.option_id, U, procId]
    );
    await q("insert into public.plan_negotiation_items (negotiation_id, item_id, included) values ($1, $2, true)", [negId, it.id]);
  };
  await como(gerente.id);
  const c16e = await novaCampanha("Quem trata " + S1.specialty + " (teste)", { multiplicador: 3 },
    { publico: { especialidades: [S1.specialty] } });
  await publicar(c16e);
  await como(recepcao.id);
  const i16e1 = await indicarX("Lia Antes", 36);
  ok((await campanhaDe(i16e1)) !== c16e, "Embaixador sem tratamento da especialidade fica fora");
  await sistema();
  const vX = await venda(cliX, 500_000, false);
  await itemNaVenda(vX.negId, S1.id);
  await q("update public.commercial_sales set closed_at = now() where id = $1", [vX.vendaId]);
  await como(recepcao.id);
  const i16e2 = await indicarX("Mia Depois", 37);
  ok((await campanhaDe(i16e2)) === c16e, `quem fechou tratamento de ${S1.specialty} entra na campanha da especialidade`);
  await como(gerente.id);
  await encerrar(c16e);

  // --- F: especialidade-ALVO no fechamento + bônus por marco ----------------
  const c16f = await novaCampanha("Alvo " + S2.specialty + " (teste)",
    { multiplicador: 2.5, marcos: [{ conversoes: 1, bonus: 300 }] }, { especialidade: S2.specialty });
  await publicar(c16f);
  const converter = async (nome, n, procId) => {
    await como(recepcao.id);
    const id = await indicarX(nome, n);
    await sistema();
    const cli = await novoCliente(nome, tel(n));
    const ag = await avaliacao(cli, false, "now() + interval '1 day'");
    await q("update public.appointments set checked_in_at = now(), attendance = 'waiting' where id = $1", [ag]);
    const v = await venda(cli, 400_000, false);
    await itemNaVenda(v.negId, procId);
    await q("update public.commercial_sales set closed_at = now() where id = $1", [v.vendaId]);
    await q(
      `insert into public.payment_installments (clinic_id, negotiation_id, seq, kind, due_date, amount_cents, status, paid_at)
       values ($1, $2, 1, 'entrada', current_date, 100000, 'paga', now())`,
      [U, v.negId]
    );
    return id;
  };
  const i16f = await converter("Nina Fora do Alvo", 38, S1.id);
  ok((await campanhaDe(i16f)) === c16f, "campanha 2,5x com especialidade-alvo entra no registro");
  ok((await um("select status from indica.indicacoes where id = $1", [i16f])).status === "convertida", "a indicação chegou a convertida");
  const f16comp = await lancDe(i16f, "credito");
  ok(f16comp.regra_aplicada.campanha?.id === c16f, "no comparecimento a campanha vale");
  const f16fech = await lancDe(i16f, "carencia");
  ok(f16fech.regra_aplicada.especialidade_fora_da_campanha === true && f16fech.regra_aplicada.campanha === null,
    "venda SEM a especialidade-alvo: o fechamento pontua sem a campanha (e o motivo fica gravado)");
  const i16g = await converter("Otto No Alvo", 39, S2.id);
  const g16fech = await lancDe(i16g, "carencia");
  ok(g16fech.regra_aplicada.especialidade_fora_da_campanha === false && g16fech.regra_aplicada.campanha?.id === c16f
      && g16fech.riso_coins > f16fech.riso_coins,
    `venda COM a especialidade-alvo: o fechamento leva a campanha (${g16fech.riso_coins} > ${f16fech.riso_coins})`);
  const marcos = await q(
    "select riso_coins from indica.pontos_lancamentos where embaixador_id = $1 and regra_aplicada ->> 'marco_campanha' = $2",
    [embX, c16f]
  );
  ok(marcos.length === 1 && marcos[0].riso_coins === 300, "bônus de marco: +300 na 1ª conversão da campanha, uma vez só");
  await como(gerente.id);
  const consumo = (await um("select indica.campanha_consumo($1) as c", [c16f])).c;
  ok(consumo.riso_coins >= 300 && consumo.custo_centavos === Math.round(consumo.riso_coins * 10),
    `consumo da campanha em Riso Coins e em reais (${consumo.riso_coins} → ${consumo.custo_centavos} centavos)`);
  await encerrar(c16f);

  // --- G: rotina das campanhas: agendada → ativa, orçamento --------------------
  const c16h = await novaCampanha("Inauguração (teste)", { multiplicador: 1.1 }, { inicio: "now() + interval '2 days'" });
  ok((await publicar(c16h)).s === "agendada", "começo no futuro: publicar deixa AGENDADA");
  await q("update indica.campanhas set inicio = now() - interval '1 hour' where id = $1", [c16h]);
  await q("update indica.campanhas set orcamento_max_centavos = 100 where id = $1", [c16b]);
  await como(recepcao.id);
  await falha("select indica.rotina_campanhas()", [], "permission denied", "ninguém logado roda a rotina das campanhas");
  await sistema();
  const rc = (await um("select indica.rotina_campanhas() as r")).r;
  const h = await um("select status from indica.campanhas where id = $1", [c16h]);
  const b = await um("select alerta_orcamento_em, orcamento_esgotado_em from indica.campanhas where id = $1", [c16b]);
  ok(h.status === "ativa" && rc.ativadas >= 1, "rotina: campanha agendada que começou vira ativa");
  ok(b.alerta_orcamento_em && b.orcamento_esgotado_em && rc.orcamentos_esgotados >= 1, "rotina: orçamento passou de 80% → alerta; de 100% → esgotado");
  await como(recepcao.id);
  const i16h = await indicarX("Pedro Pós-Orçamento", 40);
  ok((await campanhaDe(i16h)) === c16a, "campanha com orçamento esgotado sai da escolha automática (vai a 1,6x)");
  await como(gerente.id);
  await q("update indica.campanhas set orcamento_max_centavos = 100000000 where id = $1", [c16b]);
  const b2 = await um("select alerta_orcamento_em, orcamento_esgotado_em from indica.campanhas where id = $1", [c16b]);
  ok(b2.alerta_orcamento_em === null && b2.orcamento_esgotado_em === null,
    "aumentar o orçamento reabre a campanha (a rotina confere de novo)");

  // --- H: simulador --------------------------------------------------------------
  await como(recepcao.id);
  await falha("select indica.simular_campanha(array[$1::uuid], '{}', now(), now() + interval '30 days')", [U],
    "INDICA_SEM_PERMISSAO", "recepção não usa o simulador");
  await como(gerente.id);
  const sim = (await um(
    `select indica.simular_campanha(array[$1::uuid], '{"multiplicador": 2}', now(), now() + interval '30 days') as r`, [U])).r;
  ok(sim.historico_indicacoes > 0 && sim.riso_coins_com_campanha >= sim.riso_coins_sem_campanha && sim.custo_extra_centavos >= 0,
    `simulador usa o histórico da unidade (${sim.historico_indicacoes} indicações; +${sim.custo_extra_centavos} centavos)`);

  // --- I: metas da equipe ----------------------------------------------------
  await sistema();
  const padrao = (await um("select indica.config_valor('metas_faixas_padrao') as v")).v;
  ok(padrao.length === 4 && padrao[0].gatilho === 25 && padrao[3].gatilho === 55
      && padrao[0].premios.recepcao_crc.valor_centavos === 50000 && padrao[2].premios.demais.valor_centavos === 30000,
    "faixas padrão = modelo 2025 (25/40/50/55; R$ 500 recepção, voucher R$ 300 na Super Meta)");
  const faixas = [{ nome: "Meta teste", gatilho: 1, premios: {
    recepcao_crc: { tipo: "dinheiro", valor_centavos: 50000 }, demais: { tipo: "voucher", valor_centavos: 10000 } } }];
  const novaMeta = async (inicio, fim, trava) => (await um(
    `insert into indica.metas_equipe (unidade_id, periodo_tipo, periodo_inicio, periodo_fim, metrica, faixas, trava_qualidade_comparecimento, status)
     values ($1, 'mes', ${inicio}, ${fim}, 'conversoes', $2, $3, 'ativa') returning id`, [U, JSON.stringify(faixas), trava])).id;
  await como(recepcao.id);
  await falha(`insert into indica.metas_equipe (unidade_id, periodo_tipo, periodo_inicio, periodo_fim, metrica)
               values ($1, 'mes', current_date, current_date, 'conversoes')`, [U], "row-level security",
    "recepção não cria meta");
  await como(gerente.id);
  const metaMes = await novaMeta("date_trunc('month', current_date)::date", "(date_trunc('month', current_date) + interval '1 month - 1 day')::date", null);
  const apProv = (await um("select indica.apurar_meta($1, 'provisoria') as id", [metaMes])).id;
  const ap1 = await um("select valor_apurado, faixa_atingida, status from indica.apuracoes where id = $1", [apProv]);
  ok(Number(ap1.valor_apurado) >= 2 && ap1.faixa_atingida === "Meta teste", `apuração provisória conta as conversões do mês (${ap1.valor_apurado})`);
  await falha("select indica.apurar_meta($1, 'final')", [metaMes], "INDICA_APURACAO_CEDO", "a final só sai depois do fim do período");

  // Período passado: as duas conversões da seção F movidas para 5 dias atrás.
  await bastidor(
    "update indica.indicacoes set fechou_em = now() - interval '5 days', registrada_em = now() - interval '6 days' where id = any($1)",
    [[i16f, i16g]]
  );
  await como(gerente.id);
  const metaPassada = await novaMeta("current_date - 10", "current_date - 1", 50);
  const apFinal = (await um("select indica.apurar_meta($1, 'final') as id", [metaPassada])).id;
  const ap2 = await um("select * from indica.apuracoes where id = $1", [apFinal]);
  ok(Number(ap2.valor_apurado) >= 2 && ap2.comparecimento_ok === true && ap2.faixa_atingida === "Meta teste"
      && ap2.indicacoes_contadas.includes(i16f) && ap2.indicacoes_contadas.includes(i16g),
    "apuração final: 2 conversões do período, comparecimento 100%, faixa atingida, indicações listadas");
  await falha("select indica.apurar_meta($1, 'final')", [metaPassada], "apuracoes_final_uq", "só uma apuração final por meta");
  await sistema();
  await falha("update indica.apuracoes set valor_apurado = 99 where id = $1", [apFinal], "INDICA_FORA_DO_MOTOR",
    "apuração não muda por update direto");
  await como(recepcao.id);
  await falha("select indica.aprovar_apuracao($1, true)", [apFinal], "INDICA_SEM_PERMISSAO", "recepção não aprova apuração");
  await como(gerente.id);
  await falha("select indica.aprovar_apuracao($1, false, '')", [apFinal], "INDICA_MOTIVO_OBRIGATORIO", "reprovar exige motivo");
  await q("select indica.aprovar_apuracao($1, true)", [apFinal]);
  const ap3 = await um("select status, premios, aprovado_por from indica.apuracoes where id = $1", [apFinal]);
  const premioRecepcao = ap3.premios.find((p) => p.user_id === recepcao.id);
  const premioGerente = ap3.premios.find((p) => p.user_id === gerente.id);
  ok(ap3.status === "aprovada" && ap3.aprovado_por === gerente.id, "o gestor aprova a apuração final");
  ok(premioRecepcao?.grupo === "recepcao_crc" && premioRecepcao.premio.valor_centavos === 50000
      && premioGerente?.grupo === "demais" && premioGerente.premio.tipo === "voucher",
    "a aprovação congela a lista para a folha: recepção R$ 500 em dinheiro, demais voucher");

  // Trava de qualidade: uma indicação sem comparecimento no período → 66% < 70%.
  await bastidor("update indica.indicacoes set registrada_em = now() - interval '6 days' where id = $1", [i16c]);
  await como(gerente.id);
  const metaTrava = await novaMeta("current_date - 10", "current_date - 1", 70);
  const apT = (await um("select indica.apurar_meta($1, 'provisoria') as id", [metaTrava])).id;
  const ap4 = await um("select faixa_atingida, comparecimento_ok, taxa_comparecimento from indica.apuracoes where id = $1", [apT]);
  ok(ap4.comparecimento_ok === false && ap4.faixa_atingida === null,
    `trava de qualidade: comparecimento ${ap4.taxa_comparecimento}% abaixo de 70% → faixa não paga`);

  // --- J: ranking da equipe --------------------------------------------------
  await como(recepcao.id);
  const rk = await q("select * from indica.ranking_equipe($1, current_date - 30, current_date)", [U]);
  const euRk = rk.find((r) => r.usuario_id === recepcao.id);
  ok(euRk && euRk.registradas > 0 && euRk.conversoes_origem >= 2, `ranking individual da unidade (recepção: ${euRk?.registradas} registradas)`);
  await como(franqueado.id);
  await falha("select * from indica.ranking_equipe($1, current_date - 30, current_date)", [U], "INDICA_SEM_PERMISSAO",
    "outra unidade não vê o ranking desta");
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
