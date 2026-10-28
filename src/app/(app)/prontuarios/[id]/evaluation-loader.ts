import "server-only";
import { createClient } from "@/lib/supabase/server";
import { rodadasFinalizadas } from "@/lib/odontograma/rodadas-trancadas";
import {
  CLINICAL_BUCKET,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
  type ClinicalNoteItem,
  type ConsentInfo,
  type EvaluationRound,
} from "@/lib/clinical";

export type EvaluationWorkspace = {
  consent: ConsentInfo | null;
  notes: ClinicalNoteItem[];
  media: ClinicalMediaItem[];
  evaluations: EvaluationRound[];
};

/**
 * Carrega o "espaço de avaliação" de um cliente: consentimento, considerações,
 * mídias (com URL assinada) e as rodadas de avaliação/reavaliação (Fase 3).
 * Usado pelo cockpit do Coordenador (Fase 4). Carrega por client_id (a RLS
 * cuida do escopo), incluindo dados de unidades do histórico do cliente.
 */
export async function loadEvaluationWorkspace(
  clientId: string
): Promise<EvaluationWorkspace> {
  const supabase = await createClient();

  const [{ data: consentRows }, { data: noteRows }, { data: mediaRows }] =
    await Promise.all([
      supabase
        .from("client_consents")
        .select("granted_at, recorded_by")
        .eq("client_id", clientId)
        .is("revoked_at", null)
        .order("granted_at", { ascending: false })
        .limit(1),
      supabase
        .from("clinical_notes")
        .select(
          "id, body, created_at, created_by, updated_at, updated_by, evaluation_id, clinic:clinics ( name )"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("clinical_media")
        .select(
          "id, kind, original_name, display_name, note, storage_path, external_url, content_type, size_bytes, created_at, uploaded_by, evaluation_id"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
    ]);

  const [{ data: evalRows }, finalizadas] = await Promise.all([
    supabase
      .from("clinical_evaluations")
      .select(
        "id, kind, seq, status, title, opened_at, closed_at, opened_by, ortho_indicated, ortho_indication_note, ortho_indicated_by, ortho_indicated_at, clinic:clinics ( name )"
      )
      .eq("client_id", clientId)
      .order("opened_at", { ascending: false }),
    rodadasFinalizadas(clientId),
  ]);
  const trancada = (id: string | null | undefined) => Boolean(id && finalizadas.has(id));

  const peopleIds = [
    ...new Set(
      [
        consentRows?.[0]?.recorded_by,
        ...(noteRows ?? []).map((n) => n.created_by),
        ...(noteRows ?? []).map((n) => n.updated_by),
        ...(mediaRows ?? []).map((m) => m.uploaded_by),
        ...(evalRows ?? []).map((e) => e.opened_by),
        ...(evalRows ?? []).map((e) => (e as { ortho_indicated_by?: string | null }).ortho_indicated_by),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const nameById = new Map<string, string>();
  if (peopleIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", peopleIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name);
  }

  const consent: ConsentInfo | null = consentRows?.[0]
    ? {
        grantedAt: consentRows[0].granted_at as string,
        recordedByName: consentRows[0].recorded_by
          ? (nameById.get(consentRows[0].recorded_by) ?? null)
          : null,
      }
    : null;

  const notes: ClinicalNoteItem[] = (noteRows ?? []).map((n) => {
    const cRaw = (
      n as { clinic?: { name: string } | { name: string }[] | null }
    ).clinic;
    return {
      id: n.id as string,
      body: n.body as string,
      createdAt: n.created_at as string,
      authorName: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
      updatedAt: (n.updated_at as string | null) ?? null,
      editedByName: n.updated_by ? (nameById.get(n.updated_by) ?? null) : null,
      clinicName: (Array.isArray(cRaw) ? cRaw[0] : cRaw)?.name ?? null,
      evaluationId:
        (n as { evaluation_id?: string | null }).evaluation_id ?? null,
      locked: trancada((n as { evaluation_id?: string | null }).evaluation_id),
    };
  });

  const media: ClinicalMediaItem[] = await Promise.all(
    (mediaRows ?? []).map(async (m) => {
      let url: string | null = null;
      if (m.storage_path) {
        const { data: signed } = await supabase.storage
          .from(CLINICAL_BUCKET)
          .createSignedUrl(m.storage_path, 3600);
        url = signed?.signedUrl ?? null;
      }
      return {
        id: m.id as string,
        kind: m.kind as ClinicalMediaKind,
        originalName: m.original_name as string | null,
        displayName:
          (m as { display_name?: string | null }).display_name ?? null,
        note: (m as { note?: string | null }).note ?? null,
        url,
        externalUrl: (m.external_url as string | null) ?? null,
        contentType: (m.content_type as string | null) ?? null,
        createdAt: m.created_at as string,
        uploaderName: m.uploaded_by
          ? (nameById.get(m.uploaded_by) ?? null)
          : null,
        sizeBytes: (m.size_bytes as number | null) ?? null,
        evaluationId:
          (m as { evaluation_id?: string | null }).evaluation_id ?? null,
        locked: trancada((m as { evaluation_id?: string | null }).evaluation_id),
      };
    })
  );

  const evaluations: EvaluationRound[] = (evalRows ?? []).map((e) => {
    const cRaw = (
      e as { clinic?: { name: string } | { name: string }[] | null }
    ).clinic;
    return {
      id: e.id as string,
      kind: e.kind as EvaluationRound["kind"],
      seq: e.seq as number,
      status: e.status as "open" | "closed",
      title: (e.title as string | null) ?? null,
      openedAt: e.opened_at as string,
      closedAt: (e.closed_at as string | null) ?? null,
      openedByName: e.opened_by ? (nameById.get(e.opened_by) ?? null) : null,
      clinicName: (Array.isArray(cRaw) ? cRaw[0] : cRaw)?.name ?? null,
      diagnosisFinalizedAt: finalizadas.get(e.id as string) ?? null,
      // ORTO7 (0333): a indicação de ortodontia do Coordenador nesta rodada.
      orthoIndicated: (e as { ortho_indicated?: boolean | null }).ortho_indicated === true,
      orthoIndicationNote: (e as { ortho_indication_note?: string | null }).ortho_indication_note ?? null,
      orthoIndicatedAt: (e as { ortho_indicated_at?: string | null }).ortho_indicated_at ?? null,
      orthoIndicatedByName: (() => {
        const by = (e as { ortho_indicated_by?: string | null }).ortho_indicated_by;
        return by ? (nameById.get(by) ?? null) : null;
      })(),
    };
  });

  return { consent, notes, media, evaluations };
}
