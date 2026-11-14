// LEVANTAMENTO DE DÍVIDAS — FASE 4 (0407): A CONFERÊNCIA DA IMPORTAÇÃO.
//
// Código PURO e testado: recebe as células da planilha (por campo, já
// mapeadas pelo modelo) e o que o banco sabe (devedores, credores,
// categorias, dívidas já cadastradas, títulos livres do Contas a Pagar) e
// devolve, por linha, o que vai ser gravado (`computed`), os avisos, se há
// erro e a decisão sugerida. O banco (`debt_import_commit`) GUARDA o
// resultado e passa cada linha pelas portas do cadastro à mão — a regra da
// dívida não mora aqui.
//
// ⚠️ A planilha real da rede nunca entra em teste (D0): os testes usam
// planilhas inventadas com a MESMA estrutura (os nomes de coluna do modelo).

import { isValidCnpj } from "@/lib/masks";
import { parseAmountCents, parseDate } from "@/lib/finance/reconciliation";
import { titulosParecidos, type DebtType } from "@/lib/finance/dividas";

// ------------------------------------------------------------------ campos

export type Aba = "dividas" | "protestos";

type DefCampo = { campo: string; rotulo: string; cabecalhos: string[]; obrigatorio?: boolean };

/** Os campos da aba Dívidas, com os nomes de coluna que o modelo padrão reconhece. */
export const CAMPOS_DIVIDAS: DefCampo[] = [
  { campo: "chave", rotulo: "Nº da dívida (#)", cabecalhos: ["#", "Nº", "Nº da dívida"] },
  { campo: "devedor", rotulo: "Devedor (nome)", cabecalhos: ["Devedor (unidade)", "Devedor"] },
  { campo: "devedor_razao", rotulo: "Razão social do devedor", cabecalhos: ["Razão social devedora", "Razão social do devedor"] },
  { campo: "devedor_cnpj", rotulo: "CNPJ do devedor", cabecalhos: ["CNPJ devedor", "CNPJ do devedor"] },
  { campo: "credor", rotulo: "Credor", cabecalhos: ["Credor"], obrigatorio: true },
  { campo: "credor_cnpj", rotulo: "CNPJ do credor", cabecalhos: ["CNPJ do credor", "CNPJ credor"] },
  { campo: "categoria", rotulo: "Categoria", cabecalhos: ["Categoria"] },
  { campo: "subcategoria", rotulo: "Subcategoria", cabecalhos: ["Subcategoria"] },
  { campo: "natureza", rotulo: "Natureza", cabecalhos: ["Natureza"] },
  { campo: "situacao", rotulo: "Situação", cabecalhos: ["Situação"] },
  { campo: "descricao", rotulo: "Descrição", cabecalhos: ["Descrição / origem", "Descrição"] },
  { campo: "contrato", rotulo: "Nº do contrato/título", cabecalhos: ["Nº contrato / título", "Contrato"] },
  { campo: "vencimento", rotulo: "Data de vencimento", cabecalhos: ["Data de vencimento", "Vencimento"], obrigatorio: true },
  { campo: "valor_original", rotulo: "Valor original", cabecalhos: ["Valor original"] },
  { campo: "valor_atualizado", rotulo: "Valor atualizado", cabecalhos: ["Valor atualizado"] },
  { campo: "data_referencia", rotulo: "Data de referência do valor", cabecalhos: ["Data de referência do valor"] },
  { campo: "proposta", rotulo: "Proposta de quitação", cabecalhos: ["Proposta de quitação"] },
  { campo: "proposta_condicao", rotulo: "Condição da proposta", cabecalhos: ["Condição de pagamento da proposta"] },
  { campo: "proposta_validade", rotulo: "Validade da proposta", cabecalhos: ["Validade da proposta"] },
  { campo: "negativada", rotulo: "Negativada?", cabecalhos: ["Negativada?", "Negativada"] },
  { campo: "protestada", rotulo: "Protestada?", cabecalhos: ["Protestada?", "Protestada"] },
  { campo: "cartorio", rotulo: "Cartório", cabecalhos: ["Cartório"] },
  { campo: "custas", rotulo: "Custas do protesto", cabecalhos: ["Custas do protesto"] },
  { campo: "origem", rotulo: "Origem do lançamento", cabecalhos: ["Origem do lançamento", "Origem"] },
  { campo: "fonte", rotulo: "Fonte da informação", cabecalhos: ["Fonte da informação", "Fonte"] },
  { campo: "observacoes", rotulo: "Observações / pendências", cabecalhos: ["Observações / pendências", "Observações"] },
  { campo: "quantidade", rotulo: "Quantidade reunida (grupo de dívidas)", cabecalhos: ["Quantidade reunida", "Qtd. dívidas reunidas"] },
];

/** Os campos da aba Protestos. */
export const CAMPOS_PROTESTOS: DefCampo[] = [
  { campo: "devedor", rotulo: "Devedor (nome)", cabecalhos: ["Devedor (unidade)", "Devedor"], obrigatorio: true },
  { campo: "credor", rotulo: "Credor", cabecalhos: ["Credor (como está no levantamento)", "Credor"], obrigatorio: true },
  { campo: "quantidade", rotulo: "Qtd. títulos", cabecalhos: ["Qtd. títulos", "Quantidade"] },
  { campo: "valor", rotulo: "Valor protestado", cabecalhos: ["Valor protestado", "Valor"], obrigatorio: true },
  { campo: "cartorio", rotulo: "Cartório", cabecalhos: ["Cartório (nome, cidade/UF)", "Cartório"] },
  { campo: "protocolo", rotulo: "Nº protocolo/título", cabecalhos: ["Nº protocolo / título", "Protocolo"] },
  { campo: "data", rotulo: "Data do protesto", cabecalhos: ["Data do protesto"] },
  { campo: "custas", rotulo: "Custas para cancelar", cabecalhos: ["Custas para cancelar", "Custas"] },
  { campo: "anuencia", rotulo: "Carta de anuência", cabecalhos: ["Carta de anuência"] },
  { campo: "ja_esta", rotulo: "Já está na aba Dívidas?", cabecalhos: ["Já está na aba Dívidas?"] },
  { campo: "vinculada", rotulo: "Nº da dívida vinculada (#)", cabecalhos: ["Nº da dívida vinculada (#)", "Nº da dívida vinculada"] },
  { campo: "observacoes", rotulo: "Observações", cabecalhos: ["Observações"] },
];

