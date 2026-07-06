// Per-unit attendance rooms (G1): the named chairs/rooms of a unit. Replaces the
// old "number of chairs" count — each room is a row so the agenda can be viewed
// per room, scheduled into a room and closed per room (G2–G6).

export type RoomRow = {
  id: string;
  clinic_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** Ajuste #1: preenchido quando a cadeira foi EXCLUÍDA (soft delete). */
  deleted_at?: string | null;
};

export type Room = {
  id: string;
  clinicId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** ISO da exclusão; null = cadeira viva. */
  deletedAt: string | null;
};

export function mapRoom(r: RoomRow): Room {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    deletedAt: r.deleted_at ?? null,
  };
}

/**
 * Ajuste #1: rótulo da cadeira para exibir num agendamento — marca "(excluída)"
 * quando a sala foi excluída (soft delete), preservando o histórico.
 */
export function roomLabel(
  room?: { name: string | null; deleted_at?: string | null } | null
): string | null {
  if (!room?.name) return null;
  return room.deleted_at ? `${room.name} (excluída)` : room.name;
}

/** Sort by sort_order, then name (stable, case-insensitive). */
export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  );
}
