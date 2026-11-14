import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DIVIDAS,
  CAMPOS_PROTESTOS,
  casarColunas,
  celulaParaValor,
  celulasDaLinha,
  conferirPlanilha,
  decisaoEfetiva,
  devedorPeloNome,
  lerCentavos,
  lerData,
  linhaVazia,
  mapeamentoPadrao,
  type Contexto,
  type DadosDaDivida,
  type DadosDoProtesto,
  type LinhaDaPlanilha,
} from "@/lib/finance/dividas-importacao";

// ⚠️ Tudo aqui é INVENTADO (D0): nenhum credor, valor ou CNPJ de credor da
// planilha real da rede. Os CNPJs das unidades são os do cadastro (públicos).

const LDN = { id: "ldn", nome: "Risarte Londrina - Centro", razaoSocial: null, cnpj: "32.042.156/0001-21", franqueadora: false };
const CBE = { id: "cbe", nome: "Risarte Cambé - Centro", razaoSocial: null, cnpj: "28.375.429/0001-82", franqueadora: false };
const ADM = { id: "adm", nome: "RISARTE Franchising", razaoSocial: "RISARTE ADMINISTRACAO", cnpj: "46.232.307/0001-19", franqueadora: true };

const ctx = (extra: Partial<Contexto> = {}): Contexto => ({
  devedores: [LDN, CBE, ADM],
  credores: [{ id: "banco-x", nome: "Banco Exemplo", razaoSocial: "BANCO EXEMPLO SA", documento: "11222333000181" }],
  categorias: [
    { id: "emp", parentId: null, nome: "Empréstimos e financiamentos", natureza: "financeira", ativa: true },
    { id: "emp-1", parentId: "emp", nome: "Empréstimo", natureza: null, ativa: true },
    { id: "giro", parentId: null, nome: "Capital de giro / limite / cheque especial", natureza: "financeira", ativa: true },
    { id: "trib", parentId: null, nome: "Tributos", natureza: "tributaria", ativa: true },
    { id: "acl", parentId: null, nome: "A classificar", natureza: null, ativa: true },
  ],
  naturezas: [
    { code: "financeira", label: "Financeira" },
    { code: "tributaria", label: "Tributária" },
  ],
  dividas: [],
  titulosLivres: [],
  hoje: "2026-11-14",
  ...extra,
});

const divida = (numero: number, c: Record<string, string | number | null>, extra: Partial<LinhaDaPlanilha> = {}): LinhaDaPlanilha => ({
  aba: "dividas",
  numero,
  celulas: {
    chave: String(numero - 1),
    devedor: "Risarte Londrina",
    devedor_cnpj: "32.042.156/0001-21",
    credor: "Banco Exemplo",
    credor_cnpj: "11.222.333/0001-81",
    categoria: "Empréstimos e financiamentos",
    subcategoria: "Empréstimo",
    vencimento: "10/04/2025",
    valor_atualizado: 1234.56,
    origem: "A - Anterior à implantação",
    ...c,
  },
  ...extra,
});

const dados = (l: { dados: unknown }) => l.dados as DadosDaDivida;

