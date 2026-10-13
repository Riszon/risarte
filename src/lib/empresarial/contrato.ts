// Risarte Empresarial — O CONTRATO GERADO DENTRO DO SISTEMA (OC-00083, 1027).
//
// Até aqui o contrato era o único dos três documentos feito por fora: a
// apresentação e a proposta já saíam do sistema, e o contrato era um Word
// preenchido à mão — razão social, CNPJ, valores e data redigitados, um a um,
// a cada empresa. Redigitar é como o contrato passa a dizer R$ 39,90 quando a
// proposta fechou R$ 35,00.
//
// O TEXTO é do dono (modelo enviado em 13/10/2026) e mora no BANCO
// (`contract_templates`), editável em Configurações. Aqui ficam só as regras
// puras: quais campos existem, como cada um é preenchido e o que falta.
//
// ⚠️ NENHUMA CLÁUSULA É ESCRITA AQUI. Este arquivo preenche lacunas; ele não
// redige. Quando a proposta não cabe no texto do modelo (valor fixo por
// empresa, preço por quantidade), a resposta é AVISAR — nunca inventar a
// frase jurídica que faltou.

import { formatBRL } from "@/lib/pricing";
import { precoDaFaixa, type FaixaDePreco } from "./condicoes-da-proposta";
import {
  SUGGESTED_DOC_BY_CATEGORY,
  maskDocument,
  type CompanyCategory,
} from "./documents";
import { DEFAULT_ADHESION_PRICING } from "./pricing";
import type { CompanyAddress } from "./types";

// ------------------------------------------------------------------ o modelo

export type BlocoDoContrato = { titulo: string; corpo: string };

/** O texto do contrato, na forma em que é guardado e editado. */
export type ModeloDeContrato = {
  titulo: string;
  preambulo: string;
  blocos: BlocoDoContrato[];
  fecho: string;
};

/** O que se imprime no lugar de um campo sem valor — como no modelo em papel. */
export const LINHA_EM_BRANCO = "________________";

// ------------------------------------------------------------------ os campos

export type GrupoDeCampo = "Empresa" | "Risarte" | "Valores" | "Condições";

export type CampoDoContrato = {
  chave: string;
  grupo: GrupoDeCampo;
  /** O que este campo imprime, nas palavras de quem edita o modelo. */
  rotulo: string;
};

/**
 * OS CAMPOS QUE O MODELO PODE USAR — escritos no texto como `{{chave}}`.
 *
 * ⚠️ ESTA LISTA É O CONTRATO ENTRE O TEXTO E O SISTEMA. Campo usado no modelo
 * e ausente daqui sairia impresso como `{{chave}}` num documento que vai para
 * assinatura; por isso há teste que lê o modelo semeado na migração e confere
 * cada campo contra esta lista.
 */
