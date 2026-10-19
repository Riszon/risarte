import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agruparPorEspecialidade,
  pendenciasDoProcedimento,
  SEM_ESPECIALIDADE,
  sobraDoPreco,
  textoDoUso,
} from "@/lib/procedimento-na-lista";

// Pedido do dono (19/10/2026): a lista de Procedimentos em blocos por
// especialidade, uma linha de resumo por procedimento (o que falta, a sobra,
// o uso), detalhes no clique e os inativos à parte, bem diferentes.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const completo = {
  defaultPriceCents: 15000,
  estimatedMinutes: 40,
  sessionsCount: 0,
  pillar: "aesthetics",
  levelIds: ["j", "s"],
  payoutByLevel: { j: { amountCents: 750 }, s: { amountCents: 900 } },
};

describe("o que falta para o orçamento", () => {
  it("completo não tem pendência", () => {
    expect(pendenciasDoProcedimento(completo)).toEqual([]);
  });

  it("aponta preço zerado, tempo, pilar e repasse, nessa ordem", () => {
    expect(
      pendenciasDoProcedimento({
        ...completo,
        defaultPriceCents: 0,
        estimatedMinutes: null,
        pillar: null,
        payoutByLevel: { j: { amountCents: 750 } },
      })
    ).toEqual(["preco", "tempo", "pilar", "repasse"]);
  });

  it("sessões da rede contam como tempo", () => {
    expect(pendenciasDoProcedimento({ ...completo, estimatedMinutes: null, sessionsCount: 2 })).toEqual([]);
  });

  it("sem níveis cadastrados, o repasse não é cobrado", () => {
    expect(pendenciasDoProcedimento({ ...completo, levelIds: [], payoutByLevel: {} })).toEqual([]);
  });
});

describe("a sobra do preço", () => {
  it("preço − material − o MAIOR repasse", () => {
    expect(sobraDoPreco(15000, 1000, { j: { amountCents: 750 }, s: { amountCents: 2000 } })).toEqual({
      sobraCents: 12000,
      percentual: 80,
      negativa: false,
    });
  });

  it("negativa quando o preço não paga material e repasse", () => {
    expect(sobraDoPreco(1000, 800, { s: { amountCents: 500 } })?.negativa).toBe(true);
  });

  it("sem preço não há conta (nunca '0%')", () => {
    expect(sobraDoPreco(0, 100, {})).toBeNull();
  });
});

describe("os blocos por especialidade", () => {
  it("na ordem da lista de especialidades; as de fora depois; 'Sem especialidade' no fim", () => {
    const itens = [
      { id: 1, specialty: null },
      { id: 2, specialty: "Zeta" },
      { id: 3, specialty: "Endodontia" },
      { id: 4, specialty: "Ortodontia" },
      { id: 5, specialty: "Endodontia" },
    ];
    const g = agruparPorEspecialidade(itens, ["Ortodontia", "Endodontia"]);
    expect(g.map((x) => x.especialidade)).toEqual(["Ortodontia", "Endodontia", "Zeta", SEM_ESPECIALIDADE]);
    expect(g[1].itens.map((x) => x.id)).toEqual([3, 5]);
  });
});

describe("o uso", () => {
  it("medido diz quanto; não medido não vira 'não usado'", () => {
    expect(textoDoUso(0)).toBe("não usado em 90 dias");
    expect(textoDoUso(3)).toBe("3 planos em 90 dias");
    expect(textoDoUso(null)).toBeNull();
  });
});

describe("a tela e o banco", () => {
  const editor = ler("src/app/(app)/procedimentos/procedures-editor.tsx");

  it("inativos ficam fora dos blocos dos ativos, numa seção própria", () => {
    expect(editor).toContain("const ativos = procedures.filter((p) => p.isActive);");
    expect(editor).toContain("agruparPorEspecialidade(visiveis, specialties)");
    expect(editor).toContain("{inativos.map((p) => linha(p, true))}");
  });

  it("o inativo tem cara de inativo: tracejado, cinza e riscado", () => {
    expect(editor).toContain('"rounded-lg border border-dashed bg-muted/60 text-muted-foreground"');
    expect(editor).toContain('${inativo ? "line-through decoration-1" : ""}');
  });

  it("os detalhes só aparecem com a linha aberta, uma por vez", () => {
    expect(editor).toContain("open={abertoId === p.id}");
    expect(editor).toContain('<div className="space-y-2 border-t px-3 pb-3 pt-2">');
    expect(editor.indexOf("{open && (")).toBeLessThan(editor.indexOf("<PayoutByLevel\n"));
  });

  it("uso que não foi medido não é mostrado como zero", () => {
    const pagina = ler("src/app/(app)/procedimentos/page.tsx");
    expect(pagina).toContain("let usageByProcedure: Record<string, number> | null = null;");
    expect(pagina).toContain("if (!usageError) {");
    expect(editor).toContain("uso={usageByProcedure ? (usageByProcedure[p.id] ?? 0) : null}");
  });

  it("a contagem de uso (0307) só para quem vê o catálogo, e não abre sem login", () => {
    const m = ler("supabase/migrations/0307_uso_dos_procedimentos.sql");
    expect(m).toContain("if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;");
    expect(m).toContain("if not (public.is_admin_master() or public.is_planner()) then raise exception 'NOT_ALLOWED'; end if;");
    expect(m).toContain("revoke execute on function public.procedure_usage_counts(uuid, integer) from public, anon, authenticated;");
    expect(m).toContain("count(distinct o.plan_id)");
  });
});
