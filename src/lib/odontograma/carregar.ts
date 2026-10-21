import "server-only";
import { createClient } from "@/lib/supabase/server";
import { evaluationLabel, type EvaluationKind } from "@/lib/clinical";
import { todayInBrazil } from "@/lib/dates";
import { anosCompletos, denticaoPelaIdade, type Denticao } from "@/lib/odontograma/desenho";
import { regraDaLinha, type DenteDaReferencia, type RegraDoPlano } from "@/lib/odontograma/plano";
import {
  COLUNAS_DO_ACHADO,
  achadoDaLinha,
  denticaoDoBanco,
  marcasDoDesenho,
  type Achado,
  type SituacaoDoDente,
} from "@/lib/odontograma/diagnostico";
import type { OdontoDaApresentacao } from "@/lib/odontograma/aceite";

export type RodadaDoOdontograma = {
  id: string;
  rotulo: string;
  clinicId: string;
  clinicName: string | null;
  aberta: boolean;
  finalizadoEm: string | null;
  finalizadoPor: string | null;
};

export type DadosDoOdontograma = {
  nomes: Record<string, string>;
  /** Dentição e grupo de cada dente (a régua da forma, OD3). */
  dentes: Record<string, DenteDaReferencia>;
  faces: Record<string, string[]>;
  situacoes: SituacaoDoDente[];
  regioes: { code: string; name: string; dentes: string[] }[];
  denticao: Denticao;
  /** De onde veio a dentição: guardada no odontograma, ou sugerida. */
  motivoDaDenticao: string;
  /** null = o banco ainda não tem a 0310 (só o desenho, sem marcas). */
  achados: Achado[] | null;
  rodadas: RodadaDoOdontograma[];
  pessoas: Record<string, string>;
};

/**
 * Tudo o que o odontograma de um cliente precisa, numa leva de consultas em
 * paralelo. A REFERÊNCIA (dentes, faces) é obrigatória: sem ela devolve
 * `null` e a tela diz que não carregou — nunca um desenho vazio. As MARCAS
 * são opcionais só na janela em que o banco ainda não recebeu a 0310
 * (CLAUDE.md §0b): a tela mostra o desenho e diz que o diagnóstico ainda não
 * está disponível naquele ambiente.
 */
