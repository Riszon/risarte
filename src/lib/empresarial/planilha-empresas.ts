// Risarte Empresarial — A PLANILHA DE EMPRESAS (migração das empresas que já
// fazem parte do programa; pedido do dono, 16/11/2026).
//
// Pura (não lê arquivo nem banco): a mesma lista de colunas serve ao GERADOR
// (`modelo-empresas-xlsx.ts`, servidor) e à LEITURA/CONFERÊNCIA (aqui), e a
// régua `planilha-empresas.test.ts` confere os dois juntos. Título de coluna
// que muda num lado e não no outro é coluna que a importação deixa de ler.
//
// Decisões do dono (16/11/2026):
//   • benefícios: a empresa importada usa os PADRÃO DA REDE (ajuste na ficha);
//   • documento que já existe no sistema: a linha é RECUSADA ("já cadastrada");
//   • a importação NÃO gera cobrança de implantação (já estão no programa).
//
// ⚠️ TUDO OU NADA: qualquer linha com problema recusa a planilha inteira, e a
// lista de erros diz a ABA e a LINHA DO EXCEL (as linhas em branco contam).
//
// ⚠️ O que fica DE FORA de propósito: titulares e dependentes (planilha
// própria), benefícios por procedimento, faixas de preço, divisão RisLife ×
// Risarte e metas do Riso+ Social — sem os da empresa, valem os da rede.

import { parseAmountCents, parseDate } from "@/lib/finance/reconciliation";
import { formatCep, formatCpf, formatPhone, isValidCpf } from "@/lib/masks";
import {
  COMPANY_STATUS_LABELS,
  COMPANY_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_MODEL_LABELS,
  PAYMENT_MODELS,
  type CompanyStatus,
  type PaymentMethod,
  type PaymentModel,
} from "./constants";
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_LABELS,
  DOC_TYPES,
  documentDigits,
  validateDocument,
  type CompanyCategory,
  type DocType,
} from "./documents";

export type Celulas = readonly (readonly unknown[])[];

/** O nome das abas no modelo. A leitura aceita variações de caixa e acento. */
export const ABA_INSTRUCOES_EMPRESAS = "Como preencher";
export const ABA_EMPRESAS = "Empresas";
export const ABA_OUTROS_DOCUMENTOS = "Outros CNPJs";

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s*\*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

const texto = (v: unknown): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Data em "aaaa-mm-dd": texto "25/08/2026", "5/8/2026", "2026-08-25" ou o
 * número de série do Excel. A leitura do navegador já entrega a data da
 * célula em "aaaa-mm-dd" (`cellDates`), pelo relógio de quem abriu o arquivo.
 */
export function lerData(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  const curta = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (curta) {
    const p = (s: string) => s.padStart(2, "0");
    return parseDate(`${p(curta[1])}/${p(curta[2])}/${curta[3]}`);
  }
  return parseDate(t);
}

/** Centavos: número da planilha (reais) ou texto "R$ 1.234,56". */
export function lerCentavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  return parseAmountCents(String(v));
}

/**
 * A célula como a tela manda ao servidor (SheetJS com `cellDates` e
 * `raw: true`): data vira "aaaa-mm-dd" pelo relógio de quem abriu o arquivo
 * (o dia que a pessoa vê na planilha); o resto, texto ou número.
 */
export function celulaDaPlanilha(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const t = String(v).trim();
  return t === "" ? null : t;
}

export function abaDasEmpresas(nomes: readonly string[]): string | null {
  return nomes.find((n) => norm(n).startsWith("empresa")) ?? null;
}
export function abaDosOutrosDocumentos(nomes: readonly string[]): string | null {
  return nomes.find((n) => norm(n).startsWith("outros")) ?? null;
}

// -----------------------------------------------------------------------------
// As listas (o que aparece na setinha ▼ e o valor que vai para o banco)
// -----------------------------------------------------------------------------

export const ROTULO_MENSALIDADE = {
  PER_EMPLOYEE: "Por titular",
  FIXED_PER_COMPANY: "Valor fixo por empresa",
} as const;
export const ROTULO_BOLETOS = {
  unico: "Um boleto único",
  por_cnpj: "Um boleto por CNPJ",
} as const;
export const ROTULO_SUBSIDIO = {
  PERCENT: "Percentual (%)",
  AMOUNT: "Valor (R$)",
} as const;
export const ROTULO_MODO_DEPENDENTES = {
  FAMILY_PACKAGE: "Plano familiar",
  PER_DEPENDENT: "Por dependente",
} as const;
/** "Todas" na coluna das unidades = a parceria vale em toda a rede. */
export const TODAS_AS_UNIDADES = "Todas";

// -----------------------------------------------------------------------------
// As colunas
// -----------------------------------------------------------------------------

