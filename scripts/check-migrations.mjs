// Conferência de migração ANTES de o dono rodar.
//
// O portão de entrega (build + testes) não enxerga SQL: ele compila TypeScript.
// Duas migrações seguidas chegaram ao dono com erro mecânico que o Postgres só
// acusa na hora de rodar — e cada uma custou uma ida e volta.
//
// As duas primeiras regras (hoje são dez — cada uma descrita onde é conferida):
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

// ⚠️ OS TRÊS SCHEMAS DO REPOSITÓRIO (AP21, 15/10/2026). Até aqui só `public.`
// era visto, e as Regras 1 a 4 respondiam "OK" para funções do `empresarial.`
// e do `indica.` SEM TER CONFERIDO NADA — a régua que passa por ausência (§0d
// do CLAUDE.md). O nome guardado leva o schema (`empresarial.settle_billing`):
// funções de mesmo nome em schemas diferentes são funções diferentes.
const FN =
  /create\s+(?:or\s+replace\s+)?function\s+(public|empresarial|indica)\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s+language\s+(\w+)/gi;
/** O nome completo, como as Regras 1 a 3 guardam e comparam. */
const nomeDe = (schema, nome) => `${schema.toLowerCase()}.${nome.toLowerCase()}`;

// Comentário sai ANTES de achatar o espaço: uma migração que só acrescenta um
// `--` explicando um parâmetro não mudou assinatura nenhuma, e comparar com o
// comentário dentro acusaria as quatro migrações que apenas se documentaram
// melhor.
// ⚠️ O MESMO TIPO TEM VÁRIOS NOMES (AP21): `int` = `integer`, `timestamptz` =
// `timestamp with time zone`, e o default `null::text` = `null`. A 0280
// recriou funções do Empresarial no formato que o PRÓPRIO Postgres imprime, e
// sem isto a régua acusava "parâmetros mudaram" numa assinatura idêntica —
// régua que erra manda consertar o que está certo.
const SINONIMOS = [
  [/\btimestamptz\b/g, "timestamp with time zone"],
  [/\btimetz\b/g, "time with time zone"],
  [/\bint4\b|\bint\b/g, "integer"],
  [/\bint8\b/g, "bigint"],
  [/\bint2\b/g, "smallint"],
  [/\bbool\b/g, "boolean"],
  [/\bfloat8\b/g, "double precision"],
  [/\bvarchar\b/g, "character varying"],
  // O tipo escrito no default é redundante: `null::text` é o mesmo `null`.
  [/::[a-z_][a-z0-9_. \[\]]*?(?=,|$)/g, ""],
];
const norm = (s) =>
  SINONIMOS.reduce(
    (t, [de, para]) => t.replace(de, para),
    s
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      // "table (" e "table(" são o mesmo retorno: a definição copiada do banco
      // (pg_get_functiondef) vem sem o espaço — sem isto a régua acusava à toa.
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)/g, ")")
      .replace(/\s*,\s*/g, ", ")
      .trim()
      .toLowerCase()
  );

/** Última definição conhecida de cada função, antes da migração alvo. */
const known = new Map();
for (const f of files) {
  if (f === target) break;
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(FN)) {
    known.set(nomeDe(m[1], m[2]), { file: f, args: norm(m[3]), returns: norm(m[4]) });
  }
}

const sql = readFileSync(join(DIR, target), "utf8");
// `alter function public.X(...) rename to Y` também libera o nome X: a função
// criada depois com esse nome é NOVA, não substitui a antiga (0282 — a porta
// com guarda na frente da original renomeada). Sem isto, a régua acusava
// "retorno mudou" em cada porta.
const drops = new Set([
  ...[
    ...sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(public|empresarial|indica)\.(\w+)/gi),
  ].map((m) => nomeDe(m[1], m[2])),
  ...[
    ...sql.matchAll(
      /alter\s+function\s+(public|empresarial|indica)\.(\w+)\s*\([^)]*\)\s+rename\s+to\s+\w+/gi
    ),
  ].map((m) => nomeDe(m[1], m[2])),
]);

const problems = [];

// Regra 5 — COMPARAR COM `auth.uid()` USANDO `<>` DEIXA A TRAVA ABERTA.
//
// ⚠️ Achado por sonda em 26/09/2026, na 0273. `v_user <> auth.uid()` devolve
// NULO quando `auth.uid()` é nulo — chamada sem sessão, chave de serviço,
// tarefa agendada —, e `if NULO then` não dispara. A guarda "só a própria
// pessoa faz isto" ficava ABERTA justamente para quem não estava logado, numa
// função `security definer`, que roda como dona do banco.
//
// O certo é `is distinct from`, que trata o nulo como valor. A régua olha só
// o código, não os comentários: explicar o defeito não pode acusá-lo.
const semComentarios = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

