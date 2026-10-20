// ODONTOGRAMA — O PLANO POR DENTE (OD3, 0311, 20/10/2026).
//
// Cada item do plano diz ONDE acontece (dente + faces, ou região/arcada). A
// mesma régua do banco (`plan_item_location_check`), para a tela avisar antes
// de gravar:
//   - F1: o que é de FORMA não passa (face que o dente não tem, nº de faces,
//     dentição, grupo de dentes, nível errado); o que é de SITUAÇÃO (impede /
//     exige) passa com MOTIVO.
//   - F4: um item por dente, quantidade 1.
//
// Puro e testado.

import type { MarcaNoDente } from "@/lib/odontograma/desenho";
import type { SituacaoDoDente } from "@/lib/odontograma/diagnostico";

export type NivelDoProcedimento = "face" | "tooth" | "region" | "arch" | "none";

export type RegraDoPlano = {
  nivel: NivelDoProcedimento;
  facesMin: number | null;
  facesMax: number | null;
  facesFixas: string[];
  denticao: "permanent" | "deciduous" | "both";
  grupos: string[];
  impede: string[];
  exige: string[];
  efeito: string | null;
};

export type DenteDaReferencia = { dentition: "permanent" | "deciduous"; group: string };

/** As arcadas da TUSS (regiões que valem para procedimento "de arcada"). */
export const REGIOES_DE_ARCADA = ["AS", "AI", "ASAI"] as const;

export function regraDaLinha(r: {
  application_level: string;
  face_count_min: number | null;
  face_count_max: number | null;
  fixed_faces: string[] | null;
  dentition: string;
  tooth_groups: string[] | null;
  blocked_conditions: string[] | null;
  required_conditions: string[] | null;
  effect_condition: string | null;
}): RegraDoPlano {
  return {
    nivel: r.application_level as NivelDoProcedimento,
    facesMin: r.face_count_min,
    facesMax: r.face_count_max,
    facesFixas: r.fixed_faces ?? [],
    denticao: r.dentition as RegraDoPlano["denticao"],
    grupos: r.tooth_groups ?? [],
    impede: r.blocked_conditions ?? [],
    exige: r.required_conditions ?? [],
    efeito: r.effect_condition,
  };
}

/** O procedimento se marca no dente? (face ou dente) */
export const ehPorDente = (r: RegraDoPlano | null | undefined) => r?.nivel === "face" || r?.nivel === "tooth";
/** O procedimento se marca numa região ou arcada? */
export const ehPorRegiao = (r: RegraDoPlano | null | undefined) => r?.nivel === "region" || r?.nivel === "arch";

/** FORMA (F1: recusa). Devolve o recado, ou nulo se cabe. */
export function conferirForma(
  regra: RegraDoPlano,
  dente: string,
  ref: DenteDaReferencia | undefined,
  faces: string[],
  facesDoDente: string[]
): string | null {
  if (!ref) return `O dente ${dente} não existe na referência.`;
  if (regra.denticao !== "both" && ref.dentition !== regra.denticao) {
    return regra.denticao === "deciduous"
      ? `O dente ${dente} é permanente; este procedimento é de dente decíduo.`
      : `O dente ${dente} é decíduo; este procedimento é de dente permanente.`;
  }
  if (regra.grupos.length > 0 && !regra.grupos.includes(ref.group)) {
    return `Este procedimento não se faz no dente ${dente} (grupo de dentes diferente).`;
  }
  if (regra.nivel === "face") {
    const unicas = [...new Set(faces)];
    const min = regra.facesMin ?? 1;
    const max = regra.facesMax ?? 5;
    if (unicas.length < min || unicas.length > max) {
      return min === max ? `Este procedimento é de ${min} face${min === 1 ? "" : "s"}.` : `Escolha de ${min} a ${max} faces.`;
    }
    const falta = unicas.find((f) => !facesDoDente.includes(f));
    if (falta) return `O dente ${dente} não tem a face ${falta}.`;
    const fixa = regra.facesFixas.find((f) => !unicas.includes(f));
    if (fixa) return `Este procedimento é na face ${fixa}.`;
  } else if (faces.length > 0) {
    return "Este procedimento é do dente inteiro: não leva face.";
  }
  return null;
}

