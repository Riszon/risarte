// VARREDURA DE TELAS (camada 2)
//
// A camada 1 confere os DADOS; esta abre as TELAS. É a classe de defeito que
// nenhuma conferência de banco alcança: página que quebra ao abrir, rota que
// existe e responde 404 (o caso de `/financeiro/configuracao`), e permissão
// barrando quem devia entrar — ou liberando quem não devia.
//
// COMO ELA ENTRA LOGADA. Esse era o buraco da camada 1: as funções de
// relatório exigem usuário (`can_see_clinic_finance`, 0227) e um script não é
// ninguém. Aqui o script usa a chave de serviço para pedir ao Supabase um
// LINK DE ACESSO DE USO ÚNICO de um usuário que já existe, troca o link por uma
// sessão e guarda os cookies. Mesmo caminho do "entrar pelo link do e-mail" —
// só que o link nunca sai daqui. Nenhuma senha guardada, nenhum usuário criado.
//
// Os cookies são montados pelo PRÓPRIO @supabase/ssr, o mesmo pacote que o app
// usa para lê-los. Escrever o formato à mão seria adivinhar um detalhe interno
// que muda de versão em versão, e a varredura passaria a acusar "caiu no login"
// em todo lugar.
//
// LGPD: imprime rota, papel e contagem. Nunca e-mail, nunca nome, nunca id de
// paciente — os ids viajam na URL, mas o relatório mostra o molde da rota.
//
// SÓ LEITURA: exclusivamente GET, nenhuma ação executada. O único rastro é o
// log de auditoria que as fichas já gravam quando são abertas.
//
// Uso:  npm run check:telas        (precisa do "Iniciar Risarte" aberto)
// Sai com código 1 se alguma tela falhar.

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ROUTE_FIXTURES,
  classify,
  fillRoute,
  isBlocked,
  judge,
  routeFromFile,
  routeParams,
} from "./screen-rules.mjs";

const BASE = process.env.RISARTE_URL || "http://localhost:3000";
const APP_DIR = "src/app";
const CONCURRENCY = 3;
// Tela que demora mais que isto é problema em si — e esperar por ela deixaria a
// varredura eterna, que dá no mesmo que não existir.
const TIMEOUT_MS = 60_000;
const SLOW_MS = 8_000;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
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

// ---- rotas -----------------------------------------------------------------

function pageFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pageFiles(full, out);
    else if (entry.name === "page.tsx") out.push(relative(APP_DIR, full));
  }
  return out;
}

// ---- registros de verdade para as rotas com [id] ---------------------------

const FIXTURE_SOURCES = {
  client: () => admin.from("clients").select("id").limit(1),
  user: () => admin.from("profiles").select("id").limit(1),
  company: () =>
    admin.schema("empresarial").from("companies").select("id").limit(1),
  pprMembership: () => admin.from("ppr_memberships").select("id").limit(1),
  pprPlan: () => admin.from("ppr_plans").select("id").limit(1),
  pprBeneficiary: () => admin.from("ppr_beneficiaries").select("id").limit(1),
  cancellation: () => admin.from("plan_cancellations").select("id").limit(1),
  clinicalDocument: () => admin.from("clinical_documents").select("id").limit(1),
  renegotiation: () =>
    admin.from("payment_renegotiations").select("id").limit(1),
};

async function loadFixtures() {
  const ids = {};
  for (const [key, query] of Object.entries(FIXTURE_SOURCES)) {
    const { data, error } = await query();
    if (error) throw new Error(`${key}: ${error.message}`);
    if (data?.length) ids[key] = data[0].id;
  }
  return ids;
}

// ---- quem vai varrer -------------------------------------------------------

const ROLE_LABELS = {
  receptionist: "Recepcionista",
  dentist: "Dentista",
  unit_manager: "Gerente de Unidade",
  finance_franchisor: "Financeiro da Franqueadora",
  purchaser: "Comprador da Franqueadora",
  commercial_consultant: "Consultor Comercial",
};
const TARGET_ROLES = Object.keys(ROLE_LABELS);

/**
 * Escolhe UM usuário por papel — e só serve quem tem AQUELE papel e mais
 * nenhum. Um gerente que também é recepcionista em outra unidade responderia
 * como gerente, e a varredura concluiria que a recepção enxerga contas a pagar.
 */