export type ChaveDaEmpresa =
  | "tipo_doc"
  | "documento"
  | "cpf_caepf"
  | "razao"
  | "fantasia"
  | "ie"
  | "categoria"
  | "situacao"
  | "inicio"
  | "titulares"
  | "dependentes"
  | "colaboradores"
  | "unidade_principal"
  | "unidades"
  | "quem_paga"
  | "subsidio_tipo"
  | "subsidio_valor"
  | "mensalidade"
  | "fixo"
  | "boletos"
  | "vencimento"
  | "preco_titular"
  | "preco_dep_individual"
  | "preco_familiar"
  | "preco_extra"
  | "modo_dependentes"
  | "formas"
  | "parcelas"
  | "carencia_empresa"
  | "carencia_colaborador"
  | "resp_nome"
  | "resp_cargo"
  | "resp_cpf"
  | "resp_email"
  | "resp_tel"
  | "cep"
  | "rua"
  | "numero"
  | "complemento"
  | "bairro"
  | "cidade"
  | "uf"
  | "consultor"
  | "observacoes";

export type Coluna<K extends string> = {
  chave: K;
  /** O título no cabeçalho (com * quando obrigatório). A leitura acha por ele. */
  titulo: string;
  /** Grupo, para a aba de instruções. */
  grupo: string;
  obrigatorio: "Sim" | "Não" | "Às vezes";
  /** Como preencher (aba de instruções e nota da célula). */
  ajuda: string;
  /** Largura no Excel. */
  largura: number;
  /** Formato: texto (CPF, CNPJ, CEP — o Excel come zero), data, número. */
  formato?: "texto" | "data" | "inteiro" | "dinheiro";
  /** Lista fixa da setinha ▼ (a de unidades e consultores vem do sistema). */
  lista?: readonly string[] | "unidades" | "consultores";
};

const listaDe = <T extends string>(r: Record<T, string>) => Object.values(r) as string[];

