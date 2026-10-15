import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionContext } from "@/lib/auth";
import { matrizPadrao, type MatrizPermissoes } from "@/lib/permissions";
import type { UserRole } from "@/lib/roles";
import {
  bancoAceitaGravarNaRede,
  canConfigureFinanceNetwork,
  canEditFinanceNetwork,
} from "@/lib/finance/access";
import { canConsumeStock, canManageStock, canManageStockCatalog, canPostStockEntry } from "@/lib/stock-access";
import {
  canDecidePurchaseAllocations,
  canManagePurchaseRequests,
  canReceivePurchases,
  canViewPurchases,
} from "@/lib/purchases-access";

// Relatos OC-00094 a OC-00099 (14/10/2026): a função Franqueadora/Rede tinha,
// na matriz, Financeiro, Estoque e Compras ligados — e as telas abriam o
// formulário que o BANCO recusava no Salvar. Decisão do dono: a tela segue o
// banco. Estas réguas espelham as regras do banco (conferidas no treino em
// 14/10/2026) e prendem que a tela não promete mais do que ele aceita.

const FRANQUEADORA = "matriz";
const UNIDADE = "cambe";

/** A matriz como estava na produção em 14/10: o dono ligou tudo isto para a Franqueadora/Rede. */
function matrizDaProducao(): MatrizPermissoes {
  const m = matrizPadrao();
  const liga = (cap: string, ...papeis: UserRole[]) => {
    m[cap] = [...new Set([...(m[cap] ?? []), ...papeis])];
  };
  liga("modulo.financeiro", "franchisor_staff");
  liga("modulo.estoque", "franchisor_staff");
  liga("modulo.compras", "franchisor_staff");
  liga("acao.financeiro.lancar", "franchisor_staff");
  liga("acao.financeiro.configurar_rede", "franchisor_staff");
  liga("acao.estoque.gerir", "asb", "franchisor_staff");
  liga("acao.estoque.consumir", "franchisor_staff", "planner_dentist");
  liga("acao.estoque.catalogo", "franchisor_staff");
  liga("acao.compras.requisitar", "asb", "clinical_coordinator", "franchisor_staff");
  return m;
}

function sessao(
  rolesByClinic: Record<string, UserRole[]>,
  permissoes: MatrizPermissoes = matrizDaProducao(),
  isAdminMaster = false
): SessionContext {
  // As unidades com o TIPO: a Franqueadora decide a própria compra (OC-00102).
  const clinics = [
    { id: FRANQUEADORA, name: "Franqueadora", type: "franchisor", is_active: true },
    { id: UNIDADE, name: "Cambé", type: "franchise_unit", is_active: true },
  ];
  return { isAdminMaster, rolesByClinic, permissoes, clinics } as unknown as SessionContext;
}

describe("a Franqueadora/Rede (quem relatou): a matriz liga, o banco recusa — a tela segue o banco", () => {
  const andre = sessao({ [FRANQUEADORA]: ["franchisor_staff"] });

  it("continua VENDO a rede (as telas de consulta não mudam)", () => {
    expect(canConfigureFinanceNetwork(andre)).toBe(true);
  });
  it("OC-00098: juros, multa e centros de custo — só consulta", () => {
    expect(bancoAceitaGravarNaRede(andre)).toBe(false);
    expect(canEditFinanceNetwork(andre)).toBe(false);
  });
  it("OC-00097: cadastrar material — só consulta", () => {
    expect(canManageStockCatalog(andre)).toBe(false);
    expect(canManageStock(andre, FRANQUEADORA)).toBe(false);
  });
  it("OC-00096: lista de compras — só consulta", () => {
    expect(canManagePurchaseRequests(andre, FRANQUEADORA)).toBe(false);
    expect(canDecidePurchaseAllocations(andre, FRANQUEADORA)).toBe(false);
  });
});

