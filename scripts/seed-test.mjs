// SEMEIA O CENÁRIO DE TESTE — a rede em miniatura.
//
// Franqueadora + duas unidades, um usuário para CADA papel, catálogo de
// procedimentos, itens de estoque com kit e fornecedores. É o mínimo para os
// testes ponta a ponta encenarem a operação inteira.
//
// DUAS DECISÕES QUE VALE EXPLICAR:
//
// 1. **Um usuário por papel, sem acumular.** É o que a varredura de telas
//    (camada 2) exige para poder julgar permissão: quem acumula dois papéis
//    responde pelo mais forte, e o teste concluiria que a recepção enxerga
//    contas a pagar.
// 2. **Cambé é unidade PRÓPRIA, Londrina é franqueada.** Em produção as três
//    estão como franqueadas, e com isso o Resultado do Grupo (FIN8.2) mostra só
//    a franqueadora — não dá para testar a eliminação do intercompany, que é a
//    parte difícil do consolidado. Aqui existe uma de cada.
//
// A semeadura ENTRA PELA PORTA DA FRENTE: `actAs()` faz o banco enxergar o
// Admin Master, então toda guarda roda como rodaria no navegador. Cadastro que
// só funciona com superusuário não funciona para ninguém de verdade.
//
// Roda quantas vezes quiser: reconhece o que já existe e completa o que falta.
//
// Uso:  node scripts/seed-test.mjs

import { createClient } from "@supabase/supabase-js";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { actAs, connect, testEnv } from "./test-db.mjs";

const env = testEnv();
const auth = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
).auth.admin;

/** `example.com` é reservado por norma — nunca chega a uma caixa de verdade. */
const dominio = "example.com";

const CLINICAS = [
  { code: "FRA", name: "Risarte Franqueadora", type: "franchisor", ownership: "own" },
  { code: "CAM", name: "Risarte Cambé", type: "franchise_unit", ownership: "own" },
  { code: "LON", name: "Risarte Londrina", type: "franchise_unit", ownership: "franchised" },
];

/** Papel → (apelido do usuário, clínica onde ele trabalha). */
const PAPEIS = [
  // Franqueadora
  ["sdr", "sdr", "FRA"],
  ["planner_dentist", "planner", "FRA"],
  ["commercial_consultant", "consultor", "FRA"],
  ["commercial_assistant", "assistente", "FRA"],
  ["franchisor_staff", "rede", "FRA"],
  ["rislife_consultant", "rislife", "FRA"],
  ["finance_franchisor", "financeiro", "FRA"],
  ["purchaser", "comprador", "FRA"],
  // Unidade
  ["receptionist", "recepcao", "CAM"],
  ["clinical_coordinator", "coordenador", "CAM"],
  ["dentist", "dentista", "CAM"],
  ["unit_manager", "gerente", "CAM"],
  ["tsb", "tsb", "CAM"],
  ["asb", "asb", "CAM"],
  ["franchisee", "franqueado", "LON"],
];

const NOMES = {
  sdr: "Encantadora de Teste",
  planner: "Planner de Teste",
  consultor: "Consultor de Teste",
  assistente: "Assistente de Teste",
  rede: "Rede de Teste",
  rislife: "RisLife de Teste",
  financeiro: "Financeiro de Teste",
  comprador: "Comprador de Teste",
  recepcao: "Recepção de Teste",
  coordenador: "Coordenador de Teste",
  dentista: "Dentista de Teste",
  gerente: "Gerente de Teste",
  tsb: "TSB de Teste",
  asb: "ASB de Teste",
  franqueado: "Franqueado de Teste",
};

const PROCEDIMENTOS = [
  ["Consulta de avaliação", "Clínica Geral", 0, "diagnosis", 40],
  ["Restauração em resina 1 face", "Dentística", 28_000, "health", 50],
  ["Restauração em resina 3 faces", "Dentística", 45_000, "health", 70],
  ["Limpeza (profilaxia)", "Periodontia", 18_000, "prevention", 40],
  ["Clareamento a laser", "Estética", 120_000, "aesthetics", 90],
  ["Tratamento de canal", "Endodontia", 95_000, "function", 120],
  ["Coroa de porcelana", "Prótese", 180_000, "function", 60],
];