/** As situações planejadas para o dente pelos OUTROS itens da mesma opção (efeito). */
export function previstosNoDente(
  itens: { id: string; procedureId: string | null; toothCode: string | null }[],
  regras: Record<string, RegraDoPlano>,
  dente: string,
  excetoId?: string
): string[] {
  const efeitos = new Set<string>();
  for (const i of itens) {
    if (i.id === excetoId || i.toothCode !== dente || !i.procedureId) continue;
    const e = regras[i.procedureId]?.efeito;
    if (e) efeitos.add(e);
  }
  return [...efeitos];
}

/** SITUAÇÃO (F1: avisa e pede motivo). Contra o diagnóstico definido e o que a opção já planeja. */
export function conflitosDeSituacao(
  regra: RegraDoPlano,
  atuais: string[],
  previstos: string[]
): { impede: string[]; falta: string[] } {
  const impede = regra.impede.filter((c) => atuais.includes(c));
  const temExigido = regra.exige.length === 0 || regra.exige.some((c) => atuais.includes(c) || previstos.includes(c));
  return { impede, falta: temExigido ? [] : regra.exige };
}

export function textoDoConflito(
  dente: string,
  c: { impede: string[]; falta: string[] },
  nome: (codigo: string) => string
): string | null {
  const partes: string[] = [];
  if (c.impede.length) partes.push(`o dente ${dente} está marcado como ${c.impede.map(nome).join(", ")}`);
  if (c.falta.length) partes.push(`o procedimento exige ${c.falta.map(nome).join(" ou ")} no dente ${dente} (nem existe, nem está planejado nesta opção)`);
  return partes.length ? `Atenção: ${partes.join("; ")}.` : null;
}

/** F4: um item por dente. Devolve o que vai ao banco e os problemas de FORMA. */
export function itensPorDente(
  regra: RegraDoPlano,
  dentes: string[],
  faces: string[],
  referencia: Record<string, DenteDaReferencia>,
  facesPorDente: Record<string, string[]>
): { itens: { tooth: string; faces: string[] }[]; problemas: string[] } {
  const itens: { tooth: string; faces: string[] }[] = [];
  const problemas: string[] = [];
  if (dentes.length === 0) return { itens, problemas: ["Escolha o(s) dente(s) no desenho."] };
  for (const d of dentes) {
    const f = regra.nivel === "face" ? faces : [];
    const erro = conferirForma(regra, d, referencia[d], f, facesPorDente[d] ?? []);
    if (erro) problemas.push(erro);
    else itens.push({ tooth: d, faces: [...new Set(f)].sort() });
  }
  return { itens, problemas };
}

/** Regiões que servem ao procedimento: arcada → só as arcadas; região → as demais. */
export function regioesDoProcedimento<T extends { code: string }>(regra: RegraDoPlano, regioes: T[]): T[] {
  if (regra.nivel === "arch") return regioes.filter((r) => (REGIOES_DE_ARCADA as readonly string[]).includes(r.code));
  if (regra.nivel === "region") return regioes.filter((r) => !(REGIOES_DE_ARCADA as readonly string[]).includes(r.code));
  return [];
}

/** "16 (O, M)", "Sextante superior anterior" — ou nulo (item sem lugar). */
export function rotuloDoLocal(
  i: { toothCode: string | null; faceCodes: string[]; regionCode: string | null },
  nomeDaRegiao?: (codigo: string) => string | undefined
): string | null {
  if (i.toothCode) return i.faceCodes.length ? `${i.toothCode} (${i.faceCodes.join(", ")})` : `Dente ${i.toothCode}`;
  if (i.regionCode) return nomeDaRegiao?.(i.regionCode) ?? `Região ${i.regionCode}`;
  return null;
}

