// 4015a — venda com parcelas num acordo em aberto não é cancelada (19.28.11 A(a)).
// O banco é provado no ensaio (scripts/asaas-ensaio-4015a.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mensagemDoAcordoEmAberto } from "@/lib/acordo-em-aberto";

const SQL = readFileSync("supabase/migrations/4015a_asa4_recusa_cancelar_venda_com_acordo_aberto.sql", "utf8");
const CANCEL = readFileSync("src/app/(app)/apresentacao/[clientId]/cancellation-actions.ts", "utf8");
const DIRETA = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");

describe("a recusa do cancelamento com acordo em aberto", () => {
  it("o banco recusa nos três caminhos, seguindo a cadeia de acordos", () => {
    expect(SQL).toContain("before insert on public.plan_cancellations");
    expect(SQL).toContain("before update of cancelled_at on public.commercial_sales");
    expect(SQL).toContain("before update of cancelled on public.direct_sales");
    expect(SQL).toContain("with recursive cadeia(reneg_id)");
    expect(SQL).toContain("r.status = 'aguardando_autorizacao'");
    expect(SQL).toContain("raise exception 'RENEGOTIATED_OPEN: %'");
  });
  it("a tela explica o motivo e a quem recorrer, com o código do acordo", () => {
    const m = mensagemDoAcordoEmAberto("RENEGOTIATED_OPEN: RN-00012, RN-00015")!;
    expect(m).toContain("no acordo RN-00012, RN-00015");
    expect(m).toContain("fale com o Financeiro da Franqueadora ou com o Admin Master");
    expect(mensagemDoAcordoEmAberto("NOT_ALLOWED")).toBeNull();
    expect(CANCEL.match(/mensagemDoAcordoEmAberto\(m\)/g)?.length).toBe(2);
    expect(DIRETA).toContain("mensagemDoAcordoEmAberto(m)");
  });
});
