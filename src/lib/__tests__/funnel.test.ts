import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLOSING_FILTERS,
  FUNNEL_COLUMNS,
  columnOfStage,
  isOpenStage,
  matchesClosingFilter,
  rotuloDeDuracao,
  tempoNaFaseAtual,
  tempoPorFase,
  type StagePeriod,
} from "@/lib/empresarial/funnel";
import { LEAD_STAGES, type LeadStage } from "@/lib/empresarial/constants";

const AGORA = new Date("2026-09-14T15:00:00.000Z");
const UM_DIA = 24 * 60 * 60 * 1000;

function periodo(
  stage: LeadStage,
  entrou: string,
  saiu: string | null = null,
  isInitial = false
): StagePeriod {
  return { stage, enteredAt: entrou, leftAt: saiu, isInitial };
}

describe("as 8 colunas do funil", () => {
  it("tem exatamente as 8 fases que o dono pediu, na ordem", () => {
    expect(FUNNEL_COLUMNS.map((c) => c.titulo)).toEqual([
      "Captação",
      "Contato",
      "Reunião agendada",
      "Apresentado",
      "Proposta enviada",
      "Follow-up",
      "Fechamento",
      "Implantação",
    ]);
    expect(FUNNEL_COLUMNS.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("TODA fase do banco cai em alguma coluna", () => {
    // Sem isto, acrescentar uma fase na migração faria o cartão sumir do quadro
    // em silêncio — o defeito só apareceria quando a empresa reclamasse.
    for (const stage of LEAD_STAGES) {
      expect(() => columnOfStage(stage)).not.toThrow();
    }
  });

  it("ganho e perda dividem a MESMA coluna de fechamento", () => {
    expect(columnOfStage("CLOSED_WON")).toBe("CLOSING");
    expect(columnOfStage("CLOSED_LOST")).toBe("CLOSING");
  });

  it("fase inventada é erro alto, nunca coluna vazia", () => {
    expect(() => columnOfStage("INVENTADA" as LeadStage)).toThrow(/Fase sem coluna/);
  });

  it("fechado e implantado não são mais 'em aberto'", () => {
    expect(isOpenStage("FOLLOW_UP")).toBe(true);
    expect(isOpenStage("CLOSED_WON")).toBe(false);
    expect(isOpenStage("CLOSED_LOST")).toBe(false);
    expect(isOpenStage("IMPLEMENTATION")).toBe(false);
  });
});

describe("filtro de ganhos e perdas", () => {
  it("Todos mostra os dois", () => {
    expect(matchesClosingFilter("CLOSED_WON", "ALL")).toBe(true);
    expect(matchesClosingFilter("CLOSED_LOST", "ALL")).toBe(true);
  });

  it("Ganhos esconde a perda, e Perdas esconde o ganho", () => {
    expect(matchesClosingFilter("CLOSED_WON", "WON")).toBe(true);
    expect(matchesClosingFilter("CLOSED_LOST", "WON")).toBe(false);
    expect(matchesClosingFilter("CLOSED_LOST", "LOST")).toBe(true);
    expect(matchesClosingFilter("CLOSED_WON", "LOST")).toBe(false);
  });

  it("só existem três filtros", () => {
    expect(CLOSING_FILTERS).toEqual(["ALL", "WON", "LOST"]);
  });
});

describe("o relógio da fase atual", () => {
  it("conta desde a entrada na fase aberta", () => {
    const h = [
      periodo("CAPTURE", "2026-09-01T15:00:00.000Z", "2026-09-04T15:00:00.000Z"),
      periodo("CONTACT", "2026-09-04T15:00:00.000Z"),
    ];
    const t = tempoNaFaseAtual(h, AGORA);
    expect(t?.dias).toBe(10);
    expect(t?.desdeQueORelogioLigou).toBe(false);
  });

  it("SEM HISTÓRICO devolve nulo, nunca 'zero dias'", () => {
    // Régua vazia grita: ausência de medição não é medição de ausência. Um
    // "0 dias" aqui faria o painel tratar lead sem registro como recém-chegado.
    expect(tempoNaFaseAtual([], AGORA)).toBeNull();
    const sóFechados = [
      periodo("CAPTURE", "2026-09-01T15:00:00.000Z", "2026-09-04T15:00:00.000Z"),
    ];
    expect(tempoNaFaseAtual(sóFechados, AGORA)).toBeNull();
  });

  it("avisa quando o tempo só vale desde que o relógio foi ligado", () => {
    const h = [periodo("FOLLOW_UP", "2026-09-12T15:00:00.000Z", null, true)];
    const t = tempoNaFaseAtual(h, AGORA);
    expect(t?.dias).toBe(2);
    expect(t?.desdeQueORelogioLigou).toBe(true);
  });

  it("nunca devolve tempo negativo", () => {
    const futuro = [periodo("CONTACT", "2026-09-20T15:00:00.000Z")];
    expect(tempoNaFaseAtual(futuro, AGORA)?.ms).toBe(0);
  });
});

describe("tempo por fase", () => {
  it("soma as DUAS passagens quando o lead volta para a mesma fase", () => {
    // Voltar do follow-up para o contato é normal; contar só a última passagem
    // faria a fase parecer mais rápida do que foi.
    const h = [
      periodo("CONTACT", "2026-09-01T15:00:00.000Z", "2026-09-03T15:00:00.000Z"),
      periodo("FOLLOW_UP", "2026-09-03T15:00:00.000Z", "2026-09-05T15:00:00.000Z"),
      periodo("CONTACT", "2026-09-05T15:00:00.000Z", "2026-09-09T15:00:00.000Z"),
      periodo("PRESENTED", "2026-09-09T15:00:00.000Z"),
    ];
    const total = tempoPorFase(h, AGORA);
    expect(total.get("CONTACT")).toBe(6 * UM_DIA);
    expect(total.get("FOLLOW_UP")).toBe(2 * UM_DIA);
    expect(total.get("PRESENTED")).toBe(5 * UM_DIA);
  });

  it("a fase aberta conta até agora", () => {
    const h = [periodo("PROPOSAL_SENT", "2026-09-11T15:00:00.000Z")];
    expect(tempoPorFase(h, AGORA).get("PROPOSAL_SENT")).toBe(3 * UM_DIA);
  });
});

describe("rótulo de duração", () => {
  it("fala em dias, e o primeiro dia é 'hoje'", () => {
    expect(rotuloDeDuracao(0)).toBe("hoje");
    expect(rotuloDeDuracao(5 * 60 * 60 * 1000)).toBe("hoje");
    expect(rotuloDeDuracao(UM_DIA)).toBe("1 dia");
    expect(rotuloDeDuracao(12 * UM_DIA)).toBe("12 dias");
  });
});

describe("o TypeScript e o banco falam das mesmas fases", () => {
  it("o CHECK da migração 1007 lista exatamente LEAD_STAGES", () => {
    // Duas listas da mesma coisa divergem no dia em que alguém mexe só numa.
    // Aqui o teste LÊ a migração: se ela ganhar uma fase e o TS não, quebra.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/1007_funil_fases_e_relogio.sql"),
      "utf8"
    );
    const bloco = sql.match(
      /add constraint commercial_leads_stage_check\s*\n?\s*check \(stage in \(([^)]+)\)\)/
    );
    expect(bloco, "não achei o CHECK de stage na 1007").toBeTruthy();
    const doBanco = [...bloco![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...doBanco].sort()).toEqual([...LEAD_STAGES].sort());
  });
});

// ⚠️ O DEFEITO DE 14/09/2026: O RELÓGIO NÃO OUVIA O QUE PRECISAVA OUVIR.
//
// O gatilho do relógio nasceu como `after update OF stage` — e `UPDATE OF
// <coluna>` dispara pelas colunas que o COMANDO nomeia, não pelo que um
// gatilho BEFORE mudou depois. Quando os dois selos do follow-up passaram a
// fechar o lead (1010, gatilho BEFORE que muda `new.stage`), o comando só
// nomeava `contract_signed_at`: a fase virava CLOSED_WON e o histórico
// continuava aberto em Follow-up, para sempre.
//
// O estrago era silencioso: o tempo do fechamento seria contado como tempo de
// negociação e o painel mediria errado sem nada na tela denunciando.
describe("o gatilho do relógio ouve QUALQUER mudança de fase", () => {
  function ultimaDefinicao(): string {
    // A definição que vale é a ÚLTIMA — migração posterior redefine a anterior.
    const arquivos = [
      "supabase/migrations/1007_funil_fases_e_relogio.sql",
      "supabase/migrations/1010_funil_apresentacao_envio_e_selos.sql",
    ];
    let achado: string | null = null;
    for (const f of arquivos) {
      const sql = readFileSync(join(process.cwd(), f), "utf8");
      const m = [
        ...sql.matchAll(
          /create trigger commercial_leads_track_stage([\s\S]*?);/g
        ),
      ];
      if (m.length) achado = m[m.length - 1][1];
    }
    // Régua vazia grita: não achar a definição é falha de medição, não aprovação.
    expect(achado, "não achei a definição do gatilho do relógio").toBeTruthy();
    return achado!;
  }

  it("não está preso a `update of stage`", () => {
    expect(ultimaDefinicao()).not.toMatch(/update\s+of\s+stage/i);
  });

  it("continua ouvindo a criação do lead", () => {
    // Lead que nasce numa fase escolhida no cadastro precisa abrir o relógio.
    expect(ultimaDefinicao()).toMatch(/after\s+insert\s+or\s+update/i);
  });

  it("e a guarda contra linha repetida continua na função", () => {
    // É ela, e não a cláusula do gatilho, que impede o relógio de gravar duas
    // vezes quando alguém edita outro campo qualquer.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/1007_funil_fases_e_relogio.sql"),
      "utf8"
    );
    expect(sql).toMatch(/new\.stage is distinct from old\.stage/);
  });
});
