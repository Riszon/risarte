import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INDICADORES, indicadoresDoPapel } from "@/lib/certificacao";

// AP55 (decisão do dono, 03/11/2026): "a TSB deve seguir com as mesmas da
// ASB. A Recepção não vai preencher a anamnese e nem chama o paciente."
//
// Antes, o catálogo oferecia à TSB seis tarefas clínicas que o banco nunca a
// deixou fazer, e à Recepção duas. Missão com uma delas era impossível de
// cumprir. E trocar só o catálogo repetiria o defeito: das tarefas da ASB, o
// banco só aceitava três da TSB até a 0351.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const chaves = (papel: Parameters<typeof indicadoresDoPapel>[0]) =>
  indicadoresDoPapel(papel).map((i) => i.chave).sort();

const SEIS_CLINICAS = [
  "check_ins",
  "chamadas_paciente",
  "anamneses",
  "midias_enviadas",
  "atendimentos_como_profissional",
  "desfechos_atendimento",
];

describe("AP55 — as tarefas da TSB", () => {
  it("são exatamente as da ASB", () => {
    expect(chaves("tsb")).toEqual(chaves("asb"));
  });

  it("as seis clínicas que ela não consegue fazer saíram", () => {
    for (const fora of SEIS_CLINICAS) expect(chaves("tsb"), fora).not.toContain(fora);
  });

  it("o banco aceita a TSB nas duas réguas que a 0296 abriu para a ASB", () => {
    const sql = ler("supabase/migrations/0351_tsb_com_as_tarefas_da_asb.sql");
    expect(sql).toContain("array['clinical_coordinator', 'asb', 'tsb']::public.user_role[]");
    expect(sql).toContain("array['asb', 'tsb']::public.user_role[]");
    expect(sql).toContain("('acao.compras.requisitar', 'tsb')");
    expect(sql).toContain("('acao.estoque.gerir', 'tsb')");
    expect(sql).toContain("on conflict (capability, role) do nothing");
  });

  it("a tela segue o banco: monta a lista de compras e dá entrada", () => {
    expect(ler("src/lib/purchases-access.ts")).toContain(
      'hasRoleInClinic(session, clinicId as string, ["clinical_coordinator", "asb", "tsb"])'
    );
    expect(ler("src/lib/stock-access.ts")).toContain(
      'hasRoleInClinic(session, clinicId as string, ["asb", "tsb"])'
    );
  });
});

describe("AP55 — as tarefas da Recepção", () => {
  it("não preenche anamnese nem chama o paciente", () => {
    expect(chaves("receptionist")).not.toContain("anamneses");
    expect(chaves("receptionist")).not.toContain("chamadas_paciente");
  });

  it("o check-in continua com ela", () => {
    expect(chaves("receptionist")).toContain("check_ins");
  });

  it("a anamnese fica só com o Coordenador, o único que o banco deixa gravar", () => {
    expect(INDICADORES.map((i) => i.chave)).not.toContain("anamneses");
    expect(chaves("clinical_coordinator")).toContain("anamnese_clinica");
    expect(ler("supabase/migrations/0054_anamnesis_fills.sql")).toContain(
      "public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])"
    );
  });
});
