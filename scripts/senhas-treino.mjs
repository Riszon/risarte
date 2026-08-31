// SENHAS DO AMBIENTE DE TREINO — uma por papel.
//
// POR QUE UMA POR PAPEL, e não uma para todos (decisão do dono, 31/08/2026):
// o treino fica aberto na internet, e senha única tem um efeito que só aparece
// no uso. A primeira pessoa que percebe o padrão entra como gerente, como
// financeiro, como quem quiser — não por má intenção, por curiosidade. E aí
// treina no papel errado, ou vê número que não é dela. Com uma senha por papel,
// quem recebeu a da recepção entra na recepção.
//
// As senhas ficam em `.env.test.local` (fora do Git). Este script:
//   • mostra a lista (para você distribuir);
//   • com `--trocar`, sorteia senhas novas e aplica no banco de teste.
//
// ⚠️ NUNCA roda contra a produção — a trava está em `test-db.mjs`.
//
// Uso:  npm run senhas:treino              (só mostra)
//       npm run senhas:treino -- --trocar  (sorteia e aplica)

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { testEnv } from "./test-db.mjs";

const env = testEnv();
const auth = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
).auth.admin;

/** O papel de cada apelido, em português, para a lista fazer sentido sozinha. */
const FUNCAO = {
  admin: "Admin Master",
  sdr: "SDR (Encantadora)",
  planner: "Dentista Planner",
  consultor: "Consultor Comercial",
  assistente: "Assistente Comercial",
  rede: "Franqueadora / Rede",
  rislife: "Consultor RisLife",
  financeiro: "Financeiro da Franqueadora",
  comprador: "Comprador da Franqueadora",
  recepcao: "Recepcionista",
  coordenador: "Coordenador Clínico",
  dentista: "Dentista (executor)",
  gerente: "Gerente de Unidade",
  tsb: "TSB",
  asb: "ASB",
  franqueado: "Franqueado",
};

const UNIDADE = {
  sdr: "Franqueadora", planner: "Franqueadora", consultor: "Franqueadora",
  assistente: "Franqueadora", rede: "Franqueadora", rislife: "Franqueadora",
  financeiro: "Franqueadora", comprador: "Franqueadora", admin: "Todas",
  recepcao: "Cambé", coordenador: "Cambé", dentista: "Cambé",
  gerente: "Cambé", tsb: "Cambé", asb: "Cambé",
  franqueado: "Londrina",
};

const ARQUIVO = ".env.test.local";
const trocar = process.argv.includes("--trocar");

function lerMapa() {
  const texto = readFileSync(ARQUIVO, "utf8");
  const achada = texto.match(/^TEST_USER_PASSWORDS=(.+)$/m);
  return { texto, mapa: achada ? JSON.parse(achada[1].trim()) : {}, tinha: !!achada };
}

function gravarMapa(texto, mapa, tinha) {
  const linha = `TEST_USER_PASSWORDS=${JSON.stringify(mapa)}`;
  writeFileSync(
    ARQUIVO,
    tinha ? texto.replace(/^TEST_USER_PASSWORDS=.+$/m, linha) : `${texto}\n${linha}\n`,
    "utf8"
  );
}

const { data: lista } = await auth.listUsers({ perPage: 200 });
const usuarios = (lista?.users ?? [])
  .filter((u) => u.email?.endsWith("@example.com"))
  .sort((a, b) => a.email.localeCompare(b.email));

let { texto, mapa, tinha } = lerMapa();

if (trocar) {
  console.log(`Sorteando senha nova para ${usuarios.length} usuário(s)...\n`);
  for (const u of usuarios) {
    const apelido = u.email.split("@")[0];
    // O apelido entra na senha de propósito: quem recebe a dela consegue
    // conferir num relance que é a certa, sem precisar decorar.
    mapa[u.email] = `Treino-${apelido}-${randomBytes(6).toString("base64url")}`;
    const { error } = await auth.updateUserById(u.id, { password: mapa[u.email] });
    if (error) console.log(`  ERRO em ${u.email}: ${error.message}`);
  }
  gravarMapa(texto, mapa, tinha);
  console.log("Senhas trocadas e gravadas em .env.test.local.\n");
}

// ---- a lista -----------------------------------------------------------------
const linhas = [];
linhas.push("SENHAS DO AMBIENTE DE TREINO — riSZon");
linhas.push(`Endereço: https://risarte-treino.vercel.app`);
linhas.push(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
linhas.push("");
linhas.push("Este é o ambiente de TREINO. Os dados aqui não são reais e podem");
linhas.push("ser apagados a qualquer momento. Entregue a cada pessoa APENAS a");
linhas.push("linha da função dela.");
linhas.push("");
linhas.push(
  "FUNÇÃO".padEnd(30) + "UNIDADE".padEnd(14) + "E-MAIL".padEnd(30) + "SENHA"
);
linhas.push("-".repeat(100));
for (const u of usuarios) {
  const apelido = u.email.split("@")[0];
  linhas.push(
    (FUNCAO[apelido] ?? apelido).padEnd(30) +
      (UNIDADE[apelido] ?? "—").padEnd(14) +
      u.email.padEnd(30) +
      (mapa[u.email] ?? "(sem senha registrada — rode com --trocar)")
  );
}

const saida = linhas.join("\n");
console.log(saida);

// Fora do repositório, pelo mesmo motivo do backup: é credencial, e credencial
// dentro da pasta do projeto entra no Git no primeiro `git add -A`.
const destino = "../senhas-ambiente-treino.txt";
writeFileSync(destino, saida + "\n", "utf8");
console.log(`\nLista salva em: ${destino}`);