for (const mau of semComentarios.matchAll(
  /([A-Za-z_.]+)\s*(?:<>|!=)\s*auth\.uid\(\)|auth\.uid\(\)\s*(?:<>|!=)\s*([A-Za-z_.]+)/g
)) {
  problems.push(
    `comparação com auth.uid() usando "<>": ${mau[0].trim()}\n` +
      `      Quando auth.uid() é NULO (sem sessão), "<>" devolve NULO e o IF\n` +
      `      não dispara — a trava fica ABERTA para quem não está logado.\n` +
      `      Use "is distinct from". Ver 0273 e §0d do CLAUDE.md.`
  );
}

// Regra 6 — DESDE A 0277, `public.user_clinic_roles` É UMA JANELA (VIEW).
//
// A tabela de verdade virou `user_clinic_roles_all`; no lugar dela ficou uma
// view que esconde, de quem chama, as funções das unidades fechadas (AP14).
// Ler e gravar DADOS pelo nome antigo continua certo. Mexer na ESTRUTURA não:
// gatilho, política, coluna e índice em cima da view falham no Postgres — ou,
// pior, uma política criada na view não protege a tabela. A régua vale só
// para migrações DEPOIS da 0277 (as antigas mexiam na tabela, que era a
// mesma coisa).
if (target.slice(0, 4) > "0277") {
  for (const mau of semComentarios.matchAll(
    /(?:alter\s+table|create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w*\s*on|create\s+(?:or\s+replace\s+)?trigger\s+\w+[\s\S]{0,120}?\bon|create\s+policy\s+\w+\s+on|drop\s+(?:policy|trigger)\s+(?:if\s+exists\s+)?\w+\s+on)\s+(?:only\s+)?public\.user_clinic_roles\b(?!_all)/gi
  )) {
    problems.push(
      `estrutura em public.user_clinic_roles: ${mau[0].replace(/\s+/g, " ").trim()}\n` +
        `      Desde a 0277 esse nome é uma VIEW (a janela da tranca por unidade).\n` +
        `      Gatilho, política, coluna e índice vão em public.user_clinic_roles_all.`
    );
  }
}

// Regra 7 — `REVOKE ... FROM PUBLIC` NÃO DEIXA A FUNÇÃO PRIVADA NO SUPABASE.
//
// O banco tem um padrão (`pg_default_acl`) que dá EXECUTE de toda função nova,
// NOMINALMENTE, a `anon`, `authenticated` e `service_role`. Tirar de `public`
// não tira de quem recebeu pelo nome. Provado na produção em 26/09/2026: sem
// login, pela chave pública, a regra interna da tranca (0277) e a conta do
// fluxo de caixa (0230) executaram. 19 funções "privadas" estavam abertas
// (AP15). Vale para migrações DEPOIS da 0278 — as antigas são o AP15.
if (target.slice(0, 4) > "0278") {
  for (const m of semComentarios.matchAll(
    /revoke\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+([\w.]+)\s*\([^)]*\)\s+from\s+([^;]+);/gi
  )) {
    const quem = m[2].toLowerCase();
    if (/\bpublic\b/.test(quem) && !(/\banon\b/.test(quem) && /\bauthenticated\b/.test(quem))) {
      problems.push(
        `função "privada" só tirada de public: ${m[0].replace(/\s+/g, " ").trim()}\n` +
          `      No Supabase toda função nova já nasce executável por anon e\n` +
          `      authenticated (pelo nome). Escreva "from public, anon, authenticated"\n` +
          `      — e, se ela deve responder a logados, dê o grant DEPOIS. Ver AP15.`
      );
    }
  }
}

// Regra 8 — NÚMERO ÍMPAR DE `$$` = DELIMITADOR QUEBRADO.
//
// `"$$"` como TEXTO de substituição no `String.replace` do JavaScript vira UM
// `$`. Aconteceu na 0239 (em silêncio) e de novo ao GERAR a 0280 por script,
// em 26/09/2026 — pego só na revisão a olho: `AS $` e `end $;`. Função com
// delimitador quebrado ou não cria, ou engole o resto da migração como corpo.
{
  const dolares = (semComentarios.match(/\$\$/g) ?? []).length;
  if (dolares % 2 !== 0) {
    problems.push(
      `número ímpar de "$$" (${dolares}): algum delimitador de função está quebrado.\n` +
        `      Se a migração foi gerada por script, procure "AS $" ou "end $;" —\n` +
        `      "$$" no texto de substituição do replace vira UM "$".`
    );
  }
}