const ITENS = [
  // nome, unidade de consumo, unidade de compra, quantas vêm na embalagem, fraciona?
  ["Resina composta A2", "grama", "tubo", 4, true],
  ["Adesivo dentinário", "aplicação", "frasco", 20, true],
  ["Anestésico lidocaína 2%", "unidade", "caixa", 50, false],
  ["Sugador descartável", "unidade", "caixa", 100, false],
  ["Luva de procedimento M", "par", "caixa", 50, false],
  ["Gorro descartável", "unidade", "pacote", 100, false],
  ["Babador descartável", "unidade", "pacote", 100, false],
];

async function main() {
  console.log("Semeando o cenário de teste...\n");
  const db = await connect();
  // FECHAR A CONEXÃO MESMO QUANDO DÁ ERRO. Sem isto o programa não termina: uma
  // conexão aberta segura o processo vivo para sempre, e a primeira semeadura
  // que falhou ficou horas pendurada na máquina sem estar fazendo nada.
  try {
    await semear(db);
  } finally {
    await db.end().catch(() => {});
  }
}

async function semear(db) {

  // ---- usuários ------------------------------------------------------------
  // Uma senha POR PAPEL, aleatória, gravada no `.env.test.local`. Senha fixa no
  // código acabaria copiada para algum lugar que não é de teste.
  const senhas = lerOuCriarSenhas();

  const { data: existentes } = await auth.listUsers({ perPage: 200 });
  const porEmail = new Map((existentes?.users ?? []).map((u) => [u.email, u]));

  async function usuario(apelido, nomeCompleto, adminMaster = false) {
    const email = `${apelido}@${dominio}`;
    let user = porEmail.get(email);
    if (!user) {
      const { data, error } = await auth.createUser({
        email,
        password: senhas[email],
        email_confirm: true,
        user_metadata: { full_name: nomeCompleto },
      });
      if (error) throw new Error(`${email}: ${error.message}`);
      user = data.user;
      porEmail.set(email, user);
    }
    // O gatilho `handle_new_user` já criou o perfil; aqui só completamos.
    await db.query(
      `update public.profiles
          set full_name = $2, is_admin_master = $3, is_active = true
        where id = $1`,
      [user.id, nomeCompleto, adminMaster]
    );
    return user.id;
  }

  const adminId = await usuario("admin", "Admin Master de Teste", true);
  // A partir daqui o banco enxerga o Admin Master: as guardas rodam como no app.
  await actAs(db, adminId);
  console.log("  Admin Master pronto — o resto entra com as guardas ligadas.");

  // ---- clínicas ------------------------------------------------------------
  const clinicas = {};
  for (const c of CLINICAS) {
    const { rows } = await db.query(
      "select id from public.clinics where code = $1",
      [c.code]
    );
    if (rows.length) {
      clinicas[c.code] = rows[0].id;
      continue;
    }
    const { rows: nova } = await db.query(
      `insert into public.clinics (code, name, type, ownership, is_active, city, state)
       values ($1, $2, $3, $4, true, $5, 'PR') returning id`,
      [c.code, c.name, c.type, c.ownership, c.name.replace("Risarte ", "")]
    );
    clinicas[c.code] = nova[0].id;
  }
  console.log(`  ${CLINICAS.length} clínicas (1 franqueadora, 1 própria, 1 franqueada).`);

  // ---- um usuário por papel ------------------------------------------------
  for (const [papel, apelido, codigo] of PAPEIS) {
    const id = await usuario(apelido, NOMES[apelido]);
    const escopo = codigo === "FRA" ? "all" : null;
    await db.query(
      `insert into public.user_clinic_roles (user_id, clinic_id, role, unit_scope)
       values ($1, $2, $3::user_role, coalesce($4::unit_scope, 'none'::unit_scope))
       on conflict (user_id, clinic_id) do update set role = excluded.role`,
      [id, clinicas[codigo], papel, escopo]
    );
  }
  console.log(`  ${PAPEIS.length} papéis, um usuário exclusivo para cada.`);

  // ---- catálogo de procedimentos ------------------------------------------
  for (const [nome, especialidade, preco, pilar, minutos] of PROCEDIMENTOS) {
    const { rows } = await db.query(
      "select id from public.procedures where name = $1",
      [nome]
    );
    if (rows.length) continue;
    await db.query(
      `insert into public.procedures
         (code, name, specialty, default_price_cents, pillar, estimated_minutes,
          is_active, direct_sale)
       values (public.next_procedure_code(), $1, $2, $3, $4::methodology_pillar, $5, true, true)`,
      [nome, especialidade, preco, pilar, minutos]
    );
  }
  console.log(`  ${PROCEDIMENTOS.length} procedimentos no catálogo.`);

  // ---- estoque -------------------------------------------------------------
  const itens = {};
  for (const [nome, consumo, compra, porEmbalagem, fraciona] of ITENS) {
    const { rows } = await db.query(
      "select id from public.stock_items where name = $1",
      [nome]
    );
    if (rows.length) {
      itens[nome] = rows[0].id;
      continue;
    }
    const { rows: novo } = await db.query(
      `insert into public.stock_items
         (name, unit_of_measure, purchase_unit, units_per_purchase,
          track_open_package, is_active, created_by)
       values ($1, $2, $3, $4, $5, true, $6) returning id`,
      [nome, consumo, compra, porEmbalagem, fraciona, adminId]
    );
    itens[nome] = novo[0].id;
  }
  console.log(`  ${ITENS.length} itens de estoque (2 fracionados, 5 inteiros).`);

  // Kit de PROCEDIMENTO: o que a restauração gasta. É ele que faz a baixa
  // automática acontecer na conclusão da sessão (E3).
  const { rows: restauracao } = await db.query(
    "select id from public.procedures where name = 'Restauração em resina 1 face'"
  );
  await kit(db, {
    clinicId: null, // padrão da REDE — a unidade herda
    nome: "Kit restauração em resina",
    kind: "procedimento",
    itens: [
      [itens["Resina composta A2"], 0.2],
      [itens["Adesivo dentinário"], 1],
      [itens["Anestésico lidocaína 2%"], 1],
      [itens["Sugador descartável"], 2],
      [itens["Luva de procedimento M"], 1],
    ],
    procedimentos: restauracao.map((r) => r.id),
  });

  // Kit de ATENDIMENTO: o que o PACIENTE usa, uma vez por consulta — quem faz
  // três procedimentos no mesmo dia não usa três gorros.
  await kit(db, {
    clinicId: null,
    nome: "Kit de atendimento (paciente)",
    kind: "atendimento",
    itens: [
      [itens["Gorro descartável"], 1],
      [itens["Babador descartável"], 1],
    ],
    procedimentos: [],
  });
  console.log("  2 kits: um de procedimento e um de atendimento.");

  // ---- agenda das unidades -------------------------------------------------
  // SEM SALA NÃO SE AGENDA, e sem agendamento não existe atendimento, venda
  // direta nem baixa de estoque. A unidade nascia sem salas e o cenário parecia
  // completo até alguém tentar marcar a primeira consulta.
  for (const codigo of ["CAM", "LON"]) {
    // A CLÍNICA DE TESTE NÃO TEM HORÁRIO COMERCIAL, de propósito. Com 08h–18h,
    // o teste do fluxo clínico só passaria de dia: à noite a lista de horários
    // livres vem vazia e o agendamento não acontece — o sistema certíssimo, o
    // teste refém do relógio. Aqui a agenda abre todos os dias, o dia inteiro.
    await db.query(
      `insert into public.clinic_agenda_settings
         (clinic_id, chairs, open_time, close_time, weekdays)
       values ($1, 3, '00:00', '23:59', '{0,1,2,3,4,5,6}')
       on conflict (clinic_id) do update
         set open_time = '00:00', close_time = '23:59',
             weekdays = '{0,1,2,3,4,5,6}'`,
      [clinicas[codigo]]
    );
    for (const [i, nome] of ["Sala 1", "Sala 2", "Sala 3"].entries()) {
      await db.query(
        `insert into public.clinic_rooms (clinic_id, name, sort_order, is_active)
         select $1, $2, $3, true
          where not exists (
            select 1 from public.clinic_rooms
             where clinic_id = $1 and name = $2 and deleted_at is null)`,
        [clinicas[codigo], nome, i]
      );
    }
  }
  console.log("  Agenda configurada: 3 salas em cada unidade.");

  // ---- fornecedores --------------------------------------------------------
  for (const codigo of ["CAM", "LON"]) {
    for (const [nome, doc] of [
      ["Dental Teste Distribuidora", "11222333000181"],
      ["Suprimentos Odonto Teste", "44555666000172"],
    ]) {
      await db.query(
        `insert into public.suppliers (clinic_id, name, document, kind, active, created_by)
         select $1, $2, $3, 'dental', true, $4
          where not exists (
            select 1 from public.suppliers where clinic_id = $1 and name = $2)`,
        [clinicas[codigo], nome, doc, adminId]
      );
    }
  }
  console.log("  2 fornecedores em cada unidade.");

  await semearEmpresarial(db, clinicas);

  console.log(
    `\nPronto. CADA PAPEL TEM A SUA SENHA, gravadas em .env.test.local ` +
      `(TEST_USER_PASSWORDS). Para ver a lista: npm run senhas:treino`
  );
}

