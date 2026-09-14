import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estaSelado,
  faltaParaFechar,
  linkDoWhatsApp,
  montarMensagem,
  moveParaFollowUp,
} from "@/lib/empresarial/envio";
import { DISPATCH_ITEMS } from "@/lib/empresarial/constants";

describe("o que move o cartão para Follow-up", () => {
  it("só o envio que inclui a PROPOSTA", () => {
    // Mandar só a apresentação é conversa, não negociação — e pular a fase
    // faria o funil dizer que há uma proposta na mesa quando não há.
    expect(moveParaFollowUp(["PROPOSAL"])).toBe(true);
    expect(moveParaFollowUp(["PROPOSAL", "CONTRACT", "BOLETO"])).toBe(true);
    expect(moveParaFollowUp(["PRESENTATION"])).toBe(false);
    expect(moveParaFollowUp(["CONTRACT", "BOLETO"])).toBe(false);
    expect(moveParaFollowUp([])).toBe(false);
  });

  it("o TypeScript e o gatilho do banco concordam sobre isso", () => {
    // Duas regras sobre a mesma coisa divergem no dia em que alguém mexe só
    // numa. Aqui o teste LÊ a migração e exige que ela cheque 'PROPOSAL'.
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/1010_funil_apresentacao_envio_e_selos.sql"
      ),
      "utf8"
    );
    expect(sql).toMatch(/if not \('PROPOSAL' = any \(new\.items\)\)/);
  });
});

describe("a mensagem pronta para enviar", () => {
  it("chama a pessoa pelo primeiro nome", () => {
    const m = montarMensagem({
      empresa: "Bom Sabor",
      contato: "Marta da Silva Pereira",
      itens: ["PROPOSAL"],
      consultor: "João",
    });
    expect(m).toContain("Olá, Marta!");
  });

  it("sem contato, cumprimenta sem inventar nome", () => {
    const m = montarMensagem({
      empresa: "Bom Sabor",
      contato: null,
      itens: ["PROPOSAL"],
      consultor: null,
    });
    expect(m).toContain("Olá!");
    expect(m).not.toContain("undefined");
    expect(m).not.toContain("null");
  });

  it("nomeia cada item que vai junto, em português", () => {
    const m = montarMensagem({
      empresa: "Bom Sabor",
      contato: "Marta",
      itens: ["PROPOSAL", "CONTRACT", "BOLETO"],
      consultor: "João",
    });
    expect(m).toContain("• Proposta comercial");
    expect(m).toContain("• Contrato");
    expect(m).toContain("• Boleto da implantação");
    for (const cru of DISPATCH_ITEMS) expect(m).not.toContain(cru);
  });

  it("cita a empresa e pede confirmação de recebimento", () => {
    const m = montarMensagem({
      empresa: "Metalúrgica Aurora",
      contato: "Marta",
      itens: ["PROPOSAL"],
      consultor: "João",
    });
    expect(m).toContain("Metalúrgica Aurora");
    expect(m).toMatch(/confirmar o recebimento/i);
  });

  it("não promete prazo que ninguém combinou", () => {
    const m = montarMensagem({
      empresa: "Bom Sabor",
      contato: "Marta",
      itens: ["PROPOSAL"],
      consultor: "João",
    });
    expect(m).not.toMatch(/\b\d+\s*(dias|horas)\b/);
  });
});

describe("o link do WhatsApp", () => {
  it("põe o código do país quando falta", () => {
    const link = linkDoWhatsApp("(43) 99999-0000", "oi");
    expect(link).toContain("wa.me/5543999990000");
  });

  it("não duplica o código do país", () => {
    const link = linkDoWhatsApp("55 43 99999-0000", "oi");
    expect(link).toContain("wa.me/5543999990000");
    expect(link).not.toContain("5555");
  });

  it("escapa a mensagem para o endereço não quebrar", () => {
    const link = linkDoWhatsApp("43999990000", "Olá, Marta!\n• Proposta");
    expect(link).toContain("%0A");
    expect(link).not.toContain("\n");
  });

  it("SEM TELEFONE devolve nulo — botão que abre vazio parece que funcionou", () => {
    expect(linkDoWhatsApp(null, "oi")).toBeNull();
    expect(linkDoWhatsApp("", "oi")).toBeNull();
    expect(linkDoWhatsApp("999", "oi")).toBeNull();
  });
});

describe("os dois selos do fechamento", () => {
  it("UM SÓ NÃO FECHA NADA", () => {
    // Contrato sem pagamento é promessa; pagamento sem contrato é dinheiro sem
    // amarração. É a regra de ouro do projeto.
    expect(
      faltaParaFechar({ contractSignedAt: "2026-09-14", implantationPaidAt: null })
    ).toEqual(["boleto da implantação pago"]);
    expect(
      faltaParaFechar({ contractSignedAt: null, implantationPaidAt: "2026-09-14" })
    ).toEqual(["contrato assinado"]);
  });

  it("nenhum dos dois: lista os dois", () => {
    expect(
      faltaParaFechar({ contractSignedAt: null, implantationPaidAt: null })
    ).toEqual(["contrato assinado", "boleto da implantação pago"]);
  });

  it("os dois verdes fecham", () => {
    const selos = {
      contractSignedAt: "2026-09-14T12:00:00Z",
      implantationPaidAt: "2026-09-14T13:00:00Z",
    };
    expect(faltaParaFechar(selos)).toEqual([]);
    expect(estaSelado(selos)).toBe(true);
  });

  it("o gatilho do banco exige os DOIS também", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/1010_funil_apresentacao_envio_e_selos.sql"
      ),
      "utf8"
    );
    expect(sql).toMatch(
      /new\.contract_signed_at is not null\s*\n?\s*and new\.implantation_paid_at is not null/
    );
  });
});
