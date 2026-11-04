// O BACKLOG NO BANCO — o comando das sessões (BK1, migração 0366).
//
// É por aqui que a sessão do Claude registra o que achou e fecha o que
// resolveu. Grava na PRODUÇÃO (a lista de verdade, que o dono vê na tela
// Admin → Backlog); `--treino` grava no banco de treino.
//
//   npm run backlog -- listar [--todos] [--resolvidos] [--categoria "Defeito"]
//   npm run backlog -- ver AP56
//   npm run backlog -- novo --titulo "…" --detalhe "…" --categoria "Defeito"
//                           [--prioridade alta] [--modulo agenda]
//                           [--situacao aguardando_dono] [--sessao "nome da sessão"]
//   npm run backlog -- mudar AP56 [--titulo] [--detalhe] [--categoria] [--modulo]
//                           [--prioridade] [--situacao] [--nota "…"]
//   npm run backlog -- andamento AP56
//   npm run backlog -- resolver AP56 --versao 0.399.0 --como "o que foi feito"
//   npm run backlog -- descartar AP56 --motivo "…"
//   npm run backlog -- categorias
//   npm run backlog -- categoria-nova "Nome"
//   npm run backlog -- importar [--confirmar]      (uma vez: lê docs/BACKLOG.md)
//
// `--detalhe-arquivo caminho.md` lê o detalhe de um arquivo (texto longo).
// Nada aqui apaga: resolver e descartar só mudam a situação.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { itensDoArquivo } from "./backlog-do-arquivo.mjs";

const PRIORIDADES = ["urgente", "alta", "media", "baixa"];
const SITUACOES = ["aberto", "aguardando_dono", "em_andamento", "resolvido", "descartado"];
const ROTULO_SITUACAO = {
  aberto: "Aberto",
  aguardando_dono: "Aguardando o dono",
  em_andamento: "Em andamento",
  resolvido: "Resolvido",
  descartado: "Descartado",
};

/** Os módulos dos relatos (MODULOS em src/lib/system-reports.ts), lidos de lá. */
function modulosDoSistema() {
  const tudo = readFileSync("src/lib/system-reports.ts", "utf8");
  const ini = tudo.indexOf("export const MODULOS = [");
  const fim = ini < 0 ? -1 : tudo.indexOf("] as const", ini);
  if (ini < 0 || fim < 0) throw new Error("NÃO MEDI: não achei o bloco MODULOS em system-reports.ts");
  const ts = tudo.slice(ini, fim);
  const valores = [...ts.matchAll(/\{\s*value:\s*"([a-z_]+)",\s*label:/g)].map((m) => m[1]);
  if (valores.length < 5) throw new Error("NÃO MEDI: não achei a lista MODULOS em system-reports.ts");
  return valores;
}

// ---------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const comando = args[0];
const posicionais = [];
const opcoes = {};
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const nome = a.slice(2);
    const prox = args[i + 1];
    if (prox === undefined || prox.startsWith("--")) opcoes[nome] = true;
    else {
      opcoes[nome] = prox;
      i++;
    }
  } else posicionais.push(a);
}

function falhar(msg) {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
}

if (!comando || comando === "ajuda" || opcoes.ajuda) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 22).join("\n"));
  process.exit(0);
}

// ---------------------------------------------------------------- conexão
const ENV_FILE = opcoes.treino ? ".env.test.local" : ".env.local";
const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  falhar(`${ENV_FILE} sem NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY`);
}
const projeto = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const ambiente = projeto === "hvhbijctanrrkxhemlza" ? "PRODUÇÃO" : projeto === "bsnptybalszjjbhxeejo" ? "TREINO" : projeto;
if (opcoes.treino && ambiente === "PRODUÇÃO") falhar("--treino apontando para a produção — conferir .env.test.local");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log(`Backlog — banco: ${ambiente}`);

const sessao = typeof opcoes.sessao === "string" ? opcoes.sessao : "Sessão do Claude";

function texto(nome) {
  const v = opcoes[nome];
  return typeof v === "string" ? v : null;
}

function detalheDasOpcoes() {
  if (typeof opcoes["detalhe-arquivo"] === "string") return readFileSync(opcoes["detalhe-arquivo"], "utf8");
  return texto("detalhe");
}

