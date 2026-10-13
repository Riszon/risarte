import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRY_STAGES,
  impedimentoDaFase,
  recusaDoBanco,
  type DadosDoFechamento,
  type StagePeriod,
} from "@/lib/empresarial/funnel";
import {
  perdasDoLead,
  porConsultor,
  type LeadDoPainel,
} from "@/lib/empresarial/painel-funil";
import type { LeadStage } from "@/lib/empresarial/constants";

// AP39 e AP36 — decisões do dono em 13/10/2026:
//   - no funil, SÓ É GANHO COM OS DOIS SELOS, e a implantação SÓ COMEÇA PELA
//     CONFERÊNCIA (antes, dois botões do cartão passavam por fora);
//   - empresa perdida pode ser REABERTA na mesma ficha, e a perda continua
//     contando no painel.
// Quem impõe a primeira é o banco (migração 1028, provada no treino em
// transação desfeita). Aqui ficam as regras puras e as réguas das telas.

const nada: DadosDoFechamento = {
  contractSignedAt: null,
  implantationPaidAt: null,
  companyId: null,
  conferidoOk: false,
};
const selada: DadosDoFechamento = {
  ...nada,
  contractSignedAt: "2026-10-01T12:00:00Z",
  implantationPaidAt: "2026-10-02T12:00:00Z",
};

describe("o que impede a passagem de fase", () => {
  it("GANHO exige os DOIS selos — um só não fecha", () => {
    expect(impedimentoDaFase("CLOSED_WON", nada)).toContain(
      "contrato assinado e boleto da implantação pago"
    );
    const soContrato = impedimentoDaFase("CLOSED_WON", {
      ...nada,
      contractSignedAt: "2026-10-01T12:00:00Z",
    });
    expect(soContrato).toContain("Falta: boleto da implantação pago.");
    expect(soContrato).not.toContain("Falta: contrato");
    const soPagamento = impedimentoDaFase("CLOSED_WON", {
      ...nada,
      implantationPaidAt: "2026-10-02T12:00:00Z",
    });
    expect(soPagamento).toContain("Falta: contrato assinado.");
    expect(impedimentoDaFase("CLOSED_WON", selada)).toBeNull();
  });

  it("a recusa do ganho diz ONDE resolver", () => {
    expect(impedimentoDaFase("CLOSED_WON", nada)).toContain("aba Envio e selos");
  });

  it("IMPLANTAÇÃO exige o cadastro e a conferência — nessa ordem", () => {
    // Sem cadastro, é ele que falta (mesmo com a conferência dada).
    expect(
      impedimentoDaFase("IMPLEMENTATION", { ...selada, conferidoOk: true })
    ).toContain("Crie o cadastro da empresa");
    // Com cadastro e sem conferência, é a conferência.
    expect(
      impedimentoDaFase("IMPLEMENTATION", { ...selada, companyId: "emp-1" })
    ).toContain("conferência do consultor");
    expect(
      impedimentoDaFase("IMPLEMENTATION", {
        ...selada,
        companyId: "emp-1",
        conferidoOk: true,
      })
    ).toBeNull();
  });

  it("as fases em aberto e a perda não têm impedimento aqui", () => {
    for (const fase of [...ENTRY_STAGES, "CLOSED_LOST"] as LeadStage[]) {
      expect(impedimentoDaFase(fase, nada), fase).toBeNull();
    }
  });

  it("reabrir só oferece fase EM ABERTO — ganho e implantação têm caminho próprio", () => {
    expect(ENTRY_STAGES).toContain("CONTACT");
    for (const fechada of ["CLOSED_WON", "CLOSED_LOST", "IMPLEMENTATION"] as const) {
      expect(ENTRY_STAGES).not.toContain(fechada);
    }
  });
});

const MIGRACAO = readFileSync(
  join(process.cwd(), "supabase/migrations/1028_funil_ganho_so_com_selos.sql"),
  "utf8"
).replace(/\r\n/g, "\n");

describe("a recusa do banco, em português", () => {
  const codigos = [...MIGRACAO.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]);

  it("a régua acha os códigos que a migração levanta", () => {
    // Zero códigos seria ausência de medição, não "tudo traduzido".
    expect(codigos.sort()).toEqual([
      "IMPLEMENTATION_WITHOUT_COMPANY",
      "IMPLEMENTATION_WITHOUT_REVIEW",
      "WON_WITHOUT_SEALS",
    ]);
  });

  it("TODO código levantado pelo banco tem tradução", () => {
    for (const codigo of codigos) {
      const traducao = recusaDoBanco(`new row violates: ${codigo}`);
      expect(traducao, codigo).not.toBeNull();
      expect(traducao, codigo).not.toContain(codigo);
    }
  });

  it("erro que não conhece devolve NULO — nunca uma mensagem errada com cara de certa", () => {
    expect(recusaDoBanco("permission denied for table x")).toBeNull();
    expect(recusaDoBanco(null)).toBeNull();
  });

  it("a tela e o banco dizem a MESMA frase em cada recusa", () => {
    expect(recusaDoBanco("IMPLEMENTATION_WITHOUT_COMPANY")).toBe(
      impedimentoDaFase("IMPLEMENTATION", selada)
    );
    expect(recusaDoBanco("IMPLEMENTATION_WITHOUT_REVIEW")).toBe(
      impedimentoDaFase("IMPLEMENTATION", { ...selada, companyId: "emp-1" })
    );
  });
});

