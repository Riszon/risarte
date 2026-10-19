// ODONTOGRAMA — A REFERÊNCIA (0308, OD1, 19/10/2026).
//
// Dentes, faces e regiões são da TUSS (código e nome oficiais, travados no
// banco). As LIGAÇÕES (que faces cada dente tem, que dentes cada região
// seleciona), as SITUAÇÕES da Risarte e as REGRAS clínicas de cada
// procedimento são configuração da rede — o Admin ajusta em Administração →
// Odontograma (pedido do dono). Aqui: rótulos e a mesma régua do banco, para
// a tela dizer o que está errado antes de gravar.
//
// Puro e testado.

export const NIVEIS = ["face", "tooth", "region", "arch", "none"] as const;
export type Nivel = (typeof NIVEIS)[number];
export const ROTULO_DO_NIVEL: Record<Nivel, string> = {
  face: "Face(s) do dente",
  tooth: "Dente",
  region: "Região",
  arch: "Arcada",
  none: "Sem marcação no dente",
};

export const DENTICOES = ["permanent", "deciduous", "both"] as const;
export type Denticao = (typeof DENTICOES)[number];
export const ROTULO_DA_DENTICAO: Record<Denticao, string> = {
  permanent: "Permanente",
  deciduous: "Decídua",
  both: "Ambas",
};

export const GRUPOS_DE_DENTE = [
  "incisor",
  "canine",
  "premolar",
  "molar",
  "deciduous_molar",
  "supernumerary",
] as const;
export type GrupoDeDente = (typeof GRUPOS_DE_DENTE)[number];
export const ROTULO_DO_GRUPO: Record<GrupoDeDente, string> = {
  incisor: "Incisivos",
  canine: "Caninos",
  premolar: "Pré-molares",
  molar: "Molares",
  deciduous_molar: "Molares decíduos",
  supernumerary: "Supranumerários",
};

export const ONDE_SE_MARCA = ["face", "crown", "root", "whole_tooth", "between_teeth"] as const;
export type OndeSeMarca = (typeof ONDE_SE_MARCA)[number];
export const ROTULO_DO_ONDE: Record<OndeSeMarca, string> = {
  face: "Face",
  crown: "Coroa (dente)",
  root: "Raiz",
  whole_tooth: "Dente inteiro",
  between_teeth: "Entre dentes",
};

export const USOS = ["finding", "effect", "both"] as const;
export type Uso = (typeof USOS)[number];
export const ROTULO_DO_USO: Record<Uso, string> = {
  finding: "Achado (o que se encontra no exame)",
  effect: "Efeito (o que o dente passa a ter)",
  both: "Os dois",
};

export const ROTULO_DA_CONFIANCA: Record<string, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

/** Código da situação da Risarte: RZ- + letras/números (o banco confere igual). */
export function codigoDeSituacaoValido(codigo: string): boolean {
  return /^RZ-[A-Z0-9]{2,20}$/.test(codigo);
}

export type CamposDaSituacao = {
  code: string;
  name: string;
  appliesTo: string;
  usage: string;
  symbol: string;
};

export function validarSituacao(
  c: CamposDaSituacao,
  nova: boolean
): { erro: string } | { valores: CamposDaSituacao } {
  const code = c.code.trim().toUpperCase();
  const name = c.name.trim();
  const symbol = c.symbol.trim().toUpperCase();
  if (nova && !codigoDeSituacaoValido(code)) {
    return { erro: "O código começa com RZ- e tem só letras e números (ex.: RZ-SELANTE)." };
  }
  if (name.length < 2) return { erro: "Dê um nome à situação." };
  if (!ONDE_SE_MARCA.includes(c.appliesTo as OndeSeMarca)) return { erro: "Escolha onde se marca." };
  if (!USOS.includes(c.usage as Uso)) return { erro: "Escolha como a situação é usada." };
  if (symbol.length < 1 || symbol.length > 3) return { erro: "O símbolo tem de 1 a 3 letras." };
  return { valores: { code, name, appliesTo: c.appliesTo, usage: c.usage, symbol } };
}

export type RegraDoProcedimento = {
  level: Nivel;
  faceCountMin: number | null;
  faceCountMax: number | null;
  fixedFaces: string[];
  dentition: Denticao;
  toothGroups: GrupoDeDente[];
  blockedConditions: string[];
  requiredConditions: string[];
  effectCondition: string | null;
  effectWhenAbsent: string | null;
};

/**
 * A mesma régua do banco (0308): nível "face" exige de 1 a 5 faces e o
 * mínimo ≤ máximo; os outros níveis não têm faces; uma situação não pode
 * ser exigida e impedida ao mesmo tempo. Devolve a regra LIMPA (sem faces
 * nos níveis que não usam face).
 */
export function validarRegra(r: RegraDoProcedimento): { erro: string } | { regra: RegraDoProcedimento } {
  if (!NIVEIS.includes(r.level)) return { erro: "Escolha o nível." };
  if (!DENTICOES.includes(r.dentition)) return { erro: "Escolha a dentição." };
  let { faceCountMin, faceCountMax, fixedFaces } = r;
  if (r.level === "face") {
    if (!Number.isInteger(faceCountMin) || !Number.isInteger(faceCountMax)) {
      return { erro: "Diga quantas faces (de 1 a 5)." };
    }
    if ((faceCountMin as number) < 1 || (faceCountMax as number) > 5 || (faceCountMin as number) > (faceCountMax as number)) {
      return { erro: "Faces: de 1 a 5, e o mínimo não pode passar do máximo." };
    }
    if (fixedFaces.length > (faceCountMax as number)) {
      return { erro: "Há mais faces fixas do que o máximo de faces." };
    }
  } else {
    faceCountMin = null;
    faceCountMax = null;
    fixedFaces = [];
  }
  const ambas = r.requiredConditions.filter((c) => r.blockedConditions.includes(c));
  if (ambas.length) return { erro: `A situação ${ambas[0]} está como exigida e como impedida ao mesmo tempo.` };
  return { regra: { ...r, faceCountMin, faceCountMax, fixedFaces } };
}

/** Os recados do banco, em português. Desconhecido → nulo (nunca chuta). */
export function mensagemDoOdontograma(erro: string): string | null {
  const mapa: [string, string][] = [
    ["TUSS_LOCKED", "O nome de uma situação da TUSS é oficial e não muda (o símbolo pode)."],
    ["CONDITION_CODE_LOCKED", "O código de uma situação não muda depois de criado."],
    ["CONDITION_NOT_DELETABLE", "Situação não se apaga — desative."],
    ["UNKNOWN_CONDITION", "Há uma situação que não existe na lista."],
    ["UNKNOWN_FACE", "Há uma face que não existe."],
    ["UNKNOWN_TOOTH_GROUP", "Há um grupo de dentes desconhecido."],
    ["CONDITION_BOTH_REQUIRED_AND_BLOCKED", "Uma situação não pode ser exigida e impedida ao mesmo tempo."],
    ["FACES_REQUIRED", "O dente precisa de pelo menos uma face."],
    ["TOOTH_NOT_FOUND", "Dente não encontrado."],
    ["REGION_NOT_FOUND", "Região não encontrada."],
    ["NOT_ALLOWED", "Só o Admin Master configura o odontograma."],
    ["duplicate key", "Já existe uma situação com este código."],
    ["procedure_dental_rules_check", "A regra está incompleta: nível \"face\" precisa do número de faces."],
  ];
  for (const [k, v] of mapa) if (erro.includes(k)) return v;
  return null;
}
