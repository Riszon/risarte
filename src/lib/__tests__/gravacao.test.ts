import { describe, expect, it } from "vitest";
import { dispensaConsentimento, relogio, TIPOS_QUE_GRAVAM } from "../gravacao";

/**
 * ⚠️ O TESTE QUE PRENDE UMA DISPENSA DE LGPD.
 *
 * Em 21/09/2026 o dono, com o jurídico dele, dispensou o consentimento
 * registrado para o ÁUDIO da avaliação e da reavaliação (relato OC-00060: a
 * gravação precisa começar junto com o atendimento, senão o avaliador esquece
 * de ligar e não há o que transcrever).
 *
 * Dispensa que mora espalhada em `if`s cresce sozinha: um dia alguém precisa
 * salvar "só uma foto" antes do consentimento, acrescenta um `||`, e seis
 * meses depois ninguém sabe mais o que exige e o que não exige. Estes testes
 * são a cerca: cada caso que passa está escrito aqui, com o nome de quem
 * decidiu e quando.
 */
describe("dispensa do consentimento — áudio da avaliação", () => {
  it("o áudio da AVALIAÇÃO passa sem consentimento", () => {
    expect(dispensaConsentimento("audio", "clinical_conversion")).toBe(true);
  });

  it("o áudio da REAVALIAÇÃO também", () => {
    expect(dispensaConsentimento("audio", "reevaluation")).toBe(true);
  });

  it("FOTO, EXAME e VÍDEO continuam exigindo — inclusive na avaliação", () => {
    for (const tipo of ["photo", "exam", "video", "document"]) {
      expect(dispensaConsentimento(tipo, "clinical_conversion")).toBe(false);
      expect(dispensaConsentimento(tipo, "reevaluation")).toBe(false);
    }
  });

  it("áudio FORA da avaliação continua exigindo", () => {
    for (const fase of [
      "acquisition",
      "planning_center",
      "commercial_conversion",
      "treatment_start",
      "follow_up",
    ]) {
      expect(dispensaConsentimento("audio", fase)).toBe(false);
    }
  });

  it("sem fase conhecida, exige — na dúvida, a regra vale", () => {
    expect(dispensaConsentimento("audio", null)).toBe(false);
    expect(dispensaConsentimento("audio", undefined)).toBe(false);
    expect(dispensaConsentimento("audio", "")).toBe(false);
  });
});

describe("gravação automática", () => {
  it("começa sozinha só em avaliação e reavaliação", () => {
    // Sessão de tratamento, urgência e retorno ficam de fora (decisão do dono):
    // gerariam muito áudio para casos em que ninguém pediu transcrição.
    expect([...TIPOS_QUE_GRAVAM]).toEqual(["evaluation", "reevaluation"]);
  });

  it("o relógio da faixa conta em mm:ss", () => {
    expect(relogio(0)).toBe("00:00");
    expect(relogio(9)).toBe("00:09");
    expect(relogio(75)).toBe("01:15");
    // Passa de uma hora sem quebrar: a faixa mostra 60 minutos, não 00:00.
    expect(relogio(3675)).toBe("61:15");
  });
});