describe("células e mapeamento", () => {
  it("data como texto e como data do Excel na mesma coluna (3.9.1)", () => {
    expect(lerData("10/04/2025")).toBe("2025-04-10");
    expect(lerData("2025-04-10")).toBe("2025-04-10");
    expect(lerData(45757)).toBe("2025-04-10"); // série do Excel
    expect(lerData("31/02/2025")).toBeNull();
    expect(celulaParaValor(new Date(2025, 3, 10))).toBe("2025-04-10");
  });

  it("valor como número (reais) e como texto brasileiro", () => {
    expect(lerCentavos(1234.56)).toBe(123456);
    expect(lerCentavos("R$ 1.234,56")).toBe(123456);
    expect(lerCentavos("")).toBeNull();
  });

  it("o modelo padrão casa as colunas da planilha da rede, e o da 0407 é o mesmo", () => {
    const cab = ["#", "Devedor (unidade)", "Razão social devedora", "CNPJ devedor", "Credor", "CNPJ do credor", "Categoria",
      "Subcategoria", "Natureza", "Situação", "Descrição / origem", "Nº contrato / título", "Data de vencimento", "Valor original",
      "Valor atualizado", "Data de referência do valor", "Proposta de quitação", "Condição de pagamento da proposta",
      "Validade da proposta", "Desconto", "Economia", "Tem proposta?", "Valor estimado para regularizar", "Negativada?",
      "Protestada?", "Cartório", "Custas do protesto", "Origem do lançamento", "Fonte da informação", "Observações / pendências"];
    const { colunas, faltando } = casarColunas(cab, CAMPOS_DIVIDAS, mapeamentoPadrao().colunas.dividas);
    expect(faltando).toEqual([]);
    expect(Object.keys(colunas)).toHaveLength(CAMPOS_DIVIDAS.length - 1); // só a "Quantidade reunida" (nova) não está
    expect(Object.values(colunas)).not.toContain("Economia"); // calculada: não importa

    const sql = readFileSync("supabase/migrations/0407_dividas_importacao.sql", "utf8");
    const padrao = mapeamentoPadrao();
    for (const [campo, col] of [...Object.entries(padrao.colunas.dividas), ...Object.entries(padrao.colunas.protestos)]) {
      expect(sql, campo).toContain(`'${campo}', '${col}'`);
    }
  });

  it("falta coluna obrigatória → a tela pede o mapeamento", () => {
    expect(casarColunas(["Credor", "Valor"], CAMPOS_DIVIDAS).faltando).toEqual(["Data de vencimento"]);
    expect(casarColunas(["Devedor", "Credor"], CAMPOS_PROTESTOS).faltando).toEqual(["Valor protestado"]);
  });

  it("linha de total e linha vazia não são dívida", () => {
    expect(linhaVazia({ credor: null, valor_atualizado: null })).toBe(true);
    expect(linhaVazia({ chave: "TOTAL", valor_atualizado: 999 })).toBe(true);
    expect(linhaVazia(celulasDaLinha({ Credor: "Banco Exemplo" }, { credor: "Credor" }))).toBe(false);
  });

  it("devedor pelo nome: unidade e franqueadora", () => {
    const ds = ctx().devedores;
    expect(devedorPeloNome("Risarte Cambé", ds)?.id).toBe("cbe");
    expect(devedorPeloNome("Risarte Administração", ds)?.id).toBe("adm");
    expect(devedorPeloNome("Risarte", ds)).toBeNull();
  });
});

