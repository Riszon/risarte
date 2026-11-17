import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMENDA_ALERTA_DIAS,
  FORA_DO_HORARIO_DIAS,
  REVISAO_VERMELHA_DIAS,
  SEM_TITULAR_ALERTA_DIAS,
  SOBRECARGA_PERCENTUAL,
  erroDoPainelDeCoberturas,
  farolDaCobertura,
  fraseDosMotivos,
  horasPorDia,
  lerUnidadesDeCobertura,
  porAtencaoDeCobertura,
  sinaisDeSobrecarga,
  type PessoaEmCobertura,
  type UnidadeDeCobertura,
} from "@/lib/coberturas-painel";
import { NETWORK_TABS, destinoNaUnidade } from "@/lib/finance/network-areas";
import { categorizeNotification } from "@/lib/notifications";

// Funções de apoio, F4 (0419): o painel "Equipe e coberturas" e os avisos à
// Franqueadora (plano aprovado em 16/11/2026, seção 10).

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const M0419 = ler("supabase/migrations/0419_funcoes_de_apoio_painel_e_avisos.sql");
const M0414 = ler("supabase/migrations/0414_funcoes_de_apoio_coberturas.sql");

const base: UnidadeDeCobertura = {
  clinicId: "u1",
  nome: "Cambé",
  equipe: 10,
  pessoasEmApoio: 0,
  ativas: 0,
  agendadas: 0,
  diasPessoa: 0,
  diasDoPeriodo: 30,
  semTitular: [],
  diasPorFuncao: [],
  maiorEmenda: 0,
  emendasAcima: 0,
  revisoesVencidas: 0,
  maiorAtrasoDeRevisao: 0,
  previsoesVencidas: 0,
  motivos: {},
  maxSimultaneas: 2,
  maxPercentualEquipe: 30,
  limitesTravam: false,
};

const pessoa: PessoaEmCobertura = {
  clinicId: "u1",
  userId: "p1",
  nome: "Celma",
  funcoes: ["receptionist"],
  desde: "2026-11-01",
  apoiosAgora: 1,
  antesSegundos: 5 * 3600 + 600,
  duranteSegundos: 7 * 3600 + 2400,
  diasDurante: 10,
  diasForaDoHorario: 0,
};

describe("a cor da unidade (10.2)", () => {
  it("ninguém cobrindo = verde; cobertura em andamento = amarelo", () => {
    expect(farolDaCobertura(base).farol).toBe("verde");
    expect(farolDaCobertura({ ...base, ativas: 1, pessoasEmApoio: 1, diasPessoa: 4 }).farol).toBe("amarelo");
  });

  it("função sem titular: amarelo até 30 dias, vermelho depois", () => {
    const s = (days: number) => ({ ...base, ativas: 1, pessoasEmApoio: 1, semTitular: [{ role: "receptionist" as const, since: "x", days }] });
    expect(farolDaCobertura(s(SEM_TITULAR_ALERTA_DIAS)).farol).toBe("amarelo");
    const v = farolDaCobertura(s(SEM_TITULAR_ALERTA_DIAS + 1));
    expect(v.farol).toBe("vermelho");
    expect(v.motivo).toBe("Recepcionista sem titular há 31 dias");
  });

  it("limite passado é vermelho (simultâneas e % da equipe)", () => {
    expect(farolDaCobertura({ ...base, ativas: 3, pessoasEmApoio: 1 }).motivo).toContain("limite 2");
    expect(farolDaCobertura({ ...base, ativas: 2, pessoasEmApoio: 4 }).motivo).toBe("40% da equipe em acúmulo (limite 30%)");
    expect(farolDaCobertura({ ...base, ativas: 2, pessoasEmApoio: 3 }).farol).toBe("amarelo");
  });

  it("D14: revisão vencida fica amarela e, passados 15 dias, vermelha", () => {
    const r = (d: number) => ({ ...base, ativas: 1, pessoasEmApoio: 1, revisoesVencidas: 1, maiorAtrasoDeRevisao: d });
    expect(farolDaCobertura(r(REVISAO_VERMELHA_DIAS)).farol).toBe("amarelo");
    expect(farolDaCobertura(r(REVISAO_VERMELHA_DIAS + 1)).farol).toBe("vermelho");
  });

  it("emenda longa e previsão de contratação vencida são vermelhas", () => {
    expect(farolDaCobertura({ ...base, ativas: 1, emendasAcima: 1, maiorEmenda: 81 }).motivo).toContain("81 dias");
    expect(farolDaCobertura({ ...base, ativas: 1, previsoesVencidas: 1 }).farol).toBe("vermelho");
  });

  it("a ordem: vermelho primeiro, depois mais dias-pessoa por pessoa", () => {
    const a = { ...base, clinicId: "a", nome: "A", ativas: 1, diasPessoa: 5 };
    const b = { ...base, clinicId: "b", nome: "B", ativas: 1, diasPessoa: 20 };
    const c = { ...base, clinicId: "c", nome: "C", ativas: 3 };
    expect([a, b, c].sort(porAtencaoDeCobertura).map((u) => u.clinicId)).toEqual(["c", "b", "a"]);
  });
});