export const COLUNAS_EMPRESAS: readonly Coluna<ChaveDaEmpresa>[] = [
  // ---- Identificação ----
  { chave: "tipo_doc", titulo: "Tipo de documento", grupo: "Identificação", obrigatorio: "Não", largura: 14, lista: DOC_TYPES, ajuda: "CNPJ (o normal), CPF, CAEPF (produtor rural), CNO (obra civil) ou NIF (estrangeira). Em branco = CNPJ." },
  { chave: "documento", titulo: "Documento principal (CNPJ) *", grupo: "Identificação", obrigatorio: "Sim", largura: 22, formato: "texto", ajuda: "O CNPJ principal (matriz) da empresa, com ou sem pontos. É por ele que a empresa é reconhecida; filiais vão na aba Outros CNPJs." },
  { chave: "cpf_caepf", titulo: "CPF do titular do CAEPF", grupo: "Identificação", obrigatorio: "Às vezes", largura: 18, formato: "texto", ajuda: "Só quando o documento é CAEPF (produtor rural): o CPF do dono." },
  { chave: "razao", titulo: "Razão social *", grupo: "Identificação", obrigatorio: "Sim", largura: 36, ajuda: "Como está no cartão CNPJ." },
  { chave: "fantasia", titulo: "Nome fantasia", grupo: "Identificação", obrigatorio: "Não", largura: 26, ajuda: "O nome pelo qual a empresa é conhecida. É o que aparece nas listas." },
  { chave: "ie", titulo: "Inscrição estadual", grupo: "Identificação", obrigatorio: "Não", largura: 18, formato: "texto", ajuda: "Se tiver." },
  { chave: "categoria", titulo: "Categoria", grupo: "Identificação", obrigatorio: "Não", largura: 18, lista: COMPANY_CATEGORIES.map((c) => COMPANY_CATEGORY_LABELS[c]), ajuda: "Escolha na lista. Em branco = Empresa privada." },
  // ---- Contrato ----
  { chave: "situacao", titulo: "Situação", grupo: "Contrato", obrigatorio: "Não", largura: 12, lista: COMPANY_STATUSES.map((s) => COMPANY_STATUS_LABELS[s]), ajuda: "Ativa, Suspensa ou Encerrada. Em branco = Ativa." },
  { chave: "inicio", titulo: "Início do contrato *", grupo: "Contrato", obrigatorio: "Sim", largura: 14, formato: "data", ajuda: "A data em que a empresa entrou no programa (dd/mm/aaaa). Conta a carência e o tempo de casa." },
  { chave: "titulares", titulo: "Titulares contratados", grupo: "Contrato", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Quantos titulares o contrato fechou. É o limite de cadastros: passou disso, só com termo de inclusão. Em branco = sem limite." },
  { chave: "dependentes", titulo: "Dependentes contratados", grupo: "Contrato", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Quantos dependentes o contrato fechou (se houver limite). Em branco = sem limite." },
  { chave: "colaboradores", titulo: "Colaboradores da empresa", grupo: "Contrato", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Quantas pessoas a empresa tem no total (só informação; não é limite)." },
  { chave: "unidade_principal", titulo: "Unidade principal", grupo: "Contrato", obrigatorio: "Não", largura: 22, lista: "unidades", ajuda: "A unidade Risarte que atende a empresa. Escolha na lista." },
  { chave: "unidades", titulo: "Unidades da parceria", grupo: "Contrato", obrigatorio: "Não", largura: 26, ajuda: "Onde o benefício vale. “Todas” (ou em branco) = qualquer unidade. Para limitar, escreva os nomes separados por ponto e vírgula, como aparecem na lista da Unidade principal." },
  // ---- Cobrança ----
  { chave: "quem_paga", titulo: "Quem paga *", grupo: "Cobrança", obrigatorio: "Sim", largura: 22, lista: PAYMENT_MODELS.map((m) => PAYMENT_MODEL_LABELS[m]), ajuda: "Empresa paga integral, Empresa paga parcial (com subsídio) ou Titular paga." },
  { chave: "subsidio_tipo", titulo: "Subsídio: tipo", grupo: "Cobrança", obrigatorio: "Às vezes", largura: 14, lista: listaDe(ROTULO_SUBSIDIO), ajuda: "Só em “Empresa paga parcial”: o quanto a empresa banca é em percentual ou em valor." },
  { chave: "subsidio_valor", titulo: "Subsídio: valor", grupo: "Cobrança", obrigatorio: "Às vezes", largura: 12, ajuda: "Só em “Empresa paga parcial”: o número (50 para 50%, ou 20,00 para R$ 20,00)." },
  { chave: "mensalidade", titulo: "Mensalidade *", grupo: "Cobrança", obrigatorio: "Sim", largura: 20, lista: listaDe(ROTULO_MENSALIDADE), ajuda: "Por titular (cada titular paga o preço) ou Valor fixo por empresa (um valor mensal combinado)." },
  { chave: "fixo", titulo: "Valor fixo mensal (R$)", grupo: "Cobrança", obrigatorio: "Às vezes", largura: 14, formato: "dinheiro", ajuda: "Obrigatório quando a mensalidade é “Valor fixo por empresa”." },
  { chave: "boletos", titulo: "Boletos *", grupo: "Cobrança", obrigatorio: "Sim", largura: 18, lista: listaDe(ROTULO_BOLETOS), ajuda: "Um boleto único (consolidado) ou um boleto por CNPJ. Por CNPJ exige os outros CNPJs na aba Outros CNPJs." },
  { chave: "vencimento", titulo: "Dia do vencimento *", grupo: "Cobrança", obrigatorio: "Sim", largura: 12, formato: "inteiro", ajuda: "Dia do mês em que a mensalidade vence, de 1 a 28." },
  // ---- Preços (opcionais) ----
  { chave: "preco_titular", titulo: "Preço por titular (R$)", grupo: "Preços combinados", obrigatorio: "Não", largura: 14, formato: "dinheiro", ajuda: "Só se for diferente do preço da rede. Em branco = preço da rede." },
  { chave: "preco_dep_individual", titulo: "Preço dependente individual (R$)", grupo: "Preços combinados", obrigatorio: "Não", largura: 14, formato: "dinheiro", ajuda: "Em branco = preço da rede." },
  { chave: "preco_familiar", titulo: "Preço plano familiar (R$)", grupo: "Preços combinados", obrigatorio: "Não", largura: 14, formato: "dinheiro", ajuda: "Em branco = preço da rede." },
  { chave: "preco_extra", titulo: "Preço dependente extra (R$)", grupo: "Preços combinados", obrigatorio: "Não", largura: 14, formato: "dinheiro", ajuda: "Cada dependente além do plano familiar. Em branco = preço da rede." },
  { chave: "modo_dependentes", titulo: "Cobrança dos dependentes", grupo: "Preços combinados", obrigatorio: "Não", largura: 16, lista: listaDe(ROTULO_MODO_DEPENDENTES), ajuda: "Plano familiar (pacote a partir de 2) ou Por dependente. Em branco = Plano familiar." },
  // ---- Tratamento e carência ----
  { chave: "formas", titulo: "Formas de pagamento do tratamento", grupo: "Tratamento e carência", obrigatorio: "Não", largura: 20, ajuda: "Boleto, Pix, Cartão — separe por vírgula. Em branco = as três." },
  { chave: "parcelas", titulo: "Parcelas máximas do tratamento", grupo: "Tratamento e carência", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Em quantas vezes o colaborador pode parcelar o tratamento. Em branco = 24." },
  { chave: "carencia_empresa", titulo: "Carência da empresa (dias)", grupo: "Tratamento e carência", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Dias a partir do início do contrato. Em branco = 0." },
  { chave: "carencia_colaborador", titulo: "Carência do colaborador (dias)", grupo: "Tratamento e carência", obrigatorio: "Não", largura: 12, formato: "inteiro", ajuda: "Dias a partir da entrada de cada colaborador. Em branco = 0." },
  // ---- Quem assina pela empresa ----
  { chave: "resp_nome", titulo: "Responsável: nome", grupo: "Quem assina pela empresa", obrigatorio: "Não", largura: 26, ajuda: "Quem assina o contrato pela empresa." },
  { chave: "resp_cargo", titulo: "Responsável: cargo", grupo: "Quem assina pela empresa", obrigatorio: "Não", largura: 16, ajuda: "Ex.: Sócio, Diretor, RH." },
  { chave: "resp_cpf", titulo: "Responsável: CPF", grupo: "Quem assina pela empresa", obrigatorio: "Não", largura: 16, formato: "texto", ajuda: "Os 11 números." },
  { chave: "resp_email", titulo: "Responsável: e-mail", grupo: "Quem assina pela empresa", obrigatorio: "Não", largura: 26, ajuda: "Recebe os documentos para assinar." },
  { chave: "resp_tel", titulo: "Responsável: telefone", grupo: "Quem assina pela empresa", obrigatorio: "Não", largura: 16, formato: "texto", ajuda: "Com DDD." },
  // ---- Endereço da sede ----
  { chave: "cep", titulo: "CEP", grupo: "Endereço da sede", obrigatorio: "Não", largura: 11, formato: "texto", ajuda: "Os 8 números." },
  { chave: "rua", titulo: "Rua", grupo: "Endereço da sede", obrigatorio: "Não", largura: 26, ajuda: "" },
  { chave: "numero", titulo: "Número", grupo: "Endereço da sede", obrigatorio: "Não", largura: 8, formato: "texto", ajuda: "" },
  { chave: "complemento", titulo: "Complemento", grupo: "Endereço da sede", obrigatorio: "Não", largura: 14, ajuda: "" },
  { chave: "bairro", titulo: "Bairro", grupo: "Endereço da sede", obrigatorio: "Não", largura: 16, ajuda: "" },
  { chave: "cidade", titulo: "Cidade", grupo: "Endereço da sede", obrigatorio: "Não", largura: 16, ajuda: "" },
  { chave: "uf", titulo: "UF", grupo: "Endereço da sede", obrigatorio: "Não", largura: 6, ajuda: "Duas letras. Ex.: PR." },
  // ---- Outros ----
  { chave: "consultor", titulo: "Consultor RisLife", grupo: "Outros", obrigatorio: "Não", largura: 24, lista: "consultores", ajuda: "O consultor que cuida da empresa. Escolha na lista." },
  { chave: "observacoes", titulo: "Observações", grupo: "Outros", obrigatorio: "Não", largura: 36, ajuda: "Qualquer combinado que não caiba nas outras colunas. Vai para a ficha da empresa." },
];

export type ChaveDoDocumento = "empresa" | "tipo_doc" | "documento" | "apelido";
export const COLUNAS_OUTROS_DOCUMENTOS: readonly Coluna<ChaveDoDocumento>[] = [
  { chave: "empresa", titulo: "Empresa *", grupo: "", obrigatorio: "Sim", largura: 46, ajuda: "Escolha na lista a empresa da aba Empresas (razão social e documento principal)." },
  { chave: "tipo_doc", titulo: "Tipo de documento", grupo: "", obrigatorio: "Não", largura: 14, lista: DOC_TYPES, ajuda: "Em branco = CNPJ." },
  { chave: "documento", titulo: "Documento *", grupo: "", obrigatorio: "Sim", largura: 22, formato: "texto", ajuda: "O CNPJ da filial (ou CAEPF, CNO...)." },
  { chave: "apelido", titulo: "Apelido", grupo: "", obrigatorio: "Não", largura: 22, ajuda: "Como a equipe reconhece este documento. Ex.: Filial Londrina." },
];

/**
 * O texto da lista de empresas na aba Outros CNPJs: "Razão — 12.345.678/0001-90".
 * A fórmula do modelo monta o mesmo (o gerador lê esta função).
 */
export function textoDaEmpresaNaLista(razao: string, documento: string): string {
  return `${razao.trim()} — ${documento.trim()}`;
}

// -----------------------------------------------------------------------------
// A leitura
// -----------------------------------------------------------------------------

type LinhaLida<K extends string> = { linha: number; c: Record<K, unknown> };

function lerAba<K extends string>(
  celulas: Celulas,
  colunas: readonly Coluna<K>[]
): { achouCabecalho: boolean; linhas: LinhaLida<K>[] } {
  const porTitulo = new Map(colunas.map((c) => [norm(c.titulo), c.chave]));
  let iCab = -1;
  let mapa: (K | null)[] = [];
  for (let i = 0; i < Math.min(celulas.length, 30); i++) {
    const m = (celulas[i] ?? []).map((t) => porTitulo.get(norm(t)) ?? null);
    if (m.filter(Boolean).length >= 2) {
      iCab = i;
      mapa = m;
      break;
    }
  }
  if (iCab < 0) return { achouCabecalho: false, linhas: [] };
  const linhas: LinhaLida<K>[] = [];
  for (let i = iCab + 1; i < celulas.length; i++) {
    const cel = celulas[i] ?? [];
    const c = {} as Record<K, unknown>;
    let algo = false;
    mapa.forEach((k, j) => {
      if (!k) return;
      const v = cel[j];
      if (v !== null && v !== undefined && String(v).trim() !== "") algo = true;
      c[k] = v;
    });
    // Linha em branco não é linha: a planilha prepara 300 linhas vazias.
    if (algo) linhas.push({ linha: i + 1, c });
  }
  return { achouCabecalho: true, linhas };
}

// -----------------------------------------------------------------------------
// A conferência
// -----------------------------------------------------------------------------

export type ContextoDaImportacao = {
  /** Documentos (só dígitos/alfanumérico) que JÁ existem no sistema. */
  documentosExistentes: ReadonlySet<string>;
  /** As unidades que podem ser parceiras (nome → id). */
  unidades: readonly { id: string; nome: string }[];
  /** Os consultores RisLife (nome e e-mail → id). */
  consultores: readonly { id: string; nome: string; email: string | null }[];
};

export type ErroDaPlanilha = { aba: string; linha: number; motivo: string };

export type DocumentoParaGravar = {
  doc_type: DocType;
  doc_number: string;
  holder_cpf: string | null;
  is_primary: boolean;
  nickname: string | null;
};

export type PrecosParaGravar = {
  holder_fee_cents: number | null;
  dependent_individual_fee_cents: number | null;
  dependent_family_fee_cents: number | null;
  dependent_family_extra_fee_cents: number | null;
  dependent_mode: "FAMILY_PACKAGE" | "PER_DEPENDENT";
};

export type EmpresaParaGravar = {
  /** A linha do Excel (para a mensagem de erro do banco). */
  linha: number;
  empresa: {
    cnpj: string;
    legal_name: string;
    trade_name: string | null;
    state_registration: string | null;
    category: CompanyCategory;
    status: CompanyStatus;
    contract_started_at: string;
    contracted_holders: number | null;
    contracted_dependents: number | null;
    employee_count: number | null;
    main_clinic_id: string | null;
    payment_model: PaymentModel;
    company_subsidy_type: "PERCENT" | "AMOUNT" | null;
    company_subsidy_value: number | null;
    billing_basis: "PER_EMPLOYEE" | "FIXED_PER_COMPANY";
    fixed_monthly_cents: number | null;
    billing_model: "unico" | "por_cnpj";
    due_day: number;
    payment_methods: PaymentMethod[];
    default_max_installments: number;
    grace_period_days: number;
    employee_grace_period_days: number;
    responsible_name: string | null;
    responsible_role: string | null;
    responsible_cpf: string | null;
    responsible_email: string | null;
    responsible_phone: string | null;
    address: Record<string, string> | null;
    assigned_consultant_id: string | null;
    notes: string | null;
  };
  documentos: DocumentoParaGravar[];
  /** Vazio = a parceria vale em todas as unidades. */
  unidades: string[];
  /** Nulo = valem os preços da rede. */
  precos: PrecosParaGravar | null;
};

export type ResultadoDaConferencia = {
  achouAbaDeEmpresas: boolean;
  erros: ErroDaPlanilha[];
  empresas: EmpresaParaGravar[];
};

const porRotulo = <T extends string>(r: Record<T, string>, v: unknown): T | null => {
  const alvo = norm(v);
  if (!alvo) return null;
  const achado = (Object.entries(r) as [T, string][]).find(
    ([k, rotulo]) => norm(rotulo) === alvo || norm(k) === alvo
  );
  return achado ? achado[0] : null;
};

function inteiro(v: unknown): number | null | "invalido" {
  const t = texto(v);
  if (t == null) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "invalido";
  return n;
}

/**
 * CONFERE AS DUAS ABAS e devolve o que gravar — ou a lista de erros.
 *
 * As células chegam como a leitura do navegador entrega (`header: 1`, datas
 * já em "aaaa-mm-dd"); a conferência roda de novo no SERVIDOR, com o contexto
 * lido do banco (documentos já cadastrados, unidades e consultores).
 */
export function conferirPlanilhaDeEmpresas(
  celulasEmpresas: Celulas,
  celulasDocumentos: Celulas,
  ctx: ContextoDaImportacao
): ResultadoDaConferencia {
  const erros: ErroDaPlanilha[] = [];
  const emp = lerAba(celulasEmpresas, COLUNAS_EMPRESAS);
  if (!emp.achouCabecalho) {
    return {
      achouAbaDeEmpresas: false,
      erros: [{ aba: ABA_EMPRESAS, linha: 1, motivo: "não achei os títulos das colunas (baixe o modelo e preencha nele)" }],
      empresas: [],
    };
  }
  const unidadePorNome = new Map(ctx.unidades.map((u) => [norm(u.nome), u.id]));
  const consultorPor = new Map<string, string>();
  for (const c of ctx.consultores) {
    consultorPor.set(norm(c.nome), c.id);
    if (c.email) consultorPor.set(norm(c.email), c.id);
  }

  const empresas: EmpresaParaGravar[] = [];
  const porDocumento = new Map<string, EmpresaParaGravar>();
  const vistos = new Map<string, number>();

  for (const { linha, c } of emp.linhas) {
    const falta: string[] = [];
    const erro = (m: string) => falta.push(m);

    // ---- documento principal ----
    const tipoTexto = texto(c.tipo_doc);
    const tipo = (tipoTexto ? tipoTexto.toUpperCase() : "CNPJ") as DocType;
    const docBruto = texto(c.documento);
    let numero = "";
    if (!(DOC_TYPES as readonly string[]).includes(tipo)) erro(`tipo de documento “${tipoTexto}” não existe (use ${DOC_TYPES.join(", ")})`);
    else if (!docBruto) erro("falta o documento principal (CNPJ)");
    else {
      const invalido = validateDocument(tipo, docBruto);
      if (invalido) erro(invalido.replace(/^O /, "o "));
      else {
        numero = documentDigits(tipo, docBruto);
        if (ctx.documentosExistentes.has(numero)) erro("empresa já cadastrada no sistema (este documento já existe)");
        const antes = vistos.get(numero);
        if (antes) erro(`documento repetido (já está na linha ${antes})`);
        else vistos.set(numero, linha);
      }
    }
    let cpfCaepf: string | null = null;
    if (tipo === "CAEPF") {
      const cpf = String(c.cpf_caepf ?? "").replace(/\D/g, "");
      if (cpf.length !== 11) erro("no CAEPF, informe o CPF do titular (11 números)");
      else cpfCaepf = formatCpf(cpf);
    }

    const razao = texto(c.razao);
    if (!razao) erro("falta a razão social");

    let categoria: CompanyCategory = "empresa_privada";
    if (texto(c.categoria)) {
      const achada = porRotulo(COMPANY_CATEGORY_LABELS, c.categoria);
      if (achada) categoria = achada;
      else erro(`categoria “${texto(c.categoria)}” não existe (escolha na lista)`);
    }
    let situacao: CompanyStatus = "ACTIVE";
    if (texto(c.situacao)) {
      const achada = porRotulo(COMPANY_STATUS_LABELS, c.situacao);
      if (achada) situacao = achada;
      else erro("situação inválida (Ativa, Suspensa ou Encerrada)");
    }

    // ---- contrato ----
    const inicio = lerData(c.inicio);
    if (!texto(c.inicio)) erro("falta o início do contrato");
    else if (!inicio) erro("início do contrato não é uma data (use dd/mm/aaaa)");
    const contagem = (chave: ChaveDaEmpresa, rotulo: string): number | null => {
      const v = inteiro(c[chave]);
      if (v === "invalido") {
        erro(`${rotulo} deve ser um número inteiro`);
        return null;
      }
      return v;
    };
    const titulares = contagem("titulares", "titulares contratados");
    const dependentes = contagem("dependentes", "dependentes contratados");
    const colaboradores = contagem("colaboradores", "colaboradores da empresa");

    let unidadePrincipal: string | null = null;
    if (texto(c.unidade_principal)) {
      unidadePrincipal = unidadePorNome.get(norm(c.unidade_principal)) ?? null;
      if (!unidadePrincipal) erro(`unidade principal “${texto(c.unidade_principal)}” não existe (escolha na lista)`);
    }
    const unidades: string[] = [];
    const textoUnidades = texto(c.unidades);
    if (textoUnidades && norm(textoUnidades) !== norm(TODAS_AS_UNIDADES)) {
      for (const nome of textoUnidades.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
        const id = unidadePorNome.get(norm(nome));
        if (!id) erro(`unidade da parceria “${nome}” não existe`);
        else if (!unidades.includes(id)) unidades.push(id);
      }
      // A principal faz parte da parceria: limitar sem ela deixaria a empresa
      // sem atendimento na unidade que a atende.
      if (unidadePrincipal && unidades.length > 0 && !unidades.includes(unidadePrincipal)) {
        unidades.push(unidadePrincipal);
      }
    }

    // ---- cobrança ----
    const quemPaga = porRotulo(PAYMENT_MODEL_LABELS, c.quem_paga);
    if (!texto(c.quem_paga)) erro("falta quem paga");
    else if (!quemPaga) erro("“quem paga” inválido (escolha na lista)");
    let subsidioTipo: "PERCENT" | "AMOUNT" | null = null;
    let subsidioValor: number | null = null;
    if (quemPaga === "COMPANY_PARTIAL") {
      subsidioTipo = porRotulo(ROTULO_SUBSIDIO, c.subsidio_tipo);
      if (!subsidioTipo) erro("empresa paga parcial: escolha o tipo do subsídio (percentual ou valor)");
      else if (subsidioTipo === "PERCENT") {
        const p = inteiro(c.subsidio_valor);
        if (p === null || p === "invalido" || p <= 0 || p > 100) erro("subsídio em percentual: um número inteiro de 1 a 100");
        else subsidioValor = p;
      } else {
        const v = lerCentavos(c.subsidio_valor);
        if (v == null || v <= 0) erro("subsídio em valor: informe o valor em reais");
        else subsidioValor = v;
      }
    }
    const mensalidade = porRotulo(ROTULO_MENSALIDADE, c.mensalidade);
    if (!texto(c.mensalidade)) erro("falta a mensalidade (por titular ou valor fixo)");
    else if (!mensalidade) erro("mensalidade inválida (escolha na lista)");
    let fixo: number | null = null;
    if (mensalidade === "FIXED_PER_COMPANY") {
      fixo = lerCentavos(c.fixo);
      if (fixo == null || fixo <= 0) erro("valor fixo por empresa: informe o valor fixo mensal");
    }
    const boletos = porRotulo(ROTULO_BOLETOS, c.boletos);
    if (!texto(c.boletos)) erro("falta a forma dos boletos");
    else if (!boletos) erro("boletos inválido (escolha na lista)");
    const venc = inteiro(c.vencimento);
    if (venc === null) erro("falta o dia do vencimento");
    else if (venc === "invalido" || venc < 1 || venc > 28) erro("dia do vencimento: de 1 a 28");

    // ---- preços ----
    const preco = (chave: ChaveDaEmpresa, rotulo: string): number | null => {
      if (!texto(c[chave])) return null;
      const v = lerCentavos(c[chave]);
      if (v == null || v < 0) {
        erro(`${rotulo} não é um valor em reais`);
        return null;
      }
      return v;
    };
    const pTit = preco("preco_titular", "preço por titular");
    const pInd = preco("preco_dep_individual", "preço do dependente individual");
    const pFam = preco("preco_familiar", "preço do plano familiar");
    const pExt = preco("preco_extra", "preço do dependente extra");
    let modo: "FAMILY_PACKAGE" | "PER_DEPENDENT" = "FAMILY_PACKAGE";
    if (texto(c.modo_dependentes)) {
      const m = porRotulo(ROTULO_MODO_DEPENDENTES, c.modo_dependentes);
      if (!m) erro("cobrança dos dependentes inválida (escolha na lista)");
      else modo = m;
    }
    const temPreco = [pTit, pInd, pFam, pExt].some((p) => p != null) || modo !== "FAMILY_PACKAGE";

    // ---- tratamento e carência ----
    let formas: PaymentMethod[] = [...PAYMENT_METHODS];
    if (texto(c.formas)) {
      formas = [];
      for (const f of String(c.formas).split(/[;,/]|\se\s/).map((s) => s.trim()).filter(Boolean)) {
        const m = porRotulo(PAYMENT_METHOD_LABELS, f);
        if (!m) erro(`forma de pagamento “${f}” não existe (Boleto, Pix ou Cartão)`);
        else if (!formas.includes(m)) formas.push(m);
      }
    }
    const parcelas = contagem("parcelas", "parcelas máximas");
    if (parcelas !== null && (parcelas < 1 || parcelas > 48)) erro("parcelas máximas: de 1 a 48");
    const carEmp = contagem("carencia_empresa", "carência da empresa");
    const carCol = contagem("carencia_colaborador", "carência do colaborador");

    // ---- responsável e endereço ----
    let respCpf: string | null = null;
    if (texto(c.resp_cpf)) {
      const d = String(c.resp_cpf).replace(/\D/g, "");
      if (d.length !== 11 || !isValidCpf(d)) erro("CPF do responsável inválido");
      else respCpf = formatCpf(d);
    }
    const respEmail = texto(c.resp_email);
    if (respEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respEmail)) erro("e-mail do responsável inválido");
    let respTel: string | null = null;
    if (texto(c.resp_tel)) {
      const d = String(c.resp_tel).replace(/\D/g, "");
      if (d.length < 10 || d.length > 11) erro("telefone do responsável: com DDD (10 ou 11 números)");
      else respTel = formatPhone(d);
    }
    let cep: string | null = null;
    if (texto(c.cep)) {
      const d = String(c.cep).replace(/\D/g, "");
      if (d.length !== 8) erro("CEP: 8 números");
      else cep = formatCep(d);
    }
    const uf = texto(c.uf)?.toUpperCase() ?? null;
    if (uf && !/^[A-Z]{2}$/.test(uf)) erro("UF: duas letras (ex.: PR)");
    const endereco: Record<string, string> = {};
    const poe = (k: string, v: string | null) => {
      if (v) endereco[k] = v;
    };
    poe("zipCode", cep);
    poe("street", texto(c.rua));
    poe("number", texto(c.numero));
    poe("complement", texto(c.complemento));
    poe("neighborhood", texto(c.bairro));
    poe("city", texto(c.cidade));
    poe("state", uf);

    let consultor: string | null = null;
    if (texto(c.consultor)) {
      consultor = consultorPor.get(norm(c.consultor)) ?? null;
      if (!consultor) erro(`consultor “${texto(c.consultor)}” não encontrado (escolha na lista)`);
    }

    for (const motivo of falta) erros.push({ aba: ABA_EMPRESAS, linha, motivo });
    if (falta.length > 0) continue;

    const e: EmpresaParaGravar = {
      linha,
      empresa: {
        // Espelho do documento principal, como no cadastro à mão (createCompany).
        cnpj: numero.slice(0, 14),
        legal_name: razao!,
        trade_name: texto(c.fantasia),
        state_registration: texto(c.ie),
        category: categoria,
        status: situacao,
        contract_started_at: inicio!,
        contracted_holders: titulares,
        contracted_dependents: dependentes,
        employee_count: colaboradores,
        main_clinic_id: unidadePrincipal,
        payment_model: quemPaga!,
        company_subsidy_type: subsidioTipo,
        company_subsidy_value: subsidioValor,
        billing_basis: mensalidade!,
        fixed_monthly_cents: fixo,
        billing_model: boletos!,
        due_day: venc as number,
        payment_methods: formas.length > 0 ? formas : ["BOLETO"],
        default_max_installments: parcelas ?? 24,
        grace_period_days: carEmp ?? 0,
        employee_grace_period_days: carCol ?? 0,
        responsible_name: texto(c.resp_nome),
        responsible_role: texto(c.resp_cargo),
        responsible_cpf: respCpf,
        responsible_email: respEmail,
        responsible_phone: respTel,
        address: Object.keys(endereco).length > 0 ? endereco : null,
        assigned_consultant_id: consultor,
        notes: texto(c.observacoes),
      },
      documentos: [
        {
          doc_type: tipo,
          doc_number: numero,
          holder_cpf: cpfCaepf,
          is_primary: true,
          nickname: tipo === "CNPJ" ? "Matriz" : null,
        },
      ],
      unidades,
      precos: temPreco
        ? {
            holder_fee_cents: pTit,
            dependent_individual_fee_cents: pInd,
            dependent_family_fee_cents: pFam,
            dependent_family_extra_fee_cents: pExt,
            dependent_mode: modo,
          }
        : null,
    };
    empresas.push(e);
    porDocumento.set(numero, e);
  }

  // ---- aba Outros CNPJs ----
  const docs = lerAba(celulasDocumentos, COLUNAS_OUTROS_DOCUMENTOS);
  for (const { linha, c } of docs.linhas) {
    const falta: string[] = [];
    const refTexto = texto(c.empresa);
    let dona: EmpresaParaGravar | undefined;
    let donaComErro = false;
    if (!refTexto) falta.push("escolha a empresa na lista");
    else {
      // "Razão — 12.345.678/0001-90" (da lista) ou só o documento digitado.
      const depoisDoTraco = refTexto.includes("—") ? refTexto.slice(refTexto.lastIndexOf("—") + 1) : refTexto;
      const chave = depoisDoTraco.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const soDigitos = depoisDoTraco.replace(/\D/g, "");
      dona = porDocumento.get(soDigitos) ?? porDocumento.get(chave);
      donaComErro = !dona && (vistos.has(soDigitos) || vistos.has(chave));
      if (!dona && !donaComErro) falta.push("a empresa não está na aba Empresas (escolha na lista)");
    }
    const tipoTexto = texto(c.tipo_doc);
    const tipo = (tipoTexto ? tipoTexto.toUpperCase() : "CNPJ") as DocType;
    const bruto = texto(c.documento);
    let numero = "";
    if (!(DOC_TYPES as readonly string[]).includes(tipo)) falta.push(`tipo de documento “${tipoTexto}” não existe`);
    else if (!bruto) falta.push("falta o documento");
    else {
      const invalido = validateDocument(tipo, bruto);
      if (invalido) falta.push(invalido.replace(/^O /, "o "));
      else numero = documentDigits(tipo, bruto);
    }
    if (dona && numero && dona.documentos.some((d) => d.doc_type === tipo && d.doc_number === numero)) {
      falta.push("documento repetido nesta empresa");
    }
    for (const motivo of falta) erros.push({ aba: ABA_OUTROS_DOCUMENTOS, linha, motivo });
    // A empresa dona já tem erro na aba Empresas: o erro dela basta.
    if (falta.length === 0 && dona) {
      dona.documentos.push({
        doc_type: tipo,
        doc_number: numero,
        holder_cpf: null,
        is_primary: false,
        nickname: texto(c.apelido),
      });
    }
  }

  // "Um boleto por CNPJ" sem outro CNPJ seria um boleto só com outro nome.
  for (const e of empresas) {
    if (e.empresa.billing_model === "por_cnpj" && e.documentos.length < 2) {
      erros.push({
        aba: ABA_EMPRESAS,
        linha: e.linha,
        motivo: "“um boleto por CNPJ” precisa de pelo menos mais um documento na aba Outros CNPJs",
      });
    }
  }

  if (empresas.length === 0 && erros.length === 0) {
    erros.push({ aba: ABA_EMPRESAS, linha: 1, motivo: "nenhuma empresa preenchida" });
  }
  erros.sort((a, b) => (a.aba === b.aba ? a.linha - b.linha : a.aba === ABA_EMPRESAS ? -1 : 1));
  return { achouAbaDeEmpresas: true, erros, empresas: erros.length > 0 ? [] : empresas };
}

/** A recusa do banco (1047), em português. */
export function recusaDaImportacaoDeEmpresas(mensagem: string | null | undefined): string {
  const m = String(mensagem ?? "");
  const doc = m.match(/DOCUMENT_EXISTS:(\S+)/);
  if (doc) {
    return `Um documento da planilha já está cadastrado no sistema (${doc[1]}). Tire essa empresa da planilha e importe de novo. Nada foi gravado.`;
  }
  if (/permission denied|NOT_ALLOWED|row-level security/i.test(m)) {
    return "Só o gestor do programa pode importar empresas. Nada foi gravado.";
  }
  return "Não foi possível importar as empresas. Nada foi gravado.";
}
