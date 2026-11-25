import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Relatos de 23 e 24/11/2026 (lote 5). Ensaio da 0434 no treino em transação
// desfeita: 3/3 (o "antes" deixava o agendamento passado em aberto).

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("OC-00190 — quem chegou adiantado aparece no dia da chegada", () => {
  it("o Atendimento junta os em espera com chegada no período", () => {
    const t = ler("src", "app", "(app)", "atendimento", "page.tsx");
    expect(t).toMatch(/\.eq\("attendance", "waiting"\)\s+\.gte\("checked_in_at", start\.toISOString\(\)\)\s+\.lt\("checked_in_at", end\.toISOString\(\)\)/);
  });
});

describe("OC-00188 — a transferência cancela o que ficou em aberto (0434)", () => {
  const sql = ler("supabase", "migrations", "0434_transferencia_cancela_o_que_ficou_em_aberto.sql");
  it("passado em aberto também é cancelado; só o atendimento em curso fica", () => {
    expect(sql).toMatch(/and status in \('scheduled', 'confirmed'\)[\s\S]*and \(starts_at > now\(\) or attendance is distinct from 'in_service'\)/);
    expect(sql).not.toMatch(/and starts_at > now\(\)\n\s+and status in/);
  });
  it("mantém a guarda de execução e traz a conta 3.2.06 (OC-00023)", () => {
    expect(sql).toContain("revoke execute on function public.transfer_client(uuid, uuid, boolean) from public, anon, authenticated;");
    expect(sql).toMatch(/\('3\.2\.06', 'Monitoramento e segurança', '3\.2', 'expense', 'operational', 'fixed', 'both', true\)/);
  });
});

describe("OC-00189/OC-00022 — conexão que cai não vira tela de erro", () => {
  it("o envio do relato trata a queda e a tela de erro diz a origem", () => {
    expect(ler("src", "app", "(app)", "problemas", "formulario.tsx")).toMatch(/try \{\s+r = await registrarProblema\(fd\);\s+\} catch \{[\s\S]*A conexão caiu antes da resposta/);
    expect(ler("src", "app", "(app)", "error.tsx")).toMatch(/error\.digest \? \([\s\S]*Origem:[\s\S]*no seu aparelho/);
  });
});
