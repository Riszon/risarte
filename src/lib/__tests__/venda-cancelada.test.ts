import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planoTemVendaCancelada, vendasCanceladas } from "@/lib/venda-cancelada";

// AP63 (decisão do dono, 03/11/2026): depois de cancelar, o cliente compra de
// novo por uma NOVA VERSÃO do plano, com negociação nova, e o histórico mostra
// a venda cancelada. Antes, o cancelamento rápido devolvia o cliente à Fase 4
// e "Devolver ao planejamento" reabria como rascunho o plano da venda
// cancelada. Comportamento provado no treino (ensaio da 0354, transação
// desfeita, 7/7; sem a 0354, 4 reprovam).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const ev = (type: string, description: string | null = null) => ({
  id: type, type, description, actorName: null, at: "2026-11-03T12:00:00Z",
});

describe("AP63 — a venda cancelada na linha do tempo", () => {
  it("separa a venda deste plano da venda de um plano anterior", () => {
    const v = vendasCanceladas([
      ev("criado"),
      ev("venda_cancelada", "Venda cancelada — NEG-1 · desistência"),
      ev("venda_cancelada_anterior", "Venda anterior cancelada (plano versão 1) — NEG-0"),
    ]);
    expect(v.map((x) => x.tipo)).toEqual(["deste_plano", "anterior"]);
  });

  it("sem venda cancelada, o aviso não aparece", () => {
    expect(vendasCanceladas([ev("criado"), ev("venda_concluida")])).toEqual([]);
  });

  it("o plano da venda cancelada não volta ao Comercial", () => {
    expect(planoTemVendaCancelada(["criado", "venda_cancelada"])).toBe(true);
    expect(planoTemVendaCancelada(["criado", "venda_cancelada_anterior"])).toBe(false);
  });
});

describe("AP63 — o banco (0354)", () => {
  const sql = ler("supabase/migrations/0354_venda_cancelada_compra_por_versao_nova.sql");

  it("a devolução só reabre o plano quando NÃO há venda cancelada", () => {
    expect(sql).toContain("where n.plan_id = v_plan and n.status = 'cancelada'");
    expect(sql).toMatch(/elsif v_plan is not null then[\s\S]*?status = 'draft'/);
    expect(sql.match(/status = 'draft'/g)?.length).toBe(1);
  });

  it("a função continua fechada para quem não está logado", () => {
    expect(sql).toContain(
      "revoke execute on function public.return_commercial_to_planning(uuid, text) from public, anon, authenticated;"
    );
  });

  it("a versão nova herda as vendas canceladas dos planos anteriores", () => {
    expect(sql).toContain("'venda_cancelada_anterior'");
    expect(sql).toContain("after insert on public.treatment_plans");
    expect(sql).toContain("if new.previous_plan_id is null then");
  });
});

describe("AP63 — as telas", () => {
  it("Enviar ao Comercial recusa o plano da venda cancelada, também para o Admin", () => {
    const a = ler("src/app/(app)/jornada/actions.ts");
    expect(a).toContain("planoTemVendaCancelada(");
    expect(a).toContain("MENSAGEM_ENVIO_COM_VENDA_CANCELADA");
    // A conferência fica FORA do `if (!session.isAdminMaster)`.
    const i = a.indexOf("AP63: o plano da venda cancelada");
    const bloco = a.slice(a.lastIndexOf("if (!session.isAdminMaster)", i), i);
    expect(bloco.split("{").length - bloco.split("}").length).toBe(0);
  });

  it("o aviso aparece no plano (prontuário) e na negociação", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/plan-editor-switcher.tsx")).toContain(
      "<AvisoVendaCancelada events={selected.events} />"
    );
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx")).toContain(
      "<AvisoVendaCancelada events={planEvents} />"
    );
  });
});
