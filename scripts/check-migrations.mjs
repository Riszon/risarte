// Conferência de migração ANTES de o dono rodar.
//
// O portão de entrega (build + testes) não enxerga SQL: ele compila TypeScript.
// Duas migrações seguidas chegaram ao dono com erro mecânico que o Postgres só
// acusa na hora de rodar — e cada uma custou uma ida e volta.
//
// Duas regras, as duas já cometidas:
//
//   1. `create or replace function` com RETORNO DIFERENTE do que já existe.
//      O Postgres recusa: "cannot change return type of existing function".
//      Precisa de `drop function` antes.
//   2. Função que devolve `returns table (...)` com número de colunas
//      diferente do que o corpo seleciona: "Final statement returns too many
//      columns". Esta só dá para conferir nas funções `language sql` de um
//      SELECT só — e é justamente onde ela aconteceu.
//
// Uso:  node scripts/check-migrations.mjs [0233]
// Sem argumento, confere a migração de número mais alto.
//
// CASO CONHECIDO E DELIBERADO: a 0176 (`conclude_attendance_partial`) mantém de
// propósito a assinatura antiga de 3 argumentos ao lado da nova de 4, para não
// quebrar chamadas em voo — está escrito na própria migração. Uma varredura
// geral acusa essa; o uso normal (conferir UMA migração nova) não encosta nela.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const target = process.argv[2]
  ? files.find((f) => f.startsWith(process.argv[2]))
  : files.filter((f) => /^0\d{3}_/.test(f)).at(-1);

if (!target) {
  console.error("Migração não encontrada.");
  process.exit(1);
}

const FN =
  /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s+language\s+(\w+)/gi;

// Comentário sai ANTES de achatar o espaço: uma migração que só acrescenta um
// `--` explicando um parâmetro não mudou assinatura nenhuma, e comparar com o
// comentário dentro acusaria as quatro migrações que apenas se documentaram
// melhor.
const norm = (s) =>
  s.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Última definição conhecida de cada função, antes da migração alvo. */
const known = new Map();
for (const f of files) {
  if (f === target) break;
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(FN)) {
    known.set(m[1], { file: f, args: norm(m[2]), returns: norm(m[3]) });
  }
}

const sql = readFileSync(join(DIR, target), "utf8");
const drops = new Set(
  [...sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)/gi)].map(
    (m) => m[1]
  )
);

const problems = [];