describe("a pessoa (sinais de sobrecarga)", () => {
  it("tempo 30% acima do de antes, com dias suficientes, acende", () => {
    const s = sinaisDeSobrecarga(pessoa);
    expect(s.sobrecarga).toBe(true);
    expect(s.frases[0]).toBe("Tempo no sistema subiu de 5h10 para 7h40 por dia");
    expect(sinaisDeSobrecarga({ ...pessoa, diasDurante: 2 }).sobrecarga).toBe(false);
    expect(sinaisDeSobrecarga({ ...pessoa, duranteSegundos: pessoa.antesSegundos! * 1.3 }).sobrecarga).toBe(false);
  });

  it("fora do horário em 5 dias ou mais acende", () => {
    const calma = { ...pessoa, duranteSegundos: pessoa.antesSegundos };
    expect(sinaisDeSobrecarga({ ...calma, diasForaDoHorario: FORA_DO_HORARIO_DIAS - 1 }).sobrecarga).toBe(false);
    expect(sinaisDeSobrecarga({ ...calma, diasForaDoHorario: FORA_DO_HORARIO_DIAS }).sobrecarga).toBe(true);
  });

  it("formatos", () => {
    expect(horasPorDia(null)).toBe("—");
    expect(horasPorDia(3600)).toBe("1h00");
    expect(fraseDosMotivos({ ferias: 2, sem_funcao: 1 })).toBe("Férias 2 · Unidade sem a função 1");
    expect(lerUnidadesDeCobertura([{ clinic_id: "x", reasons: null, uncovered_roles: "lixo" }])[0].semTitular).toEqual([]);
    expect(erroDoPainelDeCoberturas("Could not find the function public.coverage_panel_units")).toContain("0419");
    expect(erroDoPainelDeCoberturas("qualquer")).toBe("Não foi possível ler as coberturas agora.");
  });
});

describe("o banco (0419)", () => {
  const avisos = M0419.slice(M0419.indexOf("function public._coverage_network_notices()"));

  it("os limiares da tela são os mesmos da rotina de avisos", () => {
    expect(avisos).toContain(`(j ->> 'days')::integer > ${SEM_TITULAR_ALERTA_DIAS}`);
    expect(avisos).toContain(`if a.dias > ${EMENDA_ALERTA_DIAS} then`);
    expect(avisos).toContain(`when v_atraso <= ${REVISAO_VERMELHA_DIAS} then 0`);
    expect(avisos).toContain(`p.before_avg_seconds * ${100 + SOBRECARGA_PERCENTUAL})`);
    expect(avisos).toContain(`or p.after_hours_days >= ${FORA_DO_HORARIO_DIAS} then`);
    expect(M0419).toContain(`and m.dias > ${EMENDA_ALERTA_DIAS})`);
  });

  it("a tela e os avisos leem as MESMAS contas (as funções _raw)", () => {
    expect(avisos).toContain("public._coverage_panel_units_raw(v_de, v_hoje, v_todas)");
    expect(avisos).toContain("public._coverage_panel_people_raw(v_de, v_hoje, v_todas)");
    expect(M0419).toContain("public._coverage_panel_units_raw(p_de, p_ate, public._coverage_visible_clinics())");
    expect(M0419).toContain("public._coverage_panel_people_raw(p_de, p_ate, public._coverage_visible_clinics())");
  });

  it("D12: quem vê a rede e quem vê a própria unidade", () => {
    const vis = M0419.slice(M0419.indexOf("function public._coverage_visible_clinics()"), M0419.indexOf("-- 2)"));
    expect(vis).toContain("public.is_admin_master() or public.is_network_viewer() or public.is_finance_franchisor()");
    expect(vis).toContain("u.role in ('unit_manager', 'franchisee')");
  });

  it("um aviso por fato: o registro técnico fora da auditoria", () => {
    expect(M0419).toContain("primary key (kind, key)");
    expect(M0419).toContain("('public', 'coverage_notices'");
    expect(M0419).toContain("on conflict do nothing;\n  get diagnostics v_n = row_count;\n  if v_n = 0 then return false; end if;");
  });

  it("a rotina diária é a da 0414 mais o bloco dos avisos, blindado", () => {
    const pega = (sql: string) =>
      sql.slice(
        sql.indexOf("create or replace function public.role_coverage_daily()"),
        sql.indexOf("grant execute on function public.role_coverage_daily() to service_role;")
      );
    const nova = pega(M0419);
    expect(nova).toContain("v_n := v_n + public._coverage_network_notices();\n  exception when others then");
    const semF4 = nova.replace(/\n\n  -- F4 \(0419\)[\s\S]*?  end;\n(?=\n  return v_n;)/, "");
    expect(semF4).toBe(pega(M0414));
  });

  it("sem login nada responde; a conta interna não é da API", () => {
    for (const f of [
      "_coverage_visible_clinics()",
      "_coverage_panel_units_raw(date, date, uuid[])",
      "_coverage_panel_people_raw(date, date, uuid[])",
      "_coverage_network_notices()",
      "_coverage_notify(text, text, uuid, text, text)",
      "_coverage_recipients(uuid)",
    ]) {
      expect(M0419, f).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
    }
    expect(M0419).toContain("grant execute on function public.coverage_panel_units(date, date) to authenticated;");
  });
});

describe("as telas", () => {
  it("a aba do Painel da rede e a tela da equipe usam a mesma leitura", () => {
    expect(NETWORK_TABS.some((t) => t.key === "coberturas")).toBe(true);
    expect(destinoNaUnidade("coberturas", "2026-11-01", "2026-11-30")).toBe("/risartanos/coberturas");
    for (const f of ["src/app/(app)/financeiro/painel-da-rede/page.tsx", "src/app/(app)/risartanos/coberturas/page.tsx"]) {
      const t = ler(f);
      expect(t, f).toContain("carregarPainelDeCoberturas(supabase, periodo.de, periodo.ate)");
      expect(t, f).toContain("<EquipeECoberturas");
    }
  });

  it("o aviso cai na categoria Equipe pelo link", () => {
    expect(M0419).toContain("'/risartanos/coberturas'");
    expect(categorizeNotification("Equipe: possível sobrecarga de Celma em Cambé", "/risartanos/coberturas")).toBe("equipe");
  });
});
