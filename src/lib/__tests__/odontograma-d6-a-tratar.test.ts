import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { corDaMarca } from "@/lib/odontograma/desenho";
import { marcasDoDesenho, type Achado } from "@/lib/odontograma/diagnostico";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("cor: o achado que pede tratamento é VERMELHO (decisão do dono, 20/10/2026)", () => {
  it("a tratar = vermelho, existente ou sugestão; o resto como antes", () => {
    expect(corDaMarca({ situacao: "existente", codigo: "C", aTratar: true }).classe).toBe("planejado");
    expect(corDaMarca({ situacao: "sugerido", codigo: "C", aTratar: true })).toEqual({ classe: "planejado", tracejado: true });
    expect(corDaMarca({ situacao: "existente", codigo: "R", aTratar: false }).classe).toBe("existente");
    expect(corDaMarca({ situacao: "existente", codigo: "A" }).classe).toBe("ausente");
    expect(corDaMarca({ situacao: "planejado", codigo: "PLANO" }).classe).toBe("planejado");
  });
  it("a marca do desenho leva o 'a tratar' da situação", () => {
    const a: Achado = {
      id: "1", evaluationId: "r", dente: "16", faces: ["O"], situacao: "C", acao: "mark", retira: null,
      origem: "direct", adendo: false, motivoDoAdendo: null, status: "defined", ajustadoDe: null, observacao: null,
      criadoPor: null, criadoEm: "2026-10-20T10:00:00Z", decididoPor: null, decididoEm: "2026-10-20T10:00:00Z", motivoDaDecisao: null,
    };
    const sit = (aTratar: boolean) => [{ code: "C", name: "Cariado", appliesTo: "face" as const, usage: "finding" as const, symbol: "C", isActive: true, sortOrder: 1, aTratar }];
    expect(marcasDoDesenho([a], sit(true))[0].aTratar).toBe(true);
    expect(marcasDoDesenho([a], sit(false))[0].aTratar).toBe(false);
  });
  it("a 0312 semeia UMA vez (rodar de novo não desfaz o ajuste do Admin)", () => {
    const sql = ler("supabase/migrations/0312_plano_so_titular_e_achado_a_tratar.sql");
    expect(sql).toContain("if not exists (select 1 from information_schema.columns");
    expect(sql).toContain("and column_name = 'needs_treatment') then");
    expect(sql).toMatch(/code in \('C', 'E',/);
  });
});

describe("D6 no plano: montar é do Planner e do titular; o Admin vê", () => {
  const sql = ler("supabase/migrations/0312_plano_so_titular_e_achado_a_tratar.sql");
  it("nenhuma regra de GRAVAR no plano aceita o Admin Master sozinho", () => {
    const regras = [...sql.matchAll(/create policy (\w+) on public\.(\w+)[\s\S]*?;/g)];
    expect(regras.length).toBe(13);
    for (const r of regras) expect(r[0], r[1]).not.toContain("is_admin_master");
    for (const r of regras) expect(r[0], r[1]).toContain("public.is_owner()");
  });
  it("o envio também", () => {
    const envio = sql.slice(sql.indexOf("function public.submit_treatment_plan"));
    expect(envio).toContain("if v_user is null or not (public.is_owner() or public.is_planner()) then");
    expect(envio).not.toContain("is_admin_master");
  });
  it("na tela: a guarda das ações e o editor seguem o titular, a leitura não muda", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    expect(acoes).toContain("Boolean(session.isOwner) ||");
    expect(acoes).not.toMatch(/function isPlannerSession[\s\S]{0,300}session\.isAdminMaster/);
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toContain("const podeMontarPlano = Boolean(session.isOwner) || isPlannerAnywhere;");
    expect(ficha).toContain("canEdit={podeMontarPlano}");
    expect(ficha).toContain("const canEditPlanning = session.isAdminMaster || isPlannerAnywhere;"); // ver segue
    const cockpit = ler("src/app/(app)/planejamento/[clientId]/page.tsx");
    expect(cockpit).toContain("canEdit={podeDefinir}\n        podeVerPrecos={session.isAdminMaster}");
  });
});
