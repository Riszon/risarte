import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jaEmTurmaAberta, type CandidatoDaUnidade } from "@/lib/certificacao";

// OC-00015 e OC-00016 (produção, 16/11/2026), migração 0411:
// - quem é desligado ou perde a função na unidade não pode segurar a
//   liberação coletiva para sempre;
// - abrir uma turma nova não pode depender de encerrar a turma da unidade.

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const MIGRACAO = ler("supabase/migrations/0411_certificacao_dispensa_e_turma_por_pessoa.sql");

/** O corpo de uma função da migração (de `create or replace function X` ao `$$;`). */
function corpo(nome: string): string {
  const i = MIGRACAO.indexOf(`create or replace function public.${nome}(`);
  if (i < 0) throw new Error(`a 0411 não define ${nome}`);
  const fim = MIGRACAO.indexOf("\n$$;", i);
  if (fim < 0) throw new Error(`fim de ${nome} não encontrado`);
  return MIGRACAO.slice(i, fim);
}

const base: CandidatoDaUnidade = {
  user_id: "u1",
  full_name: "Fulana",
  role: "receptionist",
  ja_certificado: false,
  clinic_id: "c1",
  clinic_name: "Cambé",
};

describe("OC-00016: turma nova não trava pela unidade", () => {
  it("abrir turma não recusa mais por turma aberta na unidade", () => {
    const abrir = corpo("open_training_campaign");
    expect(abrir).not.toContain("raise exception 'CAMPAIGN_ALREADY_OPEN'");
    // A mesma pessoa na mesma função não é convocada duas vezes.
    expect(abrir).toContain("c.turma_aberta is null");
  });

  it("a prévia diz em qual turma a pessoa já está (só turma aberta, sem dispensados)", () => {
    const previa = corpo("training_candidates_multi");
    expect(previa).toContain("turma_aberta text");
    expect(previa).toContain("tc.status = 'aberta'");
    expect(previa).toContain("e.status <> 'dispensado'");
  });

  it("a tela não convoca quem já está numa turma aberta", () => {
    expect(jaEmTurmaAberta(base)).toBe(false);
    expect(jaEmTurmaAberta({ ...base, turma_aberta: null })).toBe(false);
    expect(jaEmTurmaAberta({ ...base, turma_aberta: "TR-00007" })).toBe(true);
    const tela = ler("src/app/(app)/admin/certificacao/turmas.tsx");
    expect(tela).toContain("!jaEmTurmaAberta(c) && !fora.has(chaveDaConvocacao(c))");
    // A unidade com turma aberta continua escolhível.
    expect(tela).not.toContain("disabled={Boolean(u.turmaAberta)}");
  });
});

describe("OC-00015: quem saiu não segura a unidade", () => {
  it("desativar a pessoa dispensa as matrículas abertas dela", () => {
    expect(MIGRACAO).toContain("after update of is_active on public.profiles");
    expect(corpo("training_dismiss_on_deactivation")).toContain("_dismiss_training_enrollment");
  });

  it("tirar ou trocar a função na unidade dispensa (gatilho na tabela de verdade)", () => {
    expect(MIGRACAO).toContain("after update or delete on public.user_clinic_roles_all");
    expect(corpo("training_dismiss_on_role_change")).toContain("_dismiss_training_enrollment");
  });

  it("a dispensa só mexe em matrícula não concluída de turma aberta", () => {
    const peca = corpo("_dismiss_training_enrollment");
    expect(peca).toContain("tc.status = 'aberta'");
    expect(peca).toContain("e.status in ('convocado', 'em_andamento')");
  });

  it("o botão é só do Admin Master, com motivo; a peça interna não responde à API", () => {
    const botao = corpo("dismiss_training_enrollment");
    expect(botao).toContain("public.is_admin_master()");
    expect(botao).toContain("REASON_REQUIRED");
    expect(MIGRACAO).toContain(
      "revoke execute on function public._dismiss_training_enrollment(uuid, text, uuid) from public, anon, authenticated;"
    );
  });

  it("os casos que já existiam são acertados na própria migração", () => {
    expect(MIGRACAO).toMatch(/do \$\$[\s\S]*_dismiss_training_enrollment\(r\.id, r\.motivo, null\)/);
  });
});