describe("a conferência da aba Dívidas", () => {
  it("linha boa: devedor pelo CNPJ, credor e categorias do cadastro, origem pela coluna (D2)", () => {
    const [l] = conferirPlanilha([divida(2, {})], ctx()).linhas;
    expect(l.temErro).toBe(false);
    expect(l.sugerida).toBe("importar");
    const d = dados(l);
    expect(d.clinic_id).toBe("ldn");
    expect(d.supplier).toEqual({ id: "banco-x" });
    expect(d.category).toEqual({ id: "emp" });
    expect(d.subcategory).toEqual({ id: "emp-1" });
    expect(d.debt).toMatchObject({ origin: "A", due_date: "2025-04-10", updated_cents: 123456, debt_type: "emprestimo", nature_code: "financeira" });
  });

  it("CNPJ do devedor com dígito errado (o 'arrastar' do Excel) é erro, com o cadastrado mais parecido", () => {
    const [l] = conferirPlanilha([divida(2, { devedor_cnpj: "28.375.429/0001-83" })], ctx()).linhas;
    expect(l.temErro).toBe(true);
    expect(l.bloqueia).toBe(true);
    expect(l.dados).toBeNull();
    expect(l.avisos.map((a) => a.texto).join(" ")).toMatch(/inválido.*Risarte Cambé - Centro/);
  });

  it("dois cadastros com o mesmo CNPJ: recusa a linha em vez de escolher (seção 7)", () => {
    const c = ctx({ devedores: [LDN, CBE, { ...ADM, cnpj: LDN.cnpj }] });
    const [l] = conferirPlanilha([divida(2, {})], c).linhas;
    expect(l.temErro).toBe(true);
    expect(l.avisos[0].texto).toMatch(/CNPJ ambíguo/);
  });

  it("o devedor escolhido na correção resolve o erro do CNPJ", () => {
    const [l] = conferirPlanilha([divida(2, { devedor_cnpj: "28.375.429/0001-83" }, { ajustes: { clinicId: "cbe" } })], ctx()).linhas;
    expect(l.temErro).toBe(false);
    expect(dados(l).clinic_id).toBe("cbe");
  });

  it("credor novo com só a raiz do CNPJ: aceito, para cadastrar com a pendência (D18)", () => {
    const r = conferirPlanilha([divida(2, { credor: "Fornecedor Inventado", credor_cnpj: "99887766" })], ctx());
    const l = r.linhas[0];
    expect(l.temErro).toBe(false);
    expect(dados(l).supplier).toMatchObject({ name: "Fornecedor Inventado", document: "99887766", kind: "bancos" });
    expect(r.credoresNovos).toEqual([{ chave: "99887766", nome: "Fornecedor Inventado", documento: "99887766", linhas: 1 }]);
  });

  it("dois fornecedores com o mesmo nome e sem CNPJ na linha: erro, nunca cadastra um terceiro", () => {
    const c = ctx({ credores: [...ctx().credores, { id: "banco-y", nome: "Banco Exemplo", razaoSocial: null, documento: null }] });
    const [l] = conferirPlanilha([divida(2, { credor_cnpj: null })], c).linhas;
    expect(l.temErro).toBe(true);
    expect(l.credorNovo).toBeNull();
    expect(l.avisos[0].texto).toMatch(/2 fornecedores cadastrados/);
  });

  it("credor 'Detalhar' ou a própria Risarte: erro até identificar (pendência 11)", () => {
    for (const credor of ["Detalhar", "Risarte Londrina"]) {
      const [l] = conferirPlanilha([divida(2, { credor, credor_cnpj: null })], ctx()).linhas;
      expect(l.temErro, credor).toBe(true);
      expect(l.avisos[0].texto).toMatch(/Credor a identificar/);
    }
  });

  it("categoria com nome mais curto que o do cadastro casa; desconhecida será criada", () => {
    const r = conferirPlanilha(
      [divida(2, { categoria: "Capital de giro / limite", subcategoria: null }), divida(3, { categoria: "Consórcio", subcategoria: "Cota" })],
      ctx()
    );
    expect(dados(r.linhas[0]).category).toEqual({ id: "giro" });
    expect(dados(r.linhas[1]).category).toEqual({ name: "Consórcio", nature_code: null });
    expect(dados(r.linhas[1]).subcategory).toEqual({ name: "Cota" });
    expect(r.categoriasNovas).toEqual(["Consórcio", "Consórcio › Cota"]);
  });

  it("sem vencimento ou sem valor é erro; vencimento = data do levantamento é aviso (pendência 8)", () => {
    const r = conferirPlanilha(
      [
        divida(2, { vencimento: null }),
        divida(3, { valor_atualizado: null, valor_original: null }),
        divida(4, { vencimento: "30/10/2026", data_referencia: "30/10/2026" }),
      ],
      ctx()
    );
    expect(r.linhas[0].temErro).toBe(true);
    expect(r.linhas[1].temErro).toBe(true);
    expect(r.linhas[2].temErro).toBe(false);
    expect(r.linhas[2].avisos.map((a) => a.texto).join(" ")).toMatch(/data do levantamento/);
  });

  it("situações da planilha: negativada, dívida ativa, grupo (D11), em negociação", () => {
    const r = conferirPlanilha(
      [
        divida(2, { situacao: "Dívida negativada", fonte: "Serasa Limpa Nome (22/10/2026)" }),
        divida(3, { situacao: "Dívida ativa", categoria: "Tributos", subcategoria: null }),
        divida(4, { situacao: "Grupo de dívidas" }),
        divida(5, { situacao: "Grupo de dívidas", quantidade: 4 }),
        divida(6, { situacao: "Em negociação" }),
      ],
      ctx()
    );
    const [neg, ativa, grupo, grupo4, negoc] = r.linhas.map(dados);
    expect(neg.negativation).toEqual({ bureau: "serasa", in_limpa_nome: true });
    expect(neg.debt.notes).toMatch(/Fonte: Serasa/);
    expect(ativa.debt).toMatchObject({ tax_active_debt: true, debt_type: "imposto" });
    expect(grupo.debt).toMatchObject({ needs_split: true, bundled_count: 2 });
    expect(r.linhas[2].avisos.map((a) => a.texto).join(" ")).toMatch(/quantas ela reúne/);
    expect(grupo4.debt).toMatchObject({ needs_split: true, bundled_count: 4 });
    expect(negoc.manual_stage).toBe("em_negociacao");
  });

  it("proposta: vira a primeira do histórico; vencida entra como expirada; maior que a dívida avisa", () => {
    const r = conferirPlanilha(
      [
        divida(2, { proposta: 500, proposta_validade: "30/11/2026", proposta_condicao: "à vista no Pix", fonte: "Serasa Limpa Nome" }),
        divida(3, { proposta: 2000, proposta_validade: "01/01/2026" }),
      ],
      ctx()
    );
    expect(dados(r.linhas[0]).proposal).toMatchObject({ amount_cents: 50000, valid_until: "2026-11-30", source: "serasa_limpa_nome" });
    const texto = r.linhas[1].avisos.map((a) => a.texto).join(" ");
    expect(texto).toMatch(/expirada/);
    expect(texto).toMatch(/MAIOR que o valor/);
  });

  it("repetida dentro do arquivo e igual a uma dívida já cadastrada (sugere Ignorar)", () => {
    const c = ctx({
      dividas: [{ id: "d1", code: "DV-000009", clinicId: "ldn", supplierId: "banco-x", contrato: null, vencimento: "2025-04-10", valorCents: 123456 }],
    });
    const r = conferirPlanilha([divida(2, {}), divida(3, {})], c);
    expect(r.linhas[0].sugerida).toBe("ignorar");
    expect(r.linhas[0].duplicadaDe).toBe("d1");
    expect(r.linhas[1].avisos.map((a) => a.texto).join(" ")).toMatch(/repetida da linha 2/);
  });

  it("título parecido no Contas a Pagar: avisa na origem A e vincula na origem C (ajuste 2)", () => {
    const titulo = { id: "t1", clinicId: "ldn", fornecedorId: "banco-x", descricao: "Parcela", valorCents: 123456, vencimento: "2025-04-10", documento: null };
    const c = ctx({ titulosLivres: [titulo] });
    const [a] = conferirPlanilha([divida(2, {})], c).linhas;
    expect(a.sugerida).toBe("importar");
    expect(a.avisos.map((x) => x.texto).join(" ")).toMatch(/origem C/);
    const [cc] = conferirPlanilha([divida(2, { origem: "C - Já lançada no Contas a Pagar" })], c).linhas;
    expect(cc.sugerida).toBe("vincular");
    expect(dados(cc).link_payable_ids).toEqual(["t1"]);
    expect(dados(cc).debt.origin).toBe("C");
    // Origem C sem título nenhum: erro.
    const [semTitulo] = conferirPlanilha([divida(2, { origem: "C" })], ctx()).linhas;
    expect(semTitulo.temErro).toBe(true);
    // Escolher "Vincular" numa linha A usa os títulos parecidos.
    const [escolhida] = conferirPlanilha([divida(2, {}, { decisao: "vincular" })], c).linhas;
    expect(dados(escolhida).link_payable_ids).toEqual(["t1"]);
    expect(dados(escolhida).debt.origin).toBe("C");
  });

  it("erro numa linha marcada Ignorar não segura a gravação", () => {
    const r = conferirPlanilha([divida(2, { vencimento: null }, { decisao: "ignorar" }), divida(3, {})], ctx());
    expect(r.linhas[0].temErro).toBe(true);
    expect(r.linhas[0].bloqueia).toBe(false);
    expect(r.bloqueadas).toBe(0);
  });

  it("totais por CNPJ: arquivo = importar + ignorado", () => {
    const r = conferirPlanilha([divida(2, {}), divida(3, { valor_atualizado: 100 }, { decisao: "ignorar" })], ctx());
    expect(r.totais).toEqual([{ clinicId: "ldn", nome: "Risarte Londrina - Centro", linhas: 2, arquivoCents: 133456, importarCents: 123456, ignoradoCents: 10000 }]);
  });
});

