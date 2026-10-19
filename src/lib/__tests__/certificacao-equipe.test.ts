import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  jaCumpriu,
  lerColegas,
  percentualDoRetrato,
  porUnidade,
  situacaoDaMatricula,
} from "@/lib/certificacao-equipe";

// Relato OC-00003 (produção, 18/10/2026): "ao convocar, o sistema não gera
// nenhum alerta para quem foi convocado (teste com DENTISTA)". REGRA: o
// quadro da missão aparece no Início do sistema REAL, nunca no treino — e o
// teste foi feito no treino. Decisões do dono (19/10/2026): aviso no SINO ao
// convocar, a EQUIPE da coletiva no Início e o PAINEL de acompanhamento.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const MIGRACAO = ler("supabase/migrations/0303_certificacao_aviso_equipe_e_acompanhamento.sql");

const m = (status: string, certificado = false, aprovacao: string | null = null) => ({ status, certificado, aprovacao });

describe("a situação de cada pessoa — uma regra para a equipe e para o painel", () => {
  it("certificado vence tudo; depois aprovação pendente; depois o status", () => {
    expect(situacaoDaMatricula(m("em_andamento", true))).toBe("certificado");
    expect(situacaoDaMatricula(m("concluido", false, "pendente"))).toBe("aguardando_aprovacao");
    expect(situacaoDaMatricula(m("concluido"))).toBe("cumpriu");
    expect(situacaoDaMatricula(m("em_andamento"))).toBe("em_andamento");
    expect(situacaoDaMatricula(m("convocado"))).toBe("nao_aceitou");
    expect(situacaoDaMatricula(m("dispensado"))).toBe("dispensado");
  });

  it("quem cumpriu (mesmo aguardando aprovação) não segura mais o grupo", () => {
    expect(jaCumpriu("aguardando_aprovacao")).toBe(true);
    expect(jaCumpriu("em_andamento")).toBe(false);
    expect(jaCumpriu("nao_aceitou")).toBe(false);
  });

  it("a equipe conta quem cumpriu sobre quem conta — dispensado fica fora", () => {
    const u = { clinicId: "c1", clinicName: "Cambé" };
    const [g] = porUnidade([
      { ...u, ...m("concluido", true) },
      { ...u, ...m("em_andamento") },
      { ...u, ...m("convocado") },
      { ...u, ...m("dispensado") },
    ]);
    expect(g).toMatchObject({ cumpriram: 1, total: 3 });
  });
});

describe("o retrato do progresso", () => {
  it("lê o percentual sem confiar no formato", () => {
    expect(percentualDoRetrato({ percentual: 40 })).toBe(40);
    expect(percentualDoRetrato({ percentual: 140 })).toBe(100);
    expect(percentualDoRetrato({ percentual: "40" })).toBeNull();
    expect(percentualDoRetrato(null)).toBeNull();
  });

  it("lê a equipe que o banco devolve", () => {
    const [c] = lerColegas([
      { clinic_id: "c1", clinic_name: "Cambé", user_id: "u1", full_name: "Ana", role: "dentist", status: "em_andamento", certified: false, approval_status: null, progress_snapshot: { percentual: 60 }, progress_measured_at: "2026-10-19T10:00:00Z", is_me: true },
    ]);
    expect(c).toMatchObject({ nome: "Ana", percentual: 60, souEu: true, certificado: false });
  });
});

describe("o banco (0303)", () => {
  it("avisa no SINO ao convocar — por gatilho, e o aviso nunca derruba a convocação", () => {
    expect(MIGRACAO).toMatch(/create trigger training_enrollment_notify_trg\s+after insert on public\.training_enrollments/);
    expect(MIGRACAO).toContain("'Você foi convocado para a certificação'");
    expect(MIGRACAO).toContain("raise warning 'training_enrollment_notify: %', sqlerrm;");
  });

  it("os já convocados recebem o aviso uma vez só", () => {
    expect(MIGRACAO).toMatch(/where tc\.status = 'aberta'\s+and e\.status = 'convocado'\s+and not exists \(/);
  });

  it("o progresso só o SERVIDOR grava", () => {
    expect(MIGRACAO).toContain("revoke execute on function public.record_training_progress(uuid, jsonb) from public, anon, authenticated;");
    expect(MIGRACAO).toContain("grant execute on function public.record_training_progress(uuid, jsonb) to service_role;");
  });

  it("a equipe é o MESMO grupo que segura a unidade, só na coletiva, e exige login", () => {
    expect(MIGRACAO).toContain("if v_me is null then raise exception 'NOT_ALLOWED'; end if;");
    expect(MIGRACAO).toContain("where ts.release_scope = 'coletiva'");
    // As mesmas condições de `_system_access_raw` (0277).
    expect(MIGRACAO).toMatch(/where tc\.status = 'aberta'\s+and tc\.kind = 'novatos'\s+and e\.status <> 'dispensado'\s+order by/);
    expect(MIGRACAO).toContain("revoke execute on function public.my_training_group() from public, anon, authenticated;");
  });
});

describe("as telas", () => {
  it("toda medição guarda o retrato ANTES de registrar a conclusão", () => {
    for (const arq of ["src/app/(app)/inicio-dados.ts", "src/app/(app)/missao-actions.ts", "src/app/(app)/admin/certificacao/actions.ts"]) {
      expect(ler(arq), arq).toMatch(/await guardarProgresso\(.*\);\s+(?:const (?:registrado|r) = )?await registrarSeCumprida\(/);
    }
    expect(ler("src/lib/certificacao-servidor.ts")).toContain('if (medicao?.estado !== "medido") return;');
  });

  it("o Início mostra a equipe junto com a missão", () => {
    const pagina = ler("src/app/(app)/page.tsx");
    expect(pagina).toContain("const minhaEquipe = minhasMissoes.length > 0 ? await equipeDaMissao(supabase) : null;");
    expect(pagina).toContain("<EquipeDaCertificacao grupos={minhaEquipe} />");
  });

  it("o painel do Admin lê à parte e avisa se falhar — a lista de turmas não cai junto", () => {
    const pagina = ler("src/app/(app)/admin/certificacao/page.tsx");
    expect(pagina).toContain("const painelFalhou = !leituraDoPainel.ok || !leituraDosCertificados.ok;");
    expect(pagina).toContain("Não foi possível ler o acompanhamento.");
    expect(pagina).toContain("<Acompanhamento");
    // O texto que faltava: onde o convocado vê a missão.
    expect(pagina).toContain("<strong>Início do sistema REAL</strong>");
  });
});
