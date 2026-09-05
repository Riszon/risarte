import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  brazilClock,
  instantFromBrazil,
  isoDateIn,
  startOfDayInBrazil,
  todayInBrazil,
  weekdayOf,
} from "@/lib/dates";

// ⚠️ O TESTE QUE PRENDE O DEFEITO DE 05/09/2026.
//
// `new Date("2026-09-05T14:00:00")` é lido no fuso da MÁQUINA: 14:00 no
// computador do dono (Brasília), 14:00Z na Vercel (UTC) — que é 11:00 no
// Brasil. A agenda passou a recusar remarcação para as próximas 3 horas
// dizendo "horário no passado", e o que passava era gravado 3 horas antes.
//
// O que estes testes garantem é a propriedade que faltava: **o resultado não
// pode depender de onde o código roda**. Por isso comparam com instantes
// absolutos (o `Z` no fim), que são os mesmos em qualquer máquina — se alguém
// voltar a usar `new Date` sem fuso, um destes cai.
describe("relógio de parede brasileiro → instante", () => {
  it("14:00 no Brasil é 17:00 em UTC", () => {
    expect(instantFromBrazil("2026-09-05", "14:00").toISOString()).toBe(
      "2026-09-05T17:00:00.000Z"
    );
  });

  it("a meia-noite do dia brasileiro é 03:00 em UTC", () => {
    expect(startOfDayInBrazil("2026-09-05").toISOString()).toBe(
      "2026-09-05T03:00:00.000Z"
    );
  });

  it("aceita segundos e hora com um dígito", () => {
    expect(instantFromBrazil("2026-09-05", "9:05").toISOString()).toBe(
      "2026-09-05T12:05:00.000Z"
    );
    expect(instantFromBrazil("2026-09-05", "09:05:30").toISOString()).toBe(
      "2026-09-05T12:05:30.000Z"
    );
  });

  it("vira o dia corretamente perto da meia-noite", () => {
    // 23:30 do dia 5 no Brasil é 02:30 do dia 6 em UTC. É a hora em que o
    // sistema inteiro já errou uma vez (migração 0201).
    expect(instantFromBrazil("2026-09-05", "23:30").toISOString()).toBe(
      "2026-09-06T02:30:00.000Z"
    );
  });

  it("NÃO tem -3 cravado: respeita o horário de verão que já existiu", () => {
    // O Brasil teve horário de verão até 2019. Em janeiro de 2018 São Paulo
    // estava em UTC-2, então 14:00 daquele dia é 16:00Z — e não 17:00Z.
    // Um "-3" fixo no código erraria por uma hora durante meses inteiros se o
    // horário de verão voltar, e a agenda erraria junto.
    expect(instantFromBrazil("2018-01-15", "14:00").toISOString()).toBe(
      "2018-01-15T16:00:00.000Z"
    );
  });

  it("entrada inválida devolve data inválida, não um horário inventado", () => {
    expect(Number.isNaN(instantFromBrazil("05/09/2026", "14:00").getTime())).toBe(true);
    expect(Number.isNaN(instantFromBrazil("2026-09-05", "manhã").getTime())).toBe(true);
  });

  it("ida e volta fecha: o instante lido no Brasil devolve o que foi digitado", () => {
    for (const hora of ["00:00", "07:30", "12:00", "18:45", "23:59"]) {
      const instante = instantFromBrazil("2026-09-05", hora);
      expect(brazilClock(instante)).toEqual({ date: "2026-09-05", time: hora });
    }
  });
});

describe("dia da semana", () => {
  it("não depende de fuso nenhum", () => {
    // 05/09/2026 é sábado. A conta é aritmética pura de propósito: fazer o dia
    // da semana depender de relógio é convidar o mesmo erro de volta.
    expect(weekdayOf("2026-09-05")).toBe(6);
    expect(weekdayOf("2026-09-06")).toBe(0);
    expect(weekdayOf("2026-09-07")).toBe(1);
  });

  it("data inválida não vira segunda-feira", () => {
    expect(Number.isNaN(weekdayOf("05/09/2026"))).toBe(true);
  });
});

