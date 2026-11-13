// Risarte Empresarial — A LEITURA DA PLANILHA DE TITULARES E DEPENDENTES.
//
// Pedido do dono (13/11/2026): a planilha modelo ganhou uma aba de instruções
// na frente, a logo no alto de cada aba e, na aba Dependentes, a coluna
// "Titular" com uma LISTA dos titulares já preenchidos ("Nome — CPF"), para a
// empresa não digitar o CPF do titular de novo.
//
// Esta peça é PURA (não lê arquivo nem banco): recebe cada aba como linhas de
// células (o que o `xlsx` entrega com `header: 1`) e devolve as linhas que a
// conferência (`importacao.ts`) já sabe conferir. Lê os dois formatos:
//   - o modelo NOVO: cabeçalho abaixo da logo, coluna "Titular" com a lista;
//   - o modelo ANTIGO (e planilhas feitas à mão): cabeçalho na linha 1,
//     coluna "CPF do Titular" digitada.
//
// ⚠️ A ABA É ACHADA PELO NOME, nunca pela posição: a aba "Como preencher" vem
// primeiro no modelo novo, e a leitura antiga (`SheetNames[0]`) tomaria as
// instruções por titulares.
//
// ⚠️ A LINHA DO ERRO É A LINHA DA PLANILHA (a que o RH vê no Excel): as linhas
// em branco contam, e o cabeçalho não fica mais sempre na linha 1.

import {
  DEPENDENT_PLAN_LABELS,
  DEPENDENT_PLANS,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
} from "./constants";
import type { DependenteDaPlanilha, LinhaDaPlanilha } from "./importacao";

export type Celulas = readonly (readonly unknown[])[];

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s*\*\s*$/, "") // "Nome *" (obrigatório no modelo) = "Nome"
    .trim();

const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** O nome das abas no modelo. A leitura aceita variações ("dependente", "TITULARES"). */
export const ABA_INSTRUCOES = "Como preencher";
export const ABA_TITULARES = "Titulares";
export const ABA_DEPENDENTES = "Dependentes";

/**
 * Qual aba é a dos titulares: a que se chama "Titulares"; sem ela, a primeira
 * que não seja de instruções nem de dependentes (planilha feita à mão).
 */
export function abaDosTitulares(nomes: readonly string[]): string | null {
  const porNome = nomes.find((n) => norm(n).startsWith("titular"));
  if (porNome) return porNome;
  return (
    nomes.find((n) => {
      const x = norm(n);
      return !x.startsWith("depend") && !x.startsWith("como") && !x.startsWith("instru") && !x.startsWith("lista");
    }) ?? null
  );
}

export function abaDosDependentes(nomes: readonly string[]): string | null {
  return nomes.find((n) => norm(n).startsWith("depend")) ?? null;
}

/**
 * QUANTOS DEPENDENTES CADA PLANO DEIXA PREENCHER NA PLANILHA (pedido do dono,
 * 13/11/2026). `null` = sem limite na planilha (o limite do contrato continua
 * valendo na importação). Plano em branco = Sem dependentes (decisão do dono).
 *
 * ⚠️ O gerador (`modelo-titulares-xlsx.ts`) escreve este mesmo limite nas
 * fórmulas da planilha, e a conferência (`importacao.ts`) recusa quem passa.
 * É a régua da 1002 (`dependent_plan_for`): 1 = Individual, até 3 = Familiar,
 * 4 ou mais = Familiar + extras.
 */
export const LIMITE_DO_PLANO: Record<(typeof DEPENDENT_PLANS)[number], number | null> = {
  NONE: 0,
  INDIVIDUAL: 1,
  FAMILY: 3,
  FAMILY_EXTRA: null,
};

const PLANO_PELO_ROTULO = new Map<string, string>([
  ...DEPENDENT_PLANS.map((p) => [norm(DEPENDENT_PLAN_LABELS[p]), p] as [string, string]),
  ...DEPENDENT_PLANS.map((p) => [norm(p), p] as [string, string]),
]);