describe("a migração 1028", () => {
  it("o gatilho roda DEPOIS do que fecha pelos selos (ordem alfabética do nome)", () => {
    const nome = (MIGRACAO.match(/create trigger (\w+)\s+before insert or update/) ?? [])[1];
    expect(nome).toBe("commercial_leads_guard_closing");
    expect(nome! > "commercial_leads_close_when_sealed").toBe(true);
  });

  it("confere a PASSAGEM de fase, não a fase — o que já estava lá não é tocado", () => {
    expect(MIGRACAO).toContain("old.stage is distinct from 'CLOSED_WON'");
    expect(MIGRACAO).toContain("old.stage is distinct from 'IMPLEMENTATION'");
  });

  it("não apaga nem altera dado: só função e gatilho", () => {
    const semComentario = MIGRACAO.replace(/--.*$/gm, "");
    expect(semComentario).not.toMatch(/\b(delete from|truncate|drop table|alter table)\b/i);
    // Nenhum UPDATE solto em tabela — o único "update" é o do nome do gatilho.
    expect(semComentario).not.toMatch(/^\s*update\s+empresarial\./im);
  });
});

function lead(
  id: string,
  stage: LeadStage,
  history: StagePeriod[],
  extra: Partial<LeadDoPainel> = {}
): LeadDoPainel {
  return {
    id,
    companyName: `Empresa ${id}`,
    stage,
    consultantId: "ana",
    consultantName: "Ana",
    captureChannel: null,
    estimatedValueCents: null,
    history,
    ...extra,
  };
}
const periodo = (
  stage: LeadStage,
  enteredAt: string,
  leftAt: string | null,
  isInitial = false
): StagePeriod => ({ stage, enteredAt, leftAt, isInitial });

