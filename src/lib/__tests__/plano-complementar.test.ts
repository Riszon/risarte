import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  complementoEmAndamento,
  mensagemDoComplemento,
  planoVendidoDeBase,
  podeAbrirComplemento,
  rotuloDoComplemento,
} from "@/lib/plano-complementar";
import { planoQueAbre } from "@/lib/sequencia-do-plano";
import { itensDoPlanoVigente } from "@/lib/odontograma/plano";

// AP64, passo 1 (decisão do dono, 03/11/2026; plano em
// docs/comercial/AP63-AP64-PLANO.md): o PLANO COMPLEMENTAR. Com o cliente em
// tratamento (Fase 5), o Coordenador abre, o Planner monta e o Coordenador
// aprova. O plano vendido não muda. Comportamento do banco provado no treino
// (ensaio da 0355, transação desfeita, 21/21).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const vendido = {
  id: "v", status: "approved" as const, lifecycle: "em_tratamento" as const,
  createdAt: "2026-10-01T10:00:00Z", supersededAt: null, complementOfPlanId: null, complementNo: null,
};
const comp = (id: string, no: number, status: "draft" | "submitted" | "approved", createdAt = "2026-11-01T10:00:00Z") => ({
  id, status, lifecycle: null, createdAt, supersededAt: null, complementOfPlanId: "v", complementNo: no,
});

describe("AP64 — quem abre o complemento", () => {
  it("o Coordenador abre na Fase 5, a partir do plano vendido", () => {
    expect(podeAbrirComplemento({ fase: "treatment_start", ehCoordenadorOuAdmin: true, planos: [vendido] }))
      .toEqual({ pode: true, baseId: "v" });
  });

  it("fora da Fase 5 ou sem ser Coordenador, o botão não aparece", () => {
    expect(podeAbrirComplemento({ fase: "follow_up", ehCoordenadorOuAdmin: true, planos: [vendido] }))
      .toEqual({ pode: false, motivo: null });
    expect(podeAbrirComplemento({ fase: "treatment_start", ehCoordenadorOuAdmin: false, planos: [vendido] }))
      .toEqual({ pode: false, motivo: null });
  });

  it("um complemento em andamento por vez — e a tela diz o motivo", () => {
    const r = podeAbrirComplemento({ fase: "treatment_start", ehCoordenadorOuAdmin: true, planos: [vendido, comp("c1", 1, "submitted")] });
    expect(r.pode).toBe(false);
    expect(!r.pode && r.motivo).toContain("complementar 1");
    expect(complementoEmAndamento([vendido, comp("c1", 1, "approved")])).toBeNull();
  });

  it("o complemento nunca é a base de outro complemento", () => {
    expect(planoVendidoDeBase([vendido, { ...comp("c1", 1, "approved"), lifecycle: "em_tratamento" as const }])?.id).toBe("v");
  });

  it("o rótulo do cartão diz o número e a situação", () => {
    expect(rotuloDoComplemento(comp("c1", 1, "submitted"))).toBe("Complemento 1 · aguardando aprovação");
    expect(mensagemDoComplemento("ERROR: COMPLEMENT_IN_PROGRESS")).toContain("em andamento");
  });
});

describe("AP64 — o complemento não toma o lugar do plano vendido", () => {
  it("a tela abre no plano do cliente, não no complemento em rascunho", () => {
    expect(planoQueAbre([comp("c1", 1, "draft"), vendido])?.id).toBe("v");
  });

  it("o odontograma marca o que falta do plano vendido, não do complemento", () => {
    const planos = [
      { ...comp("c1", 1, "approved"), options: [{ isPrimary: true, reviewStatus: "approved", items: ["do complemento"] }] },
      { ...vendido, options: [{ isPrimary: true, reviewStatus: "approved", items: ["do vendido"] }] },
    ];
    expect(itensDoPlanoVigente(planos)).toEqual(["do vendido"]);
  });

  it("apresentação, negociação, resumo, assinatura e lista de procedimentos pulam o complemento", () => {
    expect(ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts")).toContain('.not("complement_of_plan_id", "is", null)');
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts")).toContain('.is("complement_of_plan_id", null)');
    const pagina = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    // o resumo do dentista pula o complemento; a lista de procedimentos o
    // inclui só depois de vendido (passo 3, 0358)
    expect(pagina.match(/\.is\("complement_of_plan_id", null\)/g)?.length).toBe(1);
    expect(pagina).toContain('(pl) => !pl.complement_of_plan_id || commercialByPlan[pl.id]?.status === "aceita"');
    expect(pagina).toContain('p.status === "approved" && !p.complementOfPlanId');
    expect(ler("src/app/(app)/jornada/actions.ts")).toContain('.is("complement_of_plan_id", null)');
  });

  it("na lista de Planos, o complemento aprovado não aparece como 'em tratamento'", () => {
    const planos = ler("src/app/(app)/planos/page.tsx");
    expect(planos).toContain("if (ehComplemento) return \"aprovado\";");
    expect(planos).toContain("Boolean(p.complement_of_plan_id)");
  });
});

describe("AP64 — o banco (0355)", () => {
  const sql = ler("supabase/migrations/0355_plano_complementar.sql");

  it("só a função cria a ligação com o plano vendido", () => {
    expect(sql).toContain("raise exception 'COMPLEMENT_BY_FUNCTION'");
    expect(sql).toContain("create or replace function public.open_plan_complement(p_parent_plan_id uuid, p_clinical_notes text)");
    expect(sql).toContain("revoke execute on function public.open_plan_complement(uuid, text) from public, anon, authenticated;");
  });

  it("abre só na Fase 5, sobre plano vendido, um por vez, com as informações clínicas", () => {
    for (const k of ["WRONG_PHASE", "PARENT_NOT_SOLD", "COMPLEMENT_IN_PROGRESS", "CLINICAL_NOTES_REQUIRED"]) {
      expect(sql).toContain(`raise exception '${k}'`);
    }
  });

  it("enviar, aprovar e aprovar por opção conhecem o complemento e não mexem no sub-status", () => {
    for (const fn of ["submit_treatment_plan", "review_treatment_plan", "review_plan_option"]) {
      const i = sql.indexOf(`create or replace function public.${fn}(`);
      expect(i, fn).toBeGreaterThan(-1);
      const corpo = sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2));
      expect(corpo, fn).toContain("v_complemento");
    }
    expect(sql).toContain("if not v_complemento then\n    update public.clients\n      set journey_status = 'awaiting_plan_approval'");
  });
});

describe("AP64 — as telas", () => {
  it("o Planner envia o complemento fora da Fase 3", () => {
    const s = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    expect(s).toContain("const montaAqui = inPlanningPhase || ehComplemento;");
    expect(s).toMatch(/const canSubmit =\s+canEditContent &&\s+montaAqui &&/);
  });

  it("o prontuário mostra o sinal e o botão do Coordenador; a Jornada mostra no cartão", () => {
    const sw = ler("src/app/(app)/prontuarios/[id]/plan-editor-switcher.tsx");
    expect(sw).toContain("<AbrirComplemento clientId={clientId} abertura={aberturaDoComplemento} />");
    expect(sw).toContain("rotuloDoComplemento(c)");
    expect(sw).toContain("!selected.complementOfPlanId && (\n        <PlanLifecycleBar");
    expect(ler("src/app/(app)/jornada/kanban-board.tsx")).toContain("{client.complemento}");
  });
});
