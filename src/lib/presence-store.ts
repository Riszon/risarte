// Presença compartilhada no app: quem está "online" agora e quem está "ausente"
// (logado mas parado). O canal de Realtime Presence é gerenciado num único lugar
// (ChatNavItem, sempre montado) porque o client do Supabase é singleton — dois
// `channel("online-users")` colidiriam. Aqui fica só o mapa userId → status.

export type PresenceStatus = "online" | "away";

let presenceById = new Map<string, PresenceStatus>();
const listeners = new Set<(m: Map<string, PresenceStatus>) => void>();

export function getPresence(): Map<string, PresenceStatus> {
  return presenceById;
}

export function setPresence(map: Map<string, PresenceStatus>): void {
  presenceById = map;
  for (const l of listeners) l(presenceById);
}

export function subscribePresence(
  listener: (m: Map<string, PresenceStatus>) => void
): () => void {
  listeners.add(listener);
  listener(presenceById);
  return () => {
    listeners.delete(listener);
  };
}