function conferirValores({ prioridade, situacao, modulo }) {
  if (prioridade && !PRIORIDADES.includes(prioridade)) falhar(`prioridade "${prioridade}" — use ${PRIORIDADES.join(", ")}`);
  if (situacao && !SITUACOES.includes(situacao)) falhar(`situação "${situacao}" — use ${SITUACOES.join(", ")}`);
  if (modulo && !modulosDoSistema().includes(modulo)) falhar(`módulo "${modulo}" — use ${modulosDoSistema().join(", ")}`);
}

function codigo() {
  const c = (posicionais[0] ?? "").toUpperCase();
  if (!/^AP\d+$/.test(c)) falhar("informe o código do item (ex.: AP56)");
  return c;
}

async function rpc(nome, params) {
  const { data, error } = await db.rpc(nome, params);
  if (error) {
    if (/Could not find the function|does not exist/.test(error.message)) {
      falhar(`a função ${nome} não existe neste banco — a migração 0366 foi aplicada?`);
    }
    falhar(`${nome}: ${error.message}`);
  }
  return data;
}

async function mostrar(code) {
  const { data, error } = await db
    .from("backlog_items")
    .select("code, title, detail, priority, status, module, found_on, resolved_at, resolved_version, resolution, backlog_categories ( name )")
    .eq("code", code)
    .maybeSingle();
  if (error) falhar(error.message);
  if (!data) falhar(`${code} não existe`);
  console.log(`\n${data.code} — ${data.title}`);
  console.log(`${ROTULO_SITUACAO[data.status]} · ${data.backlog_categories?.name} · prioridade ${data.priority}${data.module ? ` · ${data.module}` : ""} · achado em ${data.found_on}`);
  if (data.resolved_at) console.log(`Fechado em ${data.resolved_at.slice(0, 10)}${data.resolved_version ? ` (${data.resolved_version})` : ""}${data.resolution ? ` — ${data.resolution}` : ""}`);
  return data;
}

