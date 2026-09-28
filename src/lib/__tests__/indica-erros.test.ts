import { describe, expect, it } from "vitest";
import { mensagemDoBanco } from "@/lib/indica/erros";

describe("Indica +Risos — mensagens do banco", () => {
  it("tira o código e mantém a frase do motor", () => {
    expect(
      mensagemDoBanco({
        message:
          "INDICA_DUPLICADA: esta pessoa já foi indicada (IND-000012). Vale o primeiro registro.",
      })
    ).toBe("Esta pessoa já foi indicada (IND-000012). Vale o primeiro registro.");
  });

  it("acha o código mesmo com prefixo do Postgres na frente", () => {
    expect(
      mensagemDoBanco({ message: "ERROR:  INDICA_MOTIVO_OBRIGATORIO: informe o motivo." })
    ).toBe("Informe o motivo.");
  });

  it("migração ausente vira aviso de instalação, não erro técnico", () => {
    expect(mensagemDoBanco({ code: "PGRST106", message: "Invalid schema: indica" })).toMatch(
      /ainda não está instalado/
    );
    expect(mensagemDoBanco({ code: "42883", message: "function x does not exist" })).toMatch(
      /ainda não está instalado/
    );
  });

  it("recusa de RLS vira falta de permissão", () => {
    expect(
      mensagemDoBanco({ message: 'new row violates row-level security policy for table "config"' })
    ).toBe("Você não tem permissão para esta ação.");
  });

  it("erro técnico não vaza para a tela", () => {
    const m = mensagemDoBanco({ message: 'duplicate key value violates unique constraint "x"' });
    expect(m).toBe("Não foi possível concluir. Tente de novo.");
    expect(mensagemDoBanco(null)).toBe("Não foi possível concluir. Tente de novo.");
  });
});