/** Colunas que o sistema CALCULA: vêm na planilha, mas não se importam (3.9.1). */
export const COLUNAS_CALCULADAS = ["Desconto", "Economia", "Tem proposta?", "Valor estimado para regularizar"];

export type Mapeamento = {
  abas: { dividas: string; protestos: string | null };
  colunas: { dividas: Record<string, string>; protestos: Record<string, string> };
};

// ---------------------------------------------------------------- texto e células

/** Minúsculas, sem acento, só letras e números separados por espaço. */
export function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * A célula como a conferência a guarda: texto, número ou vazio. Data do
 * Excel lida pelo SheetJS (`cellDates`) vira "aaaa-mm-dd" pelo relógio de
 * QUEM ABRIU o arquivo (o navegador) — o dia que a pessoa vê na planilha.
 */
export function celulaParaValor(v: unknown): string | number | null {
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

/** Data em aaaa-mm-dd: texto "10/04/2025", "2025-04-10" ou número de série do Excel. */
export function lerData(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Série do Excel (1900): 45000 ≈ 2023. Fora da faixa razoável, não é data.
    if (v < 20000 || v > 80000) return null;
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return parseDate(String(v));
}

/** Centavos: número da planilha (reais) ou texto "R$ 1.234,56". */
export function lerCentavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  return parseAmountCents(String(v));
}

function lerSimNao(v: unknown): boolean | null {
  const t = normalizar(v);
  if (!t) return null;
  if (["sim", "s", "x", "yes", "true", "1"].includes(t)) return true;
  if (["nao", "n", "no", "false", "0"].includes(t)) return false;
  return null;
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

// ---------------------------------------------------------------- mapeamento

/** O modelo padrão, montado dos nomes de coluna conhecidos (igual ao semeado na 0407). */
export function mapeamentoPadrao(): Mapeamento {
  const mapa = (campos: DefCampo[]) => Object.fromEntries(campos.map((c) => [c.campo, c.cabecalhos[0]]));
  return { abas: { dividas: "Dívidas", protestos: "Protestos" }, colunas: { dividas: mapa(CAMPOS_DIVIDAS), protestos: mapa(CAMPOS_PROTESTOS) } };
}

/**
 * Para cada campo, a coluna do arquivo: a do modelo, quando existe no
 * arquivo; senão a primeira com um dos nomes conhecidos. Campo sem coluna fica
 * de fora (e o obrigatório aparece em `faltando`).
 */
export function casarColunas(
  cabecalhos: string[],
  campos: DefCampo[],
  doModelo: Record<string, string> = {}
): { colunas: Record<string, string>; faltando: string[] } {
  const porNome = new Map(cabecalhos.map((h) => [normalizar(h), h]));
  const colunas: Record<string, string> = {};
  for (const c of campos) {
    const doM = doModelo[c.campo];
    const achada = (doM && porNome.get(normalizar(doM))) ?? c.cabecalhos.map((h) => porNome.get(normalizar(h))).find(Boolean);
    if (achada) colunas[c.campo] = achada;
  }
  const faltando = campos.filter((c) => c.obrigatorio && !colunas[c.campo]).map((c) => c.rotulo);
  return { colunas, faltando };
}

/** As células de uma linha, por campo. */
export function celulasDaLinha(linha: Record<string, unknown>, colunas: Record<string, string>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [campo, col] of Object.entries(colunas)) out[campo] = celulaParaValor(linha[col]);
  return out;
}

/** Linha que é só total, rodapé ou vazia (não é dívida). */
export function linhaVazia(cel: Record<string, unknown>): boolean {
  const cheios = Object.values(cel).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (cheios.length === 0) return true;
  // "TOTAL" numa coluna e números no resto: rodapé de soma.
  return cheios.some((v) => /^total\b/.test(normalizar(v))) && !texto(cel.credor);
}

// ---------------------------------------------------------------- o que o banco sabe

export type DevedorDaImportacao = { id: string; nome: string; razaoSocial: string | null; cnpj: string | null; franqueadora: boolean };
export type CredorDaImportacao = { id: string; nome: string; razaoSocial: string | null; documento: string | null };
export type CategoriaDaImportacao = { id: string; parentId: string | null; nome: string; natureza: string | null; ativa: boolean };
export type NaturezaDaImportacao = { code: string; label: string };
export type DividaJaCadastrada = {
  id: string;
  code: string;
  clinicId: string;
  supplierId: string;
  contrato: string | null;
  vencimento: string;
  valorCents: number;
};
export type TituloLivreDaImportacao = {
  id: string;
  clinicId: string;
  fornecedorId: string | null;
  descricao: string;
  valorCents: number;
  vencimento: string;
  documento: string | null;
};

export type Contexto = {
  devedores: DevedorDaImportacao[];
  credores: CredorDaImportacao[];
  categorias: CategoriaDaImportacao[];
  naturezas: NaturezaDaImportacao[];
  dividas: DividaJaCadastrada[];
  titulosLivres: TituloLivreDaImportacao[];
  /** Hoje, no Brasil (aaaa-mm-dd). */
  hoje: string;
};

// ---------------------------------------------------------------- o resultado

export type Nivel = "erro" | "aviso";
export type Aviso = { nivel: Nivel; texto: string };
export type DecisaoDivida = "importar" | "ignorar" | "vincular";
export type DecisaoProtesto = "vincular" | "nova" | "ignorar" | "verificar";
export type Decisao = DecisaoDivida | DecisaoProtesto;

/** Correções feitas na conferência (sobrevivem a recarregar a página). */
export type Ajustes = {
  celulas?: Record<string, string | number | null>;
  clinicId?: string | null;
  supplierId?: string | null;
  payableIds?: string[];
  /** Protesto: o "#" da aba Dívidas ou uma dívida já cadastrada. */
  vinculada?: string | null;
  debtId?: string | null;
};

type RefCredor = { id: string } | { name: string; document: string | null; kind: string };
type RefCategoria = { id: string } | { name: string; nature_code: string | null };

/** O que o banco grava de UMA dívida (`_debt_import_debt`, 0407). */
export type DadosDaDivida = {
  clinic_id: string;
  supplier: RefCredor;
  category: RefCategoria | null;
  subcategory: { id: string } | { name: string } | null;
  debt: {
    debt_type: DebtType;
    contract_number: string | null;
    description: string | null;
    due_date: string;
    original_cents: number | null;
    updated_cents: number | null;
    updated_ref_date: string | null;
    origin: "A" | "B" | "C";
    nature_code: string | null;
    tax_active_debt: boolean;
    needs_split: boolean;
    bundled_count: number;
    notes: string | null;
    next_action: string | null;
  };
  manual_stage: "em_negociacao" | null;
  proposal: {
    amount_cents: number;
    condition_text: string | null;
    valid_until: string | null;
    source: "serasa_limpa_nome" | "credor";
    proposed_on: string;
  } | null;
  negativation: { bureau: "serasa" | "outro"; in_limpa_nome: boolean } | null;
  protest: { notary_name: string | null; cancel_cost_cents: number | null } | null;
  link_payable_ids: string[];
};

