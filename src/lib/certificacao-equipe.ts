// A EQUIPE NA CERTIFICAÇÃO E O ACOMPANHAMENTO DO ADMIN (relato OC-00003).
//
// O dono pediu duas coisas: quem está na certificação COLETIVA ver como os
// colegas da unidade avançam, e o Admin ter um painel com a evolução de cada
// pessoa e de cada equipe. As duas telas leem a MESMA regra daqui — se cada
// uma decidisse sozinha o que é "cumpriu", a pessoa veria uma situação e o
// Admin outra.
//
// ⚠️ O PROGRESSO DOS OUTROS É A ÚLTIMA MEDIÇÃO GUARDADA, NÃO UMA MEDIÇÃO NOVA.
// Medir no treino cada colega a cada abertura do Início (ou 2.000 pessoas no
// painel) seria impossível; por isso toda medição que o servidor já faz deixa
// um retrato na matrícula (`progress_snapshot`, 0303), e a tela diz QUANDO ele
// foi tirado. Quem decide "cumpriu" continua sendo a medição na hora (0281).
//
// Puro e testado: nada de banco, nada de React.

import { retratoDaMedicao } from "@/lib/certificacao-conclusao";
import type { ProgressoDaMissao } from "@/lib/certificacao";
import type { UserRole } from "@/lib/roles";

/** O retrato que vai para a matrícula: os itens + o percentual. */
export function retratoDoProgresso(p: ProgressoDaMissao, agora: Date) {
  return { ...retratoDaMedicao(p, agora), percentual: p.percentual, cumprida: p.cumprida };
}

/** O percentual do retrato guardado — sem confiar no formato. */
export function percentualDoRetrato(v: unknown): number | null {
  const n = (v as { percentual?: unknown } | null)?.percentual;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

export type Situacao =
  | "certificado"
  | "aguardando_aprovacao"
  | "cumpriu"
  | "em_andamento"
  | "nao_aceitou"
  | "dispensado";

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  certificado: "Certificado",
  aguardando_aprovacao: "Cumpriu — aguardando aprovação",
  cumpriu: "Cumpriu",
  em_andamento: "Em andamento",
  nao_aceitou: "Ainda não aceitou",
  dispensado: "Dispensado",
};

/** O que basta para dizer a situação de uma matrícula. */
export type BaseDaSituacao = {
  status: string;
  certificado: boolean;
  aprovacao: string | null;
};

/**
 * A SITUAÇÃO DE UMA PESSOA NA TURMA. A ordem importa: certificado vence tudo
 * (é fato gravado); depois a aprovação pendente; depois o status da matrícula.
 */
export function situacaoDaMatricula(m: BaseDaSituacao): Situacao {
  if (m.certificado) return "certificado";
  if (m.status === "dispensado") return "dispensado";
  if (m.aprovacao === "pendente") return "aguardando_aprovacao";
  if (m.status === "concluido") return "cumpriu";
  if (m.status === "em_andamento") return "em_andamento";
  return "nao_aceitou";
}

/** Já fez a parte dela: não segura mais o grupo. */
export function jaCumpriu(s: Situacao): boolean {
  return s === "certificado" || s === "aguardando_aprovacao" || s === "cumpriu";
}

export type ColegaDoGrupo = BaseDaSituacao & {
  clinicId: string;
  clinicName: string;
  userId: string;
  nome: string;
  role: UserRole;
  startedAt: string | null;
  percentual: number | null;
  medidoEm: string | null;
  souEu: boolean;
};

/** Lê o que `my_training_group` (0303) devolveu — sem confiar no formato. */
export function lerColegas(linhas: readonly Record<string, unknown>[]): ColegaDoGrupo[] {
  return linhas.map((r) => ({
    clinicId: String(r.clinic_id ?? ""),
    clinicName: String(r.clinic_name ?? ""),
    userId: String(r.user_id ?? ""),
    nome: String(r.full_name ?? "Sem nome"),
    role: r.role as UserRole,
    status: String(r.status ?? ""),
    startedAt: r.started_at ? String(r.started_at) : null,
    certificado: r.certified === true,
    aprovacao: r.approval_status ? String(r.approval_status) : null,
    percentual: percentualDoRetrato(r.progress_snapshot),
    medidoEm: r.progress_measured_at ? String(r.progress_measured_at) : null,
    souEu: r.is_me === true,
  }));
}

export type GrupoDaUnidade<T> = {
  clinicId: string;
  clinicName: string;
  pessoas: T[];
  /** Quantos já fizeram a parte deles (certificado, aguardando ou cumpriu). */
  cumpriram: number;
  /** Quem conta para o grupo (dispensado não segura a unidade, 0277). */
  total: number;
};

/** "Cambé", "Cambé e Londrina", "Cambé, Londrina e Maringá". */
export function listaDeNomes(nomes: readonly string[]): string {
  const unicos = [...new Set(nomes.filter(Boolean))];
  if (unicos.length <= 1) return unicos[0] ?? "";
  return `${unicos.slice(0, -1).join(", ")} e ${unicos[unicos.length - 1]}`;
}

const ORDEM_DA_SITUACAO: Record<string, number> = { concluido: 0, em_andamento: 1, convocado: 2 };

/**
 * UMA MISSÃO POR FUNÇÃO (AP52, decisão do dono 19/10/2026). A mesma pessoa
 * convocada na mesma função em duas unidades (turmas do mesmo tipo) tem UMA
 * missão: o banco anda com as matrículas irmãs juntas (0305), e a tela mostra
 * um quadro só, com as unidades. A REPRESENTANTE é a mais adiantada
 * (concluída > em andamento > convocada) — é ela que se mede e se registra.
 */
export function agruparMissoes<
  T extends { role: string; kind: string; status: string; started_at: string | null },
>(linhas: readonly T[]): { representante: T; todas: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const l of linhas) {
    const chave = `${l.role}:${l.kind}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }
  return [...grupos.values()].map((todas) => {
    const ordenadas = [...todas].sort(
      (a, b) =>
        (ORDEM_DA_SITUACAO[a.status] ?? 9) - (ORDEM_DA_SITUACAO[b.status] ?? 9) ||
        (a.started_at ?? "9").localeCompare(b.started_at ?? "9")
    );
    return { representante: ordenadas[0], todas };
  });
}

/** Agrupa por unidade, na ordem do nome, com a contagem do grupo. */
export function porUnidade<T extends BaseDaSituacao & { clinicId: string; clinicName: string }>(
  pessoas: readonly T[]
): GrupoDaUnidade<T>[] {
  const mapa = new Map<string, GrupoDaUnidade<T>>();
  for (const p of pessoas) {
    const g = mapa.get(p.clinicId) ?? {
      clinicId: p.clinicId,
      clinicName: p.clinicName,
      pessoas: [],
      cumpriram: 0,
      total: 0,
    };
    g.pessoas.push(p);
    const s = situacaoDaMatricula(p);
    if (s !== "dispensado") {
      g.total += 1;
      if (jaCumpriu(s)) g.cumpriram += 1;
    }
    mapa.set(p.clinicId, g);
  }
  return [...mapa.values()].sort((a, b) => a.clinicName.localeCompare(b.clinicName, "pt-BR"));
}