describe("o Financeiro da Franqueadora (a função feita para isto)", () => {
  const fin = sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, matrizPadrao());

  it("grava a configuração da rede e o catálogo", () => {
    expect(canEditFinanceNetwork(fin)).toBe(true);
    expect(canManageStockCatalog(fin)).toBe(true);
  });
  it("faz entrada de estoque em qualquer unidade (o banco aceita)", () => {
    expect(canManageStock(fin, UNIDADE)).toBe(true);
  });
  it("lista de compras: o banco aceita, mas a matriz de fábrica não liga — desligar sempre vale", () => {
    // O caso do relato: a lista da PRÓPRIA Franqueadora (a matriz olha a função na unidade escolhida).
    expect(canManagePurchaseRequests(fin, FRANQUEADORA)).toBe(false);
    const ligada = matrizPadrao();
    ligada["acao.compras.requisitar"] = [...ligada["acao.compras.requisitar"], "finance_franchisor"];
    expect(canManagePurchaseRequests(sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, ligada), FRANQUEADORA)).toBe(true);
  });
  it("APROVA a compra da própria Franqueadora (OC-00102, 0294) — sem precisar de \"Criar requisição\"", () => {
    // A matriz de fábrica NÃO liga "requisitar" para ele; aprovar tem permissão própria.
    expect(canDecidePurchaseAllocations(sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, matrizPadrao()), FRANQUEADORA)).toBe(true);
  });
  it("NÃO aprova a compra de uma UNIDADE — quem paga é ela (o banco recusa)", () => {
    const emTodas = sessao({ [FRANQUEADORA]: ["finance_franchisor"], [UNIDADE]: ["finance_franchisor"] }, matrizPadrao());
    expect(canDecidePurchaseAllocations(emTodas, UNIDADE)).toBe(false);
  });
  it("antes da 0294 no banco (sem a permissão gravada): vale a regra de antes — o gerente não perde os botões", () => {
    const semAprovar = matrizPadrao();
    delete semAprovar["acao.compras.aprovar"];
    expect(canDecidePurchaseAllocations(sessao({ [UNIDADE]: ["unit_manager"] }, semAprovar), UNIDADE)).toBe(true);
    // …e o Financeiro só ganha quando a permissão chegar ao banco.
    expect(canDecidePurchaseAllocations(sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, semAprovar), FRANQUEADORA)).toBe(false);
  });
  it("desligado na matriz, não aprova nem a da Franqueadora — desligar sempre vale", () => {
    const m = matrizPadrao();
    m["acao.compras.aprovar"] = m["acao.compras.aprovar"].filter((p) => p !== "finance_franchisor");
    expect(canDecidePurchaseAllocations(sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, m), FRANQUEADORA)).toBe(false);
  });
});

describe("o Gerente da unidade", () => {
  const gerente = sessao({ [UNIDADE]: ["unit_manager"] });

  it("na PRÓPRIA unidade: estoque, lista e aprovação", () => {
    expect(canManageStock(gerente, UNIDADE)).toBe(true);
    expect(canManagePurchaseRequests(gerente, UNIDADE)).toBe(true);
    expect(canDecidePurchaseAllocations(gerente, UNIDADE)).toBe(true);
  });
  it("em OUTRA unidade, não", () => {
    expect(canManageStock(gerente, FRANQUEADORA)).toBe(false);
    expect(canManagePurchaseRequests(gerente, FRANQUEADORA)).toBe(false);
  });
  it("não grava a configuração da rede", () => {
    expect(canEditFinanceNetwork(gerente)).toBe(false);
    expect(canManageStockCatalog(gerente)).toBe(false);
  });
  it("desligado na matriz, o gerente perde — desligar sempre funciona", () => {
    const m = matrizDaProducao();
    m["acao.compras.requisitar"] = m["acao.compras.requisitar"].filter((p) => p !== "unit_manager");
    expect(canManagePurchaseRequests(sessao({ [UNIDADE]: ["unit_manager"] }, m), UNIDADE)).toBe(false);
  });
});

// AP42 (decisão do dono, 15/10/2026, 0296): a matriz ligava e o banco
// recusava; o dono escolheu LIBERAR NO BANCO — mas só o que a matriz dizia.
describe("Coordenador e ASB em Compras e Estoque (AP42, 0296)", () => {
  const coord = sessao({ [UNIDADE]: ["clinical_coordinator"] });
  const asb = sessao({ [UNIDADE]: ["asb"] });

  it("Coordenador e ASB montam a lista de compras da própria unidade", () => {
    expect(canManagePurchaseRequests(coord, UNIDADE)).toBe(true);
    expect(canManagePurchaseRequests(asb, UNIDADE)).toBe(true);
    // Em outra unidade, não.
    expect(canManagePurchaseRequests(coord, FRANQUEADORA)).toBe(false);
    expect(canViewPurchases(coord, UNIDADE)).toBe(true);
  });
  it("…mas NÃO recebem o pedido: o recebimento cria conta a pagar", () => {
    expect(canReceivePurchases(coord, UNIDADE)).toBe(false);
    expect(canReceivePurchases(asb, UNIDADE)).toBe(false);
    expect(canReceivePurchases(sessao({ [UNIDADE]: ["unit_manager"] }), UNIDADE)).toBe(true);
  });
  it("o ASB dá entrada e faz o inventário; o Coordenador não (não foi liberado)", () => {
    expect(canPostStockEntry(asb, UNIDADE)).toBe(true);
    expect(canPostStockEntry(coord, UNIDADE)).toBe(false);
    // …nem se alguém ligar para ele na matriz: o banco não aceita, e a tela segue o banco.
    const ligada = matrizDaProducao();
    ligada["acao.estoque.gerir"] = [...ligada["acao.estoque.gerir"], "clinical_coordinator"];
    expect(canPostStockEntry(sessao({ [UNIDADE]: ["clinical_coordinator"] }, ligada), UNIDADE)).toBe(false);
    expect(canConsumeStock(asb, UNIDADE)).toBe(true); // consumo avulso continua
  });
  it("…e o ASB NÃO passa a gerir o resto (nota de compra, mínimo, kits)", () => {
    expect(canManageStock(asb, UNIDADE)).toBe(false);
  });
  it("a Franqueadora/Rede continua só consultando (OC-00094), mesmo com a matriz ligada", () => {
    const rede = sessao({ [FRANQUEADORA]: ["franchisor_staff"] });
    expect(canManagePurchaseRequests(rede, FRANQUEADORA)).toBe(false);
    expect(canPostStockEntry(rede, FRANQUEADORA)).toBe(false);
  });
  it("desligado na matriz, não monta e não dá entrada — desligar sempre vale", () => {
    const m = matrizDaProducao();
    m["acao.compras.requisitar"] = m["acao.compras.requisitar"].filter((p) => p !== "asb");
    m["acao.estoque.gerir"] = m["acao.estoque.gerir"].filter((p) => p !== "asb");
    expect(canManagePurchaseRequests(sessao({ [UNIDADE]: ["asb"] }, m), UNIDADE)).toBe(false);
    expect(canPostStockEntry(sessao({ [UNIDADE]: ["asb"] }, m), UNIDADE)).toBe(false);
  });
  it("as telas usam as regras novas (e o recebimento a dele)", () => {
    const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(ler("src/app/(app)/compras/receber/page.tsx")).toContain(
      "canReceive={canReceivePurchases(session, clinicId)}"
    );
    expect(ler("src/app/(app)/compras/receber/actions.ts")).toContain(
      "if (!canReceivePurchases(session, input.clinicId))"
    );
    const acoes = ler("src/app/(app)/estoque/actions.ts");
    expect(acoes).toContain("? canPostStockEntry(session, input.clinicId)");
    expect(acoes.split("if (!canPostStockEntry(session, input.clinicId))").length - 1).toBe(4);
    const tela = ler("src/app/(app)/estoque/stock-client.tsx").replace(/\r\n/g, "\n");
    expect(tela).toContain('canPostEntry ? true : k === "consumo" || k === "perda"');
    const inventario = tela.indexOf("INVENTÁRIO (0222)");
    expect(inventario).toBeGreaterThan(0);
    expect(tela.slice(inventario, inventario + 120)).toContain("{canPostEntry && (");
  });
});