/** Grava o kit pela porta oficial — a mesma que a tela usa. */
async function kit(db, { clinicId, nome, kind, itens, procedimentos }) {
  const { rows } = await db.query(
    `select id from public.stock_kits
      where name = $1 and clinic_id is not distinct from $2`,
    [nome, clinicId]
  );
  await db.query(
    `select public.save_stock_kit($1, $2, $3, null, $4::jsonb, $5::uuid[], true, $6)`,
    [
      rows[0]?.id ?? null,
      clinicId,
      nome,
      // A chave é `itemId`, em camelo: é assim que a tela manda, e o SQL lê
      // `v_item->>'itemId'`. Com o nome errado o item entra nulo e o banco
      // recusa — que é o comportamento certo, mas custa a viagem.
      JSON.stringify(
        itens.map(([itemId, quantity]) => ({ itemId, quantity }))
      ),
      procedimentos,
      kind,
    ]
  );
}

/**
 * O RISARTE EMPRESARIAL — duas empresas, gente dentro.
 *
 * ⚠️ ACRESCENTADO EM 11/09/2026, e a razão é um estrago meu. A limpeza da suíte
 * apagava o cadastro do Empresarial (o `truncate cascade` que atravessava
 * schema) e o seed não sabia recriá-lo: o módulo ficava vazio depois de todo
 * `reset`, e o teste de boas-vindas tinha de montar o próprio cenário. Cenário
 * que só um teste sabe montar é cenário que ninguém mais consegue usar.
 *
 * ⚠️ AS DUAS EMPRESAS SÃO DIFERENTES DE PROPÓSITO, porque a tela de boas-vindas
 * tem dois estados e um cenário com um só deles esconde metade dos defeitos:
 *
 *   - **Bom Sabor** entrou há 6 meses e não tem carência: todo mundo aparece
 *     como "Pode agendar".
 *   - **Nova Era** assinou ontem, com 30 dias de carência de empresa e 15 do
 *     colaborador: todo mundo aparece como "Carência até …".
 *
 * E a mistura de cadastro é igualmente deliberada: gente com ficha de paciente
 * ligada e gente ainda pré-cadastrada, que é justamente quem a recepção precisa
 * chamar. Um cenário só com cadastro completo mostraria a tela sempre limpa.
 */