for (const m of sql.matchAll(FN)) {
  const [, name, args, returns, lang] = m;
  const prev = known.get(name);

  // Regra 3 — lista de PARÂMETROS mudou sem drop. Não dá erro ao criar: cria
  // uma sobrecarga. O erro aparece depois, na chamada, como "function is not
  // unique" — longe da causa, e só quando alguém usa a tela.
  if (prev && norm(args) !== prev.args && !drops.has(name)) {
    problems.push(
      `${name}: os parâmetros mudaram desde ${prev.file} e não há ` +
        `"drop function" antes — vai virar sobrecarga, e a chamada antiga ` +
        `fica ambígua.`
    );
  }

  // Regra 1 — retorno mudou sem drop.
  if (prev && norm(returns) !== prev.returns && !drops.has(name)) {
    problems.push(
      `${name}: o retorno mudou desde ${prev.file} e não há "drop function" ` +
        `antes.\n      antes: ${prev.returns.slice(0, 70)}\n      agora: ${norm(returns).slice(0, 70)}`
    );
  }

  // Regra 4 — junção por VÍRGULA seguida de LEFT/RIGHT JOIN no mesmo FROM.
  // O join binda mais forte que a vírgula: `from a, b left join c on c.x = a.y`
  // faz o ON enxergar só `b`, e a referência a `a` é recusada. Já aconteceu
  // duas vezes (0236 e 0237) — as duas achadas na revisão, por sorte.
  {
    const body = bodyOf(sql, m.index);
    if (commaThenJoin(body)) {
      problems.push(
        `${name}: tem junção por vírgula seguida de LEFT/RIGHT JOIN no mesmo ` +
          `FROM. O ON não enxerga a tabela que veio antes da vírgula — passe a ` +
          `condição para o WHERE ou use subconsulta.`
      );
    }
  }

  // Regra 2 — colunas declaradas × colunas selecionadas.
  if (lang.toLowerCase() === "sql" && /^table\s*\(/i.test(norm(returns))) {
    const declared = countColumns(returns);
    const body = bodyOf(sql, m.index);
    const selected = countSelected(body);
    if (declared && selected && declared !== selected) {
      problems.push(
        `${name}: declara ${declared} colunas e o SELECT devolve ${selected}.`
      );
    }
  }
}

/**
 * Existe `from ... , ... left join` dentro do mesmo FROM?
 *
 * Procura, em cada `from`, uma vírgula de primeiro nível antes de um
 * LEFT/RIGHT JOIN, parando no `where`/`group`/`order` que fecha a cláusula.
 * Vírgula DEPOIS do join é outra coisa e não interessa aqui.
 */
function commaThenJoin(body) {
  const clean = body.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");
  const re = /\bfrom\b/gi;
  let m;
  while ((m = re.exec(clean))) {
    // Varre UMA passada respeitando parênteses: o `where` que fecha a cláusula
    // é o do MESMO nível. Sem isso, o `where` de dentro de um lateral (ou de um
    // `filter (where ...)`) cortaria o texto no meio e o resto viraria ruído —
    // foi o que fez a primeira versão desta regra acusar código correto.
    let depth = 0;
    let comma = -1;
    for (let i = m.index + 4; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break; // saiu da subconsulta que continha este FROM
        depth--;
      } else if (depth === 0) {
        // Ponto e vírgula fecha o comando: em corpo plpgsql, continuar depois
        // dele faz a varredura casar vírgula de um comando com JOIN de outro.
        if (ch === ";") break;
        if (ch === "," && comma < 0) comma = i;
        // `union` fecha a cláusula tanto quanto `where`: sem ele, um `from cte`
        // seco continuaria lendo o SELECT seguinte e casaria a vírgula da lista
        // de colunas dele com um JOIN mais adiante.
        const ahead = clean.slice(i, i + 12).toLowerCase();
        if (
          /^\b(where|group by|order|having|limit|union|intersect|except)/.test(
            ahead
          )
        ) {
          break;
        }
        if (comma >= 0 && /^(left|right)\s/.test(ahead)) {
          if (/^(left|right)\s+(outer\s+)?join\b/i.test(clean.slice(i))) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Colunas de um `returns table (a text, b bigint)` — vírgulas de topo. */
function countColumns(returns) {
  const inside = returns.replace(/^\s*table\s*\(/i, "").replace(/\)\s*$/, "");
  let depth = 0;
  let n = 1;
  for (const ch of inside) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return inside.trim() ? n : 0;
}

/** O corpo `as $$ ... $$` que começa depois da posição dada. */
function bodyOf(sql, from) {
  const open = sql.indexOf("$$", from);
  if (open < 0) return "";
  const close = sql.indexOf("$$", open + 2);
  return close < 0 ? "" : sql.slice(open + 2, close);
}

/**
 * Colunas do SELECT final. Conta só o caso simples e seguro: um `select` de
 * primeiro nível, sem union e sem subconsulta antes do `from`. Fora disso
 * devolve 0 (não opina) — checagem que erra é pior que checagem que cala.
 */
function countSelected(body) {
  const clean = body.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  if (/\bunion\b/i.test(clean)) return 0;
  const m = clean.match(/^(?:with[\s\S]*?\)\s*)?select\s+([\s\S]*?)\s+from\s/i);
  if (!m) return 0;
  const list = m[1];
  if (/\bselect\b/i.test(list)) return 0; // subconsulta na lista: não opina

  // `select *` sobre uma tabela de valores com apelido: dá para contar as
  // colunas do apelido. É exatamente o caso que quebrou a 0232 — a coluna de
  // filtro vazando para o retorno.
  if (list.trim() === "*") {
    const alias = clean.match(/\)\s*as\s+\w+\s*\(([^)]*)\)/i);
    if (!alias) return 0;
    return alias[1].split(",").length;
  }
  let depth = 0;
  let n = 1;
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return n;
}

if (problems.length === 0) {
  console.log(`OK — ${target} sem problemas conhecidos.`);
} else {
  console.log(`${target}: ${problems.length} problema(s)\n`);
  for (const p of problems) console.log("  - " + p);
  process.exit(1);
}