describe("o Admin Master passa por tudo", () => {
  const admin = sessao({}, matrizPadrao(), true);
  it("todas", () => {
    expect(canEditFinanceNetwork(admin)).toBe(true);
    expect(canManageStockCatalog(admin)).toBe(true);
    expect(canManageStock(admin, UNIDADE)).toBe(true);
    expect(canManagePurchaseRequests(admin, UNIDADE)).toBe(true);
    expect(canDecidePurchaseAllocations(admin, UNIDADE)).toBe(true);
  });
});

describe("as telas usam a regra que segue o banco", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("juros e multa: a ação recusa antes do banco, e o formulário só edita quem grava", () => {
    expect(ler("src/app/(app)/financeiro/actions.ts")).toMatch(
      /if \(!bancoAceitaGravarNaRede\(session\)\)[\s\S]{0,200}multa, juros e carência/
    );
    expect(ler("src/app/(app)/financeiro/configuracao/page.tsx")).toMatch(/canEdit=\{podeEditarRede\}/);
  });
  it("centros de custo: editar e criar seguem o banco", () => {
    expect(ler("src/app/(app)/financeiro/centros-de-custo/page.tsx")).toMatch(
      /const canManageNetwork = canEditFinanceNetwork\(session\);/
    );
    expect(ler("src/app/(app)/financeiro/actions.ts").match(/if \(!canEditFinanceNetwork\(session\)\)/g)).toHaveLength(2);
  });
  it("aprovar a rodada usa a regra própria (mais estreita) do banco", () => {
    expect(ler("src/app/(app)/compras/aprovar/page.tsx")).toMatch(/canDecide=\{canDecidePurchaseAllocations\(session, clinicId\)\}/);
    expect(ler("src/app/(app)/compras/aprovar/actions.ts").match(/canDecidePurchaseAllocations\(session/g)).toHaveLength(2);
  });
  it("quem só consulta lê QUEM faz, nas seis telas", () => {
    expect(ler("src/app/(app)/financeiro/fornecedores/supplier-manager.tsx")).toMatch(/Só consulta: quem cadastra fornecedor é/);
    expect(ler("src/app/(app)/financeiro/contas-a-pagar/payables-board.tsx")).toMatch(/Só consulta: quem lança conta a pagar é/);
    expect(ler("src/app/(app)/financeiro/conciliacao/reconciliation-board.tsx")).toMatch(/Só consulta: quem cadastra a conta bancária é/);
    expect(ler("src/app/(app)/estoque/stock-client.tsx")).toMatch(/O cadastro de itens é da rede: quem faz é/);
    expect(ler("src/app/(app)/compras/purchases-client.tsx")).toMatch(/Quem monta e envia a lista de compras/);
    expect(ler("src/app/(app)/financeiro/configuracao/page.tsx")).toMatch(/Quem altera multa, juros e carência é/);
    expect(ler("src/app/(app)/financeiro/fluxo-de-caixa/cash-flow-client.tsx")).toMatch(/href="\/financeiro\/conciliacao"/);
  });
});
