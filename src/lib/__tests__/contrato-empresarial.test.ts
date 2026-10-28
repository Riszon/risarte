import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DO_CONTRATO,
  LINHA_EM_BRANCO,
  abrangencia,
  camposDesconhecidos,
  camposUsados,
  dataPorExtenso,
  enderecoEmLinha,
  lerModelo,
  montarContrato,
  numeroComExtenso,
  numeroPorExtenso,
  paragrafosDoBloco,
  preencher,
  problemasDoModelo,
  trechos,
  valorComExtenso,
  valorPorExtenso,
  type Contratada,
  type DadosDaEmpresaNoContrato,
  type ModeloDeContrato,
} from "@/lib/empresarial/contrato";
import { camposDaEmpresa } from "@/lib/empresarial/proposta";

// O contrato do Programa Risarte Empresarial gerado dentro do sistema
// (OC-00083, migração 1027). O texto é do dono e mora no banco; aqui se prova
// o que PREENCHE o texto — e que o texto semeado não leva dado de ninguém.

describe("valor por extenso", () => {
  it("escreve os valores do modelo exatamente como o modelo escreve", () => {
    expect(valorPorExtenso(3990)).toBe("trinta e nove reais e noventa centavos");
    expect(valorPorExtenso(5990)).toBe("cinquenta e nove reais e noventa centavos");
    expect(valorPorExtenso(1990)).toBe("dezenove reais e noventa centavos");
  });

  it("singular, plural, só reais e só centavos", () => {
    expect(valorPorExtenso(100)).toBe("um real");
    expect(valorPorExtenso(200)).toBe("dois reais");
    expect(valorPorExtenso(1)).toBe("um centavo");
    expect(valorPorExtenso(50)).toBe("cinquenta centavos");
    expect(valorPorExtenso(101)).toBe("um real e um centavo");
    expect(valorPorExtenso(0)).toBe("zero reais");
  });

  it("centenas, milhares e a regra do 'e' entre os grupos", () => {
    expect(numeroPorExtenso(100)).toBe("cem");
    expect(numeroPorExtenso(101)).toBe("cento e um");
    expect(numeroPorExtenso(219)).toBe("duzentos e dezenove");
    expect(numeroPorExtenso(1000)).toBe("mil");
    expect(numeroPorExtenso(1050)).toBe("mil e cinquenta");
    expect(numeroPorExtenso(1500)).toBe("mil e quinhentos");
    expect(numeroPorExtenso(1234)).toBe("mil duzentos e trinta e quatro");
    expect(numeroPorExtenso(2000)).toBe("dois mil");
    expect(numeroPorExtenso(21_300)).toBe("vinte e um mil e trezentos");
    expect(numeroPorExtenso(1_000_000)).toBe("um milhão");
    expect(numeroPorExtenso(2_500_000)).toBe("dois milhões e quinhentos mil");
    expect(valorPorExtenso(500_000)).toBe("cinco mil reais");
    expect(valorPorExtenso(100_000_000)).toBe("um milhão de reais");
    expect(valorPorExtenso(123_456)).toBe(
      "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"
    );
  });

  it("recusa número que não sabe escrever, em vez de escrever errado", () => {
    expect(() => valorPorExtenso(-1)).toThrow();
    expect(() => valorPorExtenso(10.5)).toThrow();
    expect(() => numeroPorExtenso(1_000_000_000)).toThrow();
  });

  it("monta 'R$ 39,90 (trinta e nove reais e noventa centavos)' e '5 (cinco)'", () => {
    expect(valorComExtenso(3990)).toBe("R$ 39,90 (trinta e nove reais e noventa centavos)");
    // Sem o espaço que não quebra do `Intl`: quem copia o texto não leva surpresa.
    expect(valorComExtenso(3990)).not.toContain(" ");
    expect(numeroComExtenso(5)).toBe("5 (cinco)");
    expect(numeroComExtenso(28)).toBe("28 (vinte e oito)");
  });
});

