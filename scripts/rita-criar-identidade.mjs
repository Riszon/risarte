// Cria (ou confere) a identidade técnica da Rita — a assistente virtual de SDR —
// num banco. Fase 0A.1 (docs/sdr/PLANO-FASE-0A.md, DA2).
//
// O que faz:
//   1. Um login em `auth.users` com e-mail `rita@risarte.local`, SEM SENHA e com
//      o login BLOQUEADO (ban de 100 anos): ninguém entra no sistema como ela.
//   2. O perfil dela vira `full_name = 'Rita (assistente virtual)'` e
//      `kind = 'agent'` (0365). Nenhuma função em unidade nenhuma: pela regra de
//      linha (RLS) ela não lê nada. Ela é só AUTORA — a auditoria e as funções
//      `rita.*` (3000+) usam o id dela.
//
// ⚠️ `auth.users` é território comum (o Risarte Academy usa os mesmos logins na
// produção). Este roteiro só ACRESCENTA um login; não apaga nem muda ninguém.
//
// Uso (o banco vem do arquivo de ambiente; sem --confirmar, só mostra o que faria):
//   RISARTE_ENV_FILE=.env.test.local node scripts/rita-criar-identidade.mjs             (treino, conferir)
//   RISARTE_ENV_FILE=.env.test.local node scripts/rita-criar-identidade.mjs --confirmar (treino, criar)
//   node scripts/rita-criar-identidade.mjs --confirmar                                  (produção: .env.local)
//
// Rodar de novo é seguro: se a Rita já existe, só confere e diz o id.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "rita@risarte.local";
const NOME = "Rita (assistente virtual)";
const CONFIRMAR = process.argv.includes("--confirmar");

const ENV_FILE = process.env.RISARTE_ENV_FILE || ".env.local";
const MARCA_DE_BOM = new RegExp("^\\uFEFF");
const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .replace(MARCA_DE_BOM, "")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(`ERRO: ${ENV_FILE} sem NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
const projeto = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function falhar(passo, erro) {
  // Só o código do erro: a mensagem pode trazer dado de alguém.
  console.error(`ERRO ao ${passo}: ${erro?.code ?? erro?.status ?? "sem código"}`);
  process.exit(1);
}

console.log(`Banco: ${projeto} (arquivo ${ENV_FILE})`);

// A 0365 rodou? Sem a coluna, não há como marcar a assistente.
{
  const { error } = await db.from("profiles").select("kind").limit(1);
  if (error) {
    console.error("ERRO: a coluna profiles.kind não existe — rode a 0365 neste banco antes.");
    process.exit(1);
  }
}

// Já existe uma assistente?
const { data: agentes, error: erroAgentes } = await db
  .from("profiles")
  .select("id, email, full_name, is_active")
  .eq("kind", "agent");
if (erroAgentes) falhar("procurar a assistente", erroAgentes);
if ((agentes ?? []).length > 0) {
  const a = agentes[0];
  console.log(`A Rita já existe neste banco: ${a.id} (${a.full_name}).`);
  process.exit(0);
}

// Existe o login pelo e-mail (de uma rodada que parou no meio)?
const { data: porEmail, error: erroEmail } = await db
  .from("profiles")
  .select("id")
  .eq("email", EMAIL)
  .maybeSingle();
if (erroEmail) falhar("procurar o login pelo e-mail", erroEmail);

if (!CONFIRMAR) {
  console.log(
    porEmail
      ? `Faria: marcar o perfil ${porEmail.id} como a assistente e bloquear o login.`
      : `Faria: criar o login ${EMAIL} sem senha, bloqueado, e marcar o perfil como a assistente.`
  );
  console.log("Nada gravado. Rode de novo com --confirmar.");
  process.exit(0);
}

let id = porEmail?.id ?? null;
if (!id) {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    user_metadata: { full_name: NOME },
  });
  if (error || !data?.user) falhar("criar o login", error);
  id = data.user.id;
}

// Login bloqueado (como "desativar" faz com uma pessoa).
{
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (error) falhar("bloquear o login", error);
}

// O perfil: nome e tipo. O gatilho da 0365 só deixa a chave de serviço mudar o tipo.
{
  const { error } = await db
    .from("profiles")
    .update({ full_name: NOME, kind: "agent" })
    .eq("id", id);
  if (error) falhar("marcar o perfil como assistente", error);
}

// Conferência: o que o banco diz agora.
const { data: conferido, error: erroConf } = await db
  .from("profiles")
  .select("id, full_name, kind")
  .eq("id", id)
  .single();
if (erroConf) falhar("conferir o perfil", erroConf);
const { count: funcoes, error: erroFuncoes } = await db
  .from("user_clinic_roles_all")
  .select("user_id", { count: "exact", head: true })
  .eq("user_id", id);
if (erroFuncoes) falhar("conferir as funções", erroFuncoes);

if (conferido.kind !== "agent" || conferido.full_name !== NOME || funcoes !== 0) {
  console.error(
    `ERRO: o perfil não ficou como devia (tipo ${conferido.kind}, funções ${funcoes}).`
  );
  process.exit(1);
}
console.log(`Pronto. A Rita é ${id}: "${NOME}", tipo assistente, login bloqueado, 0 funções.`);
