// 1046 — A IMPLANTAÇÃO MEDIDA PELO SISTEMA (Empresarial 0.106.0).
//
// Pedido do dono (16/11/2026): o cartão do funil mostra o GANHO e o % da
// implantação; os passos deixam de depender de marca à mão, sem travar quem
// tem uma exceção ("concluir mesmo assim", com motivo).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPATCH_ITEMS } from "@/lib/empresarial/constants";
import {
  IMPLEMENTATION_STEPS,
  IMPLEMENTATION_STEP_AUTO,
  progressoDaImplantacao,
  type MedidasDaImplantacao,
  type PassoRegistrado,
} from "@/lib/empresarial/implantacao";

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const vazio: MedidasDaImplantacao = {
  contratados: 11,
  ativos: 0,
  boasVindas: 0,
  comAgendamento: 0,
  orientacoesEm: null,
  apresentacaoEm: null,
};
const manual = (step: PassoRegistrado["step"], note = "motivo"): PassoRegistrado => ({
  step,
  doneAt: "2026-11-16T12:00:00Z",
  notApplicable: false,
  note,
  doneByName: null,
});
const naoSeAplica = (step: PassoRegistrado["step"]): PassoRegistrado => ({
  step,
  doneAt: null,
  notApplicable: true,
  note: null,
  doneByName: null,
});

describe("progressoDaImplantacao com as medidas do sistema", () => {
  it("o caso da produção: 11 contratados, nada feito → 0%, com o parcial de cada passo", () => {
    const p = progressoDaImplantacao([], vazio);
    expect(p.percentual).toBe(0);
    expect(p.completa).toBe(false);
    const porPasso = new Map(p.passos.map((x) => [x.step, x]));
    expect(porPasso.get("IMPORT_EMPLOYEES")?.parcial).toBe("0 de 11");
    expect(porPasso.get("WELCOME")?.parcial).toBe("sem titulares ainda");
  });

  it("o parcial anda a barra: 3 de 11 titulares já conta", () => {
    const p = progressoDaImplantacao([], { ...vazio, ativos: 3 });
    // 3/11 de um passo, em 5 passos = 5,45% → 5 (para baixo).
    expect(p.percentual).toBe(5);
    expect(p.passos[0]).toMatchObject({ step: "IMPORT_EMPLOYEES", feito: false, parcial: "3 de 11" });
  });

  it("tudo medido, apresentação 'não se aplica' → 100% e completa, pelo sistema", () => {
    const p = progressoDaImplantacao([naoSeAplica("GROUP_PRESENTATION")], {
      contratados: 2,
      ativos: 2,
      boasVindas: 2,
      comAgendamento: 2,
      orientacoesEm: "2026-11-12T12:00:00Z",
      apresentacaoEm: null,
    });
    expect(p.percentual).toBe(100);
    expect(p.completa).toBe(true);
    expect(p.total).toBe(4);
    expect(p.passos.filter((x) => x.origem === "AUTOMATICO")).toHaveLength(4);
  });

  it("falta um titular agendar: nunca mostra 100% enquanto falta passo", () => {
    const p = progressoDaImplantacao([naoSeAplica("GROUP_PRESENTATION")], {
      contratados: 100,
      ativos: 100,
      boasVindas: 100,
      comAgendamento: 99,
      orientacoesEm: "2026-11-12T12:00:00Z",
      apresentacaoEm: null,
    });
    expect(p.completa).toBe(false);
    expect(p.percentual).toBeLessThan(100);
    expect(p.faltando).toEqual(["FIRST_SCHEDULING"]);
  });

  it("'concluir mesmo assim' fecha o passo que o sistema não fecharia (não trava)", () => {
    const p = progressoDaImplantacao([manual("FIRST_SCHEDULING", "1 titular recusou")], {
      ...vazio,
      contratados: 3,
      ativos: 3,
      comAgendamento: 2,
    });
    const passo = p.passos.find((x) => x.step === "FIRST_SCHEDULING");
    expect(passo).toMatchObject({ feito: true, origem: "MANUAL", parcial: "2 de 3" });
  });

  it("contrato sem quantidade: basta haver titular", () => {
    const sem = progressoDaImplantacao([], { ...vazio, contratados: null });
    const com = progressoDaImplantacao([], { ...vazio, contratados: null, ativos: 1 });
    expect(sem.passos[0].feito).toBe(false);
    expect(com.passos[0]).toMatchObject({ feito: true, origem: "AUTOMATICO" });
  });

  it("sem medidas (leitura que falhou) vale só a marca à mão — nunca 'zero de 11'", () => {
    const p = progressoDaImplantacao([manual("WELCOME")], null);
    expect(p.concluidos).toBe(1);
    expect(p.passos.every((x) => x.parcial === null)).toBe(true);
  });

  it("todo passo diz como o sistema confere", () => {
    for (const s of IMPLEMENTATION_STEPS) expect(IMPLEMENTATION_STEP_AUTO[s]).toMatch(/Conferido pelo sistema/);
  });
});

describe("1046 — o banco e a tela falam a mesma língua", () => {
  const sql = ler("supabase/migrations/1046_implantacao_medida_pelo_sistema.sql");
  const leitura = ler("src/lib/empresarial/implantacao-db.ts");

  it("as colunas da função são as que a leitura espera", () => {
    for (const col of [
      "lead_id",
      "ganho_em",
      "contratados",
      "ativos",
      "boas_vindas",
      "com_agendamento",
      "orientacoes_em",
      "apresentacao_em",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${col} (uuid|timestamptz|integer)`));
      expect(leitura).toContain(`${col}:`);
    }
  });

  it("o item 'Orientações' do envio é o que o banco procura", () => {
    expect(DISPATCH_ITEMS).toContain("GUIDELINES");
    expect(sql).toContain("'GUIDELINES' = any(d.items)");
  });

  it("a função só devolve lead que quem chama enxerga, e cancelada não conta", () => {
    expect(sql).toContain("and empresarial.can_access_lead(l.id)");
    expect(sql).toContain("and ap.status <> 'cancelled'");
  });
});

describe("as telas", () => {
  const quadro = ler("src/app/(app)/empresarial/funil/lead-board.tsx");
  const pagina = ler("src/app/(app)/empresarial/funil/page.tsx");
  const ficha = ler("src/app/(app)/empresarial/funil/[leadId]/page.tsx");
  const acoes = ler("src/app/(app)/empresarial/funil/[leadId]/actions.ts");

  it("o cartão da Implantação tem o selo de Ganho e a barra", () => {
    expect(quadro).toMatch(/lead\.stage === "CLOSED_WON" \|\| lead\.stage === "IMPLEMENTATION"\) && \(\s*<Badge/);
    expect(quadro).toContain("Ganho em ${formatBrDate(lead.ganhoEm)}");
    expect(quadro).toContain("<AndamentoDaImplantacao");
  });

  it("o quadro e a ficha usam a MESMA conta, com as medidas", () => {
    expect(pagina).toContain("medidasDaImplantacao(db, emImplantacao)");
    expect(pagina).toMatch(/progressoDaImplantacao\(\s*passosPorLead\.get\(l\.id\) \?\? \[\],\s*medidas\.get\(l\.id\)\?\.medidas \?\? null/);
    expect(ficha).toContain("progressoDaImplantacao(passos, medidas)");
  });

  it("concluir à mão exige o motivo", () => {
    expect(acoes).toMatch(/estado === "DONE" && !note\?\.trim\(\)/);
  });
});
