// Per-unit attendance rooms (G1): the named chairs/rooms of a unit. Replaces the
// old "number of chairs" count — each room is a row so the agenda can be viewed
// per room, scheduled into a room and closed per room (G2–G6).

export type RoomRow = {
  id: string;
  clinic_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type Room = {
  id: string;
  clinicId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export function mapRoom(r: RoomRow): Room {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  };
}

/** Sort by sort_order, then name (stable, case-insensitive). */
export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  );
}