describe("o painel conta a perda pelo HISTÓRICO", () => {
  it("perdida e ainda perdida conta uma", () => {
    const l = lead("a", "CLOSED_LOST", [
      periodo("CONTACT", "2026-09-01T10:00:00Z", "2026-09-10T10:00:00Z"),
      periodo("CLOSED_LOST", "2026-09-10T10:00:00Z", null),
    ]);
    expect(perdasDoLead(l)).toBe(1);
  });

  it("REABERTA: a perda NÃO some — e a empresa volta a contar em aberto", () => {
    const reaberta = lead("b", "CONTACT", [
      periodo("CONTACT", "2026-09-01T10:00:00Z", "2026-09-10T10:00:00Z"),
      periodo("CLOSED_LOST", "2026-09-10T10:00:00Z", "2026-10-13T10:00:00Z"),
      periodo("CONTACT", "2026-10-13T10:00:00Z", null),
    ]);
    expect(perdasDoLead(reaberta)).toBe(1);
    const [ana] = porConsultor([reaberta]);
    expect(ana.perdas).toBe(1);
    expect(ana.emAberto).toBe(1);
    expect(ana.ganhos).toBe(0);
  });

  it("reaberta e GANHA: uma perda e um ganho — a taxa de ganho não finge 100%", () => {
    const virou = lead("c", "CLOSED_WON", [
      periodo("CLOSED_LOST", "2026-09-10T10:00:00Z", "2026-10-01T10:00:00Z"),
      periodo("FOLLOW_UP", "2026-10-01T10:00:00Z", "2026-10-10T10:00:00Z"),
      periodo("CLOSED_WON", "2026-10-10T10:00:00Z", null),
    ]);
    const [ana] = porConsultor([virou]);
    expect(ana.ganhos).toBe(1);
    expect(ana.perdas).toBe(1);
    expect(ana.taxaDeGanho).toBe(50);
  });

  it("perdida duas vezes conta duas", () => {
    const l = lead("d", "CLOSED_LOST", [
      periodo("CLOSED_LOST", "2026-08-01T10:00:00Z", "2026-09-01T10:00:00Z"),
      periodo("CONTACT", "2026-09-01T10:00:00Z", "2026-09-20T10:00:00Z"),
      periodo("CLOSED_LOST", "2026-09-20T10:00:00Z", null),
    ]);
    expect(perdasDoLead(l)).toBe(2);
  });

  it("perdida SEM histórico (anterior ao relógio) conta uma — a fase atual é a evidência", () => {
    expect(perdasDoLead(lead("e", "CLOSED_LOST", []))).toBe(1);
    // E quem nunca foi perdida não ganha perda nenhuma.
    expect(perdasDoLead(lead("f", "FOLLOW_UP", []))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — leem as telas e as actions. Cada uma foi provada quebrando o
// código de propósito.
// ---------------------------------------------------------------------------

const FUNIL = "src/app/(app)/empresarial/funil";
const ler = (caminho: string) => {
  const texto = readFileSync(join(process.cwd(), caminho), "utf8").replace(/\r\n/g, "\n");
  if (texto.length < 200) throw new Error(`${caminho}: vazio ou curto demais`);
  return texto;
};
/** O JSX sem os comentários — para a régua não tropeçar no texto que explica o que saiu. */
const semComentarios = (t: string) =>
  t.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const funcao = (texto: string, nome: string) => {
  const i = texto.indexOf(`export async function ${nome}(`);
  if (i < 0) throw new Error(`não achei a action ${nome}`);
  const f = texto.indexOf("\nexport async function ", i + 10);
  return texto.slice(i, f < 0 ? undefined : f);
};

describe("réguas do fechamento no funil", () => {
  const cartao = semComentarios(ler(`${FUNIL}/lead-board.tsx`));
  const acoes = ler(`${FUNIL}/actions.ts`);

  it("o cartão NÃO tem mais atalho para o ganho nem para a implantação", () => {
    expect(cartao).not.toContain('move("IMPLEMENTATION")');
    expect(cartao).not.toContain("Mover para Implantação");
    expect(cartao).not.toContain("Fechar (ganho) → criar empresa");
    // O único "criar empresa" que sobra é o da empresa JÁ ganha, sem cadastro.
    expect(cartao.split("convertLeadToCompany(").length - 1).toBe(1);
    // Nenhuma tela pede a implantação pela action genérica de mover.
    expect(cartao).not.toMatch(/moveLeadStage\([^)]*"IMPLEMENTATION"/);
    expect(cartao).not.toMatch(/moveLeadStage\([^)]*"CLOSED_WON"/);
  });

  it("criar a empresa confere os selos ANTES de criar", () => {
    const criar = funcao(acoes, "convertLeadToCompany");
    // A RECUSA, não só a pergunta: chamar a régua e ignorar a resposta passaria
    // por uma busca pelo nome da função.
    const confere = criar.indexOf("if (semSelos) return { ok: false, error: semSelos };");
    const cria = criar.indexOf('.from("companies")');
    expect(criar).toContain('const semSelos = impedimentoDaFase("CLOSED_WON"');
    expect(confere).toBeGreaterThan(0);
    expect(cria).toBeGreaterThan(0);
    // Depois de criada, a empresa já existiria — conferir depois não desfaz nada.
    expect(confere).toBeLessThan(cria);
    expect(criar).toContain("contract_signed_at, implantation_paid_at");
  });

  it("criar a empresa não ignora mais a recusa ao ligar o cartão", () => {
    const criar = funcao(acoes, "convertLeadToCompany");
    expect(criar).toContain("erroDoVinculo");
    expect(criar).toMatch(/if \(erroDoVinculo\) \{/);
  });

  it("mover de fase pergunta antes, e traduz a recusa do banco", () => {
    const mover = funcao(acoes, "moveLeadStage");
    expect(mover).toContain('stage === "CLOSED_WON" || stage === "IMPLEMENTATION"');
    expect(mover).toContain("impedimentoDaFase(stage,");
    // …e DEVOLVE o impedimento antes de gravar.
    const recusa = mover.indexOf("if (impedimento) return { ok: false, error: impedimento };");
    const grava = mover.indexOf(".update(patch)");
    expect(recusa).toBeGreaterThan(0);
    expect(recusa).toBeLessThan(grava);
    expect(mover).toContain("recusaDoBanco(error.message)");
  });

  it("reabrir exige empresa PERDIDA, fase em aberto e motivo — e não apaga o motivo da perda", () => {
    const reabrir = funcao(acoes, "reopenLead");
    expect(reabrir).toContain('lead.stage !== "CLOSED_LOST"');
    expect(reabrir).toContain("ENTRY_STAGES.includes(stage)");
    expect(reabrir).toContain("!motivo.trim()");
    expect(reabrir).toContain(".update({ stage })");
    expect(reabrir).not.toContain("lost_reason");
    // No formato que a linha do tempo sabe fundir à linha da fase.
    expect(reabrir).toContain("Movido para ${LEAD_STAGE_LABELS[stage]} — motivo:");
  });

  it("a aba Fechamento da empresa perdida oferece a reabertura", () => {
    const aba = ler(`${FUNIL}/[leadId]/fechamento-em-aberto.tsx`);
    const perdida = aba.slice(aba.indexOf("export function NegocioPerdido("));
    expect(perdida).toContain("<ReabrirNegociacao leadId={leadId} />");
    expect(aba).toContain("await reopenLead(leadId, fase, motivo)");
    // O texto antigo dizia que não tinha volta.
    expect(aba).not.toContain("não tem\n            botão para trazê-la de volta");
    expect(semComentarios(aba)).not.toContain("botão para trazê-la de volta");
  });
});
