import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_PROVIDER_ROLES, APPOINTMENT_TYPES } from "@/lib/appointments";
import { nationalHolidays } from "@/lib/holidays";
import { repasseDosItensAceitos } from "@/lib/finance/custos-da-margem";

/**
 * O LOTE DAS MIGRAÇÕES DE 10/11/2026 — AP71 (0375), AP81 (0376), AP126 (0377)
 * e AP133 (0378). Cada régua aqui prende uma regra que mora em DOIS lugares
 * (banco e código) ou que some sem ninguém ver.
 */
const ler = (arq: string) => readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const MIG = "supabase/migrations";
const m0375 = ler(`${MIG}/0375_lista_de_compras_vazia_reaproveitada.sql`);
const m0376 = ler(`${MIG}/0376_repasse_estimado_por_item.sql`);
const m0377 = ler(`${MIG}/0377_feriados_nacionais_ate_2045.sql`);
const m0378 = ler(`${MIG}/0378_profissional_do_horario_conferido_no_banco.sql`);

/** O texto SQL sem os comentários (comentário cita o defeito; não é o código). */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

describe("AP71 (0375) — a lista de compras vazia é reaproveitada", () => {
  const sql = semComentarios(m0375);

  it("procura o rascunho vazio do mesmo tipo ANTES de criar outro", () => {
    const procura = sql.indexOf("r.status = 'rascunho'");
    const cria = sql.indexOf("insert into public.purchase_requests");
    expect(procura).toBeGreaterThan(0);
    expect(cria).toBeGreaterThan(procura);
    expect(sql).toContain("r.is_local = coalesce(p_is_local, false)");
    expect(sql).toContain("select 1 from public.purchase_request_items i where i.request_id = r.id");
    expect(sql).toContain("if v_id is null then");
  });

  it("um clique por vez em cada unidade (trava da transação)", () => {
    expect(sql).toContain("pg_advisory_xact_lock(");
    // A trava vem depois da guarda de quem pode e antes da procura.
    expect(sql.indexOf("pg_advisory_xact_lock(")).toBeGreaterThan(sql.indexOf("raise exception 'NOT_ALLOWED'"));
    expect(sql.indexOf("pg_advisory_xact_lock(")).toBeLessThan(sql.indexOf("r.status = 'rascunho'"));
  });

  it("⚠️ a guarda de quem pode gerar continua a mesma da 0296", () => {
    expect(sql).toContain("public.is_admin_master() or public.can_request_purchase(p_clinic_id)");
  });

  it("⚠️ versão mais nova da função continua reaproveitando", () => {
    // Quem recriar `build_purchase_request` numa migração futura leva isto junto.
    const arquivos = readdirSync(join(process.cwd(), MIG))
      .filter((f) => /^0\d{3}_/.test(f))
      .sort();
    const ultima = arquivos
      .filter((f) => /function public\.build_purchase_request\b/i.test(ler(`${MIG}/${f}`)))
      .pop();
    expect(ultima).toBeDefined();
    expect(semComentarios(ler(`${MIG}/${ultima}`))).toContain("pg_advisory_xact_lock(");
  });
});

describe("AP81 (0376) — a margem conta só o repasse dos itens aceitos", () => {
  it("soma só os aceitos quando o banco devolve o repasse por item", () => {
    const porItem = { a: 1000, b: 2500, c: 400 };
    expect(repasseDosItensAceitos(porItem, ["a", "b", "c"], 3900)).toBe(3900);
    // O cliente tirou o item b: o repasse dele sai da conta.
    expect(repasseDosItensAceitos(porItem, ["a", "c"], 3900)).toBe(1400);
    expect(repasseDosItensAceitos(porItem, [], 3900)).toBe(0);
  });

  it("item sem repasse cadastrado conta zero, não derruba a soma", () => {
    expect(repasseDosItensAceitos({ a: 1000 }, ["a", "sem-procedimento"], 1000)).toBe(1000);
  });

  it("⚠️ sem o repasse por item (banco sem a 0376), vale o total da opção", () => {
    expect(repasseDosItensAceitos(null, ["a"], 3900)).toBe(3900);
    expect(repasseDosItensAceitos(undefined, [], 3900)).toBe(3900);
  });

  it("o painel usa a conta, e o carregador não transforma erro em zero", () => {
    const painel = ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx");
    expect(painel).toContain("payoutCents={repasseDosItensAceitos(");
    expect(painel).not.toContain("payoutCents={payoutByOption[option.id] ?? 0}");
    const carregador = ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts");
    expect(carregador).toContain('supabase.rpc("estimated_option_payout_by_item"');
    expect(carregador).toContain("if (!porItem.error && Array.isArray(porItem.data)) {");
    // As duas telas que montam o painel passam o repasse por item.
    for (const tela of ["src/app/(app)/apresentacao/[clientId]/page.tsx", "src/app/(app)/comercial/[clientId]/page.tsx"]) {
      expect(ler(tela), tela).toContain("payoutByItem={negotiationBlock.payoutByItem}");
    }
  });

  it("a conta de cada linha é a mesma do total, e a porta tem a guarda de unidade", () => {
    const sql = semComentarios(m0376);
    expect(sql).toContain("oi.procedure_id, oi.suggested_provider_id, p_clinic_id, public.today_br()");
    expect(sql).toContain("greatest(1, coalesce(oi.quantity, 1))");
    expect(sql).toContain("where oi.option_id = p_option_id and oi.procedure_id is not null");
    expect(sql).toContain("not public.can_read_clinic_data(p_clinic_id)");
    expect(sql).toContain("from public, anon, authenticated");
  });
});

