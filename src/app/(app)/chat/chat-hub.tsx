"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  MessageSquarePlus,
  Send,
  User,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getOnlineIds, subscribeOnline } from "@/lib/presence-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getChannelPeople,
  getChannelReads,
  getMessages,
  listChannels,
  markRead,
  openDirectChannel,
  sendMessage,
  type ChatChannel,
  type ChatColleague,
  type ChatMessage,
  type ChatPerson,
} from "./actions";

function Avatar({
  person,
  name,
  online,
  className,
}: {
  person?: ChatPerson;
  name: string;
  online?: boolean;
  className?: string;
}) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span className={cn("relative shrink-0", className)}>
      {person?.photoUrl ? (
        <span
          aria-label={name}
          className="block size-8 rounded-full bg-muted bg-cover bg-center"
          style={{ backgroundImage: `url(${person.photoUrl})` }}
        />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
          {initials}
        </span>
      )}
      {online && (
        <span
          aria-label="online"
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500"
        />
      )}
    </span>
  );
}

function personSub(p?: ChatPerson): string | null {
  if (!p) return null;
  const parts = [p.roleLabel, p.unitLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function lastSeenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `hoje às ${hm}`;
  const yst = new Date(now);
  yst.setDate(now.getDate() - 1);
  if (d.toDateString() === yst.toDateString()) return `ontem às ${hm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hm}`;
}

function playBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    /* som é bônus; ignora se o navegador bloquear */
  }
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatHub({
  meId,
  initialChannels,
  colleagues,
}: {
  meId: string;
  initialChannels: ChatChannel[];
  colleagues: ChatColleague[];
}) {
  const [channels, setChannels] = useState<ChatChannel[]>(initialChannels);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChannels[0]?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<Record<string, ChatPerson>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(getOnlineIds());
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedIdRef = useRef<string | null>(selectedId);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selected = useMemo(
    () => channels.find((c) => c.id === selectedId) ?? null,
    [channels, selectedId]
  );

  const refreshChannels = useCallback(async () => {
    setChannels(await listChannels());
  }, []);

  const loadThread = useCallback(async (channelId: string) => {
    const [msgs, reads, ppl] = await Promise.all([
      getMessages(channelId),
      getChannelReads(channelId),
      getChannelPeople(channelId),
    ]);
    setPeople(ppl);
    setMessages(msgs);
    setOtherReadAt(
      reads.length > 0
        ? reads.reduce((a, b) => (a > b.lastReadAt ? a : b.lastReadAt), "")
        : null
    );
    await markRead(channelId);
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c))
    );
  }, []);

  function openChannel(channelId: string) {
    setShowNew(false);
    setSelectedId(channelId);
  }

  // Carrega o thread quando muda o canal selecionado (inclui a 1ª carga). O
  // setState fica adiado (microtask) para não disparar dentro do effect.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const id = selectedId;
    Promise.resolve().then(() => {
      if (!cancelled) loadThread(id);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadThread]);

  // Rola para o fim quando as mensagens mudam.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Tempo real: nova mensagem no canal aberto atualiza o thread; nos demais,
  // toca o som + aviso e atualiza a lista.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("chat-hub")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m = payload.new as { channel_id: string; sender_id: string };
          if (m.channel_id === selectedIdRef.current) {
            loadThread(m.channel_id);
          } else {
            refreshChannels();
            if (m.sender_id !== meId) {
              playBeep();
              toast.message("Nova mensagem no Chat Hub");
            }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, loadThread, refreshChannels]);

  // Atualiza o "visto" do outro a cada 12s no canal aberto.
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(async () => {
      const reads = await getChannelReads(selectedId);
      setOtherReadAt(
        reads.length > 0
          ? reads.reduce((a, b) => (a > b.lastReadAt ? a : b.lastReadAt), "")
          : null
      );
    }, 12_000);
    return () => clearInterval(t);
  }, [selectedId]);

  // Presença "online agora" — lê do store compartilhado (o canal é gerenciado
  // pelo item do menu, sempre montado; evita colidir com o mesmo canal aqui).
  useEffect(() => subscribeOnline(setOnlineIds), []);

  function submit() {
    const text = input.trim();
    if (!text || !selectedId) return;
    setInput("");
    startTransition(async () => {
      const r = await sendMessage(selectedId, text);
      if (r.ok) {
        await loadThread(selectedId);
        refreshChannels();
      } else {
        toast.error(r.error ?? "Não foi possível enviar.");
        setInput(text);
      }
    });
  }

  function startDirect(userId: string) {
    startTransition(async () => {
      const r = await openDirectChannel(userId);
      if (r.ok && r.channelId) {
        await refreshChannels();
        openChannel(r.channelId);
      } else {
        toast.error(r.error ?? "Não foi possível abrir a conversa.");
      }
    });
  }

  // Numa conversa direta, o outro participante (para o cabeçalho).
  const headerPerson = useMemo(() => {
    if (!selected || selected.kind !== "direct") return undefined;
    return Object.values(people).find((p) => p.userId !== meId);
  }, [selected, people, meId]);

  // Recibos: "entregue" = alguém online ou visto depois; "lida" = leu depois.
  const otherSeenAt = useMemo(() => {
    let latest: string | null = null;
    for (const p of Object.values(people)) {
      if (p.userId === meId) continue;
      if (p.lastSeenAt && (!latest || p.lastSeenAt > latest)) latest = p.lastSeenAt;
    }
    return latest;
  }, [people, meId]);
  const anyOtherOnline = useMemo(
    () =>
      Object.values(people).some(
        (p) => p.userId !== meId && onlineIds.has(p.userId)
      ),
    [people, onlineIds, meId]
  );
  function receiptFor(createdAt: string): "sent" | "delivered" | "read" {
    if (otherReadAt && otherReadAt >= createdAt) return "read";
    if (anyOtherOnline || (otherSeenAt && otherSeenAt >= createdAt)) {
      return "delivered";
    }
    return "sent";
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[26rem] overflow-hidden rounded-xl border bg-card">
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full flex-col border-r sm:flex sm:w-72",
          selectedId ? "hidden sm:flex" : "flex"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b p-2">
          <span className="text-sm font-medium">Conversas</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setShowNew((v) => !v)}
          >
            <MessageSquarePlus className="mr-1 size-3.5" />
            Nova
          </Button>
        </div>

        {showNew && (
          <div className="max-h-56 overflow-y-auto border-b bg-muted/30 p-1.5">
            <p className="px-1 pb-1 text-[11px] text-muted-foreground">
              Iniciar conversa com:
            </p>
            {colleagues.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">
                Nenhum colega disponível.
              </p>
            ) : (
              colleagues.map((c) => (
                <button
                  key={c.userId}
                  type="button"
                  disabled={isPending}
                  onClick={() => startDirect(c.userId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <User className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.hint && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {c.hint}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {channels.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma conversa ainda.
            </p>
          ) : (
            channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openChannel(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2 text-left hover:bg-accent",
                  selectedId === c.id && "bg-accent"
                )}
              >
                {c.kind === "unit" ? (
                  <Users className="size-4 shrink-0 text-primary" />
                ) : (
                  <User className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.title}
                    </span>
                    {c.unread > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-medium text-gold-foreground">
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </span>
                  {c.lastMessage && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.lastMessage}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Thread */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedId ? "flex" : "hidden sm:flex"
        )}
      >
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b p-2.5">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 sm:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft className="size-4" />
              </Button>
              {selected.kind === "unit" ? (
                <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10">
                    <Users className="size-4 text-primary" />
                  </span>
                  <span className="font-medium">{selected.title}</span>
                </>
              ) : (
                <>
                  <Avatar
                    person={headerPerson}
                    name={headerPerson?.name ?? selected.title}
                    online={
                      headerPerson ? onlineIds.has(headerPerson.userId) : false
                    }
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {headerPerson?.name ?? selected.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {headerPerson && onlineIds.has(headerPerson.userId) ? (
                        <span className="font-medium text-emerald-600">
                          online agora
                        </span>
                      ) : headerPerson?.lastSeenAt ? (
                        `visto por último ${lastSeenLabel(headerPerson.lastSeenAt)}`
                      ) : (
                        (personSub(headerPerson) ?? "")
                      )}
                      {personSub(headerPerson) &&
                        (headerPerson && onlineIds.has(headerPerson.userId)
                          ? ` · ${personSub(headerPerson)}`
                          : headerPerson?.lastSeenAt
                            ? ` · ${personSub(headerPerson)}`
                            : "")}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
              {messages.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Escreva a primeira.
                </p>
              ) : (
                messages.map((m) => {
                  const p = people[m.senderId];
                  const label = m.mine ? "Você" : (p?.name ?? m.senderName);
                  const sub = personSub(p);
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-end gap-2",
                        m.mine ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      <Avatar
                        person={p}
                        name={label}
                        online={onlineIds.has(m.senderId)}
                      />
                      <div
                        className={cn(
                          "flex min-w-0 max-w-[80%] flex-col",
                          m.mine ? "items-end" : "items-start"
                        )}
                      >
                        <span className="px-1 text-[11px] leading-tight text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {label}
                          </span>
                          {sub && ` · ${sub}`}
                        </span>
                        <div
                          className={cn(
                            "rounded-2xl px-3 py-1.5 text-sm",
                            m.mine
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <span className="whitespace-pre-wrap break-words">
                            {m.body}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 px-1 pt-0.5 text-[10px] text-muted-foreground">
                          {time(m.createdAt)}
                          {m.mine &&
                            (() => {
                              const r = receiptFor(m.createdAt);
                              if (r === "read") {
                                return (
                                  <span className="flex items-center gap-0.5 text-sky-500">
                                    <CheckCheck className="size-3" /> Lida
                                  </span>
                                );
                              }
                              if (r === "delivered") {
                                return (
                                  <span className="flex items-center gap-0.5">
                                    <CheckCheck className="size-3" /> Entregue
                                  </span>
                                );
                              }
                              return (
                                <span className="flex items-center gap-0.5">
                                  <Check className="size-3" /> Enviada
                                </span>
                              );
                            })()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="flex items-center gap-2 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escreva uma mensagem..."
                autoComplete="off"
              />
              <Button type="submit" size="icon" disabled={isPending || !input.trim()}>
                <Send className="size-4" />
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Escolha uma conversa à esquerda.
          </div>
        )}
      </section>
    </div>
  );
}