export const CAMPOS_DO_CONTRATO: readonly CampoDoContrato[] = [
  { chave: "contratante_razao_social", grupo: "Empresa", rotulo: "Razão social" },
  { chave: "contratante_documento", grupo: "Empresa", rotulo: "CNPJ ou CAEPF, com a máscara" },
  { chave: "contratante_endereco", grupo: "Empresa", rotulo: "Endereço da sede, em uma linha" },
  { chave: "contratante_representante", grupo: "Empresa", rotulo: "Quem assina pela empresa" },
  { chave: "contratante_cargo", grupo: "Empresa", rotulo: "Cargo de quem assina" },
  { chave: "contratante_nacionalidade", grupo: "Empresa", rotulo: "Nacionalidade de quem assina (opcional)" },
  { chave: "contratante_rg", grupo: "Empresa", rotulo: "RG de quem assina (opcional)" },
  { chave: "contratante_cpf", grupo: "Empresa", rotulo: "CPF de quem assina" },
  { chave: "contratada_razao_social", grupo: "Risarte", rotulo: "Razão social da contratada" },
  { chave: "contratada_cnpj", grupo: "Risarte", rotulo: "CNPJ da contratada" },
  { chave: "contratada_endereco", grupo: "Risarte", rotulo: "Endereço da contratada" },
  { chave: "contratada_representante", grupo: "Risarte", rotulo: "Representante da contratada" },
  { chave: "contratada_cargo", grupo: "Risarte", rotulo: "Cargo do representante" },
  { chave: "contratada_nacionalidade", grupo: "Risarte", rotulo: "Nacionalidade do representante" },
  { chave: "contratada_rg", grupo: "Risarte", rotulo: "RG do representante" },
  { chave: "contratada_cpf", grupo: "Risarte", rotulo: "CPF do representante" },
  { chave: "valor_titular", grupo: "Valores", rotulo: "Mensalidade por titular, com o valor por extenso" },
  { chave: "valor_dependente", grupo: "Valores", rotulo: "Mensalidade por dependente, com o valor por extenso" },
  { chave: "familia_tamanho", grupo: "Valores", rotulo: "Quantos dependentes cabem no pacote familiar" },
  { chave: "valor_familia", grupo: "Valores", rotulo: "Pacote familiar, com o valor por extenso" },
  { chave: "valor_dependente_extra", grupo: "Valores", rotulo: "Dependente acima do pacote, com o valor por extenso" },
  { chave: "valor_fixo_mensal", grupo: "Valores", rotulo: "Valor fixo mensal por empresa (só quando a proposta é de valor fixo)" },
  { chave: "dia_vencimento", grupo: "Condições", rotulo: "Dia de vencimento, com o número por extenso" },
  { chave: "abrangencia", grupo: "Condições", rotulo: "As cidades das unidades da parceria" },
  { chave: "cidade_assinatura", grupo: "Condições", rotulo: "Cidade onde o contrato é assinado" },
  { chave: "data_assinatura", grupo: "Condições", rotulo: "A data de hoje, por extenso" },
] as const;

const CHAVES = new Set(CAMPOS_DO_CONTRATO.map((c) => c.chave));

/** Os campos `{{chave}}` que aparecem num texto, na ordem em que aparecem. */
export function camposUsados(texto: string): string[] {
  return [...texto.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
}

/** Todo o texto do modelo, para varrer de uma vez. */
export function textoInteiro(m: ModeloDeContrato): string {
  return [m.titulo, m.preambulo, ...m.blocos.flatMap((b) => [b.titulo, b.corpo]), m.fecho].join("\n");
}

/** Campos escritos no modelo que o sistema não conhece (erro de digitação). */
export function camposDesconhecidos(m: ModeloDeContrato): string[] {
  return [...new Set(camposUsados(textoInteiro(m)).filter((c) => !CHAVES.has(c)))];
}

/**
 * Troca cada `{{chave}}` pelo valor.
 *
 * - Sem valor, sai a linha em branco — é o que o modelo em papel faz, e deixa
 *   o documento assinável à mão.
 * - Campo DESCONHECIDO fica como está, de propósito: `{{razao_socail}}` à
 *   vista é erro que alguém corrige; sumido em silêncio, é contrato assinado
 *   com um buraco.
 */
export function preencher(
  texto: string,
  valores: Readonly<Record<string, string | null | undefined>>
): string {
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (inteiro, chave: string) => {
    if (!CHAVES.has(chave)) return inteiro;
    const v = valores[chave]?.trim();
    return v ? v : LINHA_EM_BRANCO;
  });
}

// ------------------------------------------------------------- a formatação

export type Trecho = { texto: string; negrito: boolean };

/** `**assim**` vira negrito. É a única marcação que o modelo tem. */
export function trechos(texto: string): Trecho[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((t) => t.length > 0)
    .map((t) =>
      t.startsWith("**") && t.endsWith("**") && t.length > 4
        ? { texto: t.slice(2, -2), negrito: true }
        : { texto: t, negrito: false }
    );
}