describe("data e abrangência", () => {
  it("a data sai como no modelo, e o dia primeiro leva 'º'", () => {
    expect(dataPorExtenso("2026-08-25")).toBe("25 de agosto de 2026");
    expect(dataPorExtenso("2026-10-01")).toBe("1º de outubro de 2026");
    expect(dataPorExtenso("25/08/2026")).toBeNull();
  });

  it("duas cidades do mesmo estado saem como no modelo — sem repetir e em ordem", () => {
    expect(
      abrangencia([
        { city: "Londrina", state: "PR" },
        { city: "Cambé", state: "PR" },
        { city: "Cambé", state: "pr" },
      ])
    ).toBe("nos municípios de Cambé e Londrina, ambos do estado do Paraná");
  });

  it("uma cidade, três cidades e estados diferentes", () => {
    expect(abrangencia([{ city: "Cambé", state: "PR" }])).toBe(
      "no município de Cambé, no estado do Paraná"
    );
    expect(
      abrangencia([
        { city: "Maringá", state: "PR" },
        { city: "Cambé", state: "PR" },
        { city: "Londrina", state: "PR" },
      ])
    ).toBe("nos municípios de Cambé, Londrina e Maringá, todos do estado do Paraná");
    // Estados diferentes: a sigla vai ao lado, em vez de afirmar um estado só.
    expect(
      abrangencia([
        { city: "Cambé", state: "PR" },
        { city: "Assis", state: "SP" },
      ])
    ).toBe("nos municípios de Assis/SP e Cambé/PR");
  });

  it("sem cidade cadastrada devolve NULO — não imprime 'nos municípios de '", () => {
    expect(abrangencia([])).toBeNull();
    expect(abrangencia([{ city: null, state: "PR" }, { city: "  ", state: null }])).toBeNull();
  });

  it("o endereço sai em uma linha; sem rua ou sem cidade, não há endereço", () => {
    expect(
      enderecoEmLinha({
        street: "Rua das Flores",
        number: "120",
        complement: "sala 3",
        neighborhood: "Centro",
        zipCode: "86180-000",
        city: "Cambé",
        state: "pr",
      })
    ).toBe("Rua das Flores, n°. 120, sala 3 – Centro, CEP 86180-000, em Cambé/PR");
    expect(enderecoEmLinha({ street: "Estrada do Sol", city: "Cambé" })).toBe(
      "Estrada do Sol, em Cambé"
    );
    expect(enderecoEmLinha({ city: "Cambé", state: "PR" })).toBeNull();
    expect(enderecoEmLinha({ street: "Rua A" })).toBeNull();
    expect(enderecoEmLinha(null)).toBeNull();
  });
});

describe("preencher o texto", () => {
  it("troca o campo pelo valor; sem valor, sai a linha em branco", () => {
    expect(
      preencher("**{{contratante_razao_social}}**, RG n°. {{contratante_rg}}", {
        contratante_razao_social: "Aurora Ltda",
        contratante_rg: null,
      })
    ).toBe(`**Aurora Ltda**, RG n°. ${LINHA_EM_BRANCO}`);
    expect(preencher("{{ valor_titular }}", { valor_titular: "R$ 1,00" })).toBe("R$ 1,00");
  });

  it("campo DESCONHECIDO fica à vista — não some em silêncio", () => {
    expect(preencher("x {{razao_socail}} y", {})).toBe("x {{razao_socail}} y");
  });

  it("negrito e os rótulos dos parágrafos", () => {
    expect(trechos("antes **meio** depois")).toEqual([
      { texto: "antes ", negrito: false },
      { texto: "meio", negrito: true },
      { texto: " depois", negrito: false },
    ]);
    expect(
      paragrafosDoBloco({
        titulo: "CLÁUSULA QUINTA",
        corpo: "a permanência será de 12 meses;\nParágrafo primeiro: caso a empresa…\n\nParágrafo único: fim;",
      })
    ).toEqual([
      { rotulo: "CLÁUSULA QUINTA:", texto: "a permanência será de 12 meses;" },
      { rotulo: "Parágrafo primeiro:", texto: "caso a empresa…" },
      { rotulo: "Parágrafo único:", texto: "fim;" },
    ]);
    // Bloco sem título (texto solto) não ganha rótulo inventado.
    expect(paragrafosDoBloco({ titulo: "", corpo: "texto solto" })).toEqual([
      { rotulo: null, texto: "texto solto" },
    ]);
  });
});