async function pickPersonas() {
  const [{ data: profiles }, { data: roles }, { data: clinics }] =
    await Promise.all([
      admin.from("profiles").select("id, email, is_admin_master, is_active"),
      admin.from("user_clinic_roles").select("user_id, clinic_id, role"),
      admin.from("clinics").select("id, name, type, is_active"),
    ]);

  const byUser = new Map();
  for (const r of roles ?? []) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }

  const franchisor = (clinics ?? []).find((c) => c.type === "franchisor");
  const unit = (clinics ?? []).find(
    (c) => c.type === "franchise_unit" && c.is_active
  );

  const personas = [];
  const missing = [];

  const master = (profiles ?? []).find((p) => p.is_admin_master && p.is_active);
  if (!master) throw new Error("nenhum Admin Master ativo — nada a varrer");

  // O Admin Master entra duas vezes de propósito: a tela da Franqueadora e a
  // da unidade são caminhos diferentes no mesmo código, e há página que só
  // quebra em um dos dois.
  if (franchisor) {
    personas.push({
      label: "Admin Master (Franqueadora)",
      email: master.email,
      role: null,
      isAdminMaster: true,
      clinicId: franchisor.id,
    });
  }
  if (unit) {
    personas.push({
      label: "Admin Master (unidade)",
      email: master.email,
      role: null,
      isAdminMaster: true,
      clinicId: unit.id,
    });
  }

  for (const role of TARGET_ROLES) {
    const found = (profiles ?? []).find((p) => {
      if (!p.is_active || p.is_admin_master) return false;
      const mine = byUser.get(p.id) ?? [];
      return (
        mine.length > 0 && mine.every((r) => r.role === role)
      );
    });
    if (!found) {
      missing.push(ROLE_LABELS[role]);
      continue;
    }
    personas.push({
      label: ROLE_LABELS[role],
      email: found.email,
      role,
      isAdminMaster: false,
      clinicId: (byUser.get(found.id) ?? [])[0]?.clinic_id ?? null,
    });
  }

  return { personas, missing };
}

/** Troca um link de uso único por sessão e devolve o cabeçalho de cookies. */
async function signIn(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`link de acesso: ${error.message}`);

  const jar = new Map();
  const ssr = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () =>
          [...jar].map(([name, value]) => ({ name, value })),
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

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

// ---- a varredura -----------------------------------------------------------

async function visit(route, cookie) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, {
      headers: { cookie, "user-agent": "risarte-check-screens" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body =
      res.status === 200 && res.headers.get("content-type")?.includes("html")
        ? await res.text()
        : "";
    return {
      ...classify({
        status: res.status,
        location: res.headers.get("location"),
        body,
      }),
      ms: Date.now() - started,
    };
  } catch (e) {
    const timeout = e.name === "TimeoutError";
    return {
      verdict: "erro",
      detail: timeout
        ? `não respondeu em ${TIMEOUT_MS / 1000}s`
        : `não respondeu (${e.message})`,
      ms: Date.now() - started,
    };
  }
}

async function sweep(persona, targets, onProgress) {
  const cookie =
    (await signIn(persona.email)) +
    (persona.clinicId ? `; risarte_active_clinic=${persona.clinicId}` : "");

  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < targets.length) {
        const target = targets[next++];
        const outcome = await visit(target.url, cookie);
        results.push({
          route: target.route,
          ...judge({
            ...outcome,
            role: persona.role,
            isAdminMaster: persona.isAdminMaster,
            route: target.route,
          }),
          verdict: outcome.verdict,
          ms: outcome.ms,
        });
        onProgress?.(results.length, target.route);
      }
    })
  );
  return results;
}

// ---- programa --------------------------------------------------------------

