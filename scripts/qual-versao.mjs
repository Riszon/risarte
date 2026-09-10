/**
 * QUAL VERSÃO ESTÁ NO AR — e a régua GRITA quando não consegue medir.
 *
 * Três vezes neste projeto um script destes respondeu "não publicou" quando o
 * que houve foi "não consegui olhar" (CLAUDE.md §0d). Por isso aqui:
 *
 *   - se a página não trouxer NENHUM "Versão x.y.z", é ERRO, não "versão velha";
 *   - a versão sai impressa, para a conclusão ser lida por gente.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.RISARTE_URL;
const ENV_FILE = process.env.RISARTE_ENV_FILE;
const EMAIL = process.env.RISARTE_EMAIL;
if (!BASE || !ENV_FILE || !EMAIL) {
  throw new Error("faltam RISARTE_URL, RISARTE_ENV_FILE e RISARTE_EMAIL");
}

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .replace(new RegExp("^\\uFEFF"), "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (error) throw new Error(`link de acesso: ${error.message}`);

const jar = new Map();
const ssr = createServerClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)),
    },
  }
);
const { error: otpError } = await ssr.auth.verifyOtp({
  token_hash: data.properties.hashed_token,
  type: "email",
});
if (otpError) throw new Error(`sessão: ${otpError.message}`);
if (jar.size === 0) throw new Error("sessão criada sem cookie");

const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
const res = await fetch(BASE + "/", {
  headers: { cookie, "user-agent": "risarte-qual-versao" },
  redirect: "manual",
});
const html = await res.text();

// ⚠️ O REACT PARTE O TEXTO. `Versão {APP_VERSION}` não sai como uma frase: o
// servidor separa o texto fixo do valor com um comentário vazio (`<!-- -->`),
// para saber onde recolar na hidratação. Procurar a frase inteira não acha
// nada — e "não achei" viraria "não publicou", que é o erro do §0d.
const achou = html.match(/Vers(?:ão|&#227;o)\s*(?:<!--\s*-->\s*)?([0-9]+\.[0-9]+\.[0-9]+)/);
if (!achou) {
  throw new Error(
    `RÉGUA VAZIA: nenhum "Versão x.y.z" no HTML de ${BASE}/ ` +
      `(status ${res.status}, ${html.length} bytes). Não sei dizer qual versão está no ar.` +
      `\nTrecho com "Vers": ${JSON.stringify(
        html.slice(Math.max(0, html.indexOf("Vers") - 40), html.indexOf("Vers") + 120)
      )}`
  );
}
// ⚠️ E A VERSÃO DO EMPRESARIAL TAMBÉM, porque ela é a ÚNICA que se move numa
// entrega daquele projeto.
//
// Achado em 10/09/2026, medindo o próprio erro: publiquei a tela de cobranças
// do Empresarial, perguntei a esta régua se tinha subido, e ela respondeu
// "0.241.0" — a versão do core, que a entrega não bumpa por regra (§0 do
// CLAUDE.md: cada projeto mexe só nas SUAS duas linhas). A resposta estava
// certa e não servia para a pergunta, que é a forma mais convincente de uma
// régua enganar: ela não falha, ela responde outra coisa.
const empresarial = html.match(
  /Empresarial\s*(?:<!--\s*-->\s*)?([0-9]+\.[0-9]+\.[0-9]+)/
);
if (!empresarial) {
  throw new Error(
    `RÉGUA VAZIA: achei a versão do core (${achou[1]}) mas nenhuma "Empresarial x.y.z". ` +
      `Entrega do Empresarial não move a versão do core, então sem este número eu ` +
      `não sei dizer se ela subiu.`
  );
}
console.log(
  `${BASE} está com a versão ${achou[1]} (core) · ${empresarial[1]} (Empresarial)`
);
