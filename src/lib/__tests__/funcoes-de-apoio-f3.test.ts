import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAXIMO_DE_APOIO,
  fraseDeCobertura,
  funcoesDeApoioPossiveis,
  lerCoberturas,
  recusaDaCobertura,
  revisaoVencida,
  textoDaCobertura,
  type CoberturaNaTela,
} from "@/lib/funcoes-de-apoio";

// Funções de apoio, F3 (as telas; plano aprovado em 16/11/2026,
// docs/equipe/FUNCOES-DE-APOIO-PLANO.md).

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const cobertura: CoberturaNaTela = {
  id: "c1",
  code: "CB-00001",
  clinicId: "u1",
  clinicName: "Cambé",
  role: "receptionist",
  kind: "temporaria",
  startsOn: "2026-11-18",
  endsOn: "2026-11-29",
  reasonCategory: "ferias",
  reason: "Férias da Erika",
  status: "ativa",
  reviewDueOn: null,
  hiringForecast: null,
};

describe("o que a tela oferece", () => {
  it("só funções do tipo da unidade, menos as que a pessoa já tem", () => {
    const r = funcoesDeApoioPossiveis({ tipoDaUnidade: "franchise_unit", jaTem: ["dentist"], apoiosNaUnidade: 0 });
    expect(r).toContain("receptionist");
    expect(r).not.toContain("dentist");
    expect(r).not.toContain("purchaser");
  });

  it("D3: com duas de apoio, não oferece mais nada", () => {
    expect(MAXIMO_DE_APOIO).toBe(2);
    expect(funcoesDeApoioPossiveis({ tipoDaUnidade: "franchise_unit", jaTem: ["dentist"], apoiosNaUnidade: 2 })).toEqual([]);
  });

  it("D4: Comprador e Financeiro nunca juntos", () => {
    const r = funcoesDeApoioPossiveis({ tipoDaUnidade: "franchisor", jaTem: ["finance_franchisor"], apoiosNaUnidade: 0 });
    expect(r).not.toContain("purchaser");
    expect(funcoesDeApoioPossiveis({ tipoDaUnidade: "franchisor", jaTem: ["purchaser"], apoiosNaUnidade: 0 })).not.toContain(
      "finance_franchisor"
    );
  });
});

describe("o que a tela diz", () => {
  it("cada recusa do banco tem frase própria (e a desconhecida não finge sucesso)", () => {
    for (const codigo of [
      "TEMPORARY_TOO_LONG",
      "TOO_MANY_SUPPORT_ROLES",
      "ROLE_COMBINATION_NOT_ALLOWED",
      "HIRING_FORECAST_REQUIRED",
      "ALREADY_HAS_ROLE",
      "NO_PRINCIPAL_ROLE",
      "UNIT_COVERAGE_LIMIT",
    ]) {
      expect(recusaDaCobertura(codigo), codigo).not.toBe("Não foi possível agora. Nada foi alterado.");
    }
    expect(recusaDaCobertura("algo estranho")).toBe("Não foi possível agora. Nada foi alterado.");
  });

  it("a linha da cobertura e a frase do Início", () => {
    expect(textoDaCobertura(cobertura)).toBe("Recepcionista · até 29/11/2026 · Férias");
    expect(textoDaCobertura({ ...cobertura, status: "agendada" })).toContain("de 18/11/2026 a 29/11/2026");
    // `ends_at` = meia-noite SEGUINTE ao último dia, em Brasília (03:00 UTC).
    expect(
      fraseDeCobertura({ role: "receptionist", unidade: "Cambé", endsAt: "2026-11-30T03:00:00+00:00" })
    ).toBe("Você está cobrindo Recepcionista em Cambé até 29/11/2026.");
    expect(fraseDeCobertura({ role: "asb", unidade: "Cambé", endsAt: null })).toContain("acúmulo fixo");
  });

  it("D14: revisão vencida do acúmulo fixo", () => {
    const fixa = { ...cobertura, kind: "fixa" as const, endsOn: null, reviewDueOn: "2026-11-10" };
    expect(revisaoVencida(fixa, "2026-11-16")).toBe(true);
    expect(revisaoVencida({ ...fixa, reviewDueOn: "2026-12-10" }, "2026-11-16")).toBe(false);
  });

  it("lê do banco só o que reconhece", () => {
    const linhas = lerCoberturas(
      [
        { id: "a", clinic_id: "u1", role: "asb", kind: "fixa", starts_on: "2026-11-16", reason_category: "sem_funcao", reason: "x", status: "ativa" },
        { id: "b", clinic_id: "u1", role: "asb", kind: "esquisito", starts_on: "2026-11-16", reason_category: "ferias", reason: "x", status: "ativa" },
        { id: "c", clinic_id: "u1", role: "asb", kind: "fixa", starts_on: "2026-11-16", reason_category: "ferias", reason: "x", status: "encerrada" },
      ],
      () => "Cambé"
    );
    expect(linhas.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("as telas e as ações", () => {
  it("a função de apoio não se apaga pela lixeira (sai encerrando a cobertura)", () => {
    const acoes = ler("src/app/(app)/risartanos/acesso-actions.ts");
    expect(acoes).toContain('if (linha?.assignment_kind === "apoio") {');
    const tela = ler("src/app/(app)/risartanos/acesso.tsx");
    expect(tela).toContain("{isAdmin && !f.apoio && (");
  });

  it("dar/encerrar/cancelar/revisar passam pelas portas do banco (0414)", () => {
    const acoes = ler("src/app/(app)/risartanos/acesso-actions.ts");
    for (const rpc of ["grant_role_coverage", "end_role_coverage", "cancel_role_coverage", "review_role_coverage"]) {
      expect(acoes, rpc).toContain(`"${rpc}"`);
    }
  });

  it("a tranca na ficha é por (unidade, função), e liberar diz a função", () => {
    const tela = ler("src/app/(app)/risartanos/acesso.tsx");
    expect(tela).toContain("porUnidade.get(`${f.clinicId}:${f.role}`)");
    expect(tela).toContain("liberarUnidadeSemMissao(userId, f.clinicId, motivo, f.role)");
    expect(tela).toContain("retirarLiberacaoDaUnidade(userId, f.clinicId, f.role)");
  });

  it("o Início e o menu mostram a cobertura", () => {
    expect(ler("src/app/(app)/page.tsx")).toContain("fraseDeCobertura(");
    expect(ler("src/components/app-sidebar.tsx")).toContain("`${ROLE_LABELS[r]} (apoio)`");
    expect(ler("src/lib/auth.ts")).toContain('.select("role, assignment_kind, ends_at, clinics ( id, name, type, is_active )")');
  });
});