describe("a conferência da aba Protestos", () => {
  const protesto = (numero: number, c: Record<string, string | number | null>, extra: Partial<LinhaDaPlanilha> = {}): LinhaDaPlanilha => ({
    aba: "protestos",
    numero,
    celulas: { devedor: "Risarte Londrina", credor: "Banco Exemplo", quantidade: 1, valor: 300, cartorio: "1º Tabelionato de Protesto", data: "05/03/2025", custas: 45.5, ...c },
    ...extra,
  });

  it("'Já está' com o nº da dívida: vincula ao protesto da linha da aba Dívidas", () => {
    const r = conferirPlanilha([divida(2, { chave: "7" }), protesto(2, { ja_esta: "Sim", vinculada: "7" })], ctx());
    const p = r.linhas[1];
    expect(p.sugerida).toBe("vincular");
    expect((p.dados as DadosDoProtesto).link).toEqual({ source_key: "7" });
    expect((p.dados as DadosDoProtesto).protest).toMatchObject({ amount_cents: 30000, cancel_cost_cents: 4550, protested_on: "2025-03-05" });
  });

  it("nº que não existe na aba Dívidas é erro", () => {
    const r = conferirPlanilha([divida(2, { chave: "7" }), protesto(2, { ja_esta: "Sim", vinculada: "99" })], ctx());
    expect(r.linhas[1].temErro).toBe(true);
  });

  it("'Não' vira dívida nova (protestada), e avisa se o credor também está na aba Dívidas (pendência 12)", () => {
    const r = conferirPlanilha([divida(2, {}), protesto(2, { ja_esta: "Não", quantidade: 3 })], ctx());
    const p = r.linhas[1];
    expect(p.sugerida).toBe("nova");
    const d = p.dados as DadosDoProtesto;
    expect(d.link).toBeNull();
    expect(d.nova?.debt).toMatchObject({ origin: "A", due_date: "2025-03-05", updated_cents: 30000, needs_split: true, bundled_count: 3 });
    expect(d.nova?.category).toEqual({ id: "acl" });
    expect(p.avisos.map((a) => a.texto).join(" ")).toMatch(/mesmo credor está na aba Dívidas \(linha 2\)/);
  });

  it("'Verificar' segura a gravação até a pessoa decidir", () => {
    const r = conferirPlanilha([protesto(2, { ja_esta: "Verificar" })], ctx());
    expect(r.linhas[0].sugerida).toBe("verificar");
    expect(r.linhas[0].bloqueia).toBe(true);
    expect(r.linhas[0].dados).toBeNull();
    const decidido = conferirPlanilha([protesto(2, { ja_esta: "Verificar" }, { decisao: "nova" })], ctx());
    expect(decidido.linhas[0].bloqueia).toBe(false);
    expect(decisaoEfetiva(decidido.linhas[0])).toBe("nova");
  });

  it("protesto ligado a uma linha repetida de dívida já cadastrada vai para a cadastrada", () => {
    const c = ctx({
      dividas: [{ id: "d1", code: "DV-000009", clinicId: "ldn", supplierId: "banco-x", contrato: null, vencimento: "2025-04-10", valorCents: 123456 }],
    });
    const r = conferirPlanilha([divida(2, { chave: "7" }), protesto(2, { ja_esta: "Sim", vinculada: "7" })], c);
    expect((r.linhas[1].dados as DadosDoProtesto).link).toEqual({ debt_id: "d1" });
  });
});

