// AS CONTAS DE TESTE DO ASAAS (ASA0) — só SANDBOX, só banco de TREINO.
//
// No sandbox, a conta raiz representa a franqueadora. Este roteiro:
//   1. registra a conta raiz na franqueadora "RISARTE Franchising" do treino;
//   2. cria no sandbox três subcontas (Londrina, Cambé e RisLife) e as
//      registra como contas VINCULADAS — pelas mesmas funções do banco que a
//      Central usa (`gateway_create_account`, `_gateway_store_credentials`).
// O webhook, as tarifas e as conferências NÃO são feitos aqui: são do próprio
// riSZon (botões "Criar o webhook" e "Verificar agora" da Central), para o
// teste exercitar o caminho real.
//
//   node scripts/asaas-sandbox-contas.mjs --confirmar
//   node scripts/asaas-sandbox-contas.mjs --evento londrina --confirmar
//       cria uma cobrança PIX de R$ 5,00 de teste na conta, para ver o
//       evento chegar pelo webhook.
//
// TRAVAS (o roteiro RECUSA em qualquer outro caso):
//   * a chave tem de começar com `$aact_hmlg_` e o endereço tem de ser o do
//     sandbox (`https://api-sandbox.asaas.com/v3`);
//   * o banco tem de ser o de treino (`scripts/test-db.mjs` recusa a produção);
//   * exige `--confirmar`.
// A chave vem de `ASAAS_API_KEY` no `.env.local` (escrita com `\$` na frente,
// por causa do Next) e NUNCA é impressa. As chaves das subcontas vão direto
// para o Vault e também nunca são impressas. A saída só tem nomes de conta,
// identificadores de carteira e contagens.
//
// A criação de subconta fica DESLIGADA no produto (D2): só este roteiro, no
// sandbox, a usa.
import { readFileSync } from "node:fs";
import { connect, actAs } from "./test-db.mjs";

const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const PREFIXO_SANDBOX = "$aact_hmlg_";
const USER_AGENT = "riSZon (Risarte Odontologia) - roteiro de teste";
const FRANQUEADORA = "RISARTE Franchising";

const args = process.argv.slice(2);
const evento = args.includes("--evento") ? (args[args.indexOf("--evento") + 1] ?? "").toLowerCase() : null;

