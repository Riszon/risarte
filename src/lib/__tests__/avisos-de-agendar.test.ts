import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADIAMENTO_MS,
  clienteDoAviso,
  nomeDoAvisoDeApresentacao,
  nomeDoAvisoDeFechamento,
} from "@/lib/avisos-de-agendar";

const ID = "49083081-3dee-433e-9da5-476727cf9959";

describe("o aviso que cobra um agendamento (OC-00080)", () => {
  it("lê o cliente dos DOIS formatos de link que as funções gravam", () => {
    expect(clienteDoAviso(`/agenda?cliente=${ID}`)).toBe(ID);
    expect(clienteDoAviso(`/prontuarios/${ID}`)).toBe(ID);
    expect(clienteDoAviso(null)).toBeNull();
    expect(clienteDoAviso("/agenda")).toBeNull();
  });

  it("Fechar adia 15 minutos", () => {
    expect(ADIAMENTO_MS).toBe(15 * 60 * 1000);
  });

  it("acha o nome em todas as variantes do aviso de apresentação", () => {
    expect(nomeDoAvisoDeApresentacao("Agendar apresentação: Ana Lima", "x")).toBe("Ana Lima");
    expect(nomeDoAvisoDeApresentacao("Agendar apresentação comercial: Ana Lima", null)).toBe("Ana Lima");
    expect(
      nomeDoAvisoDeApresentacao(
        "URGENTE: agendar apresentação comercial",
        "Ana Lima está pronto(a) para a Conversão Comercial, mas NÃO tem apresentação"
      )
    ).toBe("Ana Lima");
    expect(
      nomeDoAvisoDeApresentacao(
        "Agendar apresentação comercial",
        "Ana Lima — Clínica: Londrina — Veio de: Instagram"
      )
    ).toBe("Ana Lima");
  });

  it("acha o nome no aviso de fechamento", () => {
    expect(
      nomeDoAvisoDeFechamento(
        "FECHAMENTO! Iniciar tratamento",
        "Gustavo Henrique Carvalho fechou o plano. Fale com o cliente…"
      )
    ).toBe("Gustavo Henrique Carvalho");
  });
});

// ⚠️ A RÉGUA: a tela NÃO pode voltar a calar o aviso. Quem o tira é o banco,
// ao criar o agendamento (0283). "Já agendei" e "Marcar todos" afirmavam um
// fato que ninguém conferia.
const TELAS = [
  "src/components/aviso-de-agendar.tsx",
  "src/components/treatment-start-popup.tsx",
  "src/components/urgent-scheduling-popup.tsx",
];

describe("a tela do aviso não marca nada como lido (OC-00080)", () => {
  for (const arq of TELAS) {
    it(`${arq.split("/").pop()} não cala o aviso`, () => {
      const t = readFileSync(join(process.cwd(), arq), "utf8");
      expect(t).not.toMatch(/markNotifications? ?Read|markNotificationRead|markNotificationsRead/);
      expect(t).not.toMatch(/J[áa] agendei|Marcar todos/);
      expect(t).not.toMatch(/\.update\(\s*\{\s*read_at/);
    });
  }

  it("o botão continua se chamando Fechar (a suíte E2E fecha por ele)", () => {
    const t = readFileSync(join(process.cwd(), TELAS[0]), "utf8");
    expect(t).toMatch(/>\s*Fechar\s*</);
  });
});