const EMPRESAS_DO_PROGRAMA = [
  {
    cnpj: "11222333000181",
    legal_name: "Bom Sabor Alimentos LTDA",
    trade_name: "Bom Sabor",
    // Contrato antigo e sem carência: pessoal liberado para agendar.
    mesesDeContrato: 6,
    grace_period_days: 0,
    employee_grace_period_days: 0,
    pessoas: [
      {
        cpf: "52998224725",
        nome: "Marina AlvesPrado",
        fone: "43999110011",
        unidade: "CAM",
        cadastro: "COMPLETED",
        comFicha: true,
        dependentes: [
          { cpf: "16899535009", nome: "Théo Alves Prado", parentesco: "CHILD" },
          { cpf: "40532176871", nome: "Rita Alves", parentesco: "SPOUSE" },
        ],
      },
      {
        cpf: "22233344456",
        nome: "Joaquim Bezerra Lima",
        fone: "43999220022",
        unidade: "CAM",
        // ⚠️ Sem ficha de paciente: é quem a recepção PRECISA chamar, porque
        // sem ficha não há como agendar. A tela mostra isso na coluna do que
        // falta.
        cadastro: "PRE_REGISTERED",
        comFicha: false,
        dependentes: [],
      },
      {
        cpf: "33344455567",
        nome: "Cláudia Moreira Sato",
        fone: "43999330033",
        unidade: "LON",
        cadastro: "PRE_REGISTERED",
        comFicha: false,
        dependentes: [
          { cpf: "44455566678", nome: null, parentesco: "CHILD" },
        ],
      },
    ],
  },
  {
    cnpj: "44555666000172",
    legal_name: "Nova Era Serviços ME",
    trade_name: "Nova Era",
    // Assinou ontem: a carência ainda corre para todo mundo.
    diasDeContrato: 1,
    grace_period_days: 30,
    employee_grace_period_days: 15,
    pessoas: [
      {
        cpf: "55566677789",
        nome: "Rafael Toledo Pires",
        fone: "43999440044",
        unidade: "CAM",
        cadastro: "PRE_REGISTERED",
        comFicha: false,
        dependentes: [],
      },
      {
        cpf: "66677788890",
        nome: "Sônia Braga Nunes",
        fone: "43999550055",
        unidade: "LON",
        cadastro: "COMPLETED",
        comFicha: true,
        dependentes: [
          { cpf: "77788899901", nome: "Ivo Braga", parentesco: "PARENT" },
        ],
      },
    ],
  },
];