describe("0407 — o banco", () => {
  const SQL = readFileSync("supabase/migrations/0407_dividas_importacao.sql", "utf8").replace(/\r\n/g, "\n");

  it("a gravação passa pelas portas do cadastro à mão (a importação não tem regra própria)", () => {
    const corpo = SQL.slice(SQL.indexOf("function public._debt_import_debt"), SQL.indexOf("revoke execute on function public._debt_import_debt"));
    for (const porta of ["public.debt_save(", "public.debt_save_proposal(", "public.debt_save_negativation(", "public.debt_save_protest(", "public.debt_link_payables("]) {
      expect(corpo, porta).toContain(porta);
    }
    expect(SQL).toContain("perform public._debt_sync_finance(t.id);");
  });

  it("linha com erro ou 'Verificar' não grava; desfazer só sem pagamento", () => {
    expect(SQL).toContain("Há linhas com erro ou decisão pendente");
    expect(SQL).toContain("Já há pagamento em título de dívida deste lote");
    expect(SQL).toContain("perform public.debt_delete(d.id,");
  });

  it("nenhuma tabela nova tem regra de escrita; toda porta tira o anônimo antes", () => {
    const policies = [...SQL.matchAll(/create policy "([^"]+)" on public\.(\w+)\s+for (\w+)/gi)];
    expect(policies).toHaveLength(4);
    expect(policies.filter((p) => p[3].toLowerCase() !== "select")).toEqual([]);
    for (const m of SQL.matchAll(/grant execute on function (public\.\w+)\(/g)) {
      expect(SQL).toMatch(new RegExp(`revoke execute on function ${m[1].replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`));
    }
  });

});