export type ParagrafoDoContrato = {
  /** "CLÁUSULA PRIMEIRA:" ou "Parágrafo primeiro:" — impresso em negrito. */
  rotulo: string | null;
  texto: string;
};

/**
 * Os parágrafos de uma cláusula.
 *
 * O título do bloco vira o rótulo do primeiro parágrafo; cada linha que
 * começa com "Parágrafo …:" ganha o seu. Assim quem edita o modelo escreve
 * texto corrido, uma linha por parágrafo, sem marcação nenhuma.
 */
export function paragrafosDoBloco(b: BlocoDoContrato): ParagrafoDoContrato[] {
  const linhas = b.corpo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const titulo = b.titulo.trim();
  if (linhas.length === 0) {
    return titulo ? [{ rotulo: `${titulo}:`, texto: "" }] : [];
  }
  return linhas.map((linha, i) => {
    const m = linha.match(/^(Par[áa]grafo\s+[^:]{1,30}:)\s*(.*)$/i);
    if (m) return { rotulo: m[1], texto: m[2] };
    return { rotulo: i === 0 && titulo ? `${titulo}:` : null, texto: linha };
  });
}

// ------------------------------------------------------------- por extenso

const UNIDADES = [
  "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
  "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 1 a 999. */
function grupoPorExtenso(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

/**
 * Um número inteiro por extenso, de 0 a 999.999.999.
 *
 * A regra do "e" entre os grupos é a da norma: ele entra antes do último
 * grupo quando esse grupo é menor que cem ou é centena redonda ("mil e
 * cinquenta", "mil e quinhentos"); nos outros casos não entra ("mil duzentos
 * e trinta e quatro").
 */
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    throw new Error(`numeroPorExtenso: fora do intervalo (${n})`);
  }
  if (n === 0) return UNIDADES[0];
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const unidades = n % 1000;

  const grupos: { texto: string; valor: number }[] = [];
  if (milhoes > 0) {
    grupos.push({
      texto: milhoes === 1 ? "um milhão" : `${grupoPorExtenso(milhoes)} milhões`,
      valor: milhoes,
    });
  }
  if (milhares > 0) {
    grupos.push({
      texto: milhares === 1 ? "mil" : `${grupoPorExtenso(milhares)} mil`,
      valor: milhares,
    });
  }
  if (unidades > 0) grupos.push({ texto: grupoPorExtenso(unidades), valor: unidades });

  return grupos
    .map((g, i) => {
      if (i === 0) return g.texto;
      const ultimo = i === grupos.length - 1;
      const pedeE = ultimo && (g.valor < 100 || g.valor % 100 === 0);
      return `${pedeE ? " e " : " "}${g.texto}`;
    })
    .join("");
}

/** "trinta e nove reais e noventa centavos". */
export function valorPorExtenso(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`valorPorExtenso: valor inválido (${cents})`);
  }
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const partes: string[] = [];
  if (reais > 0) {
    // "um milhão DE reais", "dois milhões DE reais" — só no milhão redondo.
    const de = reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${numeroPorExtenso(reais)}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return partes.length ? partes.join(" e ") : "zero reais";
}

/** "R$ 39,90 (trinta e nove reais e noventa centavos)" — como o modelo escreve. */
export function valorComExtenso(cents: number): string {
  // O `Intl` separa "R$" do número com espaço que não quebra; num texto que a
  // pessoa pode copiar e colar, espaço comum dá menos surpresa.
  return `${formatBRL(cents).replace(/ /g, " ")} (${valorPorExtenso(cents)})`;
}

/** "5 (cinco)". */
export function numeroComExtenso(n: number): string {
  return `${n} (${numeroPorExtenso(n)})`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro",
];

/** "25 de agosto de 2026" a partir de "2026-08-25". */
export function dataPorExtenso(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  const nomeDoMes = MESES[Number(mes) - 1];
  if (!nomeDoMes) return null;
  const d = Number(dia);
  return `${d === 1 ? "1º" : d} de ${nomeDoMes} de ${ano}`;
}