async function semearEmpresarial(db, clinicas) {
  let empresas = 0;
  let pessoas = 0;
  let dependentes = 0;

  for (const e of EMPRESAS_DO_PROGRAMA) {
    // Idempotente pelo CNPJ, como o resto do seed: rodar de novo completa o que
    // falta em vez de duplicar.
    let { rows } = await db.query(
      "select id from empresarial.companies where cnpj = $1",
      [e.cnpj]
    );
    if (rows.length === 0) {
      const inicio = e.mesesDeContrato
        ? `now() - interval '${e.mesesDeContrato} months'`
        : `now() - interval '${e.diasDeContrato ?? 1} days'`;
      ({ rows } = await db.query(
        `insert into empresarial.companies
           (cnpj, legal_name, trade_name, contract_started_at,
            grace_period_days, employee_grace_period_days)
         values ($1, $2, $3, ${inicio}, $4, $5)
         returning id`,
        [
          e.cnpj,
          e.legal_name,
          e.trade_name,
          e.grace_period_days,
          e.employee_grace_period_days,
        ]
      ));
      empresas++;
    }
    const companyId = rows[0].id;

    for (const p of e.pessoas) {
      const { rows: jaTem } = await db.query(
        "select id from empresarial.employees where company_id = $1 and cpf = $2",
        [companyId, p.cpf]
      );
      let employeeId = jaTem[0]?.id;

      if (!employeeId) {
        // A ficha de paciente, quando a pessoa já foi cadastrada de verdade.
        // É ela que separa "dá para agendar" de "ainda precisa de cadastro".
        let clientId = null;
        if (p.comFicha) {
          // ⚠️ PROCURA ANTES DE INSERIR, sem `on conflict`. O CPF do paciente
          // NÃO é único sozinho na tabela — o mesmo CPF pode existir em
          // unidades diferentes, que é como a rede compartilha um cliente. Um
          // `on conflict (cpf)` foi recusado pelo banco na primeira tentativa,
          // e a recusa estava certa.
          const { rows: existente } = await db.query(
            "select id from public.clients where cpf = $1 limit 1",
            [p.cpf]
          );
          if (existente.length) {
            clientId = existente[0].id;
          } else {
            const { rows: ficha } = await db.query(
              `insert into public.clients
                 (clinic_id, full_name, cpf, empresarial_company_id)
               values ($1, $2, $3, $4) returning id`,
              [clinicas[p.unidade], p.nome, p.cpf, companyId]
            );
            clientId = ficha[0].id;
          }
        }

        const { rows: novo } = await db.query(
          `insert into empresarial.employees
             (company_id, cpf, full_name, phone, status, registration_stage,
              dependent_plan, joined_at, clinic_id, client_id)
           values ($1, $2, $3, $4, 'ACTIVE', $5, $6,
                   now() - interval '2 days', $7, $8)
           returning id`,
          [
            companyId,
            p.cpf,
            p.nome,
            p.fone,
            p.cadastro,
            p.dependentes.length ? "FAMILY" : "NONE",
            clinicas[p.unidade],
            clientId,
          ]
        );
        employeeId = novo[0].id;
        pessoas++;
      }

      for (const d of p.dependentes) {
        const { rows: temDep } = await db.query(
          "select id from empresarial.dependents where employee_id = $1 and cpf = $2",
          [employeeId, d.cpf]
        );
        if (temDep.length) continue;
        await db.query(
          `insert into empresarial.dependents
             (employee_id, cpf, full_name, relationship, status, clinic_id)
           values ($1, $2, $3, $4, 'ACTIVE', $5)`,
          // ⚠️ Um dependente SEM NOME de propósito (o filho da Cláudia): é o
          // cadastro pela metade que a recepção tem de completar na ligação, e
          // a tela precisa saber mostrar isso sem quebrar.
          [employeeId, d.cpf, d.nome, d.parentesco, clinicas[p.unidade]]
        );
        dependentes++;
      }
    }
  }

  console.log(
    `  Empresarial: ${EMPRESAS_DO_PROGRAMA.length} empresas ` +
      `(${empresas} criada(s) agora), ${pessoas} colaborador(es) e ` +
      `${dependentes} dependente(s) novos — uma empresa em carência, outra liberada.`
  );
}