/** O vermelho do desenho: o que a opção planeja, dente a dente. */
export function marcasDoPlano(
  itens: { toothCode: string | null; faceCodes: string[]; procedureId: string | null; description: string }[],
  regras: Record<string, RegraDoPlano>,
  situacoes: SituacaoDoDente[]
): MarcaNoDente[] {
  const porCodigo = new Map(situacoes.map((s) => [s.code, s]));
  const marcas: MarcaNoDente[] = [];
  for (const i of itens) {
    if (!i.toothCode || !i.procedureId) continue;
    const regra = regras[i.procedureId];
    const efeito = regra?.efeito ? porCodigo.get(regra.efeito) : undefined;
    const naFace = regra?.nivel === "face" && i.faceCodes.length > 0;
    marcas.push({
      dente: i.toothCode,
      faces: naFace ? i.faceCodes : [],
      local: naFace ? "face" : (efeito?.appliesTo === "root" ? "root" : "crown"),
      situacao: "planejado",
      codigo: efeito?.code ?? "PLANO",
      simbolo: efeito?.symbol ?? "P",
      nome: i.description,
    });
  }
  return marcas;
}

/**
 * O plano que VALE (D4): a versão aprovada mais nova que não foi substituída;
 * sem aprovada, a mais nova não substituída. E dele, a opção que se mostra: a
 * principal aprovada, senão a primeira aprovada, senão a principal.
 */
export function itensDoPlanoVigente<I>(
  planos: {
    status: string;
    supersededAt?: string | null;
    createdAt: string;
    options: { isPrimary: boolean; reviewStatus: string; items: I[] }[];
  }[]
): I[] {
  const vigentes = planos
    .filter((p) => !p.supersededAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const plano = vigentes.find((p) => p.status === "approved") ?? vigentes[0];
  if (!plano) return [];
  const aprovadas = plano.options.filter((o) => o.reviewStatus === "approved");
  const opcao =
    aprovadas.find((o) => o.isPrimary) ?? aprovadas[0] ?? plano.options.find((o) => o.isPrimary) ?? plano.options[0];
  return opcao?.items ?? [];
}

/** Os recados do banco (0311), em português. Desconhecido → nulo. */
export function mensagemDoPlano(erro: string): string | null {
  const mapa: [string, string][] = [
    ["SITUATION_CONFLICT", "O procedimento não combina com a situação do dente (diagnóstico). Para lançar mesmo assim, escreva o motivo."],
    ["ITEM_ONE_PER_TOOTH", "Procedimento por dente: um item por dente (quantidade 1)."],
    ["ITEM_FACE_COUNT", "O número de faces não bate com o procedimento."],
    ["ITEM_FIXED_FACES", "Este procedimento é numa face específica — confira as faces."],
    ["FACE_NOT_ON_TOOTH", "Há uma face que o dente não tem."],
    ["FACES_NOT_ALLOWED", "Este procedimento é do dente inteiro: não leva face."],
    ["ITEM_WRONG_DENTITION", "Este procedimento não é desta dentição (permanente × decídua)."],
    ["ITEM_WRONG_TOOTH_GROUP", "Este procedimento não se faz neste grupo de dentes."],
    ["ITEM_TOOTH_REQUIRED", "Escolha o dente."],
    ["ITEM_REGION_REQUIRED", "Escolha a região."],
    ["ITEM_ARCH_REQUIRED", "Escolha a arcada (superior, inferior ou as duas)."],
    ["ITEM_NO_LOCATION", "Este procedimento não se marca no dente."],
    ["ITEM_LOCATION_REQUIRED", "Há procedimento sem o dente ou a região. Indique o lugar de cada um antes de enviar."],
    ["ITEM_FACES_WITHOUT_TOOTH", "Faces sem dente: escolha o dente."],
    ["ITEM_LOCATION_WITHOUT_PROCEDURE", "Item sem procedimento do catálogo não leva dente."],
    ["DIAGNOSIS_PENDING_SUGGESTIONS", "Há sugestões do Coordenador no odontograma esperando a sua decisão. Decida antes de enviar."],
    ["DIAGNOSIS_NOT_FINALIZED", "O diagnóstico por dente ainda não foi finalizado. Finalize no odontograma antes de enviar."],
    ["PLAN_LOCKED", "Este plano já foi enviado ou aprovado e não se edita — crie uma nova versão."],
    ["PLAN_STATUS_BY_FUNCTION", "A situação do plano só muda pelos botões do fluxo (enviar, aprovar)."],
    ["PLAN_SUPERSEDED", "Este plano foi substituído por uma versão mais nova."],
    ["PREVIOUS_PLAN_INVALID", "A versão anterior não é deste cliente."],
  ];
  for (const [k, v] of mapa) if (erro.includes(k)) return v;
  return null;
}
