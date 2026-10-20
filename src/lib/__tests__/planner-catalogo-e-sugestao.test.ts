import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mensagemDaSugestao, validarSugestao } from "@/lib/sugestao-de-procedimento";

// Relatos OC-00067 e OC-00068 (Dentista Planner, treino, 21/09/2026). Eram
// REGRA combinada (0039: o Planner gerenciava o catálogo; 0036: "linha livre"
// no orçamento), mudada pelo dono em 19/10/2026:
//   - o Planner CONSULTA o catálogo e edita DIRETO só as sessões;
//   - item personalizado sai para TODOS; o preço do item é o do catálogo;
//   - procedimento novo: o Planner SUGERE, o Admin aprova (cria), recusa ou
//     pede mais informações.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const MIGRACAO = ler("supabase/migrations/0306_planner_procedimentos_e_sugestoes.sql");
const corpoDe = (nome: string) => {
  const i = MIGRACAO.indexOf(`function public.${nome}(`);
  return MIGRACAO.slice(i, MIGRACAO.indexOf("$$;", i));
};

const ok = { name: "Lente de contato", specialty: "Prótese", pillar: "aesthetics", sessions: "3", totalMinutes: "120", justification: "Pacientes pedem e não temos." };

describe("a sugestão — a mesma régua do banco", () => {
  it("aceita a sugestão completa", () => {
    const r = validarSugestao(ok);
    expect("valores" in r && r.valores).toMatchObject({ name: "Lente de contato", sessions: 3, totalMinutes: 120, pillar: "aesthetics" });
  });

  it("recusa nome curto, sessões fora de 1–50 e justificativa vazia", () => {
    expect("erro" in validarSugestao({ ...ok, name: "ab" })).toBe(true);
    expect("erro" in validarSugestao({ ...ok, sessions: "0" })).toBe(true);
    expect("erro" in validarSugestao({ ...ok, sessions: "51" })).toBe(true);
    expect("erro" in validarSugestao({ ...ok, justification: "curto" })).toBe(true);
  });

  it("pilar desconhecido vira 'sem pilar' (nunca vai inválido ao banco)", () => {
    const r = validarSugestao({ ...ok, pillar: "Estetica" });
    expect("valores" in r && r.valores.pillar).toBeNull();
  });

  it("os recados do banco em português; o desconhecido não vira chute", () => {
    expect(mensagemDaSugestao("PROCEDURE_EXISTS")).toMatch(/já está no catálogo/);
    expect(mensagemDaSugestao("ALGO_NOVO")).toBeNull();
  });
});