export type DadosDoProtesto = {
  link: { source_key: string } | { debt_id: string } | null;
  nova: DadosDaDivida | null;
  protest: {
    notary_name: string | null;
    protocol: string | null;
    protested_on: string | null;
    amount_cents: number | null;
    cancel_cost_cents: number | null;
    consent_letter: "pendente" | "solicitada" | "recebida";
    notes: string | null;
  };
};

export type LinhaConferida = {
  aba: Aba;
  /** Número da linha na planilha (o cabeçalho é a linha 1). */
  numero: number;
  chave: string | null;
  celulas: Record<string, string | number | null>;
  ajustes: Ajustes;
  devedorId: string | null;
  devedorNome: string | null;
  credorNome: string | null;
  valorCents: number | null;
  vencimento: string | null;
  avisos: Aviso[];
  temErro: boolean;
  /** Erro ou decisão pendente: segura a gravação. */
  bloqueia: boolean;
  sugerida: Decisao;
  /** A decisão da pessoa (nula = segue a sugerida). */
  decisao: Decisao | null;
  /** Títulos do Contas a Pagar parecidos (sugerem a origem C). */
  titulosParecidos: string[];
  /** A dívida já cadastrada de que esta linha parece repetida. */
  duplicadaDe: string | null;
  /** Credor que a gravação vai cadastrar (para o resumo). */
  credorNovo: { chave: string; nome: string; documento: string | null } | null;
  categoriasNovas: string[];
  dados: DadosDaDivida | DadosDoProtesto | null;
};

export const decisaoEfetiva = (l: Pick<LinhaConferida, "decisao" | "sugerida">): Decisao => l.decisao ?? l.sugerida;

// ---------------------------------------------------------------- devedor

const PALAVRAS_VAZIAS = new Set(["risarte", "de", "da", "do", "das", "dos", "e", "ltda", "me", "epp", "eireli", "centro", "unidade", "sa", "s", "a"]);
const tokens = (v: unknown) => normalizar(v).split(" ").filter((t) => t && !PALAVRAS_VAZIAS.has(t));
const FRANQUEADORA = /administra|franque|franchis|matriz/;

/** O devedor pelo nome ("Risarte Cambé", "Risarte Administração"): só quando um só casa. */
export function devedorPeloNome(nome: unknown, devedores: DevedorDaImportacao[]): DevedorDaImportacao | null {
  const n = normalizar(nome);
  if (!n) return null;
  if (FRANQUEADORA.test(n)) {
    const fr = devedores.filter((d) => d.franqueadora);
    if (fr.length === 1) return fr[0];
  }
  const t = tokens(nome);
  if (t.length === 0) return null;
  const casa = devedores.filter((d) => {
    const alvo = new Set([...tokens(d.nome), ...tokens(d.razaoSocial)]);
    return t.every((x) => alvo.has(x));
  });
  return casa.length === 1 ? casa[0] : null;
}

function resolverDevedor(
  cel: Record<string, unknown>,
  ajustes: Ajustes,
  ctx: Contexto,
  avisos: Aviso[]
): DevedorDaImportacao | null {
  if (ajustes.clinicId) {
    const d = ctx.devedores.find((x) => x.id === ajustes.clinicId) ?? null;
    if (d) avisos.push({ nivel: "aviso", texto: `Devedor escolhido à mão na conferência: ${d.nome}.` });
    else avisos.push({ nivel: "erro", texto: "O devedor escolhido não está mais cadastrado." });
    return d;
  }
  const cnpj = digitos(cel.devedor_cnpj);
  if (cnpj) {
    if (cnpj.length !== 14 || !isValidCnpj(cnpj)) {
      const parecido = ctx.devedores.find((d) => d.cnpj && digitos(d.cnpj).slice(0, 12) === cnpj.slice(0, 12))
        ?? ctx.devedores.find((d) => d.cnpj && digitos(d.cnpj).slice(0, 8) === cnpj.slice(0, 8));
      avisos.push({
        nivel: "erro",
        texto:
          `CNPJ do devedor inválido (${cel.devedor_cnpj}): o dígito verificador não confere.` +
          (parecido ? ` O cadastrado mais parecido é ${parecido.nome} (${parecido.cnpj}) — escolha o devedor na correção.` : ""),
      });
      return null;
    }
    const iguais = ctx.devedores.filter((d) => digitos(d.cnpj) === cnpj);
    if (iguais.length > 1) {
      avisos.push({
        nivel: "erro",
        texto: `CNPJ ambíguo: ${iguais.map((d) => d.nome).join(" e ")} estão cadastrados com o mesmo CNPJ. Corrija o cadastro das unidades antes de importar.`,
      });
      return null;
    }
    if (iguais.length === 1) return iguais[0];
    avisos.push({ nivel: "erro", texto: `Nenhum devedor cadastrado com o CNPJ ${cel.devedor_cnpj}. Confira o CNPJ da unidade no cadastro.` });
    return null;
  }
  const pelo = devedorPeloNome(cel.devedor, ctx.devedores) ?? devedorPeloNome(cel.devedor_razao, ctx.devedores);
  if (pelo) {
    avisos.push({ nivel: "aviso", texto: `Devedor achado pelo nome (sem CNPJ na linha): ${pelo.nome}.` });
    return pelo;
  }
  avisos.push({ nivel: "erro", texto: `Devedor não encontrado${texto(cel.devedor) ? ` ("${texto(cel.devedor)}")` : ""}: escolha-o na correção.` });
  return null;
}

// ---------------------------------------------------------------- credor

const CREDOR_A_IDENTIFICAR = /^(detalhar|a detalhar|verificar|a verificar|a identificar|nao sei|\?+|outros?)$/;

