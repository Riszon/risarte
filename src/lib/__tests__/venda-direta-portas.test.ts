import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const acoes = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
const caixa = readFileSync("src/components/venda-direta/caixa.tsx", "utf8");
const agenda = readFileSync("src/app/(app)/agenda/appointment-info-dialog.tsx", "utf8");
const lista = readFileSync("src/app/(app)/comercial/venda-direta/direct-sale-item.tsx", "utf8");

describe("D5 — desmarcar o termo é só do Gerente, com motivo", () => {
  const passo = acoes.slice(
    acoes.indexOf("export async function closeDirectSaleStep("),
    acoes.indexOf("export async function cancelDirectSale(")
  );
  it("o servidor recusa quem não é Gerente (nem Admin) ao desmarcar", () => {
    expect(passo).toMatch(/desmarcandoTermo = step === "contract" && !value/);
    expect(passo).toMatch(/!session\.isAdminMaster && !hasRoleInClinic\(session, info\.clinicId, \["unit_manager"\]\)/);
    expect(passo).toContain("Só o Gerente desmarca o termo assinado.");
  });
  it("o motivo é obrigatório e vai para a Auditoria", () => {
    expect(passo).toMatch(/motivoLimpo\.length < 5/);
    expect(passo).toMatch(/details: \{ step, value, \.\.\.\(desmarcandoTermo \? \{ motivo:/);
  });
  it("as duas telas pedem o motivo", () => {
    expect(caixa).toContain('closeDirectSaleStep(venda.id, "contract", false, motivo)');
    expect(lista).toContain("closeDirectSaleStep(sale.id, which, value, motivo)");
  });
});

describe("as portas do caixa (plano §2)", () => {
  it("a Agenda abre o caixa com o atendimento já escolhido", () => {
    expect(agenda).toContain("<CaixaVendaDireta alvo={vender}");
    expect(agenda).toMatch(/appointmentId: appointment\.id/);
    expect(agenda).toMatch(/appointment\.type !== "commercial_presentation"/);
  });
  it("a lista do Comercial fecha pela mesma janela", () => {
    expect(lista).toMatch(/rotulo="Abrir no caixa"\s*destaque/);
  });
});