export async function carregarOdontograma(
  clientId: string,
  nascimento: string | null
): Promise<DadosDoOdontograma | null> {
  const supabase = await createClient();
  const [dentesR, facesR, situacoesR, regioesR, regiaoDentesR, odontoR, achadosR, rodadasR] =
    await Promise.all([
      supabase.from("dental_teeth").select("code, name, dentition, tooth_group"),
      supabase.from("dental_tooth_faces").select("tooth_code, face_code"),
      supabase
        .from("dental_conditions")
        .select("code, name, applies_to, usage, symbol, is_active, sort_order"),
      supabase.from("dental_regions").select("code, name"),
      supabase.from("dental_region_teeth").select("region_code, tooth_code"),
      supabase.from("odontograms").select("dentition").eq("client_id", clientId).maybeSingle(),
      supabase
        .from("tooth_findings")
        .select(COLUNAS_DO_ACHADO)
        .eq("client_id", clientId)
        .order("created_at"),
      supabase
        .from("clinical_evaluations")
        .select("id, kind, seq, title, status, clinic_id, diagnosis_finalized_at, diagnosis_finalized_by, clinic:clinics ( name )")
        .eq("client_id", clientId)
        .order("opened_at", { ascending: false }),
    ]);

  if (dentesR.error || facesR.error || situacoesR.error || (dentesR.data ?? []).length === 0) {
    return null;
  }

  const nomes: Record<string, string> = {};
  const dentes: Record<string, DenteDaReferencia> = {};
  for (const d of dentesR.data ?? []) {
    nomes[d.code] = d.name;
    dentes[d.code] = { dentition: d.dentition, group: d.tooth_group };
  }
  const faces: Record<string, string[]> = {};
  for (const f of facesR.data ?? []) (faces[f.tooth_code] ??= []).push(f.face_code);
  const situacoes: SituacaoDoDente[] = (situacoesR.data ?? []).map((s) => ({
    code: s.code,
    name: s.name,
    appliesTo: s.applies_to,
    usage: s.usage,
    symbol: s.symbol,
    isActive: s.is_active,
    sortOrder: s.sort_order,
  }));
  const dentesDaRegiao = new Map<string, string[]>();
  for (const r of regiaoDentesR.data ?? []) {
    dentesDaRegiao.set(r.region_code, [...(dentesDaRegiao.get(r.region_code) ?? []), r.tooth_code]);
  }
  // 0312: o achado "a tratar" (vermelho). Leitura À PARTE: sem a 0312 a
  // coluna não existe e nada fica vermelho no diagnóstico (como antes).
  {
    const { data: tratar, error: tratarErro } = await supabase
      .from("dental_conditions")
      .select("code, needs_treatment")
      .returns<{ code: string; needs_treatment: boolean }[]>();
    if (!tratarErro) {
      const aTratar = new Set((tratar ?? []).filter((t) => t.needs_treatment).map((t) => t.code));
      for (const s of situacoes) s.aTratar = aTratar.has(s.code);
    }
  }

  // Todas as regiões. As de tecido (língua, palato…) vêm com `dentes` vazio:
  // não selecionam dente no diagnóstico, mas servem de lugar a procedimento
  // "de região" no plano (OD3).
  const regioes = (regioesR.data ?? [])
    .map((r) => ({ code: r.code, name: r.name.trim(), dentes: dentesDaRegiao.get(r.code) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Sem a 0310: a tabela das marcas não existe (as outras leituras deram certo).
  const sem0310 = Boolean(achadosR.error);
  const achados = sem0310 ? null : (achadosR.data ?? []).map(achadoDaLinha);

  const guardada = sem0310 ? null : denticaoDoBanco(odontoR.data?.dentition);
  const anos = anosCompletos(nascimento, todayInBrazil());
  const denticao = guardada ?? denticaoPelaIdade(anos);
  const motivoDaDenticao = guardada
    ? "Dentição registrada no odontograma do paciente."
    : anos === null
      ? "Sem data de nascimento na ficha: o desenho começa na dentição permanente."
      : `Dentição sugerida pela idade (${anos} ${anos === 1 ? "ano" : "anos"}).`;

  type LinhaDaRodada = {
    id: string;
    kind: EvaluationKind;
    seq: number;
    title: string | null;
    status: string;
    clinic_id: string;
    diagnosis_finalized_at: string | null;
    diagnosis_finalized_by: string | null;
    clinic: { name: string } | { name: string }[] | null;
  };
  const linhas = (rodadasR.error ? [] : (rodadasR.data ?? [])) as unknown as LinhaDaRodada[];

  const ids = new Set<string>();
  for (const a of achados ?? []) {
    if (a.criadoPor) ids.add(a.criadoPor);
    if (a.decididoPor) ids.add(a.decididoPor);
  }
  for (const r of linhas) if (r.diagnosis_finalized_by) ids.add(r.diagnosis_finalized_by);
  const pessoas: Record<string, string> = {};
  if (ids.size > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", [...ids]);
    for (const p of data ?? []) pessoas[p.id] = p.full_name;
  }

  const rodadas: RodadaDoOdontograma[] = linhas.map((r) => {
    const c = Array.isArray(r.clinic) ? r.clinic[0] : r.clinic;
    return {
      id: r.id,
      rotulo: evaluationLabel({ kind: r.kind, seq: r.seq, title: r.title }),
      clinicId: r.clinic_id,
      clinicName: c?.name ?? null,
      aberta: r.status === "open",
      finalizadoEm: r.diagnosis_finalized_at ?? null,
      finalizadoPor: r.diagnosis_finalized_by ? (pessoas[r.diagnosis_finalized_by] ?? null) : null,
    };
  });

  return { nomes, dentes, faces, situacoes, regioes, denticao, motivoDaDenticao, achados, rodadas, pessoas };
}

/**
 * OD4: o odontograma que a tela do CLIENTE (apresentação, aceite, orçamento)
 * desenha. Leva só o diagnóstico DEFINIDO — nada de sugestão pendente nem de
 * quem sugeriu. Nulo quando a referência ou as regras não carregaram: a tela
 * segue sem o desenho (a proposta continua de pé).
 */
export async function carregarOdontoDaApresentacao(
  clientId: string,
  nascimento: string | null
): Promise<OdontoDaApresentacao | null> {
  const [dados, regras] = await Promise.all([
    carregarOdontograma(clientId, nascimento),
    carregarRegrasDoPlano(),
  ]);
  if (!dados || !regras) return null;
  return {
    nomes: dados.nomes,
    faces: dados.faces,
    denticao: dados.denticao,
    motivoDaDenticao: dados.motivoDaDenticao,
    situacoes: dados.situacoes,
    regras,
    regioes: dados.regioes.map((r) => ({ code: r.code, name: r.name })),
    existentes: marcasDoDesenho(dados.achados ?? [], dados.situacoes, "definidos"),
  };
}

/**
 * As regras clínicas de TODOS os procedimentos (0308), para o plano por dente
 * (OD3). São 370 hoje — uma leitura só. Falhou: devolve nulo, e a tela de
 * lançar item avisa em vez de deixar lançar sem conferir.
 */
export async function carregarRegrasDoPlano(): Promise<Record<string, RegraDoPlano> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedure_dental_rules")
    .select(
      "procedure_id, application_level, face_count_min, face_count_max, fixed_faces, dentition, tooth_groups, blocked_conditions, required_conditions, effect_condition"
    );
  if (error) return null;
  const regras: Record<string, RegraDoPlano> = {};
  for (const r of data ?? []) regras[r.procedure_id] = regraDaLinha(r);
  return regras;
}
