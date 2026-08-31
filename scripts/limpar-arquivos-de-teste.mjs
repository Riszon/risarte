// APAGA OS ARQUIVOS DE TESTE DO ARMAZENAMENTO.
//
// O SQL da limpeza (`supabase/manutencao/limpeza-dados-de-teste.sql`) apaga o
// REGISTRO da mídia; o ARQUIVO continua guardado. Sem esta parte, a foto do
// paciente de teste sobreviveria à limpeza — e dado de saúde que deveria ter
// sumido e não sumiu é problema de LGPD, não de arrumação.
//
// ⚠️ RODAR DEPOIS DO SQL, e só depois da cópia de segurança.
// ⚠️ Exige `--confirmar`: um script que apaga arquivo não pode obedecer a um
//    duplo-clique distraído.
//
// Uso:  npm run limpar:arquivos -- --confirmar

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Os baldes cujo CONTEÚDO nasceu junto com os dados que o SQL apaga.
const ESVAZIAR = [
  "clinical-media",              // fotos, exames, áudio e vídeo dos pacientes
  "chat-media",                  // anexos das mensagens do Chat
  "staff-photos",                // foto do cadastro de Risartano
  "empresarial-empresa-docs",    // documentos das empresas parceiras
  "empresarial-colaborador-docs",
  "nfe",                         // XML das notas de compra
];

// ⚠️ NÃO SÃO ÓRFÃOS — E EU JÁ ESCREVI AQUI QUE ERAM (31/08/2026).
//
// `lms-media`, `certificates` e `covers` pertencem ao **Risarte Academy**, um
// sistema SEPARADO (`PROJETOS RISARTE/risarte-academy`) que divide o mesmo
// Supabase, no schema `treinamento`. Guardam os vídeos e materiais das aulas,
// os certificados emitidos e as capas dos cursos e trilhas.
//
// Eu os chamei de órfãos porque procurei referência a eles NESTE repositório e
// não achei — conclusão tirada do lugar errado. A pergunta certa era por que
// existem, e ela tinha resposta em dez minutos.
//
// Este script é do riSZon e **não apaga arquivo do Academy**. A limpeza de lá
// tem arquivo próprio: `supabase/manutencao/limpeza-academy.sql`, e os arquivos
// dela saem à mão, junto com o conteúdo a que pertencem.
const DE_OUTRO_SISTEMA = ["lms-media", "certificates", "covers"];

const NAO_TOCAR = DE_OUTRO_SISTEMA;

const confirmado = process.argv.includes("--confirmar");

/** Lista todos os caminhos de um balde, entrando nas subpastas. */
async function listar(balde, prefixo = "") {
  const saida = [];
  const { data, error } = await db.storage
    .from(balde)
    .list(prefixo, { limit: 1000 });
  if (error || !data) return saida;
  for (const item of data) {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
    // Pasta não tem `id`; arquivo tem. É como a API do Supabase os separa.
    if (item.id === null) saida.push(...(await listar(balde, caminho)));
    else saida.push(caminho);
  }
  return saida;
}

async function main() {
  console.log(
    `Armazenamento de ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "").slice(0, 12)}…\n`
  );

  let total = 0;
  const plano = [];
  for (const balde of ESVAZIAR) {
    const caminhos = await listar(balde);
    total += caminhos.length;
    plano.push([balde, caminhos]);
    console.log(`  ${balde.padEnd(30)} ${String(caminhos.length).padStart(4)} arquivo(s)`);
  }

  if (NAO_TOCAR.length > 0) {
    console.log("\n  Intocados (são do Risarte Academy, não do riSZon):");
    for (const balde of NAO_TOCAR) {
      const caminhos = await listar(balde);
      console.log(
        `  ${balde.padEnd(30)} ${String(caminhos.length).padStart(4)} arquivo(s)`
      );
    }
  }

  if (!confirmado) {
    console.log(
      `\n  NADA FOI APAGADO. ${total} arquivo(s) seriam apagados.` +
        `\n  Para apagar de verdade:  npm run limpar:arquivos -- --confirmar`
    );
    return;
  }

  console.log(`\n  Apagando ${total} arquivo(s)...`);
  for (const [balde, caminhos] of plano) {
    if (caminhos.length === 0) continue;
    // Em lotes de 100: a API aceita uma lista, mas uma lista enorme numa
    // requisição só falha inteira por causa de um caminho ruim.
    for (let i = 0; i < caminhos.length; i += 100) {
      const lote = caminhos.slice(i, i + 100);
      const { error } = await db.storage.from(balde).remove(lote);
      if (error) console.log(`    ERRO em ${balde}: ${error.message}`);
    }
    const sobrou = await listar(balde);
    console.log(`  ${balde.padEnd(30)} sobrou ${sobrou.length}`);
  }
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exitCode = 1;
});
