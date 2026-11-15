// 4017a — a exceção para cancelar venda com acordo de renegociação (19.30).
// O banco é provado no ensaio (scripts/asaas-ensaio-4017a.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4017a_asa4_excecao_cancelar_venda_com_acordo.sql", "utf8");
const PAINEL = readFileSync("src/components/commercial/acordos-da-venda.tsx", "utf8");
const ACOES = readFileSync("src/app/(app)/financeiro/cobrancas-automaticas/excecao-actions.ts", "utf8");
const CANC = readFileSync("src/app/(app)/apresentacao/[clientId]/cancellation-actions.ts", "utf8");
const DIRETA = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
const TERMO = readFileSync("src/app/cancelamentos/[id]/termo/page.tsx", "utf8");

describe("quem pede e quem autoriza (19.30.2, 3b)", () => {
  it("só o Gerente ou o Admin Master pede; só o Financeiro ou o Admin autoriza; nunca quem pediu", () => {
    expect(SQL).toMatch(/sale_cancel_exception_request[\s\S]*?if not public\._is_manager_or_admin\(v_clinic\) then raise exception 'NOT_ALLOWED'/);
    expect(SQL).toContain("if not (public.is_finance_franchisor() or public.is_admin_master()) then raise exception 'NOT_ALLOWED'; end if;");
    expect(SQL).toContain("if e.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;");
  });
  it("o aviso vai ao Financeiro da Franqueadora (a rede) e aos Admin; a fila é da rede para eles", () => {
    expect(SQL).toContain("select ucr.user_id u from public.user_clinic_roles ucr where ucr.role = 'finance_franchisor'");
    expect(SQL).toMatch(/sale_cancel_exceptions_read[\s\S]*public\.is_admin_master\(\) or public\.is_finance_franchisor\(\) or public\._is_manager_or_admin\(e\.clinic_id\)/);
  });
  it("a Recepção vê o motivo e a orientação de chamar o Gerente", () => {
    expect(PAINEL).toContain("Chame o Gerente da unidade: só ele (ou o Admin Master) pode pedir a exceção ao Financeiro.");
    expect(ACOES).toContain("Só o Gerente da unidade ou o Admin Master pede a exceção. Chame o Gerente.");
  });
});

describe("a validade (19.30.2, 1a) e os casos sem exceção", () => {
  it("vale 7 dias, uma vez, e cai se o acordo mudar", () => {
    expect(SQL).toContain("valid_until = case when p_approve then public.today_br() + 7 end");
    expect(SQL).toContain("e.status = 'autorizada' and e.used_at is null and e.valid_until >= public.today_br()");
    expect(SQL).toContain("= coalesce((select array_agg(x order by x) from unnest(e.open_installment_ids) x), '{}'::uuid[])");
    expect(SQL).toContain("update public.sale_cancel_exceptions set status = 'usada', used_at = now() where id = p_exception_id;");
  });
  it("acordo pendente: cancele antes; várias vendas: distrato; venda direta com pago: distrato (2a)", () => {
    expect(SQL).toContain("raise exception 'PENDING_FIRST'");
    expect(SQL).toContain("raise exception 'MULTI_SALE'");
    expect(SQL).toContain("if p_direct_sale_id is not null and v_pago > 0 then raise exception 'DIRECT_SALE_PAID'; end if;");
  });
});

describe("o cancelamento com a exceção (19.30.3)", () => {
  it("o acerto conta o pago no acordo, e o termo mostra a linha (e o cartão a receber)", () => {
    expect(SQL).toContain("v_paid := v_paid + v_agr_paid;");
    expect(TERMO).toContain("pagos no acordo de renegociação desta venda");
    expect(TERMO).toContain("a unidade ainda vai receber");
  });
  it("efetivar cancela as parcelas abertas do acordo e encerra o acordo; os boletos caem no Asaas antes", () => {
    expect(SQL).toContain("perform public._sale_agreements_close(v_c.negotiation_id, null, v_c.exception_id, v_user);");
    expect(SQL).toContain("perform public._sale_agreements_close(null, p_sale_id, v_exc, v_user);");
    expect(CANC).toContain("...doAcordo.installmentIds");
    expect(DIRETA).toContain("...doAcordo.installmentIds");
    expect(SQL).toContain("raise exception 'EXCEPTION_INVALID'");
  });
});
