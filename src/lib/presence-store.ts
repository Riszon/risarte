// Presença "online agora" compartilhada no app. O canal de Realtime Presence é
// gerenciado num único lugar (ChatNavItem, sempre montado) porque o client do
// Supabase no navegador é singleton — dois `channel("online-users")` colidem.
// Aqui fica só o conjunto de ids online + assinatura para os demais lerem.

type Listener = (ids: Set<string>) => void;

let onlineIds = new Set<string>();
const listeners = new Set<Listener>();

export function getOnlineIds(): Set<string> {
  return onlineIds;
}

export function setOnlineIds(ids: Set<string>): void {
  onlineIds = ids;
  for (const l of listeners) l(onlineIds);
}

export function subscribeOnline(listener: Listener): () => void {
  listeners.add(listener);
  listener(onlineIds);
  return () => {
    listeners.delete(listener);
  };
}
