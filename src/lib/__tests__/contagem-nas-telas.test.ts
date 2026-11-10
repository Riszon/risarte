import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAO_FOI_POSSIVEL_CONTAR,
  SEM_CONTAGEM,
  contagemDaTela,
  somarContagens,
} from "@/lib/contagem";

/**
 * AP11, A PARTE DAS TELAS. As ações já tinham régua
 * (`contagem-nas-acoes.test.ts`); as telas ficaram de fora "porque o pior caso
 * é um número errado". O número errado era o Início dizendo "Nada esperando
 * por você agora" com trabalho parado.
 *
 * A lista é fechada de propósito: são os arquivos de DADOS das telas que
 * contam o que espera por alguém (Início, trilha de Compras, boia de relatos).
 * Varrer toda tela reprovaria contadores de enfeite e a régua viraria ruído.
 * Tela nova que conte pendência entra aqui.
 *
 * AP136: entraram o sino, o Chat, o prontuário, o painel do Financeiro, as
 * duas telas da assinatura digital e a rotina de e-mails.
 */
const ARQUIVOS = [
  "src/app/(app)/inicio-dados.ts",
  "src/app/(app)/compras/trilha-dados.ts",
  "src/app/(app)/relatos-treino-actions.ts",
  "src/lib/relatos-do-treino.ts",
  "src/components/report-nav-item.tsx",
  // AP136 (10/11/2026): as telas que tinham sobrado.
  "src/components/notification-nav-item.tsx",
  "src/app/(app)/chat/page.tsx",
  "src/app/(app)/prontuarios/[id]/page.tsx",
  "src/app/(app)/financeiro/painel-dados.ts",
  "src/app/(app)/assinaturas/configuracoes/page.tsx",
  "src/lib/signatures/painel-dados.ts",
  "src/lib/signatures/rotina-horaria.ts",
];

// `count ?? 0`, `x.count ?? 0`, `x?.count ?? 0`, `(count ?? 0)` e o parente
// `count || 0`. Coluna de dado que termina em "count" (`kit_count`) não casa.
const PROIBIDO = /(^|[^\w)])(\w+\??\.)?count (\?\?|\|\|) 0/;

function achados(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => {
      const t = linha.trimStart();
      // Comentário explica o defeito; não é o defeito.
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      return PROIBIDO.test(linha);
    })
    .map(({ linha, n }) => `${n}  ${linha.trim()}`);
}

describe("⚠️ nenhuma TELA de pendências transforma 'não consegui contar' em zero (AP11)", () => {
  it("a régua está medindo alguma coisa", () => {
    // Arquivo que mudou de lugar não pode virar verde por ausência.
    for (const arq of ARQUIVOS) {
      expect(existsSync(join(process.cwd(), arq)), `sumiu: ${arq}`).toBe(true);
    }
    // E os dois arquivos de dados continuam pedindo contagem — se deixarem
    // de pedir, a régua está olhando para o lugar errado.
    for (const arq of ARQUIVOS.slice(0, 2)) {
      expect(readFileSync(join(process.cwd(), arq), "utf8"), arq).toMatch(/head: true/);
    }
  });

  it("nenhum desses arquivos usa `count ?? 0`", () => {
    const todos: string[] = [];
    for (const arq of ARQUIVOS) {
      for (const a of achados(readFileSync(join(process.cwd(), arq), "utf8"))) {
        todos.push(`${arq}:${a}`);
      }
    }
    expect(
      todos,
      "Contagem que falhou vira ZERO e a tela diz que não há nada esperando. Use " +
        "contagemDaTela()/contagemConfirmada() e mostre o null como \"—\" " +
        "(ver src/lib/contagem.ts):\n" +
        todos.join("\n")
    ).toEqual([]);
  });

  it("a régua pega as formas reais do defeito e deixa passar as legítimas", () => {
    // As três formas que existiam nesses arquivos:
    expect(achados("    numero: esperando?.count ?? 0,")).toHaveLength(1);
    expect(achados("    aguardandoAprovacao: aprovacoes.count ?? 0,")).toHaveLength(1);
    expect(achados("  return count ?? 0;")).toHaveLength(1);
    expect(achados("  if ((count || 0) > 0) {")).toHaveLength(1);
    // O jeito certo, coluna de dado e comentário passam:
    expect(achados("    numero: contagemDaTela(esperando),")).toEqual([]);
    expect(achados("    kitCount: Number(c.kit_count ?? 0),")).toEqual([]);
    expect(achados("    // antes: `count ?? 0`")).toEqual([]);
    expect(achados(" * O jeito natural, `count ?? 0`, vira zero.")).toEqual([]);
  });
});

describe("contagemDaTela — consulta não pedida × consulta que falhou", () => {
  it("consulta NÃO PEDIDA é zero por construção (o cartão não é do papel)", () => {
    expect(contagemDaTela(null)).toBe(0);
    expect(contagemDaTela(undefined)).toBe(0);
  });

  it("consulta que respondeu devolve o número, inclusive zero", () => {
    expect(contagemDaTela({ count: 4, error: null })).toBe(4);
    expect(contagemDaTela({ count: 0, error: null })).toBe(0);
  });

  it("⚠️ consulta que FALHOU é null, nunca zero", () => {
    expect(contagemDaTela({ count: null, error: { message: "timeout" } })).toBeNull();
    // O caso sem erro nenhum (tabela inexistente, medido em 26/09/2026):
    expect(contagemDaTela({ count: null, error: null })).toBeNull();
    expect(contagemDaTela({ count: 7, error: { code: "57014" } })).toBeNull();
  });
});

