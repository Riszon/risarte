import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDICADORES } from "@/lib/certificacao";

// Relatos de 13 a 21/11/2026 (lote 4). Ensaio no treino, como a dentista do
// relato, em transação desfeita: 6/6.

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("OC-00186 — o kit não depende de quem conclui (0433)", () => {
  const sql = ler("supabase", "migrations", "0433_kit_sem_depender_de_quem_conclui_e_coleta_de_residuos.sql");
  const corpo = sql.slice(sql.indexOf("create or replace function public.consume_attendance_kit"));
  it("confere o mês fechado direto em fiscal_periods, nunca por is_period_closed (que depende de quem chama)", () => {
    expect(corpo).toMatch(/from public\.fiscal_periods p\s+where p\.clinic_id = new\.clinic_id\s+and p\.status = 'closed'/);
    expect(corpo).not.toMatch(/is_period_closed\(/);
  });
  it("leva os desvios da 0411 (sem kit na apresentação; dia do Brasil)", () => {
    expect(corpo).toMatch(/if new\.type::text = 'commercial_presentation' then\s+return new;/);
    expect(corpo).toMatch(/new\.starts_at at time zone 'America\/Sao_Paulo'/);
  });
  it("a tela do Desenvolvimento Clínico traduz o mês fechado", () => {
    expect(ler("src", "app", "(app)", "prontuarios", "[id]", "clinical-progress-actions.ts")).toMatch(/PERIOD_CLOSED[\s\S]*já está fechado no Financeiro/);
  });
});

describe("OC-00018 — a conta de coleta de resíduos", () => {
  it("3.2.05 fixa em Ocupação", () => {
    expect(ler("supabase", "migrations", "0433_kit_sem_depender_de_quem_conclui_e_coleta_de_residuos.sql"))
      .toMatch(/\('3\.2\.05', 'Coleta de resíduos de saúde', '3\.2', 'expense', 'operational', 'fixed', 'both', true\)/);
  });
});

describe("OC-00183 — cancelado à mão não oferece Gerar (4027)", () => {
  const sql = ler("supabase", "migrations", "4027_asa4_cancelado_a_mao_nao_oferece_gerar.sql");
  it("o resumo segue a regra do bloqueio e diz que foi cancelado à mão", () => {
    expect(sql).toMatch(/'pode_gerar', v_block is null or \(bool_and\(c\.status = 'cancelada'\)\s+and not bool_or\(c\.status = 'cancelada' and c\.cancelled_by is not null\)\)/);
    expect(sql).toMatch(/'cancelado_a_mao'/);
  });
  it("a tela explica o caminho (Trocar meio)", () => {
    expect(ler("src", "components", "commercial", "parcelamento-da-venda.tsx")).toMatch(/p\.cancelado_a_mao &&[\s\S]*Trocar meio/);
  });
});

describe("OC-00184 — Ver anamnese troca de aba e rola", () => {
  it("o botão leva aba e seção, e a seção tem o alvo", () => {
    const p = ler("src", "app", "(app)", "prontuarios", "[id]", "page.tsx");
    expect(p).toMatch(/rotulo: "Ver anamnese", aba: "clinico", secao: "anamnese"/);
    expect(p).toMatch(/<div id="anamnese"/);
    expect(ler("src", "app", "(app)", "prontuarios", "[id]", "prontuario-tabs.tsx")).toMatch(/EVENTO_ABRIR_ABA[\s\S]*scrollIntoView/);
  });
});

describe("OC-00013 — o texto do controle de qualidade", () => {
  it("diz os níveis de hoje e quando aparece", () => {
    const i = INDICADORES.find((x) => x.chave === "revisoes_qualidade");
    expect(i?.onde).toMatch(/Excelente, Bom, Aceitável, Revisar, Refazer/);
    expect(i?.onde).toMatch(/plano do cliente termina/);
  });
});
