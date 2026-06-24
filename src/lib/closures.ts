// Agenda closures (G4): blocking a period for personal commitments, events,
// maintenance or training, scoped to the whole unit / specific rooms / providers.

export const CLOSURE_REASONS = [
  "personal",
  "event",
  "maintenance",
  "training",
  "other",
] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  personal: "Compromisso pessoal",
  event: "Evento",
  maintenance: "Manutenção",
  training: "Treinamento",
  other: "Outro",
};

export const CLOSURE_SCOPES = ["unit", "rooms", "providers"] as const;
export type ClosureScope = (typeof CLOSURE_SCOPES)[number];

export const CLOSURE_SCOPE_LABELS: Record<ClosureScope, string> = {
  unit: "Unidade toda",
  rooms: "Salas específicas",
  providers: "Profissionais específicos",
};

export type AgendaClosure = {
  id: string;
  startsAt: string;
  endsAt: string;
  scope: ClosureScope;
  reason: ClosureReason;
  note: string | null;
  roomIds: string[];
  providerIds: string[];
};

export type AgendaClosureRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  scope: ClosureScope;
  reason: ClosureReason;
  note: string | null;
  agenda_closure_rooms: { room_id: string }[] | null;
  agenda_closure_providers: { user_id: string }[] | null;
};

export function mapClosure(row: AgendaClosureRow): AgendaClosure {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scope: row.scope,
    reason: row.reason,
    note: row.note,
    roomIds: (row.agenda_closure_rooms ?? []).map((r) => r.room_id),
    providerIds: (row.agenda_closure_providers ?? []).map((p) => p.user_id),
  };
}

/** Does the closure block the given room/provider at the given time range? */
export function closureBlocks(
  closure: AgendaClosure,
  params: { startMs: number; endMs: number; roomId: string | null; providerId: string | null }
): boolean {
  const cs = new Date(closure.startsAt).getTime();
  const ce = new Date(closure.endsAt).getTime();
  if (!(params.startMs < ce && params.endMs > cs)) return false; // no overlap
  if (closure.scope === "unit") return true;
  if (closure.scope === "rooms") {
    return params.roomId != null && closure.roomIds.includes(params.roomId);
  }
  return params.providerId != null && closure.providerIds.includes(params.providerId);
}