describe("somarContagens — a boia junta dois ambientes", () => {
  it("tudo contado: soma, e não é incompleta", () => {
    expect(somarContagens([2, 3])).toEqual({ total: 5, incompleta: false });
    expect(somarContagens([0, 0])).toEqual({ total: 0, incompleta: false });
  });

  it("⚠️ uma parte falhou: fica o que se sabe, marcado como incompleto", () => {
    expect(somarContagens([2, null])).toEqual({ total: 2, incompleta: true });
    expect(somarContagens([null, null])).toEqual({ total: 0, incompleta: true });
  });
});

describe("o que a tela escreve", () => {
  it("o traço e a frase são os combinados", () => {
    expect(SEM_CONTAGEM).toBe("—");
    expect(NAO_FOI_POSSIVEL_CONTAR).toBe("Não foi possível contar agora.");
  });

  it("o Início mostra o cartão da contagem que falhou, e não o zero", () => {
    const dados = readFileSync(join(process.cwd(), "src/app/(app)/inicio-dados.ts"), "utf8");
    expect(dados).toContain("if (p.numero === null || p.numero > 0) lista.push(p);");
    const pagina = readFileSync(join(process.cwd(), "src/app/(app)/page.tsx"), "utf8");
    expect(pagina).toContain("const semContagem = p.numero === null;");
    expect(pagina).toContain("{SEM_CONTAGEM}");
    expect(pagina).toContain("NAO_FOI_POSSIVEL_CONTAR");
  });

  it("a trilha de Compras mostra o traço na etapa que não conseguiu contar", () => {
    const trilha = readFileSync(join(process.cwd(), "src/app/(app)/compras/trilha.tsx"), "utf8");
    expect(trilha).toContain("{esperando === null && (");
    expect(trilha).toContain("{SEM_CONTAGEM}");
  });
});

describe("AP136 — as telas que tinham sobrado", () => {
  const ler = (arq: string) => readFileSync(join(process.cwd(), arq), "utf8");

  it("o sino não zera quando a contagem falha: guarda o último número e marca", () => {
    const sino = ler("src/components/notification-nav-item.tsx");
    expect(sino).toContain("setSemContagem(n === null);");
    expect(sino).toContain("if (n !== null) setUnread(n);");
    expect(sino).toContain("semContagem={semContagem}");
    expect(ler("src/components/topbar-item.tsx")).toContain("{SEM_CONTAGEM}");
  });

  it("o Chat mostra o traço no lugar de 'N offline' quando não contou", () => {
    expect(ler("src/app/(app)/chat/page.tsx")).toContain("totalUsers = contagemConfirmada(");
    expect(ler("src/app/(app)/chat/chat-hub.tsx")).toContain("totalUsers === null ? SEM_CONTAGEM");
  });

  it("o painel do Financeiro mostra o cartão da autorização com o traço", () => {
    const fin = ler("src/app/(app)/financeiro/painel-dados.ts");
    expect(fin).toContain("if (aguardando === null || aguardando > 0) {");
    expect(fin).toContain("valor: aguardando === null ? SEM_CONTAGEM : String(aguardando),");
  });

  it("o prontuário não esconde o atalho da apresentação por contagem que falhou", () => {
    const p = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(p).toContain("planoAprovadoNaoConferido = aprovados === null;");
    expect(p).toContain("{(hasApprovedPlan || planoAprovadoNaoConferido) && canPresent && (");
    // O envio para assinatura NÃO afrouxa: continua exigindo a confirmação.
    expect(p).toContain("{canSendSignature && hasApprovedPlan && (");
  });

  it("a assinatura digital mostra o traço no consumo e na fila", () => {
    expect(ler("src/app/(app)/assinaturas/configuracoes/page.tsx")).toContain(
      "{contagemConfirmada(usados) ?? SEM_CONTAGEM} documento(s)"
    );
    expect(ler("src/lib/signatures/painel-dados.ts")).toContain("usadosNoMes: contagemConfirmada(usados),");
    expect(ler("src/app/(app)/assinaturas/page.tsx")).toContain("opcoes.usadosNoMes ?? SEM_CONTAGEM");
  });

  it("⚠️ a rotina de e-mails não trata fila que não contou como fila vazia", () => {
    const r = ler("src/lib/signatures/rotina-horaria.ts");
    // Sai só com a fila CONFIRMADA em zero; `null` segue e registra o erro.
    expect(r).toContain('if (stats.email !== "ligado" || stats.emailsNaFila === 0) return;');
    expect(r).toContain('stats.erros.push("fila: não foi possível contar os e-mails pendentes")');
    expect(r).not.toContain("!stats.emailsNaFila");
  });

  it("⚠️ a Ortodontia do Início devolve null quando a leitura falha", () => {
    const d = ler("src/app/(app)/inicio-dados.ts");
    expect(d).toContain("if (error || !casos) return null;");
    expect(d).toContain("if (erroDaAgenda || !agendados) return null;");
    expect(d).toContain("numero: ortodontiaSemInstalacao,");
    expect(d).not.toContain('typeof ortodontiaSemInstalacao === "number"');
  });
});
