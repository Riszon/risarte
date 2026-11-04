import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planoVendidoDeBase, planosVendidos, podeAbrirComplemento } from "@/lib/plano-complementar";

// AP64, passo 3 (decisão do dono, 03/11/2026; docs/comercial/AP63-AP64-PLANO.md
// §3 item 5): "a venda do complemento gera SÓ as sessões dele". O defeito que a
// 0358 evita foi provado no treino (transação desfeita): sem ela, um item novo
// do plano ORIGINAL ficava sem sessão, porque a geração escolhia o complemento.
// Ensaio 14/14 com a 0358; sem ela, 3 reprovam.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0358_plano_complementar_sessoes.sql");

describe("AP64 passo 3 — o banco (0358)", () => {
  it("as sessões do complemento saem só dos complementos VENDIDOS e sem duplicar", () => {
    const i = sql.indexOf("create or replace function public._generate_complement_sessions(");
    const corpo = sql.slice(i, sql.indexOf("$$;", i));
    expect(corpo).toContain("and tp.complement_of_plan_id is not null");
    expect(corpo).toContain("and s.closed_at is not null");
    expect(corpo).toContain("and s.cancelled_at is null");
    expect(corpo).toContain("where not exists (select 1 from public.treatment_sessions ts where ts.item_id = r.item_id)");
    expect(corpo).toContain("and ni.included = false");
    expect(sql).toContain("revoke execute on function public._generate_complement_sessions(uuid, uuid) from public, anon, authenticated;");
  });

  it("fechar a venda do complemento gera as sessões e nunca derruba o fechamento", () => {
    expect(sql).toContain("after update of closed_at on public.commercial_sales");
    expect(sql).toContain("raise warning 'commercial_sale_complement_sessions (%): %'");
  });

  it("a geração normal nunca escolhe o complemento (e completa o plano original)", () => {
    const t = sql.indexOf("create or replace function public.topup_treatment_sessions(");
    const topup = sql.slice(t, sql.indexOf("$$;", sql.indexOf("$$", t) + 2));
    expect(topup).toContain("perform public._generate_complement_sessions(p_client_id, v_clinic);");
    expect(topup.match(/complement_of_plan_id is null/g)?.length).toBe(4);
    const e = sql.indexOf("create or replace function public.ensure_treatment_sessions(");
    const ensure = sql.slice(e);
    expect(ensure.match(/complement_of_plan_id is null/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("AP64 passo 3 — o plano vendido pela venda, não pela marcação manual", () => {
  const vendido = {
    id: "v", status: "approved" as const, lifecycle: "aguardando_apresentacao" as const,
    createdAt: "2026-10-01T10:00:00Z", supersededAt: null, complementOfPlanId: null, complementNo: null,
  };

  it("plano com negociação aceita é o vendido, mesmo marcado 'aguardando apresentação'", () => {
    // No treino, 3 de 4 planos vendidos seguiam assim: o botão do Coordenador
    // dizia que não havia plano vendido.
    const vendidos = planosVendidos({ v: { status: "aceita" } });
    expect(planoVendidoDeBase([vendido], vendidos)?.id).toBe("v");
    expect(podeAbrirComplemento({ fase: "treatment_start", ehCoordenadorOuAdmin: true, planos: [vendido], vendidos }))
      .toEqual({ pode: true, baseId: "v" });
  });

  it("sem negociação aceita, não é vendido", () => {
    expect(planoVendidoDeBase([vendido], planosVendidos({ v: { status: "em_negociacao" } }))).toBeNull();
  });

  it("o prontuário e a faixa usam a negociação aceita", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/page.tsx")).toContain("vendidos: planosVendidos(commercialByPlan),");
    expect(ler("src/app/(app)/prontuarios/[id]/plan-editor-switcher.tsx")).toContain(
      "planoVendidoDeBase(plans, planosVendidos(commercialByPlan))"
    );
  });

  it("a lista de procedimentos inclui o complemento vendido, com o nome dele", () => {
    const p = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(p).toContain("`Complemento ${pl.complement_no ?? \"\"}`");
  });
});
