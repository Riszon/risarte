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
import { canConsumeStock, canManageStock, canManageStockCatalog } from "@/lib/stock-access";
import {
  canDecidePurchaseAllocations,
  canManagePurchaseRequests,
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
  return { isAdminMaster, rolesByClinic, permissoes } as unknown as SessionContext;
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
  it("NÃO aprova a parte da unidade na rodada — o banco só aceita Admin e Gerente", () => {
    const ligada = matrizPadrao();
    ligada["acao.compras.requisitar"] = [...ligada["acao.compras.requisitar"], "finance_franchisor"];
    // Na unidade onde ele TEM a função e a matriz liga: mesmo assim, não aprova.
    expect(canDecidePurchaseAllocations(sessao({ [FRANQUEADORA]: ["finance_franchisor"] }, ligada), FRANQUEADORA)).toBe(false);
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

describe("outras funções que a matriz ligou e o banco recusa", () => {
  it("ASB com 'entrada e inventário' ligado: o formulário não abre (o banco só aceita o gerente)", () => {
    const asb = sessao({ [UNIDADE]: ["asb"] });
    expect(canManageStock(asb, UNIDADE)).toBe(false);
    expect(canConsumeStock(asb, UNIDADE)).toBe(true); // consumo avulso continua
  });
  it("Coordenador e ASB com 'criar requisição' ligado: não montam a lista, mas continuam VENDO Compras", () => {
    const coord = sessao({ [UNIDADE]: ["clinical_coordinator"] });
    expect(canManagePurchaseRequests(coord, UNIDADE)).toBe(false);
    expect(canManagePurchaseRequests(sessao({ [UNIDADE]: ["asb"] }), UNIDADE)).toBe(false);
    // Ver segue a matriz — a regra nova não pode tirar leitura de ninguém.
    expect(canViewPurchases(coord, UNIDADE)).toBe(true);
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
