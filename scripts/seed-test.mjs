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
import { appendFileSync, readFileSync } from "node:fs";
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
  // A senha nasce aleatória e vai para o `.env.test.local`. Senha fixa no
  // código acabaria copiada para algum lugar que não é de teste.
  const senha = lerOuCriarSenha();

  const { data: existentes } = await auth.listUsers({ perPage: 200 });
  const porEmail = new Map((existentes?.users ?? []).map((u) => [u.email, u]));

  async function usuario(apelido, nomeCompleto, adminMaster = false) {
    const email = `${apelido}@${dominio}`;
    let user = porEmail.get(email);
    if (!user) {
      const { data, error } = await auth.createUser({
        email,
        password: senha,
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

  console.log(
    `\nPronto. Entre no sistema de teste com admin@${dominio} e a senha ` +
      `gravada em .env.test.local (TEST_USER_PASSWORD). Todos os usuários ` +
      `usam a MESMA senha.`
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

/** Senha única para os usuários de teste, gerada uma vez e reaproveitada. */
function lerOuCriarSenha() {
  const arquivo = ".env.test.local";
  const texto = readFileSync(arquivo, "utf8");
  const achada = texto.match(/^TEST_USER_PASSWORD=(.+)$/m);
  if (achada) return achada[1].trim();
  const nova = "Teste-" + randomBytes(9).toString("base64url");
  appendFileSync(arquivo, `\nTEST_USER_PASSWORD=${nova}\n`, "utf8");
  return nova;
}

main().catch((e) => {
  console.error("\nErro ao semear:", e.message);
  process.exitCode = 1;
});