/** O tipo do fornecedor novo, pela categoria da dívida. */
export function tipoDoCredor(categoria: string | null): string {
  const c = normalizar(categoria);
  if (/emprest|capital de giro|antecipa|financ/.test(c)) return "bancos";
  if (/tribut/.test(c)) return "tributo_federal";
  if (/trabalh/.test(c)) return "trabalhista";
  if (/odonto/.test(c)) return "dental";
  if (/laborat|protese/.test(c)) return "laboratorio";
  if (/equipam/.test(c)) return "equipamentos";
  if (/ocupa|aluguel/.test(c)) return "ocupacao";
  if (/utilid|energia|telefon/.test(c)) return "utilidades";
  if (/marketing/.test(c)) return "marketing";
  if (/software|servic/.test(c)) return "ti";
  return "outros";
}

function resolverCredor(
  cel: Record<string, unknown>,
  ajustes: Ajustes,
  ctx: Contexto,
  categoria: string | null,
  avisos: Aviso[]
): { ref: RefCredor | null; existente: CredorDaImportacao | null; novo: LinhaConferida["credorNovo"]; nome: string | null } {
  if (ajustes.supplierId) {
    const c = ctx.credores.find((x) => x.id === ajustes.supplierId) ?? null;
    if (!c) {
      avisos.push({ nivel: "erro", texto: "O credor escolhido não está mais cadastrado." });
      return { ref: null, existente: null, novo: null, nome: null };
    }
    return { ref: { id: c.id }, existente: c, novo: null, nome: c.nome };
  }
  const nome = texto(cel.credor);
  if (!nome) {
    avisos.push({ nivel: "erro", texto: "Credor em branco." });
    return { ref: null, existente: null, novo: null, nome: null };
  }
  const n = normalizar(nome);
  if (CREDOR_A_IDENTIFICAR.test(n) || /\brisarte\b/.test(n)) {
    avisos.push({
      nivel: "erro",
      texto: `Credor a identificar ("${nome}"): informe o credor real na correção ou marque "Ignorar".`,
    });
    return { ref: null, existente: null, novo: null, nome };
  }
  const doc = digitos(cel.credor_cnpj);
  if (doc && doc.length !== 8 && doc.length !== 14) {
    avisos.push({ nivel: "erro", texto: `CNPJ do credor incompleto (${doc.length} dígitos): informe os 14 ou só a raiz (8).` });
    return { ref: null, existente: null, novo: null, nome };
  }
  if (doc.length === 14 && !isValidCnpj(doc)) {
    avisos.push({ nivel: "erro", texto: `CNPJ do credor inválido (${cel.credor_cnpj}): o dígito verificador não confere.` });
    return { ref: null, existente: null, novo: null, nome };
  }

  let achado: CredorDaImportacao | null = null;
  if (doc.length === 14) achado = ctx.credores.find((c) => digitos(c.documento) === doc) ?? null;
  if (!achado && doc.length === 8) {
    const pelaRaiz = ctx.credores.filter((c) => digitos(c.documento).slice(0, 8) === doc);
    if (pelaRaiz.length === 1) {
      achado = pelaRaiz[0];
      avisos.push({ nivel: "aviso", texto: `Credor achado pela raiz do CNPJ: ${achado.nome}.` });
    }
  }
  if (!achado) {
    const pelo = ctx.credores.filter((c) => normalizar(c.nome) === n || normalizar(c.razaoSocial) === n);
    if (pelo.length === 1) achado = pelo[0];
    else if (pelo.length > 1) {
      avisos.push({
        nivel: "erro",
        texto: `Há ${pelo.length} fornecedores cadastrados com o nome "${nome}": informe o CNPJ do credor ou escolha-o na correção.`,
      });
      return { ref: null, existente: null, novo: null, nome };
    }
  }
  if (achado) return { ref: { id: achado.id }, existente: achado, novo: null, nome: achado.nome };

  avisos.push({
    nivel: "aviso",
    texto:
      `Credor novo: "${nome}" será cadastrado no Fornecedores` +
      (doc.length === 8 ? " com só a raiz do CNPJ (completar depois)." : doc ? "." : " sem CNPJ (completar depois)."),
  });
  return {
    ref: { name: nome, document: doc || null, kind: tipoDoCredor(categoria) },
    existente: null,
    novo: { chave: doc || n, nome, documento: doc || null },
    nome,
  };
}

// ---------------------------------------------------------------- categoria

function acharCategoria(nome: string, parentId: string | null, ctx: Contexto): CategoriaDaImportacao | null {
  const n = normalizar(nome);
  const nivel = ctx.categorias.filter((c) => c.parentId === parentId);
  const exata = nivel.filter((c) => normalizar(c.nome) === n);
  if (exata.length === 1) return exata[0];
  // "Capital de giro / limite" × "Capital de giro / limite / cheque especial";
  // "Utilidades" × "Utilidades (energia, água…)": o cadastro é mais longo.
  const prefixo = nivel.filter((c) => normalizar(c.nome).startsWith(n + " "));
  return prefixo.length === 1 ? prefixo[0] : null;
}

/** O tipo da dívida, pela categoria e subcategoria. */
export function tipoDaDivida(categoria: string | null, subcategoria: string | null): DebtType {
  const c = normalizar(categoria);
  const s = normalizar(subcategoria);
  if (/emprest|financiamento/.test(c)) return "emprestimo";
  if (/capital de giro/.test(c)) return /limite/.test(s) ? "limite_de_conta" : "capital_de_giro";
  if (/antecipa/.test(c)) return "antecipacao_recebiveis";
  if (/tribut/.test(c)) return "imposto";
  if (/fornecedor|laborat|equipam/.test(c)) return "boleto_de_compra";
  if (/utilid|ocupa/.test(c)) return "fatura";
  return "outro";
}

