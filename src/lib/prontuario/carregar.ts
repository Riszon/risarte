import "server-only";
import { createClient } from "@/lib/supabase/server";
import { evaluationLabel, type EvaluationKind } from "@/lib/clinical";
import type { DadosDoOdontograma } from "@/lib/odontograma/carregar";
import { descricaoDoAchado, marcasAtuais } from "@/lib/odontograma/diagnostico";
import { MOTIVOS_DO_PRONTUARIO, type EventoClinico, type MotivoDoProntuario } from "@/lib/prontuario/linha-do-tempo";

const ROTULO_DO_DOCUMENTO: Record<string, string> = {
  prescription: "Receita",
  certificate: "Atestado",
  declaration: "Declaração",
  guidance: "Orientação",
};

/**
 * OD6 (J2): a linha do tempo clínica do cliente, lida das tabelas que já
 * existem — cada uma pela regra de leitura de quem pede (RLS). Leitura que
 * falha deixa aquele assunto de fora (a lista é o que a pessoa pode ver).
 */
export async function carregarLinhaDoTempo(
  clientId: string,
  odonto: DadosDoOdontograma | null
): Promise<EventoClinico[]> {
  const supabase = await createClient();
  const [cons, anam, rodadas, planos, saidas, notas, docs, exportes] = await Promise.all([
    supabase.from("client_consents").select("granted_at, revoked_at, recorded_by").eq("client_id", clientId),
    supabase.from("anamnesis_fills").select("filled_at, template_name, filled_by, no_changes").eq("client_id", clientId),
    supabase
      .from("clinical_evaluations")
      .select("kind, seq, title, opened_at, opened_by, diagnosis_finalized_at, diagnosis_finalized_by")
      .eq("client_id", clientId),
    supabase.from("treatment_plans").select("id, version_no").eq("client_id", clientId),
    supabase
      .from("attendance_session_outcomes")
      .select("label, done, unplanned, reason, recorded_at, recorded_by")
      .eq("client_id", clientId),
    supabase.from("clinical_progress_notes").select("id, created_at, author_id").eq("client_id", clientId),
    supabase.from("clinical_documents").select("kind, title, created_at, author_id").eq("client_id", clientId),
    supabase.from("clinical_record_exports").select("reason_code, created_at, requested_by").eq("client_id", clientId),
  ]);

  // O adendo (0315) é lido à parte: sem a migração, toda anotação é evolução.
  const adendos = new Set<string>();
  {
    const { data, error } = await supabase
      .from("clinical_progress_notes")
      .select("id")
      .eq("client_id", clientId)
      .not("addendum_of", "is", null);
    if (!error) for (const a of data ?? []) adendos.add(a.id as string);
  }

  const idsDosPlanos = (planos.data ?? []).map((p) => p.id as string);
  const versao = new Map((planos.data ?? []).map((p) => [p.id as string, p.version_no as number | null]));
  const eventosDosPlanos = idsDosPlanos.length
    ? await supabase
        .from("treatment_plan_events")
        .select("plan_id, event_type, description, actor_id, created_at")
        .in("plan_id", idsDosPlanos)
    : { data: [] as { plan_id: string; event_type: string; description: string | null; actor_id: string | null; created_at: string }[] };

  // Os nomes de quem fez (uma leitura só).
  const ids = new Set<string>();
  const junta = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  for (const r of cons.data ?? []) junta(r.recorded_by);
  for (const r of anam.data ?? []) junta(r.filled_by);
  for (const r of rodadas.data ?? []) {
    junta(r.opened_by);
    junta(r.diagnosis_finalized_by);
  }
  for (const r of saidas.data ?? []) junta(r.recorded_by);
  for (const r of notas.data ?? []) junta(r.author_id);
  for (const r of docs.data ?? []) junta(r.author_id);
  for (const r of exportes.data ?? []) junta(r.requested_by);
  for (const r of eventosDosPlanos.data ?? []) junta(r.actor_id);
  const nomes = new Map<string, string>(Object.entries(odonto?.pessoas ?? {}));
  const faltam = [...ids].filter((i) => !nomes.has(i));
  if (faltam.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", faltam);
    for (const p of data ?? []) nomes.set(p.id as string, p.full_name as string);
  }
  const quem = (id: unknown) => (typeof id === "string" ? (nomes.get(id) ?? null) : null);

  const ev: EventoClinico[] = [];
  for (const c of cons.data ?? []) {
    ev.push({ quando: c.granted_at as string, tipo: "consentimento", titulo: "Consentimento registrado", quem: quem(c.recorded_by) });
    if (c.revoked_at) ev.push({ quando: c.revoked_at as string, tipo: "consentimento", titulo: "Consentimento revogado" });
  }
  for (const a of anam.data ?? []) {
    ev.push({
      quando: a.filled_at as string,
      tipo: "anamnese",
      titulo: `Anamnese preenchida${a.template_name ? ` — ${a.template_name}` : ""}`,
      detalhe: a.no_changes ? "sem alterações" : null,
      quem: quem(a.filled_by),
    });
  }
  for (const r of rodadas.data ?? []) {
    const rotulo = evaluationLabel({ kind: r.kind as EvaluationKind, seq: r.seq as number, title: r.title as string | null });
    ev.push({ quando: r.opened_at as string, tipo: "avaliacao", titulo: `${rotulo} aberta`, quem: quem(r.opened_by) });
    if (r.diagnosis_finalized_at) {
      ev.push({
        quando: r.diagnosis_finalized_at as string,
        tipo: "diagnostico",
        titulo: `Diagnóstico finalizado — ${rotulo}`,
        quem: quem(r.diagnosis_finalized_by),
      });
    }
  }
  if (odonto?.achados) {
    const nomeDaSituacao = new Map(odonto.situacoes.map((s) => [s.code, s.name]));
    const valendo = new Set(marcasAtuais(odonto.achados).map((a) => a.id));
    for (const a of odonto.achados) {
      if (a.status !== "defined" || !a.decididoEm) continue;
      ev.push({
        quando: a.decididoEm,
        tipo: "achado",
        titulo: `${a.acao === "remove" ? "Retirado" : "Definido"} no odontograma: ${descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}`,
        detalhe: a.acao === "mark" && !valendo.has(a.id) ? "depois retirado" : a.adendo ? `adendo: ${a.motivoDoAdendo ?? ""}` : null,
        quem: quem(a.decididoPor),
      });
    }
  }
  for (const p of eventosDosPlanos.data ?? []) {
    const v = versao.get(p.plan_id);
    ev.push({
      quando: p.created_at,
      tipo: "plano",
      titulo: (p.description as string | null) ?? p.event_type,
      detalhe: v ? `plano versão ${v}` : null,
      quem: quem(p.actor_id),
    });
  }
  for (const s of saidas.data ?? []) {
    ev.push({
      quando: s.recorded_at as string,
      tipo: "sessao",
      titulo: `${s.done ? "Sessão feita" : "Sessão não realizada"}: ${s.label as string}`,
      detalhe: [s.unplanned ? "fora do programado" : null, s.reason as string | null].filter(Boolean).join(" · ") || null,
      quem: quem(s.recorded_by),
    });
  }
  for (const n of notas.data ?? []) {
    const ehAdendo = adendos.has(n.id as string);
    ev.push({
      quando: n.created_at as string,
      tipo: ehAdendo ? "adendo" : "evolucao",
      titulo: ehAdendo ? "Adendo à evolução clínica" : "Evolução clínica registrada",
      quem: quem(n.author_id),
    });
  }
  for (const d of docs.data ?? []) {
    ev.push({
      quando: d.created_at as string,
      tipo: "documento",
      titulo: `${ROTULO_DO_DOCUMENTO[d.kind as string] ?? "Documento"} emitido: ${d.title as string}`,
      quem: quem(d.author_id),
    });
  }
  for (const x of exportes.data ?? []) {
    ev.push({
      quando: x.created_at as string,
      tipo: "prontuario",
      titulo: "Prontuário completo gerado",
      detalhe: MOTIVOS_DO_PRONTUARIO[x.reason_code as MotivoDoProntuario] ?? null,
      quem: quem(x.requested_by),
    });
  }
  return ev;
}