describe("o banco (0306)", () => {
  it("catálogo e preço por unidade: só o Admin Master grava", () => {
    expect(MIGRACAO).toMatch(/create policy "procedures_write" on public\.procedures\s+for all to authenticated\s+using \(public\.is_admin_master\(\)\)\s+with check \(public\.is_admin_master\(\)\);/);
    expect(MIGRACAO).toMatch(/create policy "clinic_procedure_prices_write" on public\.clinic_procedure_prices\s+for all to authenticated\s+using \(public\.is_admin_master\(\)\)/);
  });

  it("sessões da rede: o Planner grava direto, pela função", () => {
    const corpo = corpoDe("set_network_procedure_sessions");
    expect(corpo).toContain("if v_user is null then raise exception 'NOT_ALLOWED'; end if;");
    expect(corpo).toContain("if not (public.is_admin_master() or public.is_planner()) then");
    expect(corpo).toContain("where procedure_id = p_procedure_id and clinic_id is null;");
  });

  it("orçamento: só item do catálogo, com o nome e o preço do catálogo, e eles não mudam", () => {
    const corpo = corpoDe("plan_item_catalog_guard");
    expect(corpo).toContain("if new.procedure_id is null then\n      raise exception 'CATALOG_ITEM_REQUIRED';");
    expect(corpo).toContain("new.unit_price_cents := coalesce(public.catalog_price_for(new.clinic_id, new.procedure_id), 0);");
    expect(corpo).toContain("raise exception 'ITEM_PRICE_LOCKED';");
  });

  it("a trava roda como QUEM CHAMA — com `security definer` ela nunca valeria", () => {
    const i = MIGRACAO.indexOf("create or replace function public.plan_item_catalog_guard()");
    const cabecalho = MIGRACAO.slice(i, MIGRACAO.indexOf("as $$", i));
    expect(cabecalho).toContain("security invoker");
    expect(cabecalho).not.toContain("security definer");
  });

  it("decidir a sugestão é só do Admin; responder, só de quem sugeriu", () => {
    for (const f of ["ask_procedure_suggestion_info", "reject_procedure_suggestion", "approve_procedure_suggestion"]) {
      expect(corpoDe(f), f).toContain("if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;");
    }
    expect(corpoDe("answer_procedure_suggestion")).toContain("if s.proposed_by is distinct from v_user then raise exception 'NOT_ALLOWED'; end if;");
  });

  it("aprovar transforma as sessões sugeridas no protocolo (a última absorve o resto)", () => {
    expect(corpoDe("approve_procedure_suggestion")).toContain("case when i = s.sessions then coalesce(s.total_minutes, 0) - v_base * (s.sessions - 1) else v_base end");
  });

  it("as tabelas novas entram na auditoria e as funções não abrem sem login", () => {
    expect(MIGRACAO).toContain("select public.audit_attach_all();");
    expect(MIGRACAO).toContain("revoke execute on function public.suggest_procedure(text, text, text, integer, integer, text) from public, anon, authenticated;");
  });
});

describe("as telas", () => {
  it("cadastro, preço e importação: só o Admin; o Planner vê e edita sessões", () => {
    const acoes = ler("src/app/(app)/procedimentos/actions.ts");
    expect(acoes).toMatch(/function canEdit\(session: SessionContext\): boolean \{\s+return session\.isAdminMaster;\s+\}/);
    expect(acoes).toContain("? session.isAdminMaster || isPlannerSession(session)");
    expect(acoes).toContain('supabase.rpc("set_network_procedure_sessions"');
    const pagina = ler("src/app/(app)/procedimentos/page.tsx");
    expect(pagina).toContain("const canManageCatalog = session.isAdminMaster;");
    expect(pagina).toContain("{!unitId && canManageCatalog && <ImportProcedures />}");
    expect(ler("src/app/(app)/procedimentos/precificacao/page.tsx")).toContain('if (!session.isAdminMaster) redirect("/procedimentos");');
  });

  it("no editor, os botões de cadastro só para o Admin; o relógio aplica direto para o Planner", () => {
    const editor = ler("src/app/(app)/procedimentos/procedures-editor.tsx");
    expect(editor).toMatch(/\{canManageCatalog && \(\s+<>\s+<Button\s+variant="ghost"\s+size="icon"\s+aria-label="Editar"/);
    expect(editor).toContain('isAdmin || canEditNetworkSessions ? "apply" : "propose";');
  });

  it("no plano: sem item personalizado, sem preço digitado, e com o caminho para sugerir", () => {
    const plano = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    expect(plano).not.toContain('label: "Item personalizado"');
    expect(plano).not.toContain('aria-label="Valor unitário"');
    // Sem procedimento do catálogo, o botão não habilita (OD3 acrescentou o
    // lugar do item à mesma condição).
    expect(plano).toMatch(/disabled=\{\s*!procId \|\|\s*isPending/);
    expect(plano).toContain("<BotaoSugerirProcedimento");
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    expect(acoes).toContain("if (!input.procedureId) {");
    expect(acoes).toContain(".filter((r) => r.procedure_id != null);");
    const editar = acoes.slice(acoes.indexOf("export async function editBudgetItem("), acoes.indexOf("export async function removeBudgetItem("));
    expect(editar).not.toContain("unit_price_cents");
  });
});
