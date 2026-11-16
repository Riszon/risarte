import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OC-00181 (16/11/2026): o Concluir de uma apresentação de outubro voltava
// "Não foi possível atualizar o atendimento" — o kit era baixado com a data do
// agendamento, num mês já fechado (PERIOD_CLOSED). Ensaio no treino 5/5.

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase", "migrations", "0411_kit_do_atendimento_sem_mes_fechado.sql");

describe("o kit do atendimento não trava o Concluir (OC-00181)", () => {
  it("a apresentação comercial não consome o kit", () => {
    expect(sql).toMatch(/if new\.type::text = 'commercial_presentation' then\s+return new;/);
  });
  it("o dia é o do Brasil; mês fechado leva a baixa para o dia da conclusão", () => {
    expect(sql).toMatch(/new\.starts_at at time zone 'America\/Sao_Paulo'/);
    expect(sql).not.toMatch(/new\.starts_at::date/);
    expect(sql).toMatch(/if public\.is_period_closed\(new\.clinic_id, v_dia\) then\s+v_when := public\.today_br\(\);/);
  });
  it("a tela traduz o mês fechado", () => {
    const acoes = ler("src", "app", "(app)", "agenda", "actions.ts");
    expect(acoes).toMatch(/PERIOD_CLOSED[\s\S]*já está fechado no Financeiro/);
  });
});
