import { describe, expect, it } from "vitest";
import {
  formatRecipients,
  mensagemDaConfiguracao,
  normalizeRecipients,
  parseDayList,
  parseRecipients,
  unknownMessageFields,
} from "@/lib/signatures/settings";
import {
  canConfigureSignatures,
  canSendSignatures,
  canViewSignatureNetworkDashboard,
  canViewSignaturePackages,
  canViewSignatures,
} from "@/lib/signatures/access";
import { matrizPadrao } from "@/lib/permissions";
import type { SessionContext } from "@/lib/auth";

// ZS1: as regras puras da tela de configurações e o espelho de `signature_can`.

describe("destinatários do relatório mensal", () => {
  it("entende 'Nome <email>' e só o e-mail, uma pessoa por linha", () => {
    const r = parseRecipients('Jeferson <Jeferson@Risarte.com.br>\n"André" <andre@x.com>\nfin@x.com');
    expect(r.recipients).toEqual([
      { name: "Jeferson", email: "jeferson@risarte.com.br" },
      { name: "André", email: "andre@x.com" },
      { name: "", email: "fin@x.com" },
    ]);
    expect(r.invalid).toEqual([]);
  });
  it("linha que não é e-mail volta como inválida; repetido entra uma vez", () => {
    const r = parseRecipients("a@x.com\nnão é email\na@x.com");
    expect(r.recipients).toHaveLength(1);
    expect(r.invalid).toEqual(["não é email"]);
  });
  it("o que está gravado é limpo ao ler (lixo não quebra a tela)", () => {
    expect(normalizeRecipients([{ name: "A", email: "A@X.com" }, { email: "ruim" }, null, "x"])).toEqual([{ name: "A", email: "a@x.com" }]);
    expect(normalizeRecipients("não é lista")).toEqual([]);
  });
  it("ida e volta", () => {
    const lista = [{ name: "A", email: "a@x.com" }, { name: "", email: "b@x.com" }];
    expect(parseRecipients(formatRecipients(lista)).recipients).toEqual(lista);
  });
});

describe("dias e campos da mensagem", () => {
  it("'2, 5' vira [2, 5]; repetido e fora de ordem se arruma; vazio ou letra é nulo", () => {
    expect(parseDayList("5, 2, 5")).toEqual([2, 5]);
    expect(parseDayList("2 5 7")).toEqual([2, 5, 7]);
    expect(parseDayList("")).toBeNull();
    expect(parseDayList("dois")).toBeNull();
    expect(parseDayList("2, -1")).toBeNull();
  });
  it("campo desconhecido na mensagem é apontado; os quatro conhecidos passam", () => {
    expect(unknownMessageFields("Olá {{nome}}, {{ unidade }} {{link}} {{prazo}}")).toEqual([]);
    expect(unknownMessageFields("Olá {{nome}} {{cpf}} {{cpf}}")).toEqual(["cpf"]);
  });
  it("os erros da porta saem em português", () => {
    expect(mensagemDaConfiguracao({ message: "NOT_ALLOWED" })).toMatch(/Admin Master/);
    expect(mensagemDaConfiguracao({ message: "MESSAGE_REQUIRED" })).toMatch(/mensagem padrão/);
    expect(mensagemDaConfiguracao({ message: "violates check constraint" })).toMatch(/fora do permitido/);
    expect(mensagemDaConfiguracao({ message: "Could not find the function signature_save_settings" })).toMatch(/0340/);
    expect(mensagemDaConfiguracao(null)).toMatch(/Não foi possível/);
  });
});

describe("quem pode o quê (espelho de signature_can)", () => {
  const sessao = (rolesByClinic: Record<string, string[]>, isAdminMaster = false) =>
    ({ isAdminMaster, rolesByClinic, permissoes: matrizPadrao() }) as unknown as SessionContext;

  it("o Admin Master pode tudo, inclusive configurar", () => {
    const s = sessao({}, true);
    expect(canViewSignatures(s)).toBe(true);
    expect(canConfigureSignatures(s)).toBe(true);
    expect(canViewSignatureNetworkDashboard(s)).toBe(true);
  });
  it("o gerente vê e envia na própria unidade, não configura, não vê a rede", () => {
    const s = sessao({ un: ["unit_manager"] });
    expect(canViewSignatures(s)).toBe(true);
    expect(canSendSignatures(s, "un")).toBe(true);
    expect(canSendSignatures(s, "outra")).toBe(false);
    expect(canViewSignaturePackages(s, "un")).toBe(true);
    expect(canViewSignaturePackages(s, "outra")).toBe(false);
    expect(canConfigureSignatures(s)).toBe(false);
    expect(canViewSignatureNetworkDashboard(s)).toBe(false);
  });
  it("o Financeiro da Franqueadora vê a rede — e com isso qualquer unidade", () => {
    const s = sessao({ fr: ["finance_franchisor"] });
    expect(canViewSignatureNetworkDashboard(s)).toBe(true);
    expect(canViewSignaturePackages(s, "qualquer")).toBe(true);
  });
  it("o Coordenador vê, mas não envia; a recepção e o dentista não veem o módulo", () => {
    expect(canViewSignatures(sessao({ un: ["clinical_coordinator"] }))).toBe(true);
    expect(canSendSignatures(sessao({ un: ["clinical_coordinator"] }), "un")).toBe(false);
    expect(canViewSignatures(sessao({ un: ["receptionist"] }))).toBe(false);
    expect(canViewSignatures(sessao({ un: ["dentist"] }))).toBe(false);
  });
});