// Parentesco: o rótulo oficial (o da lista do modelo), o valor do enum e as
// formas que as pessoas escrevem ("esposa", "filho", "mãe"...).
const SINONIMOS_DO_PARENTESCO: Record<string, string> = {
  esposa: "SPOUSE",
  esposo: "SPOUSE",
  marido: "SPOUSE",
  mulher: "SPOUSE",
  companheiro: "SPOUSE",
  companheira: "SPOUSE",
  "companheiro(a)": "SPOUSE",
  conjuge: "SPOUSE",
  parceiro: "SPOUSE",
  parceira: "SPOUSE",
  filho: "CHILD",
  filha: "CHILD",
  filhos: "CHILD",
  enteado: "CHILD",
  enteada: "CHILD",
  dependente: "CHILD",
  pai: "PARENT",
  mae: "PARENT",
  genitor: "PARENT",
  genitora: "PARENT",
  sogro: "OTHER",
  sogra: "OTHER",
  irmao: "OTHER",
  irma: "OTHER",
  neto: "OTHER",
  neta: "OTHER",
  avo: "OTHER",
  outros: "OTHER",
};

const PARENTESCO_PELO_ROTULO = new Map<string, string>([
  ...RELATIONSHIPS.map((r) => [norm(RELATIONSHIP_LABELS[r]), r] as [string, string]),
  ...RELATIONSHIPS.map((r) => [norm(r), r] as [string, string]),
  ...Object.entries(SINONIMOS_DO_PARENTESCO).map(([k, v]) => [norm(k), v] as [string, string]),
]);

/** Parentesco não reconhecido não descarta a linha: entra como "Outro". */
export function parentescoDaPlanilha(texto: unknown): string {
  return PARENTESCO_PELO_ROTULO.get(norm(texto)) ?? "OTHER";
}

export function planoDaPlanilha(texto: unknown): string {
  const t = norm(texto);
  if (!t) return "NONE";
  return PLANO_PELO_ROTULO.get(t) ?? "NONE";
}

/**
 * O texto que a lista de titulares mostra: "Maria Silva — 111.111.111-11".
 * A fórmula do modelo (`textoDaListaFormula`) monta o mesmo.
 */
export function textoDaLista(nome: string, cpfFormatado: string): string {
  return `${nome.trim()} — ${cpfFormatado.trim()}`;
}

/**
 * Acha a linha do cabeçalho: a primeira (nas 30 de cima) que tem uma célula
 * "Nome" ou que tem uma célula começando por "CPF" e outra coluna conhecida.
 * Devolve o índice (0 = primeira linha) ou -1.
 */
function linhaDoCabecalho(celulas: Celulas, conhecidas: readonly string[]): number {
  const limite = Math.min(celulas.length, 30);
  for (let i = 0; i < limite; i++) {
    const nomes = (celulas[i] ?? []).map(norm).filter(Boolean);
    const acertos = nomes.filter((n) => conhecidas.includes(n)).length;
    if (acertos >= 2) return i;
  }
  return -1;
}

type Leitura<T> = { linhas: T[]; achouCabecalho: boolean; cabecalho: string[] };

function lerAba(
  celulas: Celulas,
  conhecidas: readonly string[]
): Leitura<{ linha: number; get: (...chaves: string[]) => string }> {
  const iCab = linhaDoCabecalho(celulas, conhecidas);
  if (iCab < 0) return { linhas: [], achouCabecalho: false, cabecalho: [] };
  const cabecalho = (celulas[iCab] ?? []).map(norm);
  const linhas: { linha: number; get: (...chaves: string[]) => string }[] = [];
  for (let i = iCab + 1; i < celulas.length; i++) {
    const linha = celulas[i] ?? [];
    const m: Record<string, string> = {};
    cabecalho.forEach((h, j) => {
      if (h && !(h in m)) m[h] = String(linha[j] ?? "").trim();
    });
    const get = (...chaves: string[]) => {
      for (const k of chaves) if (m[k]) return m[k];
      return "";
    };
    // A linha da planilha começa em 1.
    linhas.push({ linha: i + 1, get });
  }
  return { linhas, achouCabecalho: true, cabecalho };
}

