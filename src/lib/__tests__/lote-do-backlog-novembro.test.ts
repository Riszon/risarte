import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { funcoesAtendemOTipo, TYPE_PROVIDER_ROLES } from "@/lib/appointments";

/**
 * As réguas do lote de 10/11/2026 (itens do backlog resolvidos sem migração).
 * Cada uma foi provada devolvendo o defeito uma vez.
 */
const ler = (caminho: string) => readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");
/** Só o código: comentário cita o defeito por escrito e enganaria a régua. */
const semComentarios = (fonte: string) =>
  fonte
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("AP56 — o profissional do horário tem de atender aquele tipo", () => {
  it("a ASB não é profissional de nenhum tipo de compromisso", () => {
    for (const tipo of Object.keys(TYPE_PROVIDER_ROLES) as (keyof typeof TYPE_PROVIDER_ROLES)[]) {
      expect(funcoesAtendemOTipo(tipo, ["asb"]), tipo).toBe(false);
    }
  });

  it("vale a função certa, e basta uma entre as da pessoa", () => {
    expect(funcoesAtendemOTipo("evaluation", ["clinical_coordinator"])).toBe(true);
    expect(funcoesAtendemOTipo("evaluation", ["dentist"])).toBe(false);
    expect(funcoesAtendemOTipo("treatment_session", ["receptionist", "dentist"])).toBe(true);
    expect(funcoesAtendemOTipo("commercial_presentation", ["commercial_consultant"])).toBe(true);
    expect(funcoesAtendemOTipo("commercial_presentation", [])).toBe(false);
  });

  it("criar e editar agendamento perguntam ao servidor antes de gravar", () => {
    const fonte = semComentarios(ler("src/app/(app)/agenda/actions.ts"));
    const chamadas = fonte.match(/await recusaDoProfissional\(/g) ?? [];
    expect(chamadas.length, "createAppointment e updateAppointment").toBe(2);
    // Não conseguiu ler a equipe = recusa (guarda que não confere fecha).
    expect(fonte).toMatch(/if \(error\) return naoConferiu;/);
  });
});

describe("AP85 — a primeira opção do plano nasce principal", () => {
  it("a opção é principal quando a contagem confirmou zero", () => {
    const fonte = semComentarios(ler("src/app/(app)/prontuarios/[id]/planning-actions.ts"));
    expect(fonte).toMatch(/const principal = input\.isPrimary \|\| jaExistem === 0;/);
    expect(fonte).toMatch(/is_primary: principal,/);
  });
});

describe("AP70 — adesão nova do Riso+ é a ATIVADA, e transferência não conta", () => {
  const fonte = semComentarios(ler("src/app/(app)/ppr/painel/page.tsx"));

  it("o painel não conta adesão nova pela criação", () => {
    expect(fonte).not.toMatch(/inPeriod\(m\.created_at\)/);
    expect(fonte).toMatch(/adesaoNova\(m\) && inPeriod\(m\.activated_at\)/);
  });

  it("lê a ligação da transferência (sem ela a regra não tem como valer)", () => {
    expect(fonte).toMatch(/transferred_from_id/);
    expect(fonte).toMatch(/saiuDeVerdade\(m\) && inPeriod\(m\.cancelled_at\)/);
  });
});

describe("AP86 — janela não alarga com botão ou texto que não quebra linha", () => {
  it("o DialogContent tem uma coluna definida", () => {
    const fonte = ler("src/components/ui/dialog.tsx");
    const classe = /data-slot="dialog-content"\s+className=\{cn\(\s*"([^"]+)"/.exec(fonte)?.[1];
    if (!classe) throw new Error("NÃO MEDI: não achei a classe do DialogContent");
    expect(classe.split(/\s+/)).toContain("grid-cols-1");
  });
});

describe("AP106 — o padrão de fábrica acompanha o que o banco deixa", () => {
  it("entrada de estoque e requisição de compra incluem ASB e TSB", () => {
    const fonte = ler("src/lib/permissions.ts");
    const padraoDe = (id: string) => {
      const i = fonte.indexOf(`id: "${id}"`);
      if (i < 0) throw new Error(`NÃO MEDI: não achei ${id}`);
      return /padrao: \[([^\]]*)\]/.exec(fonte.slice(i))?.[1] ?? "";
    };
    for (const id of ["acao.estoque.gerir", "acao.compras.requisitar"]) {
      expect(padraoDe(id), id).toContain('"asb"');
      expect(padraoDe(id), id).toContain('"tsb"');
    }
    expect(padraoDe("acao.compras.requisitar")).toContain('"clinical_coordinator"');
  });
});

describe("AP40 — o servidor de teste limpa a própria pasta", () => {
  it("apaga a .next-test antes de subir e ao encerrar, e recusa a produção", () => {
    const fonte = ler("scripts/servidor-treino.mjs");
    expect(fonte).toMatch(/limpar\("antes de subir"\)/);
    expect(fonte).toMatch(/limpar\("ao encerrar"\)/);
    expect(fonte).toMatch(/includes\(PRODUCAO\)/);
    expect(ler("package.json")).toMatch(/"servidor:treino": "node scripts\/servidor-treino\.mjs"/);
  });
});

describe("AP88 — a régua do destrutivo está no portão", () => {
  it("npm run verificar roda o conferir-destrutivo", () => {
    expect(ler("scripts/verificar-build.mjs")).toMatch(/scripts\/conferir-destrutivo\.mjs/);
  });
});