function resolverCategorias(cel: Record<string, unknown>, ctx: Contexto, avisos: Aviso[]) {
  const nomeCat = texto(cel.categoria) ?? "A classificar";
  const nomeSub = texto(cel.subcategoria);
  const novas: string[] = [];
  const cat = acharCategoria(nomeCat, null, ctx);
  let category: RefCategoria | null;
  let natureza = cat?.natureza ?? null;
  const natDaCelula = texto(cel.natureza);
  if (natDaCelula && normalizar(natDaCelula) !== "a classificar") {
    const nat = ctx.naturezas.find((x) => normalizar(x.label) === normalizar(natDaCelula) || x.code === normalizar(natDaCelula));
    if (nat) natureza = nat.code;
    else avisos.push({ nivel: "aviso", texto: `Natureza "${natDaCelula}" não existe no cadastro: fica a da categoria.` });
  }
  if (cat) {
    if (!cat.ativa) avisos.push({ nivel: "erro", texto: `A categoria "${cat.nome}" está desativada: escolha outra ou reative-a.` });
    category = { id: cat.id };
  } else {
    category = { name: nomeCat, nature_code: natureza };
    novas.push(nomeCat);
    avisos.push({ nivel: "aviso", texto: `Categoria nova: "${nomeCat}" será criada.` });
  }
  if (normalizar(nomeCat) === "a classificar") {
    avisos.push({ nivel: "aviso", texto: "Categoria \"A classificar\": classifique a dívida depois (Qualidade dos dados)." });
  }
  let subcategory: DadosDaDivida["subcategory"] = null;
  if (nomeSub) {
    const sub = cat ? acharCategoria(nomeSub, cat.id, ctx) : null;
    if (sub) {
      if (!sub.ativa) avisos.push({ nivel: "erro", texto: `A subcategoria "${sub.nome}" está desativada.` });
      subcategory = { id: sub.id };
    } else {
      subcategory = { name: nomeSub };
      novas.push(`${nomeCat} › ${nomeSub}`);
      avisos.push({ nivel: "aviso", texto: `Subcategoria nova: "${nomeSub}" será criada em "${cat?.nome ?? nomeCat}".` });
    }
  }
  return { category, subcategory, natureza, novas, nomeCat: cat?.nome ?? nomeCat, nomeSub };
}

// ---------------------------------------------------------------- a dívida

const SITUACOES_SEM_EFEITO = new Set(["em aberto", "conta atrasada", "a vencer", "vencida", "em atraso", ""]);

type MontagemDaDivida = {
  dados: DadosDaDivida | null;
  devedor: DevedorDaImportacao | null;
  credorExistente: CredorDaImportacao | null;
  credorNovo: LinhaConferida["credorNovo"];
  credorNome: string | null;
  categoriasNovas: string[];
  valorCents: number | null;
  vencimento: string | null;
};

/** Monta a dívida de uma linha (aba Dívidas, ou o protesto que vira dívida nova). */
function montarDivida(cel: Record<string, unknown>, ajustes: Ajustes, ctx: Contexto, avisos: Aviso[]): MontagemDaDivida {
  const devedor = resolverDevedor(cel, ajustes, ctx, avisos);
  const cats = resolverCategorias(cel, ctx, avisos);
  const credor = resolverCredor(cel, ajustes, ctx, texto(cel.categoria), avisos);

  // Datas
  const vencimento = lerData(cel.vencimento);
  if (!vencimento) {
    avisos.push({
      nivel: "erro",
      texto: texto(cel.vencimento) ? `Data de vencimento não entendida ("${cel.vencimento}"): use dd/mm/aaaa.` : "Data de vencimento em branco.",
    });
  }
  const referencia = lerData(cel.data_referencia);
  if (texto(cel.data_referencia) && !referencia) {
    avisos.push({ nivel: "aviso", texto: `Data de referência não entendida ("${cel.data_referencia}"): fica em branco.` });
  }
  if (vencimento && referencia && vencimento === referencia) {
    avisos.push({
      nivel: "aviso",
      texto: "O vencimento é igual à data de referência do valor: parece a data do levantamento. Informe o vencimento real quando souber.",
    });
  }

  // Valores
  const original = lerCentavos(cel.valor_original);
  const atualizado = lerCentavos(cel.valor_atualizado);
  for (const [nome, v] of [["original", original], ["atualizado", atualizado]] as const) {
    if (v !== null && v < 0) avisos.push({ nivel: "erro", texto: `Valor ${nome} negativo.` });
  }
  if (texto(cel.valor_original) && original === null) avisos.push({ nivel: "aviso", texto: `Valor original não entendido ("${cel.valor_original}").` });
  if (texto(cel.valor_atualizado) && atualizado === null) avisos.push({ nivel: "aviso", texto: `Valor atualizado não entendido ("${cel.valor_atualizado}").` });
  if ((original ?? 0) <= 0 && (atualizado ?? 0) <= 0) avisos.push({ nivel: "erro", texto: "Sem valor: informe o original ou o atualizado." });
  const valorCents = atualizado && atualizado > 0 ? atualizado : original && original > 0 ? original : null;

  // Origem (D2: na importação vale a coluna)
  const origemTxt = texto(cel.origem);
  let origem: "A" | "B" | "C" = "A";
  if (!origemTxt) {
    avisos.push({ nivel: "aviso", texto: "Origem do lançamento em branco: considerada A (anterior à implantação)." });
  } else {
    const l = normalizar(origemTxt).charAt(0).toUpperCase();
    if (l === "A" || l === "B" || l === "C") origem = l;
    else avisos.push({ nivel: "erro", texto: `Origem "${origemTxt}" não entendida: use A, B ou C.` });
  }

  // Situação
  const situacao = normalizar(cel.situacao);
  let negativada = lerSimNao(cel.negativada) === true;
  let taxActive = false;
  let needsSplit = false;
  let manualStage: "em_negociacao" | null = null;
  let bundled = 1;
  const qtd = Number(digitos(cel.quantidade)) || null;
  if (situacao === "divida negativada") negativada = true;
  else if (situacao === "divida ativa") taxActive = true;
  else if (situacao === "grupo de dividas") {
    needsSplit = true;
    bundled = qtd && qtd >= 2 ? qtd : 2;
    if (!qtd) avisos.push({ nivel: "aviso", texto: "Grupo de dívidas: entra como uma dívida para desdobrar depois. Informe quantas ela reúne (coluna \"Quantidade reunida\")." });
  } else if (situacao === "em negociacao") manualStage = "em_negociacao";
  else if (situacao === "acordo em andamento" || situacao === "quitada") {
    avisos.push({ nivel: "aviso", texto: `Situação "${texto(cel.situacao)}": a importação não registra acordo nem quitação — registre depois, na dívida.` });
  } else if (!SITUACOES_SEM_EFEITO.has(situacao)) {
    avisos.push({ nivel: "aviso", texto: `Situação "${texto(cel.situacao)}" não reconhecida: a situação sai pelo vencimento.` });
  }
  if (qtd && qtd >= 2 && !needsSplit) {
    needsSplit = true;
    bundled = qtd;
  }

  // Proposta
  const fonte = texto(cel.fonte);
  const serasa = /serasa/.test(normalizar(fonte));
  let proposal: DadosDaDivida["proposal"] = null;
  const valorProposta = lerCentavos(cel.proposta);
  if (texto(cel.proposta) && valorProposta === null) avisos.push({ nivel: "aviso", texto: `Proposta não entendida ("${cel.proposta}"): não importada.` });
  if (valorProposta !== null && valorProposta > 0) {
    const validade = lerData(cel.proposta_validade);
    let condicao = texto(cel.proposta_condicao);
    if (texto(cel.proposta_validade) && !validade) {
      condicao = [condicao, `Validade: ${cel.proposta_validade}`].filter(Boolean).join(" · ");
      avisos.push({ nivel: "aviso", texto: "Validade da proposta não é uma data: vai junto da condição, como texto." });
    }
    if (validade && validade < ctx.hoje) avisos.push({ nivel: "aviso", texto: "Proposta com validade vencida: entra no histórico como expirada." });
    if (valorCents !== null && valorProposta > valorCents) {
      avisos.push({ nivel: "aviso", texto: "A proposta é MAIOR que o valor da dívida: confira os dois valores." });
    }
    proposal = {
      amount_cents: valorProposta,
      condition_text: condicao,
      valid_until: validade,
      source: serasa ? "serasa_limpa_nome" : "credor",
      proposed_on: referencia && referencia <= ctx.hoje ? referencia : ctx.hoje,
    };
  }

  // Restrições
  const negativation: DadosDaDivida["negativation"] = negativada
    ? { bureau: serasa ? "serasa" : "outro", in_limpa_nome: /limpa nome/.test(normalizar(fonte)) }
    : null;
  const custas = lerCentavos(cel.custas);
  const protestada = lerSimNao(cel.protestada) === true || (!!texto(cel.cartorio) && lerSimNao(cel.protestada) !== false);
  const protest: DadosDaDivida["protest"] = protestada ? { notary_name: texto(cel.cartorio), cancel_cost_cents: custas } : null;

  // Observações (3.9.1): viram nota e próxima ação.
  const obs = texto(cel.observacoes);
  const notas = [obs, fonte ? `Fonte: ${fonte}` : null].filter(Boolean).join("\n") || null;

  // Origem C: os títulos que já estão no Contas a Pagar.
  const payableIds = ajustes.payableIds ?? [];

  const ok = devedor && credor.ref && cats.category && vencimento && valorCents !== null && !avisos.some((a) => a.nivel === "erro");
  const dados: DadosDaDivida | null = ok
    ? {
        clinic_id: devedor.id,
        supplier: credor.ref!,
        category: cats.category,
        subcategory: cats.subcategory,
        debt: {
          debt_type: tipoDaDivida(cats.nomeCat, cats.nomeSub),
          contract_number: texto(cel.contrato),
          description: texto(cel.descricao),
          due_date: vencimento!,
          original_cents: original && original > 0 ? original : null,
          updated_cents: atualizado && atualizado > 0 ? atualizado : null,
          updated_ref_date: referencia,
          origin: origem,
          nature_code: cats.natureza,
          tax_active_debt: taxActive,
          needs_split: needsSplit,
          bundled_count: bundled,
          notes: notas,
          next_action: obs ? obs.slice(0, 200) : null,
        },
        manual_stage: manualStage,
        proposal,
        negativation,
        protest,
        link_payable_ids: payableIds,
      }
    : null;

  return {
    dados,
    devedor,
    credorExistente: credor.existente,
    credorNovo: credor.novo,
    credorNome: credor.nome,
    categoriasNovas: cats.novas,
    valorCents,
    vencimento,
  };
}

