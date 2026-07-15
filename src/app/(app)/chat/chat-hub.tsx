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
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  FileText,
  Loader2,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  User,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getPresence,
  subscribePresence,
  type PresenceStatus,
} from "@/lib/presence-store";
import {
  CHAT_BUCKET,
  CHAT_MAX_BYTES,
  attachmentKindFor,
} from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  broadcastToUnitMembers,
  getChannelPeople,
  getChannelReads,
  getImportantUnread,
  getLastSeen,
  getMessages,
  listChannels,
  listReachableUnits,
  markRead,
  openDirectChannel,
  openUnitChannel,
  sendAttachment,
  sendMessage,
  toggleReaction,
  type ChatChannel,
  type ChatColleague,
  type ChatMessage,
  type ChatPerson,
} from "./actions";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "✅", "🔥"];

function statusColor(s: PresenceStatus | undefined): string | null {
  if (s === "online") return "bg-emerald-500";
  if (s === "away") return "bg-amber-500";
  return null;
}

function Avatar({
  person,
  name,
  status,
  className,
}: {
  person?: ChatPerson;
  name: string;
  status?: PresenceStatus;
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
  const dot = statusColor(status);
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
      {dot && (
        <span
          aria-label={status}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
            dot
          )}
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
  isAdmin,
  totalUsers,
  canMessageUnits,
}: {
  meId: string;
  initialChannels: ChatChannel[];
  colleagues: ChatColleague[];
  isAdmin: boolean;
  totalUsers: number;
  canMessageUnits: boolean;
}) {
  const [channels, setChannels] = useState<ChatChannel[]>(initialChannels);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChannels[0]?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<Record<string, ChatPerson>>({});
  const [presence, setPresenceState] = useState<Map<string, PresenceStatus>>(
    getPresence()
  );
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [important, setImportant] = useState(false);
  const [importantUnread, setImportantUnread] = useState<
    { channelId: string; count: number; lastAt: string }[]
  >([]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newSearch, setNewSearch] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  // R4: envio para unidade específica (Admin/franqueadora).
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [unitsLoaded, setUnitsLoaded] = useState(false);
  const [broadcastFor, setBroadcastFor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [broadcastText, setBroadcastText] = useState("");
  // Lote 2: anexos (arquivo/áudio).
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("audio/webm");
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    // Abrir a conversa marca como lida → some da insistência de importantes.
    setImportantUnread(await getImportantUnread());
  }, []);

  function openChannel(channelId: string) {
    setShowNew(false);
    setSelectedId(channelId);
  }

  // Presença compartilhada (o menu gerencia o canal; aqui só lemos).
  useEffect(() => subscribePresence(setPresenceState), []);

  // Carga inicial das mensagens importantes não lidas (faixa fixa).
  useEffect(() => {
    getImportantUnread().then(setImportantUnread);
  }, []);

  // Carrega o thread quando muda o canal (inclui a 1ª carga).
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Tempo real: nova mensagem no canal aberto atualiza; nos demais, aviso.
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
            getImportantUnread().then(setImportantUnread);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reads" },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            channel_id?: string;
          } | null;
          const ch = row?.channel_id;
          if (ch && ch === selectedIdRef.current) {
            getChannelReads(ch).then((reads) =>
              setOtherReadAt(
                reads.length > 0
                  ? reads.reduce(
                      (a, b) => (a > b.lastReadAt ? a : b.lastReadAt),
                      ""
                    )
                  : null
              )
            );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
        () => {
          if (selectedIdRef.current) loadThread(selectedIdRef.current);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId, loadThread, refreshChannels]);

  // Atualiza leitura do outro + "visto por último" a cada 12s no canal aberto.
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(async () => {
      const [reads, seen] = await Promise.all([
        getChannelReads(selectedId),
        getLastSeen(Object.keys(people)),
      ]);
      setOtherReadAt(
        reads.length > 0
          ? reads.reduce((a, b) => (a > b.lastReadAt ? a : b.lastReadAt), "")
          : null
      );
      if (Object.keys(seen).length > 0) {
        setPeople((prev) => {
          const next: Record<string, ChatPerson> = {};
          for (const [id, p] of Object.entries(prev)) {
            next[id] = seen[id] ? { ...p, lastSeenAt: seen[id] } : p;
          }
          return next;
        });
      }
    }, 12_000);
    return () => clearInterval(t);
  }, [selectedId, people]);

  function submit() {
    const text = input.trim();
    if (!text || !selectedId) return;
    const replyId = replyingTo?.id;
    const imp = important;
    setInput("");
    setReplyingTo(null);
    setImportant(false);
    startTransition(async () => {
      const r = await sendMessage(selectedId, text, replyId, imp);
      if (r.ok) {
        await loadThread(selectedId);
        refreshChannels();
      } else {
        toast.error(r.error ?? "Não foi possível enviar.");
        setInput(text);
        setImportant(imp);
      }
    });
  }

  function react(messageId: string, emoji: string) {
    setReactingId(null);
    startTransition(async () => {
      await toggleReaction(messageId, emoji);
      if (selectedId) loadThread(selectedId);
    });
  }

  // --- Lote 2: anexos -------------------------------------------------------
  async function uploadAndSend(file: Blob, name: string, type: string) {
    if (!selectedId) return;
    if (file.size === 0) {
      toast.error("Arquivo vazio.");
      return;
    }
    if (file.size > CHAT_MAX_BYTES) {
      toast.error("Arquivo muito grande (máximo 25 MB).");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const safe = (name.replace(/[^\w.\-]+/g, "_") || "arquivo").slice(-80);
    const path = `${selectedId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(path, file, { contentType: type });
    if (error) {
      setUploading(false);
      toast.error("Falha ao enviar o arquivo.");
      return;
    }
    const r = await sendAttachment(selectedId, {
      path,
      name,
      type,
      kind: attachmentKindFor(type),
    });
    if (r.ok) {
      await loadThread(selectedId);
      refreshChannels();
    } else {
      toast.error(r.error ?? "Não foi possível enviar.");
      await supabase.storage.from(CHAT_BUCKET).remove([path]);
    }
    setUploading(false);
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) uploadAndSend(f, f.name, f.type || "application/octet-stream");
  }

  function pickAudioMime(): string {
    if (typeof MediaRecorder === "undefined") return "audio/webm";
    for (const c of [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
    ]) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return "audio/webm";
  }

  async function startRecording() {
    if (
      !selectedId ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      toast.error("Seu navegador não permite gravar áudio aqui.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        const ext = mimeRef.current.includes("mp4")
          ? "m4a"
          : mimeRef.current.includes("ogg")
            ? "ogg"
            : "webm";
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, "-");
        uploadAndSend(blob, `audio-${stamp}.${ext}`, mimeRef.current);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
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

  // R4: carrega as unidades alcançáveis quando o painel "Nova" abre.
  useEffect(() => {
    if (showNew && canMessageUnits && !unitsLoaded) {
      listReachableUnits().then((u) => {
        setUnits(u);
        setUnitsLoaded(true);
      });
    }
  }, [showNew, canMessageUnits, unitsLoaded]);

  function openUnit(clinicId: string) {
    startTransition(async () => {
      const r = await openUnitChannel(clinicId);
      if (r.ok && r.channelId) {
        await refreshChannels();
        openChannel(r.channelId);
        setShowNew(false);
      } else {
        toast.error(r.error ?? "Não foi possível abrir o chat da equipe.");
      }
    });
  }

  function sendBroadcast() {
    if (!broadcastFor) return;
    const text = broadcastText.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await broadcastToUnitMembers(broadcastFor.id, text);
      if (r.ok) {
        toast.success(
          `Mensagem enviada individualmente a ${r.sent ?? 0} membro(s).`
        );
        setBroadcastFor(null);
        setBroadcastText("");
        setShowNew(false);
        refreshChannels();
      } else {
        toast.error(r.error ?? "Não foi possível enviar.");
      }
    });
  }

  const headerPerson = useMemo(() => {
    if (!selected || selected.kind !== "direct") return undefined;
    return Object.values(people).find((p) => p.userId !== meId);
  }, [selected, people, meId]);

  // Recibos: comparação por DATA (timestamps têm formatos diferentes como texto).
  const otherSeenAt = useMemo(() => {
    let latest = 0;
    for (const p of Object.values(people)) {
      if (p.userId === meId || !p.lastSeenAt) continue;
      latest = Math.max(latest, new Date(p.lastSeenAt).getTime());
    }
    return latest;
  }, [people, meId]);
  const anyOtherConnected = useMemo(
    () =>
      Object.values(people).some(
        (p) => p.userId !== meId && presence.has(p.userId)
      ),
    [people, presence, meId]
  );
  const otherReadMs = otherReadAt ? new Date(otherReadAt).getTime() : 0;
  function receiptFor(createdAt: string): "sent" | "delivered" | "read" {
    const t = new Date(createdAt).getTime();
    if (otherReadMs >= t && otherReadMs > 0) return "read";
    if (anyOtherConnected || otherSeenAt >= t) return "delivered";
    return "sent";
  }

  // Contagem do Admin.
  const onlineCount = useMemo(
    () => [...presence.values()].filter((s) => s === "online").length,
    [presence]
  );
  const awayCount = useMemo(
    () => [...presence.values()].filter((s) => s === "away").length,
    [presence]
  );

  const visibleChannels = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.lastMessage ?? "").toLowerCase().includes(q)
    );
  }, [channels, listSearch]);

  const visibleColleagues = useMemo(() => {
    const q = newSearch.trim().toLowerCase();
    if (!q) return colleagues;
    return colleagues.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.hint ?? "").toLowerCase().includes(q)
    );
  }, [colleagues, newSearch]);

  const visibleUnits = useMemo(() => {
    const q = newSearch.trim().toLowerCase();
    return q ? units.filter((u) => u.name.toLowerCase().includes(q)) : units;
  }, [units, newSearch]);

  const teamMembers = useMemo(
    () =>
      Object.values(people).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [people]
  );

  // Lote 3: mensagens importantes não lidas → faixa fixa + marcador na lista.
  const importantByChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of importantUnread) m.set(r.channelId, r.count);
    return m;
  }, [importantUnread]);
  const importantTotal = useMemo(
    () => importantUnread.reduce((a, r) => a + r.count, 0),
    [importantUnread]
  );
  const importantJumpTo = useMemo(() => {
    let best: { channelId: string; lastAt: string } | null = null;
    for (const r of importantUnread) {
      if (!best || new Date(r.lastAt).getTime() > new Date(best.lastAt).getTime()) {
        best = { channelId: r.channelId, lastAt: r.lastAt };
      }
    }
    return best?.channelId ?? null;
  }, [importantUnread]);

  return (
    <div className="space-y-2">
      {importantTotal > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Você tem <b>{importantTotal}</b>{" "}
            {importantTotal === 1
              ? "mensagem importante não lida"
              : "mensagens importantes não lidas"}
            .
          </span>
          {importantJumpTo && (
            <Button
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => openChannel(importantJumpTo)}
            >
              Ver
            </Button>
          )}
        </div>
      )}
      <div className="flex h-[calc(100vh-13rem)] min-h-[26rem] overflow-hidden rounded-xl border bg-card">
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

        {isAdmin && (
          <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="text-emerald-600">● {onlineCount} online</span>
            {" · "}
            <span className="text-amber-600">{awayCount} ausentes</span>
            {" · "}
            {Math.max(0, totalUsers - presence.size)} offline
          </div>
        )}

        {showNew && (
          <div className="max-h-64 overflow-y-auto border-b bg-muted/30 p-1.5">
            <div className="relative mb-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={newSearch}
                onChange={(e) => setNewSearch(e.target.value)}
                placeholder="Buscar pessoa ou unidade..."
                className="h-8 pl-7 text-sm"
              />
            </div>
            {visibleColleagues.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">
                Nenhum colega encontrado.
              </p>
            ) : (
              visibleColleagues.map((c) => (
                <button
                  key={c.userId}
                  type="button"
                  disabled={isPending}
                  onClick={() => startDirect(c.userId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className="relative">
                    <User className="size-4 shrink-0 text-muted-foreground" />
                    {statusColor(presence.get(c.userId)) && (
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-card",
                          statusColor(presence.get(c.userId))
                        )}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.hint && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {c.hint}
                    </span>
                  )}
                </button>
              ))
            )}

            {canMessageUnits &&
              (broadcastFor ? (
                <div className="mt-1.5 rounded-md border bg-card p-2">
                  <p className="text-xs font-medium">
                    Mensagem individual — {broadcastFor.name}
                  </p>
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    A mesma mensagem vai como conversa direta para cada membro da
                    equipe.
                  </p>
                  <textarea
                    value={broadcastText}
                    onChange={(e) => setBroadcastText(e.target.value)}
                    rows={3}
                    placeholder="Escreva a mensagem..."
                    className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setBroadcastFor(null);
                        setBroadcastText("");
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={isPending || !broadcastText.trim()}
                      onClick={sendBroadcast}
                    >
                      Enviar a todos
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 border-t pt-1.5">
                  <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                    Enviar para uma unidade
                  </p>
                  {!unitsLoaded ? (
                    <p className="px-1 text-xs text-muted-foreground">
                      Carregando…
                    </p>
                  ) : visibleUnits.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">
                      Nenhuma unidade.
                    </p>
                  ) : (
                    visibleUnits.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent"
                      >
                        <Users className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => openUnit(u.id)}
                          className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] hover:border-primary"
                        >
                          Chat da equipe
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setBroadcastFor(u);
                            setBroadcastText("");
                          }}
                          className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] hover:border-primary"
                        >
                          Individual
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ))}
          </div>
        )}

        {channels.length > 4 && (
          <div className="relative border-b p-1.5">
            <Search className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Filtrar conversas..."
              className="h-8 pl-7 text-sm"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {visibleChannels.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma conversa.
            </p>
          ) : (
            visibleChannels.map((c) => (
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
                    <span className="flex shrink-0 items-center gap-1">
                      {importantByChannel.has(c.id) && (
                        <span
                          title="Mensagem importante não lida"
                          className="inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white"
                        >
                          <AlertTriangle className="size-3" />
                          {importantByChannel.get(c.id)}
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-medium text-gold-foreground">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </span>
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{selected.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {teamMembers.length} membro
                      {teamMembers.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setMembersOpen(true)}
                  >
                    Ver membros
                  </Button>
                </>
              ) : (
                <>
                  <Avatar
                    person={headerPerson}
                    name={headerPerson?.name ?? selected.title}
                    status={
                      headerPerson ? presence.get(headerPerson.userId) : undefined
                    }
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {headerPerson?.name ?? selected.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(() => {
                        const st = headerPerson
                          ? presence.get(headerPerson.userId)
                          : undefined;
                        const sub = personSub(headerPerson);
                        const suffix = sub ? ` · ${sub}` : "";
                        if (st === "online") {
                          return (
                            <>
                              <span className="font-medium text-emerald-600">
                                online agora
                              </span>
                              {suffix}
                            </>
                          );
                        }
                        if (st === "away") {
                          return (
                            <>
                              <span className="font-medium text-amber-600">
                                ausente
                              </span>
                              {suffix}
                            </>
                          );
                        }
                        if (headerPerson?.lastSeenAt) {
                          return `visto por último ${lastSeenLabel(headerPerson.lastSeenAt)}${suffix}`;
                        }
                        return sub ?? "";
                      })()}
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
                        "group flex items-end gap-2",
                        m.mine ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      <Avatar
                        person={p}
                        name={label}
                        status={presence.get(m.senderId)}
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
                        {m.important && (
                          <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            <AlertTriangle className="size-3" />
                            Importante
                          </span>
                        )}
                        {m.replyTo && (
                          <div className="mb-0.5 max-w-full rounded-md border-l-2 border-primary/50 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                            <span className="font-medium">
                              {m.replyTo.senderName}
                            </span>
                            {": "}
                            <span className="line-clamp-1">{m.replyTo.body}</span>
                          </div>
                        )}
                        {m.attachment && (
                          <div className="mb-0.5 max-w-full">
                            {m.attachment.kind === "image" ? (
                              <a
                                href={m.attachment.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={m.attachment.url}
                                  alt={m.attachment.name}
                                  className="max-h-56 max-w-full rounded-lg border object-cover"
                                />
                              </a>
                            ) : m.attachment.kind === "audio" ? (
                              <audio
                                controls
                                src={m.attachment.url}
                                className="h-9 max-w-[16rem]"
                              />
                            ) : (
                              <a
                                href={m.attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                download={m.attachment.name}
                                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary"
                              >
                                <FileText className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">
                                  {m.attachment.name}
                                </span>
                                <Download className="size-3.5 shrink-0 text-muted-foreground" />
                              </a>
                            )}
                          </div>
                        )}
                        <div
                          className={cn(
                            "flex items-center gap-1",
                            m.mine ? "flex-row-reverse" : "flex-row"
                          )}
                        >
                          {m.body && (
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
                          )}
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              title="Reagir"
                              onClick={() =>
                                setReactingId((v) => (v === m.id ? null : m.id))
                              }
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                            >
                              <Smile className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Responder"
                              onClick={() => setReplyingTo(m)}
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                            >
                              <Reply className="size-3.5" />
                            </button>
                          </span>
                        </div>
                        {reactingId === m.id && (
                          <div className="mt-0.5 flex gap-0.5 rounded-full border bg-card p-0.5 shadow-sm">
                            {EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => react(m.id, e)}
                                className="rounded-full px-1 text-base hover:bg-accent"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                        {m.reactions.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {m.reactions.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() => react(m.id, r.emoji)}
                                className={cn(
                                  "rounded-full border px-1.5 text-[11px] leading-5",
                                  r.mine
                                    ? "border-primary bg-primary/10"
                                    : "bg-background"
                                )}
                              >
                                {r.emoji} {r.count}
                              </button>
                            ))}
                          </div>
                        )}
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

            {replyingTo && (
              <div className="flex items-center gap-2 border-t bg-muted/40 px-2 py-1 text-xs">
                <Reply className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  Respondendo{" "}
                  <span className="font-medium">
                    {replyingTo.mine ? "você" : replyingTo.senderName}
                  </span>
                  : {replyingTo.body}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            <form
              className="flex items-center gap-1.5 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={onFilePicked}
              />
              {recording ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    onClick={stopRecording}
                    title="Parar gravação"
                  >
                    <Square className="size-4" />
                  </Button>
                  <span className="flex-1 text-sm text-destructive">
                    <span className="mr-1 inline-block size-2 animate-pulse rounded-full bg-destructive align-middle" />
                    Gravando…{" "}
                    {`${String(Math.floor(recSeconds / 60)).padStart(2, "0")}:${String(
                      recSeconds % 60
                    ).padStart(2, "0")}`}
                  </span>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() => setImportant((v) => !v)}
                    title={
                      important
                        ? "Importante ativado — clique para desativar"
                        : "Marcar como importante (reavisa até o destinatário abrir)"
                    }
                    className={cn(
                      important &&
                        "bg-amber-500 text-white hover:bg-amber-600 hover:text-white"
                    )}
                  >
                    <AlertTriangle className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar arquivo"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={uploading}
                    onClick={startRecording}
                    title="Gravar áudio"
                  >
                    <Mic className="size-4" />
                  </Button>
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      uploading
                        ? "Enviando anexo..."
                        : important
                          ? "Mensagem importante — reavisa até abrir…"
                          : "Escreva uma mensagem..."
                    }
                    disabled={uploading}
                    autoComplete="off"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={isPending || uploading || !input.trim()}
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </>
              )}
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Escolha uma conversa à esquerda.
          </div>
        )}
      </section>

      {/* Membros da equipe */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Membros — {selected?.title}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {teamMembers.map((p) => (
              <li key={p.userId} className="flex items-center gap-2 py-1">
                <Avatar
                  person={p}
                  name={p.name}
                  status={presence.get(p.userId)}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.userId === meId ? `${p.name} (você)` : p.name}
                  </p>
                  {personSub(p) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {personSub(p)}
                    </p>
                  )}
                </div>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {presence.get(p.userId) === "online"
                    ? "online"
                    : presence.get(p.userId) === "away"
                      ? "ausente"
                      : p.lastSeenAt
                        ? lastSeenLabel(p.lastSeenAt)
                        : ""}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