// ⚠️ O GUARDA CONTRA A VOLTA DO DEFEITO.
//
// Corrigir os pontos de hoje não impede que o próximo `new Date(\`${d}T${h}\`)`
// entre amanhã, escrito de boa-fé — ele parece certo, e no computador de quem
// escreve ele FUNCIONA. Só quebra onde o sistema roda de verdade.
//
// Esta varredura olha só o código que roda no SERVIDOR: no navegador o fuso é o
// da pessoa, que no Brasil é o certo. Arquivos com "use client" ficam de fora
// de propósito — arrastá-los para cá tornaria o teste barulhento, e teste
// barulhento é teste que alguém desliga.
describe("nenhum horário de negócio é lido no fuso da máquina", () => {
  function arquivosDoServidor(raiz: string): string[] {
    const achados: string[] = [];
    for (const nome of readdirSync(raiz)) {
      const caminho = join(raiz, nome);
      if (statSync(caminho).isDirectory()) {
        achados.push(...arquivosDoServidor(caminho));
        continue;
      }
      if (!/\.tsx?$/.test(nome)) continue;
      const fonte = readFileSync(caminho, "utf8");
      if (/^\s*["']use client["']/m.test(fonte)) continue;
      achados.push(caminho);
    }
    return achados;
  }

  // DUAS formas, e só elas. A régua precisa ser exata: uma que acusasse
  // `new Date(\`${d}T00:00:00\`).toLocaleDateString()` — que é inofensivo,
  // porque lê e escreve no mesmo fuso — ensinaria a ignorar o aviso, e aí ela
  // deixaria de valer para os casos que importam.
  const FORMAS = [
    {
      // 1. A HORA VEM DE VARIÁVEL: é relógio de parede virando instante.
      //    Sempre errado fora do fuso do Brasil.
      nome: "hora montada a partir de variável",
      padrao: /new Date\(`[^`]*T\$\{/,
    },
    {
      // 2. MEIA-NOITE VIRANDO INSTANTE (`.toISOString()` / `.getTime()`): é
      //    fronteira de dia, e no servidor em UTC ela cai às 21h do dia anterior.
      nome: "fronteira de dia convertida em instante",
      padrao: /new Date\(`[^`]*T\d[^`]*`\)\s*\.\s*(?:toISOString|getTime)\b/,
    },
  ];

  for (const { nome, padrao } of FORMAS) {
    it(`nenhum arquivo de servidor tem ${nome}`, () => {
      const culpados = arquivosDoServidor("src/app")
        .filter((f) => padrao.test(readFileSync(f, "utf8")))
        .map((f) => f.replace(/\\/g, "/"));

      expect(
        culpados,
        `Use instantFromBrazil()/startOfDayInBrazil() de @/lib/dates:\n${culpados.join("\n")}`
      ).toEqual([]);
    });
  }

  it("a régua reconhece as duas formas do defeito", () => {
    // Régua que ninguém provou que dispara passa por cegueira, não por saúde.
    expect(FORMAS[0].padrao.test("const x = new Date(`${d}T${hora}:00`);")).toBe(true);
    expect(FORMAS[1].padrao.test("new Date(`${d}T00:00:00`).toISOString()")).toBe(true);
    // E não acusa o que é seguro: ler e escrever no mesmo fuso.
    expect(FORMAS[0].padrao.test('new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR")')).toBe(false);
    expect(FORMAS[1].padrao.test('new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR")')).toBe(false);
  });
});

describe("hoje no Brasil", () => {
  it("continua devolvendo AAAA-MM-DD", () => {
    expect(todayInBrazil()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("às 21h no Brasil ainda é HOJE, não amanhã", () => {
    // O defeito original da 0201: `toISOString()` já teria virado o dia.
    const instante = new Date("2026-09-05T23:30:00.000Z"); // 20:30 no Brasil
    expect(isoDateIn(instante)).toBe("2026-09-05");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-05");

    const maisTarde = new Date("2026-09-06T02:30:00.000Z"); // 23:30 no Brasil
    expect(isoDateIn(maisTarde)).toBe("2026-09-05");
    // E aqui está a diferença que custou o dia inteiro:
    expect(maisTarde.toISOString().slice(0, 10)).toBe("2026-09-06");
  });
});