// ---------------------------------------------------------------- a planilha

export type LinhaDaPlanilha = { aba: Aba; numero: number; celulas: Record<string, string | number | null>; ajustes?: Ajustes; decisao?: Decisao | null };

export type TotalPorDevedor = {
  clinicId: string | null;
  nome: string;
  linhas: number;
  arquivoCents: number;
  importarCents: number;
  ignoradoCents: number;
};

export type Conferencia = {
  linhas: LinhaConferida[];
  credoresNovos: { chave: string; nome: string; documento: string | null; linhas: number }[];
  categoriasNovas: string[];
  totais: TotalPorDevedor[];
  /** Quantas linhas seguram a gravação. */
  bloqueadas: number;
};

const chaveDoCredor = (m: MontagemDaDivida) => m.credorExistente?.id ?? m.credorNovo?.chave ?? normalizar(m.credorNome);

/**
 * A conferência da planilha inteira. Roda de novo, do zero, a cada correção
 * (as decisões e ajustes de cada linha vão junto), e o banco guarda o
 * resultado.
 */
export function conferirPlanilha(entrada: LinhaDaPlanilha[], ctx: Contexto): Conferencia {
  const linhas: LinhaConferida[] = [];
  const dividas = entrada.filter((l) => l.aba === "dividas");
  const protestos = entrada.filter((l) => l.aba === "protestos");

  // ---------- aba Dívidas
  const vistas = new Map<string, number>();
  const porChave = new Map<string, LinhaConferida>();
  const credoresPorDevedor = new Map<string, { numero: number; credor: string }[]>();
  for (const e of dividas) {
    const ajustes = e.ajustes ?? {};
    const cel = { ...e.celulas, ...(ajustes.celulas ?? {}) };
    const avisos: Aviso[] = [];
    const m = montarDivida(cel, ajustes, ctx, avisos);
    const chave = texto(cel.chave);
    let sugerida: DecisaoDivida = "importar";
    let parecidos: string[] = [];
    let duplicadaDe: string | null = null;

    if (m.devedor) {
      const cr = chaveDoCredor(m);
      const contrato = normalizar(cel.contrato);
      // Duplicidade dentro do arquivo.
      const k1 = contrato ? `${m.devedor.id}|${cr}|c:${contrato}` : null;
      const k2 = m.vencimento && m.valorCents !== null ? `${m.devedor.id}|${cr}|${m.vencimento}|${m.valorCents}` : null;
      const antes = (k1 && vistas.get(k1)) || (k2 && vistas.get(k2));
      if (antes) avisos.push({ nivel: "aviso", texto: `Parece repetida da linha ${antes} deste arquivo (mesmo devedor, credor e ${k1 && vistas.get(k1) ? "contrato" : "vencimento e valor"}).` });
      for (const k of [k1, k2]) if (k && !vistas.has(k)) vistas.set(k, e.numero);

      // Duplicidade contra as dívidas já cadastradas.
      if (m.credorExistente) {
        const igual = ctx.dividas.find(
          (d) =>
            d.clinicId === m.devedor!.id &&
            d.supplierId === m.credorExistente!.id &&
            ((contrato && normalizar(d.contrato) === contrato) || (d.vencimento === m.vencimento && d.valorCents === m.valorCents))
        );
        if (igual) {
          avisos.push({ nivel: "aviso", texto: `Já existe a dívida ${igual.code} igual a esta: sugerido "Ignorar" (importar de novo duplicaria).` });
          sugerida = "ignorar";
          duplicadaDe = igual.id;
        }

        // Título parecido no Contas a Pagar do mesmo CNPJ (ajuste 2).
        if (m.vencimento) {
          parecidos = titulosParecidos(
            ctx.titulosLivres.filter((t) => t.clinicId === m.devedor!.id),
            { fornecedorId: m.credorExistente.id, vencimento: m.vencimento, valorCents: m.valorCents, contrato: texto(cel.contrato) }
          ).map((t) => t.id);
        }
      }
      const chaveCr = normalizar(m.credorNome);
      if (chaveCr) credoresPorDevedor.set(m.devedor.id, [...(credoresPorDevedor.get(m.devedor.id) ?? []), { numero: e.numero, credor: chaveCr }]);
    }

    const origem = m.dados?.debt.origin ?? (normalizar(cel.origem).charAt(0) === "c" ? "C" : null);
    // Vincular = origem C: pela coluna, ou porque a pessoa escolheu na conferência.
    if (origem === "C" || e.decisao === "vincular") {
      const escolhidos = ajustes.payableIds?.length ? ajustes.payableIds : parecidos;
      if (m.dados) {
        m.dados.link_payable_ids = escolhidos;
        m.dados.debt.origin = "C";
      }
      if (escolhidos.length === 0) {
        avisos.push({
          nivel: "erro",
          texto: "Origem C (já no Contas a Pagar), mas nenhum título parecido foi achado neste CNPJ: escolha os títulos na correção ou mude a origem.",
        });
      }
      if (sugerida !== "ignorar" && origem === "C") sugerida = "vincular";
    } else if (parecidos.length > 0) {
      avisos.push({
        nivel: "aviso",
        texto: `Há ${parecidos.length === 1 ? "um título parecido" : `${parecidos.length} títulos parecidos`} no Contas a Pagar deste CNPJ: se for a mesma conta, use a origem C (vincular) para não lançar duas vezes.`,
      });
    }

    const temErro = avisos.some((a) => a.nivel === "erro");
    const linha: LinhaConferida = {
      aba: "dividas",
      numero: e.numero,
      chave,
      celulas: e.celulas,
      ajustes,
      devedorId: m.devedor?.id ?? null,
      devedorNome: m.devedor?.nome ?? texto(cel.devedor),
      credorNome: m.credorNome,
      valorCents: m.valorCents,
      vencimento: m.vencimento,
      avisos,
      temErro,
      bloqueia: temErro,
      sugerida,
      decisao: (e.decisao as DecisaoDivida | null | undefined) ?? null,
      titulosParecidos: parecidos,
      duplicadaDe,
      credorNovo: m.credorNovo,
      categoriasNovas: m.categoriasNovas,
      dados: temErro ? null : m.dados,
    };
    if (chave) porChave.set(normalizar(chave), linha);
    linhas.push(linha);
  }

  // ---------- aba Protestos
  for (const e of protestos) {
    const ajustes = e.ajustes ?? {};
    const cel = { ...e.celulas, ...(ajustes.celulas ?? {}) };
    const avisos: Aviso[] = [];
    const devedor = ajustes.clinicId
      ? ctx.devedores.find((d) => d.id === ajustes.clinicId) ?? null
      : devedorPeloNome(cel.devedor, ctx.devedores);
    if (!devedor) avisos.push({ nivel: "erro", texto: `Devedor não encontrado ("${texto(cel.devedor) ?? ""}"): escolha-o na correção.` });
    const valor = lerCentavos(cel.valor);
    if (valor === null || valor <= 0) avisos.push({ nivel: "erro", texto: "Valor protestado em branco ou não entendido." });
    const data = lerData(cel.data);
    if (texto(cel.data) && !data) avisos.push({ nivel: "aviso", texto: `Data do protesto não entendida ("${cel.data}").` });
    const custas = lerCentavos(cel.custas);
    const anuencia = normalizar(cel.anuencia);
    const qtd = Math.max(1, Number(digitos(cel.quantidade)) || 1);
    const protest: DadosDoProtesto["protest"] = {
      notary_name: texto(cel.cartorio),
      protocol: texto(cel.protocolo),
      protested_on: data,
      amount_cents: valor,
      cancel_cost_cents: custas,
      consent_letter: /recebid/.test(anuencia) ? "recebida" : /solicitad/.test(anuencia) ? "solicitada" : "pendente",
      notes: [texto(cel.observacoes), qtd > 1 ? `${qtd} títulos protestados` : null].filter(Boolean).join(" · ") || null,
    };

    const jaEsta = normalizar(cel.ja_esta);
    const vinculada = ajustes.vinculada !== undefined ? texto(ajustes.vinculada) : texto(cel.vinculada);
    let sugerida: DecisaoProtesto;
    let link: DadosDoProtesto["link"] = null;
    let nova: DadosDaDivida | null = null;
    let credorNovo: LinhaConferida["credorNovo"] = null;
    let categoriasNovas: string[] = [];
    let credorNome = texto(cel.credor);
    const decidida = (e.decisao as DecisaoProtesto | null | undefined) ?? null;

    if (ajustes.debtId) {
      sugerida = "vincular";
      link = { debt_id: ajustes.debtId };
      const d = ctx.dividas.find((x) => x.id === ajustes.debtId);
      if (!d) avisos.push({ nivel: "erro", texto: "A dívida escolhida não está mais cadastrada." });
    } else if (vinculada && (jaEsta === "sim" || jaEsta === "" || ajustes.vinculada !== undefined)) {
      sugerida = "vincular";
      const alvo = porChave.get(normalizar(vinculada));
      if (!alvo) avisos.push({ nivel: "erro", texto: `A dívida nº ${vinculada} não existe na aba Dívidas deste arquivo.` });
      else if (alvo.devedorId && devedor && alvo.devedorId !== devedor.id) {
        avisos.push({ nivel: "erro", texto: `A dívida nº ${vinculada} é de outro devedor (${alvo.devedorNome}).` });
      } else if (decisaoEfetiva(alvo) === "ignorar") {
        // A linha ligada é repetida de uma dívida já cadastrada: o protesto vai para ela.
        if (alvo.duplicadaDe) link = { debt_id: alvo.duplicadaDe };
        else avisos.push({ nivel: "erro", texto: `A dívida nº ${vinculada} está marcada para "Ignorar": o protesto não teria onde ficar.` });
      }
      if (!link) link = { source_key: vinculada };
    } else if (jaEsta === "nao") {
      sugerida = "nova";
    } else {
      sugerida = "verificar";
      avisos.push({
        nivel: "aviso",
        texto:
          jaEsta === "verificar"
            ? "Marcada \"Verificar\" na planilha: decida — ligar a uma dívida, criar dívida nova ou ignorar."
            : "Não diz se já está na aba Dívidas: decida — ligar a uma dívida, criar dívida nova ou ignorar.",
      });
    }

    const efetiva = decidida ?? sugerida;
    if (efetiva === "nova") {
      // O protesto vira uma dívida (protestada = sim, D16): mesmas regras da aba Dívidas.
      const celDaDivida: Record<string, unknown> = {
        devedor: cel.devedor,
        credor: cel.credor,
        categoria: null,
        vencimento: data ?? cel.data,
        valor_atualizado: valor !== null ? valor / 100 : null,
        origem: "A",
        observacoes: texto(cel.observacoes) ?? "Dívida nova a partir da aba Protestos.",
        quantidade: qtd > 1 ? qtd : null,
        descricao: `Protesto${texto(cel.protocolo) ? ` ${texto(cel.protocolo)}` : ""}`,
      };
      const avisosDaNova: Aviso[] = [];
      const m = montarDivida(celDaDivida, { clinicId: devedor?.id ?? null, supplierId: ajustes.supplierId }, ctx, avisosDaNova);
      for (const a of avisosDaNova) if (!/escolhido à mão/.test(a.texto)) avisos.push(a);
      nova = m.dados;
      if (nova) nova.protest = null; // o protesto da linha entra à parte, com o cartório e as custas
      credorNovo = m.credorNovo;
      categoriasNovas = m.categoriasNovas;
      credorNome = m.credorNome;
      // Pendência 12: o credor protestado também está na aba Dívidas?
      if (devedor) {
        const n = normalizar(m.credorNome);
        const mesmo = (credoresPorDevedor.get(devedor.id) ?? []).filter((x) => n && (x.credor.includes(n) || n.includes(x.credor)));
        if (mesmo.length > 0) {
          avisos.push({
            nivel: "aviso",
            texto: `O mesmo credor está na aba Dívidas (linha ${mesmo.map((x) => x.numero).join(", ")}): confira se não é a mesma dívida, para não somar duas vezes.`,
          });
        }
      }
    } else if (efetiva === "vincular" && !link) {
      avisos.push({ nivel: "erro", texto: "Escolha a dívida a que este protesto pertence." });
    }

    const temErro = efetiva !== "ignorar" && avisos.some((a) => a.nivel === "erro");
    const dados: DadosDoProtesto | null =
      temErro || efetiva === "ignorar" || efetiva === "verificar" ? null : { link: efetiva === "nova" ? null : link, nova, protest };
    linhas.push({
      aba: "protestos",
      numero: e.numero,
      chave: null,
      celulas: e.celulas,
      ajustes,
      devedorId: devedor?.id ?? null,
      devedorNome: devedor?.nome ?? texto(cel.devedor),
      credorNome,
      valorCents: valor,
      vencimento: data,
      avisos,
      temErro,
      bloqueia: temErro || efetiva === "verificar",
      sugerida,
      decisao: decidida,
      titulosParecidos: [],
      duplicadaDe: null,
      credorNovo: efetiva === "nova" ? credorNovo : null,
      categoriasNovas: efetiva === "nova" ? categoriasNovas : [],
      dados,
    });
  }

  // Erro só segura quem vai ser gravado.
  for (const l of linhas) if (decisaoEfetiva(l) === "ignorar") l.bloqueia = false;

  return {
    linhas,
    credoresNovos: resumirCredoresNovos(linhas),
    categoriasNovas: [...new Set(linhas.filter((l) => decisaoEfetiva(l) !== "ignorar").flatMap((l) => l.categoriasNovas))].sort(),
    totais: totaisPorDevedor(linhas, ctx),
    bloqueadas: linhas.filter((l) => l.bloqueia).length,
  };
}