// ---------------------------------------------------------------- comandos
switch (comando) {
  case "listar": {
    let q = db
      .from("backlog_items")
      .select("code, title, priority, status, module, backlog_categories ( name )")
      .order("code");
    if (opcoes.resolvidos) q = q.in("status", ["resolvido", "descartado"]);
    else if (!opcoes.todos) q = q.not("status", "in", "(resolvido,descartado)");
    const { data, error } = await q;
    if (error) falhar(error.message);
    let itens = data ?? [];
    if (typeof opcoes.categoria === "string") {
      itens = itens.filter((i) => i.backlog_categories?.name?.toLowerCase() === opcoes.categoria.toLowerCase());
    }
    const ordem = (i) => PRIORIDADES.indexOf(i.priority) * 100000 + Number(i.code.slice(2));
    itens.sort((a, b) => ordem(a) - ordem(b));
    for (const i of itens) {
      console.log(`${i.code.padEnd(6)} ${i.priority.padEnd(8)} ${ROTULO_SITUACAO[i.status].padEnd(18)} ${(i.backlog_categories?.name ?? "").padEnd(17)} ${i.title.slice(0, 90)}`);
    }
    const { count: abertos } = await db.from("backlog_items").select("*", { count: "exact", head: true }).not("status", "in", "(resolvido,descartado)");
    const { count: resolvidos } = await db.from("backlog_items").select("*", { count: "exact", head: true }).in("status", ["resolvido", "descartado"]);
    console.log(`\n${itens.length} na lista · ${abertos ?? "?"} abertos · ${resolvidos ?? "?"} resolvidos no banco`);
    break;
  }

  case "ver": {
    const it = await mostrar(codigo());
    console.log(`\n${it.detail}\n`);
    break;
  }

  case "novo": {
    const titulo = texto("titulo");
    const categoria = texto("categoria");
    if (!titulo || !categoria) falhar("novo precisa de --titulo e --categoria (e de preferência --detalhe)");
    const prioridade = texto("prioridade") ?? "media";
    const situacao = texto("situacao") ?? "aberto";
    const modulo = texto("modulo");
    conferirValores({ prioridade, situacao, modulo });
    const code = await rpc("backlog_create_item", {
      p_title: titulo,
      p_detail: detalheDasOpcoes() ?? "",
      p_category: categoria,
      p_priority: prioridade,
      p_module: modulo,
      p_status: situacao,
      p_origin: "sessao",
      p_author_label: sessao,
    });
    console.log(`\n✔ Registrado: ${code}`);
    await mostrar(code);
    break;
  }

  case "mudar":
  case "andamento":
  case "resolver":
  case "descartar": {
    const code = codigo();
    const situacao =
      comando === "andamento" ? "em_andamento" : comando === "resolver" ? "resolvido" : comando === "descartar" ? "descartado" : texto("situacao");
    if (comando === "descartar" && !texto("motivo")) falhar("descartar precisa de --motivo");
    if (comando === "resolver" && !texto("como")) falhar("resolver precisa de --como (e de preferência --versao)");
    const prioridade = texto("prioridade");
    const modulo = texto("modulo");
    conferirValores({ prioridade, situacao, modulo });
    await rpc("backlog_update_item", {
      p_code: code,
      p_title: texto("titulo"),
      p_detail: detalheDasOpcoes(),
      p_category: texto("categoria"),
      p_module: modulo,
      p_priority: prioridade,
      p_status: situacao,
      p_resolved_version: texto("versao"),
      p_resolution: texto("como") ?? texto("motivo"),
      p_note: texto("nota"),
      p_author_label: sessao,
    });
    console.log(`\n✔ ${code} atualizado`);
    await mostrar(code);
    break;
  }

  case "categorias": {
    const { data, error } = await db.from("backlog_categories").select("name, sort_order, active").order("sort_order");
    if (error) falhar(error.message);
    for (const c of data ?? []) console.log(`${String(c.sort_order).padStart(4)}  ${c.name}${c.active ? "" : "  (desativada)"}`);
    break;
  }

  case "categoria-nova": {
    const nome = posicionais.join(" ").trim();
    if (!nome) falhar('informe o nome: categoria-nova "Nome"');
    await rpc("backlog_save_category", { p_id: null, p_name: nome, p_sort_order: 100, p_active: true });
    console.log(`\n✔ Categoria criada: ${nome}`);
    break;
  }

  case "importar": {
    const itens = itensDoArquivo(readFileSync("docs/BACKLOG.md", "utf8"));
    const modulos = modulosDoSistema();
    for (const i of itens) {
      if (i.module && !modulos.includes(i.module)) falhar(`${i.code}: módulo "${i.module}" fora da lista`);
    }
    const por = (campo) => itens.reduce((m, i) => ((m[i[campo]] = (m[i[campo]] ?? 0) + 1), m), {});
    console.log(`\n${itens.length} itens lidos do docs/BACKLOG.md`);
    console.log("Situação:", por("status"));
    console.log("Categoria:", por("category"));
    if (!opcoes.confirmar) {
      console.log("\nNada gravado. Para gravar: npm run backlog -- importar --confirmar" + (opcoes.treino ? " --treino" : ""));
      break;
    }
    let novos = 0;
    let jaExistiam = 0;
    for (const i of itens) {
      const ok = await rpc("backlog_import_item", {
        p_code: i.code,
        p_title: i.title,
        p_detail: i.detail,
        p_category: i.category,
        p_priority: i.priority,
        p_status: i.status,
        p_module: i.module,
        p_found_on: i.foundOn,
        p_resolved_on: i.resolvedOn,
        p_resolved_version: i.resolvedVersion,
        p_resolution: i.resolution,
      });
      if (ok) {
        novos++;
        if (i.note) {
          await rpc("backlog_update_item", { p_code: i.code, p_note: i.note, p_author_label: "Importação do BACKLOG.md" });
        }
      } else jaExistiam++;
    }
    // Confere o que ficou no banco contra o que foi lido — falha alto se divergir.
    const { data: noBanco, error } = await db.from("backlog_items").select("code, status");
    if (error) falhar(error.message);
    const mapa = new Map((noBanco ?? []).map((r) => [r.code, r.status]));
    const faltando = itens.filter((i) => !mapa.has(i.code)).map((i) => i.code);
    const divergentes = itens.filter((i) => mapa.has(i.code) && mapa.get(i.code) !== i.status).map((i) => i.code);
    console.log(`\n✔ ${novos} gravados, ${jaExistiam} já existiam.`);
    if (faltando.length) falhar(`faltam no banco: ${faltando.join(", ")}`);
    if (divergentes.length) console.log(`⚠️ Situação diferente do arquivo (mudada depois no banco?): ${divergentes.join(", ")}`);
    console.log(`Conferido: os ${itens.length} itens estão no banco.`);
    break;
  }

  default:
    falhar(`comando "${comando}" não existe — npm run backlog -- ajuda`);
}