// ------------------------------------------------------------- abrangência

const ESTADOS: Record<string, string> = {
  AC: "do Acre", AL: "de Alagoas", AP: "do Amapá", AM: "do Amazonas", BA: "da Bahia",
  CE: "do Ceará", DF: "do Distrito Federal", ES: "do Espírito Santo", GO: "de Goiás",
  MA: "do Maranhão", MT: "de Mato Grosso", MS: "de Mato Grosso do Sul",
  MG: "de Minas Gerais", PA: "do Pará", PB: "da Paraíba", PR: "do Paraná",
  PE: "de Pernambuco", PI: "do Piauí", RJ: "do Rio de Janeiro",
  RN: "do Rio Grande do Norte", RS: "do Rio Grande do Sul", RO: "de Rondônia",
  RR: "de Roraima", SC: "de Santa Catarina", SP: "de São Paulo", SE: "de Sergipe",
  TO: "do Tocantins",
};

const lista = (itens: string[]) =>
  itens.length <= 1
    ? itens.join("")
    : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;

export type CidadeDaUnidade = { city: string | null; state: string | null };

/**
 * "nos municípios de Cambé e Londrina, ambos do estado do Paraná" — as cidades
 * das unidades da parceria, sem repetir.
 *
 * Devolve `null` quando nenhuma unidade tem cidade cadastrada: é AUSÊNCIA de
 * dado, e o contrato avisa em vez de imprimir "nos municípios de ".
 */
export function abrangencia(unidades: readonly CidadeDaUnidade[]): string | null {
  const vistas = new Map<string, { cidade: string; uf: string }>();
  for (const u of unidades) {
    const cidade = u.city?.trim();
    if (!cidade) continue;
    const uf = (u.state ?? "").trim().toUpperCase();
    const chave = `${cidade.toLocaleLowerCase("pt-BR")}|${uf}`;
    if (!vistas.has(chave)) vistas.set(chave, { cidade, uf });
  }
  const cidades = [...vistas.values()].sort((a, b) =>
    a.cidade.localeCompare(b.cidade, "pt-BR")
  );
  if (cidades.length === 0) return null;

  const ufs = [...new Set(cidades.map((c) => c.uf))];
  const estado = ufs.length === 1 ? ESTADOS[ufs[0]] : undefined;

  if (cidades.length === 1) {
    const c = cidades[0];
    if (estado) return `no município de ${c.cidade}, no estado ${estado}`;
    return `no município de ${c.cidade}${c.uf ? `/${c.uf}` : ""}`;
  }
  if (estado) {
    const quantos = cidades.length === 2 ? "ambos" : "todos";
    return `nos municípios de ${lista(cidades.map((c) => c.cidade))}, ${quantos} do estado ${estado}`;
  }
  // Estados diferentes (ou sigla que o sistema não conhece): a sigla vai ao
  // lado de cada cidade, em vez de uma frase que afirmaria um estado só.
  return `nos municípios de ${lista(cidades.map((c) => (c.uf ? `${c.cidade}/${c.uf}` : c.cidade)))}`;
}