function resumirCredoresNovos(linhas: LinhaConferida[]) {
  const m = new Map<string, { chave: string; nome: string; documento: string | null; linhas: number }>();
  for (const l of linhas) {
    if (!l.credorNovo || decisaoEfetiva(l) === "ignorar") continue;
    const x = m.get(l.credorNovo.chave) ?? { ...l.credorNovo, linhas: 0 };
    x.linhas += 1;
    m.set(l.credorNovo.chave, x);
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Total do arquivo por devedor (aba Dívidas) × o que vai ser importado × o que
 * fica de fora — a conferência pós-importação compara com o que entrou.
 */
export function totaisPorDevedor(linhas: LinhaConferida[], ctx: Contexto): TotalPorDevedor[] {
  const m = new Map<string, TotalPorDevedor>();
  for (const l of linhas) {
    const k = l.devedorId ?? "—";
    const nome = l.devedorId ? ctx.devedores.find((d) => d.id === l.devedorId)?.nome ?? "—" : "Sem devedor identificado";
    const t = m.get(k) ?? { clinicId: l.devedorId, nome, linhas: 0, arquivoCents: 0, importarCents: 0, ignoradoCents: 0 };
    const v = l.valorCents ?? 0;
    const ignora = decisaoEfetiva(l) === "ignorar";
    if (l.aba === "dividas") {
      t.linhas += 1;
      t.arquivoCents += v;
      if (ignora) t.ignoradoCents += v;
      else t.importarCents += v;
    } else if (decisaoEfetiva(l) === "nova") {
      // Protesto que vira dívida: entra a mais (não estava na aba Dívidas).
      t.importarCents += v;
    }
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A rota que baixa a planilha-modelo (é um arquivo, não uma tela: link comum, sem o roteador). */
export const LINK_DA_PLANILHA_MODELO = "/financeiro/dividas/importar/modelo/planilha";

export type StatusDoLote = "conferencia" | "importado" | "desfeito" | "descartado";
export const ROTULO_DO_LOTE: Record<StatusDoLote, string> = {
  conferencia: "Em conferência",
  importado: "Importado",
  desfeito: "Desfeito",
  descartado: "Descartado",
};

/** Rótulo de cada decisão, para a tela. */
export const ROTULO_DA_DECISAO: Record<Decisao, string> = {
  importar: "Importar",
  ignorar: "Ignorar",
  vincular: "Vincular",
  nova: "Criar dívida nova",
  verificar: "Decidir",
};