async function main() {
  const alive = await fetch(BASE + "/login", {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!alive) {
    console.error(
      `O servidor não respondeu em ${BASE}.\n` +
        `Abra o "Iniciar Risarte" (clique duplo), espere a página do sistema ` +
        `aparecer e rode a conferência de novo.`
    );
    process.exitCode = 2;
    return;
  }

  console.log("Varrendo as telas do sistema...\n");

  const fixtures = await loadFixtures();
  const routes = [...new Set(pageFiles(APP_DIR).map(routeFromFile))].sort();

  const targets = [];
  const semDado = [];
  for (const route of routes) {
    const params = routeParams(route);
    if (params.length === 0) {
      targets.push({ route, url: route });
      continue;
    }
    const fixture = ROUTE_FIXTURES[route];
    if (!fixture) {
      semDado.push(`${route} (rota variável sem registro previsto na regra)`);
      continue;
    }
    if (!fixtures[fixture]) {
      semDado.push(`${route} (não há registro deste tipo no banco)`);
      continue;
    }
    targets.push({ route, url: fillRoute(route, fixtures[fixture]) });
  }

  const { personas, missing } = await pickPersonas();

  console.log(
    `${targets.length} telas, ${personas.length} perfis. ` +
      `A primeira passagem é a mais lenta (o servidor monta cada tela na ` +
      `primeira vez que ela é aberta).\n`
  );

  let falhas = 0;
  const lentas = [];
  for (const persona of personas) {
    const started = Date.now();
    const line = (text) =>
      process.stdout.write("\r" + text.padEnd(72).slice(0, 72));
    line(`  ...   ${persona.label}: abrindo as telas`);
    let results;
    try {
      results = await sweep(persona, targets, (done) =>
        line(`  ...   ${persona.label}: ${done}/${targets.length} telas`)
      );
    } catch (e) {
      line("");
      console.log(`\r  FALHA  ${persona.label}: ${e.message}\n`);
      falhas++;
      continue;
    }

    const conta = (level) => results.filter((r) => r.level === level).length;
    const abriram = results.filter((r) => r.verdict === "ok").length;
    const bloqueadas = results.filter((r) => isBlocked(r.verdict)).length;
    const ruins = results.filter((r) => r.level === "falha");
    falhas += ruins.length;

    line("");
    console.log(
      `\r  ${ruins.length === 0 ? "OK   " : "FALHA"}  ${persona.label} — ` +
        `${abriram} abriram, ${bloqueadas} bloqueadas, ${ruins.length} falha(s)` +
        ` (${((Date.now() - started) / 1000).toFixed(0)}s)`
    );
    for (const r of ruins) console.log(`           ${r.route}: ${r.note}`);

    // Tela lenta não é falha, mas é notícia: na primeira passagem o servidor
    // ainda está montando cada página, então só vale contar a partir da
    // segunda — antes disso o número mede o compilador, não a tela.
    if (personas.indexOf(persona) > 0) {
      for (const r of results
        .filter((r) => r.ms >= SLOW_MS)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3)) {
        lentas.push(`${r.route} (${(r.ms / 1000).toFixed(0)}s)`);
      }
    }

    const observadas = results.filter((r) => r.level === "observado");
    if (observadas.length > 0 && observadas.length <= 3) {
      for (const r of observadas) {
        console.log(`           ${r.route}: ${r.note} (sem regra escrita)`);
      }
    } else if (observadas.length > 0 && conta("falha") === 0) {
      console.log(
        `           (${observadas.length} tela(s) sem regra escrita no ` +
          `CLAUDE.md — anotadas, não julgadas)`
      );
    }
  }

  // ---- relatório -----------------------------------------------------------
  console.log(
    `\nVolume conferido: ${targets.length} telas × ${personas.length} perfis = ` +
      `${targets.length * personas.length} aberturas.`
  );
  console.log(
    falhas === 0
      ? `\nNenhuma tela falhou.`
      : `\n${falhas} falha(s) na varredura.`
  );

  // Invariante sem dado não é invariante aprovada — a mesma regra da camada 1.
  if (semDado.length > 0) {
    console.log(
      `\nATENÇÃO: ${semDado.length} tela(s) NÃO conferida(s) por falta de ` +
        `registro para abrir:`
    );
    for (const s of semDado) console.log(`  - ${s}`);
  }
  if (missing.length > 0) {
    console.log(
      `\nATENÇÃO: sem usuário exclusivo destes papéis, então eles não foram ` +
        `conferidos: ${missing.join(", ")}.`
    );
  }
  if (lentas.length > 0) {
    const unicas = [...new Set(lentas.map((l) => l.split(" (")[0]))];
    console.log(
      `\nTelas lentas (não é falha, mas quem usa vai sentir): ` +
        `${unicas.slice(0, 5).join(", ")}.`
    );
  }

  process.exitCode = falhas === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("Erro ao varrer:", e.message);
  process.exitCode = 2;
});