/** O endereço em uma linha, no jeito do modelo. `null` quando não há rua nem cidade. */
export function enderecoEmLinha(a: CompanyAddress | null | undefined): string | null {
  if (!a) return null;
  const rua = a.street?.trim();
  const cidade = a.city?.trim();
  if (!rua || !cidade) return null;
  const partes = [
    [rua, a.number?.trim() ? `n°. ${a.number.trim()}` : null, a.complement?.trim() || null]
      .filter(Boolean)
      .join(", "),
    a.neighborhood?.trim() ? `– ${a.neighborhood.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const cep = a.zipCode?.trim() ? `, CEP ${a.zipCode.trim()}` : "";
  return `${partes}${cep}, em ${cidade}${a.state?.trim() ? `/${a.state.trim().toUpperCase()}` : ""}`;
}

// ------------------------------------------------------- os dados do contrato

/** A parte da Risarte, guardada em Configurações (`contract_settings`). */
export type Contratada = {
  legalName: string | null;
  cnpj: string | null;
  address: string | null;
  repName: string | null;
  repRole: string | null;
  repNationality: string | null;
  repRg: string | null;
  repCpf: string | null;
  signingCity: string | null;
};

export type DadosDaEmpresaNoContrato = {
  /** O nome que está no funil — entra quando a razão social não foi preenchida. */
  companyName: string;
  cnpj: string | null;
  legalName: string | null;
  category: CompanyCategory | null;
  address: CompanyAddress | null;
  responsibleName: string | null;
  responsibleRole: string | null;
  responsibleNationality: string | null;
  responsibleRg: string | null;
  responsibleCpf: string | null;
  /** Dia de vencimento combinado. Nulo = o padrão do programa (dia 5). */
  dueDay: number | null;
  billingBasis: "PER_EMPLOYEE" | "FIXED_PER_COMPANY" | null;
  fixedMonthlyCents: number | null;
  employeeCount: number | null;
  holderFeeCents: number | null;
  includesDependents: boolean | null;
  dependentFeeCents: number | null;
  dependentMode: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependentFamilyFeeCents: number | null;
  dependentFamilyExtraFeeCents: number | null;
  dependentFamilySize: number | null;
};

/** O dia em que as mensalidades vencem quando nada foi combinado. */
export const DIA_DE_VENCIMENTO_PADRAO = 5;
/** Quantos dependentes cabem no pacote familiar quando nada foi combinado. */
export const TAMANHO_DA_FAMILIA_PADRAO = 3;

export type ContratoMontado = {
  valores: Record<string, string | null>;
  /** O que impede o contrato de sair completo. Vazio = pode assinar. */
  faltando: string[];
  /** Onde a proposta não cabe no texto do modelo — para alguém LER antes de enviar. */
  avisos: string[];
};

/**
 * OS VALORES DE CADA CAMPO, e o que falta.
 *
 * ⚠️ O PREÇO VEM DA PROPOSTA, e só cai no padrão quando ela não diz nada — a
 * mesma cascata que o documento da proposta usa. Contrato com preço diferente
 * da proposta é o defeito que este módulo existe para acabar.
 *
 * ⚠️ O AVISO NÃO BLOQUEIA. Proposta de valor fixo não cabe na cláusula de
 * "valor por colaborador"; a tela diz isso em vermelho e o consultor
 * personaliza o texto daquela empresa. Bloquear faria o contrato voltar a ser
 * feito no Word — que é de onde ele acabou de sair.
 */
export function montarContrato(entrada: {
  empresa: DadosDaEmpresaNoContrato;
  faixas: readonly FaixaDePreco[];
  contratada: Contratada | null;
  unidades: readonly CidadeDaUnidade[];
  /** Quantos benefícios a proposta tem salvos — é deles que sai o Anexo I. */
  beneficios: number;
  /** "AAAA-MM-DD", no relógio de Brasília. */
  hoje: string;
}): ContratoMontado {
  const { empresa: e, contratada: c } = entrada;
  const faltando: string[] = [];
  const avisos: string[] = [];

  // ---- a empresa
  const doc = (e.cnpj ?? "").replace(/\D/g, "");
  const tipoDoDoc =
    SUGGESTED_DOC_BY_CATEGORY[e.category ?? "empresa_privada"] === "CAEPF" ? "CAEPF" : "CNPJ";
  const razao = e.legalName?.trim() || e.companyName.trim();
  const endereco = enderecoEmLinha(e.address);
  if (doc.length !== 14) faltando.push("CNPJ completo da empresa");
  if (!endereco) faltando.push("endereço da sede da empresa");
  if (!e.responsibleName?.trim()) faltando.push("quem assina pela empresa");
  const cpf = (e.responsibleCpf ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) faltando.push("CPF de quem assina pela empresa");

  // ---- a Risarte
  if (!c || !c.legalName?.trim() || !c.cnpj?.trim() || !c.address?.trim()) {
    faltando.push("dados da Risarte: razão social, CNPJ e endereço (Configurações → Contrato)");
  }
  if (!c?.repName?.trim()) faltando.push("nome do representante da Risarte (Configurações → Contrato)");
  if (!c?.repRg?.trim()) faltando.push("RG do representante da Risarte (Configurações → Contrato)");
  const cpfDaRisarte = (c?.repCpf ?? "").replace(/\D/g, "");
  if (cpfDaRisarte.length !== 11) {
    faltando.push("CPF do representante da Risarte (Configurações → Contrato)");
  }

  // ---- os valores
  const base = e.holderFeeCents ?? DEFAULT_ADHESION_PRICING.holderFeeCents;
  const titulares = e.employeeCount ?? 0;
  const naFaixa = precoDaFaixa(entrada.faixas, titulares, base);
  const fixo = e.billingBasis === "FIXED_PER_COMPANY";
  const tamanho = e.dependentFamilySize ?? TAMANHO_DA_FAMILIA_PADRAO;

  if (fixo) {
    avisos.push(
      e.fixedMonthlyCents != null
        ? `A proposta é de VALOR FIXO por empresa (${formatBRL(e.fixedMonthlyCents).replace(/ /g, " ")} por mês), e a cláusula de valores do modelo fala em valor por colaborador. Personalize o texto desta empresa antes de enviar.`
        : "A proposta é de VALOR FIXO por empresa, sem o valor preenchido, e a cláusula de valores do modelo fala em valor por colaborador. Complete a proposta e personalize o texto desta empresa antes de enviar."
    );
  } else if (entrada.faixas.length > 0) {
    avisos.push(
      naFaixa.faixa
        ? `A proposta tem preço por quantidade: o contrato mostra o valor da faixa de ${titulares} titular(es). O modelo não diz que o valor muda quando a quantidade muda de faixa.`
        : `A proposta tem preço por quantidade, mas ${titulares} titular(es) não alcançam nenhuma faixa: o contrato mostra o preço base. O modelo não fala das faixas.`
    );
  }
  if (e.includesDependents === false) {
    avisos.push(
      "A proposta NÃO inclui dependentes nesta fase, e a cláusula de valores do modelo cita os preços de dependente."
    );
  } else if (e.dependentMode !== "FAMILY_PACKAGE") {
    avisos.push(
      "A proposta cobra por dependente, sem pacote familiar. O modelo cita o pacote familiar e o dependente extra — eles saem com os valores padrão da rede."
    );
  }
  if (entrada.beneficios === 0) {
    avisos.push(
      "A proposta não tem benefícios salvos: o Anexo I (rol de procedimentos e carências) sai vazio. Salve os benefícios no passo 3 da proposta."
    );
  }

  // ---- as condições
  const onde = abrangencia(entrada.unidades);
  if (!onde) {
    faltando.push("cidades de abrangência (cadastre cidade e estado nas unidades da parceria)");
  }
  const dia = e.dueDay ?? DIA_DE_VENCIMENTO_PADRAO;

  const valores: Record<string, string | null> = {
    contratante_razao_social: razao || null,
    contratante_documento: doc.length === 14 ? maskDocument(tipoDoDoc, doc) : null,
    contratante_endereco: endereco,
    contratante_representante: e.responsibleName?.trim() || null,
    // Sem cargo informado, "representante legal" é verdade para qualquer um
    // que assine — e evita "por seu ________________".
    contratante_cargo: e.responsibleRole?.trim() || "representante legal",
    contratante_nacionalidade: e.responsibleNationality?.trim() || null,
    contratante_rg: e.responsibleRg?.trim() || null,
    // Sempre com a máscara: o levantamento aceita o CPF digitado só com
    // números, e num contrato "12345678901" parece erro (visto no treino).
    contratante_cpf: cpf.length === 11 ? maskDocument("CPF", cpf) : null,
    contratada_razao_social: c?.legalName?.trim() || null,
    contratada_cnpj: c?.cnpj?.trim() || null,
    contratada_endereco: c?.address?.trim() || null,
    contratada_representante: c?.repName?.trim() || null,
    contratada_cargo: c?.repRole?.trim() || "representante legal",
    contratada_nacionalidade: c?.repNationality?.trim() || null,
    contratada_rg: c?.repRg?.trim() || null,
    contratada_cpf:
      cpfDaRisarte.length === 11 ? maskDocument("CPF", cpfDaRisarte) : null,
    valor_titular: valorComExtenso(naFaixa.precoCents),
    valor_dependente: valorComExtenso(
      e.dependentFeeCents ?? DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents
    ),
    familia_tamanho: String(tamanho),
    valor_familia: valorComExtenso(
      e.dependentFamilyFeeCents ?? DEFAULT_ADHESION_PRICING.dependentFamilyFeeCents
    ),
    valor_dependente_extra: valorComExtenso(
      e.dependentFamilyExtraFeeCents ?? DEFAULT_ADHESION_PRICING.dependentFamilyExtraFeeCents
    ),
    valor_fixo_mensal:
      fixo && e.fixedMonthlyCents != null ? valorComExtenso(e.fixedMonthlyCents) : null,
    dia_vencimento: numeroComExtenso(dia),
    abrangencia: onde,
    cidade_assinatura: c?.signingCity?.trim() || null,
    data_assinatura: dataPorExtenso(entrada.hoje),
  };

  return { valores, faltando, avisos };
}

/**
 * O que impede de SALVAR um modelo.
 *
 * Campo desconhecido reprova: ele sairia impresso com as chaves num documento
 * que vai para assinatura. Modelo sem cláusula nenhuma também — é quase
 * sempre um formulário enviado pela metade.
 */
export function problemasDoModelo(m: ModeloDeContrato): string[] {
  const problemas: string[] = [];
  if (!m.titulo.trim()) problemas.push("o contrato precisa de um título");
  if (!m.preambulo.trim()) problemas.push("escreva a qualificação das partes");
  if (m.blocos.filter((b) => b.corpo.trim()).length === 0) {
    problemas.push("escreva pelo menos uma cláusula");
  }
  const estranhos = camposDesconhecidos(m);
  if (estranhos.length) {
    problemas.push(
      `campo que o sistema não conhece: ${estranhos.map((c) => `{{${c}}}`).join(", ")}`
    );
  }
  return problemas;
}

/** Quantas cláusulas um modelo pode ter — folga larga sobre as 15 do modelo. */
export const MAXIMO_DE_BLOCOS = 60;

/**
 * O modelo, lido de um formulário (`title`, `preamble`, `closing` e os blocos
 * como `titulo_0`/`corpo_0`, `titulo_1`/`corpo_1`…).
 *
 * Bloco sem título e sem corpo é bloco apagado — não vira cláusula em branco.
 * Mora aqui, e não nas actions, porque as duas telas que editam o texto (a da
 * rede e a da empresa) têm de ler o formulário do mesmo jeito.
 */
export function lerModelo(form: { get(nome: string): unknown }): ModeloDeContrato {
  const texto = (nome: string) => String(form.get(nome) ?? "").replace(/\r\n/g, "\n").trim();
  const blocos: BlocoDoContrato[] = [];
  for (let i = 0; i < MAXIMO_DE_BLOCOS; i += 1) {
    const titulo = texto(`titulo_${i}`);
    const corpo = texto(`corpo_${i}`);
    if (!titulo && !corpo) continue;
    blocos.push({ titulo, corpo });
  }
  return {
    titulo: texto("title"),
    preambulo: texto("preamble"),
    blocos,
    fecho: texto("closing"),
  };
}