const CABECALHO_DOS_TITULARES = [
  "nome",
  "nome completo",
  "cpf",
  "telefone",
  "celular",
  "whatsapp",
  "e-mail",
  "email",
  "plano de dependentes",
  "plano",
];

const CABECALHO_DOS_DEPENDENTES = [
  "titular",
  "cpf do titular",
  "cpf titular",
  "cpf do dependente",
  "cpf dependente",
  "nome",
  "nome do dependente",
  "nome completo",
  "parentesco",
  "grau de parentesco",
  "telefone",
];

export type TitularesLidos = {
  linhas: LinhaDaPlanilha[];
  achouCabecalho: boolean;
  /** A aba tem a coluna "Plano de Dependentes": o limite do plano vale. */
  temColunaDoPlano: boolean;
};

export function lerTitulares(celulas: Celulas): TitularesLidos {
  const { linhas, achouCabecalho, cabecalho } = lerAba(celulas, CABECALHO_DOS_TITULARES);
  const temColunaDoPlano = cabecalho.some((h) => h === "plano de dependentes" || h === "plano");
  return {
    achouCabecalho,
    temColunaDoPlano,
    linhas: linhas
      .map(({ linha, get }) => ({
        linha,
        fullName: get("nome", "nome completo"),
        cpf: get("cpf"),
        phone: get("telefone", "whatsapp", "celular"),
        email: get("e-mail", "email"),
        dependentPlan: planoDaPlanilha(get("plano de dependentes", "plano")),
        planoNaPlanilha: temColunaDoPlano,
      }))
      // Só a linha em branco é descartada: o resto vai à conferência, que diz
      // o que falta (AP97). O plano sozinho não conta — o modelo não o
      // preenche, mas uma linha só com ele é linha em branco.
      .filter((r) => r.fullName || r.cpf || r.phone || r.email),
  };
}

/**
 * De quem é o dependente. A célula "Titular" do modelo novo traz
 * "Nome — CPF" (escolhido na lista); a antiga traz só o CPF. Sem CPF na
 * célula (alguém digitou só o nome, ou o Google Planilhas não abriu a lista),
 * procura o nome entre os titulares da planilha — e só aceita se houver UM.
 */
export function cpfDoTitular(
  texto: string,
  titulares: readonly LinhaDaPlanilha[]
): string {
  const digitos = soDigitos(texto);
  if (digitos.length === 11) return digitos;
  // "Nome — 111.111.111-11" com algum número a mais? Pega os 11 do fim.
  if (digitos.length > 11) {
    const doFim = soDigitos(texto.slice(texto.lastIndexOf("—") + 1));
    if (doFim.length === 11) return doFim;
  }
  if (digitos.length === 0 && texto.trim()) {
    const alvo = norm(texto);
    const iguais = titulares.filter((t) => norm(t.fullName) === alvo);
    if (iguais.length === 1) return soDigitos(iguais[0].cpf);
  }
  return digitos;
}

export type DependentesLidos = { linhas: DependenteDaPlanilha[]; achouCabecalho: boolean };

export function lerDependentes(
  celulas: Celulas,
  titulares: readonly LinhaDaPlanilha[]
): DependentesLidos {
  const { linhas, achouCabecalho } = lerAba(celulas, CABECALHO_DOS_DEPENDENTES);
  return {
    achouCabecalho,
    linhas: linhas
      .map(({ linha, get }) => {
        const titular = get("titular", "cpf do titular", "cpf titular");
        return {
          linha,
          holderCpf: cpfDoTitular(titular, titulares),
          holderTexto: titular,
          cpf: get("cpf do dependente", "cpf dependente", "cpf"),
          fullName: get("nome do dependente", "nome", "nome completo"),
          relationship: parentescoDaPlanilha(
            get("parentesco", "grau de parentesco", "vinculo")
          ),
          phone: get("telefone", "celular", "whatsapp"),
        };
      })
      .filter((d) => d.holderTexto || d.cpf || d.fullName),
  };
}