const contratada: Contratada = {
  legalName: "RISARTE TESTE LTDA",
  cnpj: "11.222.333/0001-44",
  address: "Rua do Teste, n°. 1, em Cambé/PR",
  repName: "Fulano de Teste",
  repRole: "sócio administrador",
  repNationality: "brasileiro",
  repRg: "1234567",
  repCpf: "111.222.333-44",
  signingCity: "Cambé/PR",
  repGender: "M",
};

const empresa: DadosDaEmpresaNoContrato = {
  companyName: "Aurora",
  cnpj: "55666777000188",
  legalName: "Aurora Indústria Ltda",
  category: "empresa_privada",
  address: { street: "Rua das Flores", number: "120", city: "Cambé", state: "PR" },
  responsibleName: "Maria de Teste",
  responsibleRole: "diretora",
  responsibleNationality: null,
  responsibleRg: null,
  responsibleCpf: "999.888.777-66",
  responsibleGender: "F",
  dueDay: null,
  billingBasis: "PER_EMPLOYEE",
  fixedMonthlyCents: null,
  employeeCount: 40,
  holderFeeCents: 3500,
  includesDependents: true,
  dependentFeeCents: 3000,
  dependentMode: "FAMILY_PACKAGE",
  dependentFamilyFeeCents: 5000,
  dependentFamilyExtraFeeCents: 1500,
  dependentFamilySize: 4,
};

const entrada = {
  empresa,
  faixas: [],
  contratada,
  unidades: [
    { city: "Cambé", state: "PR" },
    { city: "Londrina", state: "PR" },
  ],
  beneficios: 4,
  hoje: "2026-10-13",
};