// Regra 9 — TABELA NOVA TEM DE ENTRAR NA AUDITORIA (0288).
//
// Desde a 0288 o banco registra sozinho cada inclusão, alteração e exclusão,
// por um gatilho preso em cada tabela de cadastro. Tabela criada depois nasce
// SEM o gatilho — e o que acontece nela some da auditoria sem ninguém notar.
// Quem cria tabela em `public`, `empresarial` ou `indica` termina a migração
// com `select public.audit_attach_all();` (prende em todas as que faltam; é
// idempotente). Se a tabela NÃO deve ser auditada (histórico, derivada,
// registro técnico), declara o motivo em `public.audit_excluded_tables`.
// Vale para as três faixas, só DEPOIS da 0288 / 1026 / 2008.
{
  const faixa = Number(target.slice(0, 4));
  const vale =
    (faixa >= 288 && faixa < 1000) || (faixa > 1026 && faixa < 2000) || faixa > 2008;
  const criadas = [
    ...semComentarios.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(public|empresarial|indica)\.(\w+)/gi
    ),
  ].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  if (vale && criadas.length > 0) {
    const prende = /select\s+public\.audit_attach_all\s*\(\s*\)/i.test(semComentarios);
    const declaradas = new Set(
      [
        ...semComentarios.matchAll(
          /\(\s*'(public|empresarial|indica)'\s*,\s*'(\w+)'\s*,\s*'/gi
        ),
      ].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`)
    );
    const declaraFora =
      /insert\s+into\s+public\.audit_excluded_tables/i.test(semComentarios);
    const semDestino = criadas.filter((t) => !(declaraFora && declaradas.has(t)));
    if (!prende && semDestino.length > 0) {
      problems.push(
        `tabela nova fora da auditoria: ${semDestino.join(", ")}\n` +
          `      Desde a 0288 toda tabela de cadastro tem o gatilho da auditoria.\n` +
          `      Termine a migração com "select public.audit_attach_all();" — ou,\n` +
          `      se ela não deve ser auditada, declare o motivo em\n` +
          `      public.audit_excluded_tables (schema, tabela, motivo).`
      );
    }
  }
}

// Regra 10 — DELETE/UPDATE SEM WHERE NÃO RODA PELA API (OC-00103, 16/10/2026).
//
// A conexão da API do Supabase carrega o `safeupdate`, que RECUSA "DELETE
// requires a WHERE clause" — também dentro de função `security definer`. No
// SQL Editor e na conexão direta dos scripts ele NÃO está carregado: a função
// passa em todo teste e quebra na tela. Foi assim que a importação de extrato
// (0196) parou: `delete from tmp_import_keys;`. O conserto é declarar o
// alcance: `where true` quando a intenção é mesmo a tabela inteira.
// Só olha o CORPO das funções (o que roda pela API); `on conflict ... do
// update set` é INSERT e não é afetado. Vale depois da 0297.
if (target.slice(0, 4) > "0297") {
  const corpos = semComentarios.split("$$").filter((_, i) => i % 2 === 1);
  for (const corpo of corpos) {
    // Texto entre aspas sai antes de separar por ";" (um ";" dentro de uma
    // mensagem partiria o comando ao meio).
    const semTextos = corpo.replace(/'(?:[^']|'')*'/g, "''");
    for (const comando of semTextos.split(";")) {
      const c = comando.replace(/\s+/g, " ");
      const m = c.match(/\b(delete\s+from|update)\s+(?:only\s+)?([\w."]+)/i);
      if (!m) continue;
      const resto = c.slice(m.index);
      if (/^update/i.test(m[1])) {
        if (!/\bset\b/i.test(resto)) continue; // "for update", gatilho "or update on"
        if (/\bdo\s*$/i.test(c.slice(0, m.index))) continue; // on conflict do update
      }
      if (/\bwhere\b/i.test(resto)) continue;
      problems.push(
        `${m[1].toUpperCase()} sem WHERE dentro de função: ${resto.trim().slice(0, 80)}\n` +
          `      Pela API o Supabase recusa ("DELETE requires a WHERE clause") — a\n` +
          `      função passa no SQL Editor e quebra na tela. Se a intenção é a\n` +
          `      tabela inteira, escreva "where true". Ver OC-00103.`
      );
    }
  }
}

for (const m of sql.matchAll(FN)) {
  const [, schema, nomeCurto, args, returns, lang] = m;
  // Nas mensagens `public.` fica implícito (como sempre foi); os outros
  // schemas aparecem, para não confundir funções de mesmo nome.
  const name = schema.toLowerCase() === "public" ? nomeCurto : `${schema}.${nomeCurto}`;
  const prev = known.get(nomeDe(schema, nomeCurto));
  const caiu = drops.has(nomeDe(schema, nomeCurto));

  // Regra 3 — lista de PARÂMETROS mudou sem drop. Não dá erro ao criar: cria
  // uma sobrecarga. O erro aparece depois, na chamada, como "function is not
  // unique" — longe da causa, e só quando alguém usa a tela.
  if (prev && norm(args) !== prev.args && !caiu) {
    problems.push(
      `${name}: os parâmetros mudaram desde ${prev.file} e não há ` +
        `"drop function" antes — vai virar sobrecarga, e a chamada antiga ` +
        `fica ambígua.`
    );
  }

  // Regra 1 — retorno mudou sem drop.
  if (prev && norm(returns) !== prev.returns && !caiu) {
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