describe("AP126 (0377) — os feriados semeados são os da função do código", () => {
  const linhas = [...m0377.matchAll(/\(date '(\d{4}-\d{2}-\d{2})', '([^']+)'\)/g)].map((m) => ({
    date: m[1],
    name: m[2],
  }));

  it("a régua está medindo alguma coisa", () => {
    expect(linhas.length).toBe(16 * 12);
  });

  it("cada linha da migração é igual à de nationalHolidays()", () => {
    const esperado = [];
    for (let ano = 2030; ano <= 2045; ano++) esperado.push(...nationalHolidays(ano));
    expect(linhas).toEqual(esperado);
  });

  it("⚠️ faltando menos de 3 anos de semente, reprova: é hora de semear mais", () => {
    const ultimoAno = Math.max(...linhas.map((l) => Number(l.date.slice(0, 4))));
    const anoDeHoje = new Date().getUTCFullYear();
    expect(
      ultimoAno - anoDeHoje,
      `A tabela public.holidays só tem os feriados nacionais até ${ultimoAno}. ` +
        "Escreva uma migração nova com mais anos (o gerador é nationalHolidays())."
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("AP133 (0378) — o banco confere a função do profissional do horário", () => {
  const sql = semComentarios(m0378);

  it("⚠️ a lista do banco é o espelho de TYPE_PROVIDER_ROLES", () => {
    const doBanco: Record<string, string[]> = {};
    for (const m of sql.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) {
      doBanco[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
    // Zero linhas = a busca não achou o que medir, não "está igual".
    expect(Object.keys(doBanco).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(doBanco).sort()).toEqual([...APPOINTMENT_TYPES].sort());
    for (const tipo of APPOINTMENT_TYPES) {
      expect(doBanco[tipo], tipo).toEqual(TYPE_PROVIDER_ROLES[tipo]);
    }
  });

  it("o gatilho vale só para a API e fecha quando não consegue conferir", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("if current_user <> 'authenticated' then");
    expect(sql).toContain(
      "if not coalesce(public._provider_serves_type(new.clinic_id, new.type, new.provider_user_id), false) then"
    );
    expect(sql).toContain("before insert or update of provider_user_id, type on public.appointments");
  });

  it("a troca de última hora passa pela porta, e a original não responde a logado", () => {
    expect(sql).toContain("rename to _swap_appointment_provider_raw");
    expect(sql).toContain(
      "revoke execute on function public._swap_appointment_provider_raw(uuid, uuid, text) from public, anon, authenticated"
    );
    expect(sql).toContain("and not coalesce(public._provider_serves_type(v_clinic, v_type, p_new_provider), false)");
    expect(sql).toContain("perform public._swap_appointment_provider_raw(p_appointment_id, p_new_provider, p_reason);");
  });

  it("o Consultor comercial vale pelo acesso à unidade, como na janela", () => {
    expect(sql).toContain("public.providers_with_access(p_clinic_id, 'commercial_consultant'::public.user_role)");
  });

  it("a agenda traduz a recusa do banco nos três caminhos", () => {
    const acoes = ler("src/app/(app)/agenda/actions.ts");
    expect(acoes.match(/error\.message\.includes\("PROVIDER_ROLE_MISMATCH"\)/g)?.length).toBe(3);
    expect(acoes).toContain("const PROFISSIONAL_NAO_ATENDE =");
  });
});