if (!args.includes("--confirmar")) {
  console.log(
    [
      "Este roteiro cria contas de TESTE no sandbox do Asaas e grava no banco de TREINO.",
      "Para rodar:",
      "  node scripts/asaas-sandbox-contas.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

// ---- a chave e o endereço: só do .env.local, só sandbox ----------------------
function lerEnvLocal() {
  const env = {};
  for (const linha of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = linha.indexOf("=");
    if (i < 1 || linha.trim().startsWith("#")) continue;
    let v = linha.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    // No .env.local o cifrão vem com barra invertida (`\$aact_…`), senão o Next
    // o trata como variável. Aqui a barra sai.
    env[linha.slice(0, i).trim()] = v.replace(/\\\$/g, "$");
  }
  return env;
}

const envLocal = lerEnvLocal();
const CHAVE_RAIZ = envLocal.ASAAS_API_KEY ?? "";
const BASE_URL = (envLocal.ASAAS_BASE_URL ?? "").replace(/\/+$/, "");

if (!CHAVE_RAIZ) {
  console.error("RECUSADO: falta ASAAS_API_KEY no .env.local.");
  process.exit(1);
}
if (!CHAVE_RAIZ.startsWith(PREFIXO_SANDBOX)) {
  console.error("RECUSADO: a chave em ASAAS_API_KEY não é de SANDBOX. Este roteiro nunca usa chave de produção.");
  process.exit(1);
}
if (BASE_URL !== SANDBOX_URL) {
  console.error(`RECUSADO: ASAAS_BASE_URL tem de ser exatamente ${SANDBOX_URL}.`);
  process.exit(1);
}

// ---- o Asaas ---------------------------------------------------------------------
async function asaas(chave, metodo, caminho, corpo) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), 30_000);
  let res;
  try {
    res = await fetch(`${SANDBOX_URL}${caminho}`, {
      method: metodo,
      headers: { access_token: chave, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controle.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(relogio);
  }
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    // Só os códigos e as descrições de erro do Asaas — nunca o corpo enviado.
    const erros = Array.isArray(json?.errors) ? json.errors.map((e) => `${e.code}: ${e.description}`).join(" | ") : "";
    throw new Error(`Asaas ${metodo} ${caminho.split("?")[0]} -> ${res.status} ${erros}`.trim());
  }
  return json;
}

// ---- documentos de mentira, válidos no dígito ------------------------------------
function cnpjDeTeste() {
  const n = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (base, pesos) => {
    const resto = base.reduce((s, d, i) => s + d * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...n, d1, d2].join("");
}
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base) => {
    const resto = (base.reduce((s, d, i) => s + d * (base.length + 1 - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

// Nomes SEM dígito nem símbolo: no sandbox, nome com eles trava a aprovação.
const SUBCONTAS = [
  { chave: "londrina", nome: "Risarte Londrina Teste", unidade: "Risarte Londrina - Centro", tipo: "unit" },
  { chave: "cambe", nome: "Risarte Cambe Teste", unidade: "Risarte Cambé - Centro", tipo: "unit" },
  { chave: "rislife", nome: "RisLife Teste", unidade: null, tipo: "recipient" },
];

const c = await connect();
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];

try {
  const admin = (await um("select id from public.profiles where email = 'admin@example.com' and is_admin_master"))?.id;
  if (!admin) throw new Error("NÃO RODEI: não achei o Admin Master de teste (admin@example.com) no treino.");
  if (!(await um("select to_regclass('public.gateway_accounts') as t")).t) {
    throw new Error("NÃO RODEI: o treino ainda não tem as migrações 4000 a 4002 (rode npm run migrar:teste).");
  }

  const comoAdmin = async () => actAs(c, admin);
  const comoServidor = async () => c.query("select set_config('request.jwt.claims', '', false)");

  /** A conta em uso desta unidade (ou carteira, pelo rótulo). */
  const contaExistente = (clinicId, rotulo) =>
    clinicId
      ? um("select id, api_key_secret_id is not null as tem_chave, webhook_ref from public.gateway_accounts where clinic_id = $1 and environment = 'sandbox' and status <> 'disabled'", [clinicId])
      : um("select id, api_key_secret_id is not null as tem_chave, webhook_ref from public.gateway_accounts where owner_type = 'recipient' and label = $1 and environment = 'sandbox' and status <> 'disabled'", [rotulo]);

  async function abrirCadastro(clinicId, tipo, rotulo) {
    const ja = await contaExistente(clinicId, rotulo);
    if (ja) return ja;
    await comoAdmin();
    const id = (await um("select public.gateway_create_account($1, $2, $3, null, 'sandbox') as id", [clinicId, tipo, rotulo])).id;
    await comoServidor();
    return { id, tem_chave: false };
  }

  async function guardar(contaId, chave) {
    const [carteiras, info, situacao] = await Promise.all([
      asaas(chave, "GET", "/wallets/"),
      asaas(chave, "GET", "/myAccount/commercialInfo/"),
      asaas(chave, "GET", "/myAccount/status/"),
    ]);
    const wallet = carteiras?.data?.[0]?.id;
    if (!wallet) throw new Error("o Asaas não devolveu a carteira da conta");
    await comoServidor();
    await c.query(
      "select public._gateway_store_credentials($1, null, $2, $3, $4, $5, $6, $7::jsonb, null)",
      [
        contaId, chave, wallet, situacao?.id ?? null, info?.name ?? null, info?.cpfCnpj ?? null,
        JSON.stringify({
          general: situacao?.general ?? null,
          commercialInfo: situacao?.commercialInfo ?? null,
          bankAccountInfo: situacao?.bankAccountInfo ?? null,
          documentation: situacao?.documentation ?? null,
        }),
      ]
    );
    return wallet;
  }

  // ---- modo chave Pix: cria uma chave aleatória em cada conta de teste -----------
  // (item de prontidão; nas contas reais quem cadastra é o dono, no painel.)
  if (args.includes("--chave-pix")) {
    await comoServidor();
    const contas = (
      await c.query(
        "select id, label from public.gateway_accounts where environment = 'sandbox' and status = 'active' and api_key_secret_id is not null and owner_type <> 'recipient' order by created_at"
      )
    ).rows;
    if (contas.length === 0) throw new Error("NÃO RODEI: nenhuma conta de teste registrada.");
    for (const conta of contas) {
      const chave = (await um("select api_key from public._gateway_read_key($1, 'sandbox_pix_key', null)", [conta.id])).api_key;
      const ativas = await asaas(chave, "GET", "/pix/addressKeys?status=ACTIVE&limit=1");
      if ((ativas?.data ?? []).length > 0) {
        console.log(`${conta.label}: já tem chave Pix ativa.`);
        continue;
      }
      const criada = await asaas(chave, "POST", "/pix/addressKeys", { type: "EVP" });
      console.log(`${conta.label}: chave Pix aleatória criada (situação ${criada?.status ?? "?"}).`);
    }
    console.log("\nUse 'Verificar agora' na Central para o riSZon enxergar as chaves.");
  } else if (evento) {
    const alvo = SUBCONTAS.find((s) => s.chave === evento && s.tipo === "unit");
    if (!alvo) throw new Error(`Conta desconhecida para --evento: use ${SUBCONTAS.filter((s) => s.tipo === "unit").map((s) => s.chave).join(" ou ")}.`);
    const unidade = (await um("select id from public.clinics where name = $1", [alvo.unidade]))?.id;
    const conta = unidade ? await contaExistente(unidade, null) : null;
    if (!conta?.tem_chave) throw new Error("NÃO RODEI: esta conta ainda não foi registrada (rode o roteiro sem --evento primeiro).");
    await comoServidor();
    const chave = (await um("select api_key from public._gateway_read_key($1, 'sandbox_test_event', null)", [conta.id])).api_key;
    const cliente = await asaas(chave, "POST", "/customers", { name: "Cliente de Teste do riSZon", cpfCnpj: cpfDeTeste(), notificationDisabled: true });
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const cobranca = await asaas(chave, "POST", "/payments", {
      customer: cliente.id,
      billingType: "PIX",
      value: 5,
      dueDate: amanha,
      description: "Cobrança de teste do webhook (riSZon ASA0)",
      externalReference: `riszon-asa0-${Date.now()}`,
    });
    const eventos = (await um("select count(*)::int n from public.gateway_webhook_events where account_id = $1", [conta.id])).n;
    console.log(`\nCobrança de teste criada na conta "${alvo.nome}" (situação ${cobranca.status}).`);
    console.log(`Eventos já recebidos desta conta antes: ${eventos}.`);
    console.log("Em alguns segundos o Asaas chama o webhook: confira 'Último evento recebido' na Central.");
  } else {
    // ---- 1) a conta raiz ------------------------------------------------------
    const franqueadora = (await um("select id from public.clinics where name = $1 and type = 'franchisor'", [FRANQUEADORA]))?.id;
    if (!franqueadora) throw new Error(`NÃO RODEI: não achei a franqueadora "${FRANQUEADORA}" no treino.`);
    const raiz = await abrirCadastro(franqueadora, "franchisor", "Risarte Administração (teste)");
    if (raiz.tem_chave) {
      console.log("Conta raiz: já registrada (nada a fazer).");
    } else {
      const wallet = await guardar(raiz.id, CHAVE_RAIZ);
      console.log(`Conta raiz: registrada. Carteira ${wallet}.`);
    }

    // ---- 2) as três subcontas ----------------------------------------------------
    for (const s of SUBCONTAS) {
      const unidade = s.unidade ? (await um("select id from public.clinics where name = $1", [s.unidade]))?.id : null;
      if (s.unidade && !unidade) throw new Error(`NÃO RODEI: não achei a unidade "${s.unidade}" no treino.`);
      const conta = await abrirCadastro(unidade, s.tipo, s.nome);
      if (conta.tem_chave) {
        console.log(`${s.nome}: já registrada (nada a fazer).`);
        continue;
      }
      const criada = await asaas(CHAVE_RAIZ, "POST", "/accounts", {
        name: s.nome,
        email: `riszon.teste.${s.chave}.${Date.now().toString(36)}@example.com`,
        cpfCnpj: cnpjDeTeste(),
        companyType: "LIMITED",
        mobilePhone: "43999990001",
        incomeValue: 50000,
        address: "Avenida Paulista",
        addressNumber: "1000",
        province: "Bela Vista",
        postalCode: "01310100",
      });
      // A documentação diverge sobre onde vem a chave: lê dos dois lugares.
      const chave = criada?.apiKey ?? criada?.accessToken?.apiKey;
      if (!chave) throw new Error(`${s.nome}: o Asaas criou a subconta mas não devolveu a chave.`);
      const wallet = await guardar(conta.id, chave);
      console.log(`${s.nome}: subconta criada e registrada como vinculada. Carteira ${wallet}.`);
    }

    const total = (await um("select count(*)::int n from public.gateway_accounts where environment = 'sandbox' and status = 'active'")).n;
    console.log(`\n${total} conta(s) de teste ativas no treino.`);
    console.log("Próximo passo, na Central (no endereço publicado): 'Criar o webhook' e 'Verificar agora' em cada conta.");
  }
} catch (e) {
  console.error(`\nFALHOU: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