describe("os dados do contrato", () => {
  it("OS VALORES VÊM DA PROPOSTA — não do padrão da rede", () => {
    const { valores, faltando, avisos } = montarContrato(entrada);
    expect(valores.valor_titular).toBe("R$ 35,00 (trinta e cinco reais)");
    expect(valores.valor_dependente).toBe("R$ 30,00 (trinta reais)");
    expect(valores.valor_familia).toBe("R$ 50,00 (cinquenta reais)");
    expect(valores.valor_dependente_extra).toBe("R$ 15,00 (quinze reais)");
    expect(valores.familia_tamanho).toBe("4");
    expect(valores.contratante_razao_social).toBe("Aurora Indústria Ltda");
    expect(valores.contratante_documento).toBe("55.666.777/0001-88");
    expect(valores.abrangencia).toBe(
      "nos municípios de Cambé e Londrina, ambos do estado do Paraná"
    );
    expect(valores.data_assinatura).toBe("13 de outubro de 2026");
    expect(valores.cidade_assinatura).toBe("Cambé/PR");
    expect(faltando).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it("proposta que não diz o preço cai no padrão do programa (os R$ 39,90 do modelo)", () => {
    const { valores } = montarContrato({
      ...entrada,
      empresa: {
        ...empresa,
        holderFeeCents: null,
        dependentFeeCents: null,
        dependentFamilyFeeCents: null,
        dependentFamilyExtraFeeCents: null,
        dependentFamilySize: null,
      },
    });
    expect(valores.valor_titular).toContain("R$ 39,90");
    expect(valores.valor_dependente).toContain("R$ 39,90");
    expect(valores.valor_familia).toContain("R$ 59,90");
    expect(valores.valor_dependente_extra).toContain("R$ 19,90");
    expect(valores.familia_tamanho).toBe("3");
  });

  it("o dia de vencimento é o combinado; sem combinado, o dia 5", () => {
    expect(montarContrato(entrada).valores.dia_vencimento).toBe("5 (cinco)");
    expect(
      montarContrato({ ...entrada, empresa: { ...empresa, dueDay: 10 } }).valores.dia_vencimento
    ).toBe("10 (dez)");
  });

  it("RG e nacionalidade em branco NÃO são 'falta' — o modelo os deixa para a caneta", () => {
    const { valores, faltando } = montarContrato(entrada);
    expect(valores.contratante_rg).toBeNull();
    expect(valores.contratante_nacionalidade).toBeNull();
    expect(faltando).toEqual([]);
  });

  it("o que FALTA é dito com o nome do campo e o lugar de preencher", () => {
    const { faltando } = montarContrato({
      ...entrada,
      empresa: {
        ...empresa,
        cnpj: "123",
        address: null,
        responsibleName: " ",
        responsibleCpf: null,
      },
      contratada: { ...contratada, repName: null, repRg: "", repCpf: "123" },
      unidades: [],
    });
    expect(faltando).toEqual([
      "CNPJ completo da empresa",
      "endereço da sede da empresa",
      "quem assina pela empresa",
      "CPF de quem assina pela empresa",
      "nome do representante da Risarte (Configurações → Contrato)",
      "RG do representante da Risarte (Configurações → Contrato)",
      "CPF do representante da Risarte (Configurações → Contrato)",
      "cidades de abrangência (cadastre cidade e estado nas unidades da parceria)",
    ]);
    // Sem a linha da Risarte no banco, é ela que falta — inteira.
    expect(montarContrato({ ...entrada, contratada: null }).faltando[0]).toContain(
      "dados da Risarte"
    );
  });

  it("o CPF sai SEMPRE com a máscara, mesmo guardado só com números", () => {
    const { valores, faltando } = montarContrato({
      ...entrada,
      empresa: { ...empresa, responsibleCpf: "99988877766" },
      contratada: { ...contratada, repCpf: "11122233344" },
    });
    expect(valores.contratante_cpf).toBe("999.888.777-66");
    expect(valores.contratada_cpf).toBe("111.222.333-44");
    expect(faltando).toEqual([]);
  });

  it("produtor rural leva a máscara do CAEPF", () => {
    const { valores } = montarContrato({
      ...entrada,
      empresa: { ...empresa, category: "produtor_rural", cnpj: "12345678000199" },
    });
    expect(valores.contratante_documento).toBe("123.456.780/001-99");
  });

  it("VALOR FIXO não cabe na cláusula de 'por colaborador': AVISA, e oferece o campo", () => {
    const { avisos, valores } = montarContrato({
      ...entrada,
      empresa: { ...empresa, billingBasis: "FIXED_PER_COMPANY", fixedMonthlyCents: 500_000 },
    });
    expect(avisos[0]).toContain("VALOR FIXO");
    expect(avisos[0]).toContain("R$ 5.000,00");
    expect(avisos[0]).toContain("Personalize o texto");
    expect(valores.valor_fixo_mensal).toBe("R$ 5.000,00 (cinco mil reais)");
    // Por titular, o campo do valor fixo fica vazio — não imprime um fixo que não existe.
    expect(montarContrato(entrada).valores.valor_fixo_mensal).toBeNull();
  });

  it("PREÇO POR QUANTIDADE: o contrato mostra o valor da faixa, e avisa que o modelo não fala disso", () => {
    const faixas = [
      { minQuantity: 30, priceCents: 3200 },
      { minQuantity: 100, priceCents: 2900 },
    ];
    const r = montarContrato({ ...entrada, faixas });
    expect(r.valores.valor_titular).toBe("R$ 32,00 (trinta e dois reais)");
    expect(r.avisos.some((a) => a.includes("preço por quantidade"))).toBe(true);
    // Abaixo da primeira faixa, vale o preço base — e o aviso diz isso.
    const abaixo = montarContrato({
      ...entrada,
      faixas,
      empresa: { ...empresa, employeeCount: 10 },
    });
    expect(abaixo.valores.valor_titular).toBe("R$ 35,00 (trinta e cinco reais)");
    expect(abaixo.avisos.some((a) => a.includes("não alcançam nenhuma faixa"))).toBe(true);
  });

  it("avisa quando a proposta não tem dependentes, não tem pacote familiar ou não tem benefícios", () => {
    const sem = montarContrato({
      ...entrada,
      empresa: { ...empresa, includesDependents: false },
    });
    expect(sem.avisos.some((a) => a.includes("NÃO inclui dependentes"))).toBe(true);
    const porDependente = montarContrato({
      ...entrada,
      empresa: { ...empresa, dependentMode: "PER_DEPENDENT" },
    });
    expect(porDependente.avisos.some((a) => a.includes("sem pacote familiar"))).toBe(true);
    const semBeneficio = montarContrato({ ...entrada, beneficios: 0 });
    expect(semBeneficio.avisos.some((a) => a.includes("Anexo I"))).toBe(true);
  });
});

describe("salvar um modelo", () => {
  const modelo: ModeloDeContrato = {
    titulo: "CONTRATO",
    preambulo: "De um lado, {{contratante_razao_social}}…",
    blocos: [{ titulo: "CLÁUSULA PRIMEIRA", corpo: "texto" }],
    fecho: "Assim…",
  };

  it("modelo certo não tem problema", () => {
    expect(problemasDoModelo(modelo)).toEqual([]);
  });

  it("campo escrito errado REPROVA — sairia impresso com as chaves", () => {
    const errado = { ...modelo, fecho: "Valor: {{valor_titulra}}" };
    expect(camposDesconhecidos(errado)).toEqual(["valor_titulra"]);
    expect(problemasDoModelo(errado)[0]).toContain("{{valor_titulra}}");
  });

  it("sem título, sem qualificação ou sem cláusula, reprova", () => {
    expect(problemasDoModelo({ ...modelo, titulo: " " })).toHaveLength(1);
    expect(problemasDoModelo({ ...modelo, preambulo: "" })).toHaveLength(1);
    expect(problemasDoModelo({ ...modelo, blocos: [{ titulo: "X", corpo: " " }] })).toHaveLength(1);
  });

  it("lê o formulário: bloco vazio é bloco apagado, e a ordem se mantém", () => {
    const form = new Map<string, string>([
      ["title", " CONTRATO "],
      ["preamble", "De um lado…"],
      ["closing", "Assim…"],
      ["titulo_0", "CLÁUSULA PRIMEIRA"],
      ["corpo_0", "um\r\nParágrafo único: dois"],
      ["titulo_1", ""],
      ["corpo_1", "  "],
      ["titulo_3", "CLÁUSULA SEGUNDA"],
      ["corpo_3", "três"],
    ]);
    expect(lerModelo(form)).toEqual({
      titulo: "CONTRATO",
      preambulo: "De um lado…",
      blocos: [
        { titulo: "CLÁUSULA PRIMEIRA", corpo: "um\nParágrafo único: dois" },
        { titulo: "CLÁUSULA SEGUNDA", corpo: "três" },
      ],
      fecho: "Assim…",
    });
  });
});

describe("o fechamento leva o endereço e o vencimento do contrato", () => {
  const lead = { company_name: "Aurora", cnpj: "55666777000188" };

  it("o dia combinado e o endereço vão para o cadastro da empresa", () => {
    const c = camposDaEmpresa(
      {
        legal_name: "Aurora Ltda",
        category: null,
        billing_model: null,
        payment_model: null,
        subsidy_type: null,
        subsidy_value: null,
        employee_count: 10,
        responsible_name: null,
        responsible_role: null,
        responsible_cpf: null,
        responsible_email: null,
        responsible_phone: null,
        notes: null,
        address: { street: "Rua A", city: "Cambé" },
        due_day: 10,
      },
      lead
    );
    expect(c.due_day).toBe(10);
    expect(c.address).toEqual({ street: "Rua A", city: "Cambé" });
  });

  it("sem nada combinado, o cadastro nasce no dia 5 e sem endereço", () => {
    const c = camposDaEmpresa(null, lead);
    expect(c.due_day).toBe(5);
    expect(c.address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — leem a migração e as telas. Cada uma foi provada quebrando o
// código de propósito (régua nova só vale depois de reprovar uma vez).
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const ler = (caminho: string) => {
  const texto = readFileSync(join(RAIZ, caminho), "utf8").replace(/\r\n/g, "\n");
  if (texto.length < 200) throw new Error(`${caminho}: vazio ou curto demais`);
  return texto;
};

const MIGRACAO = ler("supabase/migrations/1027_contrato_dentro_do_sistema.sql");
/** Só o que é GRAVADO no banco: os trechos entre `$marca$ … $marca$`. */
const SEMEADO = [...MIGRACAO.matchAll(/\$([a-z0-9]+)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]);

describe("réguas do contrato", () => {
  it("a régua acha o texto semeado (15 cláusulas + título, qualificação e fecho)", () => {
    // Zero trechos seria ausência de medição, não "nenhum problema".
    expect(SEMEADO).toHaveLength(18);
  });

  it("TODO campo usado no modelo semeado existe na lista do sistema", () => {
    const usados = [...new Set(SEMEADO.flatMap((t) => camposUsados(t)))];
    expect(usados.length).toBeGreaterThanOrEqual(20);
    const conhecidos = new Set(CAMPOS_DO_CONTRATO.map((c) => c.chave));
    expect(usados.filter((c) => !conhecidos.has(c))).toEqual([]);
  });

  it("NENHUM DADO DE PESSOA no texto semeado: sem CPF, sem RG, sem o cliente do exemplo", () => {
    const tudo = SEMEADO.join("\n");
    // CPF com máscara, e sequências longas de dígitos (RG, CPF sem máscara).
    expect(tudo).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(tudo).not.toMatch(/\d{7,}/);
    // Nenhum CNPJ dentro do texto: o da Risarte entra pelo campo.
    expect(tudo).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4,5}-\d{2}/);

    // NOME DE GENTE OU DE EMPRESA. Esta régua não cita os nomes que vieram no
    // modelo — escrevê-los aqui seria guardá-los no repositório. Ela confere a
    // FORMA: na qualificação das partes, tudo o que está em negrito é campo, e
    // as únicas palavras em maiúsculas são os termos do próprio contrato.
    const preambulo = SEMEADO.find((t) => t.includes("perfazendo como CONTRATANTE"));
    if (!preambulo) throw new Error("não achei a qualificação das partes no texto semeado");
    const negritos = [...preambulo.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    expect(negritos.length).toBeGreaterThanOrEqual(6);
    expect(negritos.filter((n) => !/^\{\{[a-z_]+\}\}$/.test(n))).toEqual([]);
    const TERMOS = new Set(["CONTRATANTE", "CONTRATADO", "CNPJ", "CAEPF", "RG", "CPF"]);
    const emMaiusculas = preambulo
      .replace(/\{\{[a-z_]+\}\}/g, " ")
      .match(/\b[A-ZÀ-Ý]{2,}\b/g) ?? [];
    expect(emMaiusculas.filter((p) => !TERMOS.has(p))).toEqual([]);
  });

  it("o representante da Risarte NÃO é semeado pela migração", () => {
    const insercao = MIGRACAO.slice(
      MIGRACAO.indexOf("insert into empresarial.contract_settings"),
      MIGRACAO.indexOf("alter table empresarial.contract_settings enable row level security")
    );
    expect(insercao.length).toBeGreaterThan(100);
    for (const coluna of ["rep_name", "rep_rg", "rep_cpf", "rep_nationality"]) {
      expect(insercao, coluna).not.toContain(coluna);
    }
    expect(MIGRACAO).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });

  it("as correções pedidas pelo dono estão no texto semeado", () => {
    const tudo = SEMEADO.join("\n");
    expect(tudo).toContain("PROGRAMA RISARTE EMPRESARIAL (PRE)");
    expect(tudo).not.toContain("EMPRESARIA (PRE)");
    expect(MIGRACAO).toContain("'CLÁUSULA DÉCIMA PRIMEIRA'");
    expect(tudo).not.toContain("GUNDA");
    // A cláusula primeira aponta para a oitava (rol) e a décima (coparticipação).
    expect(tudo).toContain("previstos na cláusula oitava do presente instrumento");
    expect(tudo).toContain("previstos na cláusula décima do presente instrumento");
    expect(tudo).not.toContain("previstos na cláusula nona");
    expect(tudo).not.toContain("previstos na cláusula décima primeira");
  });

  it("o que varia por empresa NÃO está escrito fixo no texto semeado", () => {
    const tudo = SEMEADO.join("\n");
    // Valores, vencimento e cidades saem da proposta (decisão do dono).
    expect(tudo).not.toMatch(/R\$\s?\d/);
    expect(tudo).not.toContain("todo dia 5");
    expect(tudo).not.toContain("municípios de Cambé");
  });

  it("as tabelas novas entram na auditoria e têm RLS", () => {
    expect(MIGRACAO).toContain("select public.audit_attach_all();");
    for (const t of ["contract_settings", "contract_templates"]) {
      expect(MIGRACAO).toContain(`alter table empresarial.${t} enable row level security;`);
    }
    // Quem escreve os dados da Risarte e o modelo da rede: só o gestor.
    expect(MIGRACAO).toMatch(
      /create policy contract_settings_write[\s\S]{0,200}using \(empresarial\.is_program_manager\(\)\)/
    );
  });

  const FICHA = "src/app/(app)/empresarial/funil/[leadId]";

  it("contrato NÃO se monta com leitura pela metade: a tela recusa e diz o que não leu", () => {
    const pagina = ler(`${FICHA}/contrato/page.tsx`);
    for (const erro of [
      "erroDoLevantamento",
      "erroDasFaixas",
      "erroDosBeneficios",
      "erroDaParceria",
      "erroDaContratada",
      "erroDasUnidades",
    ]) {
      expect(pagina.split(erro).length - 1, erro).toBeGreaterThanOrEqual(2);
    }
    expect(pagina).toContain("if (naoLido.length > 0) {");
    // Sem modelo (migração por rodar), diz por quê — não desenha documento vazio.
    expect(pagina).toContain("if (modelos.erro || !modelo) {");
  });

  it("os campos novos do contrato NÃO entram no salvar da proposta (a proposta não pode parar de salvar)", () => {
    const acoes = ler(`${FICHA}/actions.ts`);
    const i = acoes.indexOf("export async function saveProposal(");
    const f = acoes.indexOf("export async function", i + 10);
    if (i < 0 || f < 0) throw new Error("não achei saveProposal");
    const salvarProposta = acoes.slice(i, f);
    for (const coluna of ["due_day", "responsible_rg", "responsible_nationality"]) {
      expect(salvarProposta, coluna).not.toContain(coluna);
    }
    expect(acoes).toContain("export async function saveContractData(");
  });

  it("as duas telas que editam o texto usam o MESMO editor e a mesma leitura do formulário", () => {
    const rede = ler("src/app/(app)/empresarial/configuracoes/contrato-da-rede.tsx");
    const empresaPagina = ler(`${FICHA}/contrato/texto/page.tsx`);
    expect(rede).toContain("<EditorDoContrato");
    expect(empresaPagina).toContain("<EditorDoContrato");
    const daRede = ler("src/app/(app)/empresarial/configuracoes/actions.ts");
    const daEmpresa = ler(`${FICHA}/actions.ts`);
    for (const acoes of [daRede, daEmpresa]) {
      expect(acoes).toContain("lerModelo(formData)");
      expect(acoes).toContain("problemasDoModelo(modelo)");
    }
  });

  it("voltar ao modelo da rede apaga SÓ a linha da empresa — nunca a da rede", () => {
    const acoes = ler(`${FICHA}/actions.ts`);
    const i = acoes.indexOf("export async function resetContractText(");
    if (i < 0) throw new Error("não achei resetContractText");
    const corpo = acoes.slice(i);
    expect(corpo).toMatch(/\.delete\(\)\s*\.eq\("lead_id", leadId\)/);
    expect(corpo).not.toContain('.is("lead_id", null)');
  });
});