/**
 * UMA SENHA POR PAPEL — e não uma para todos (decisão do dono, 31/08/2026).
 *
 * O ambiente de treino ficou aberto na internet, e senha única tem um efeito
 * que só aparece no uso: a primeira pessoa que percebe o padrão entra como
 * gerente, como financeiro, como quem quiser. Não por má intenção — por
 * curiosidade. E aí ela treina no papel errado, ou vê número que não é dela.
 *
 * Com uma senha por papel, quem recebeu a da recepção só entra na recepção.
 *
 * Ficam guardadas em `.env.test.local` (fora do Git) numa linha só, em JSON,
 * porque o leitor de ambiente parte cada linha no primeiro `=`.
 */
function lerOuCriarSenhas() {
  const arquivo = ".env.test.local";
  const texto = readFileSync(arquivo, "utf8");
  const achada = texto.match(/^TEST_USER_PASSWORDS=(.+)$/m);
  const mapa = achada ? JSON.parse(achada[1].trim()) : {};

  // Só completa o que falta: papel novo no cenário ganha senha própria sem
  // mexer nas que já foram distribuídas para a equipe.
  const apelidos = ["admin", ...PAPEIS.map(([, apelido]) => apelido)];
  let mudou = false;
  for (const apelido of apelidos) {
    const email = `${apelido}@${dominio}`;
    if (!mapa[email]) {
      mapa[email] = `Treino-${apelido}-${randomBytes(6).toString("base64url")}`;
      mudou = true;
    }
  }

  if (mudou) {
    const linha = `TEST_USER_PASSWORDS=${JSON.stringify(mapa)}`;
    if (achada) {
      writeFileSync(
        arquivo,
        texto.replace(/^TEST_USER_PASSWORDS=.+$/m, linha),
        "utf8"
      );
    } else {
      appendFileSync(arquivo, `\n${linha}\n`, "utf8");
    }
  }
  return mapa;
}

main().catch((e) => {
  console.error("\nErro ao semear:", e.message);
  process.exitCode = 1;
});
