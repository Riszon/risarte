"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { setPresence, type PresenceStatus } from "@/lib/presence-store";
import { cn } from "@/lib/utils";

// Sem atividade por este tempo → "ausente".
const AWAY_AFTER_MS = 5 * 60 * 1000;

function beep() {
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
    /* som é bônus */
  }
}

/**
 * H4.9 Chat Hub: item do menu com contador de não lidas em tempo real +
 * gerência da presença (online/ausente) do usuário para todo o app.
 */
export function ChatNavItem({ linkClass }: { linkClass: string }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const meRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc("chat_unread_total");
      if (!cancelled) setUnread(typeof data === "number" ? data : 0);
    }

    // Presença: entra no canal, marca-se online e vira "ausente" ao ficar
    // parado. Também atualiza o "visto por último".
    let presence: ReturnType<typeof supabase.channel> | null = null;
    let myStatus: PresenceStatus = "online";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const publishState = () => {
      const state = presence?.presenceState() as
        | Record<string, Array<{ status?: PresenceStatus }>>
        | undefined;
      const map = new Map<string, PresenceStatus>();
      if (state) {
        for (const key of Object.keys(state)) {
          const anyOnline = state[key].some(
            (m) => (m.status ?? "online") === "online"
          );
          map.set(key, anyOnline ? "online" : "away");
        }
      }
      setPresence(map);
    };

    const setMyStatus = (s: PresenceStatus) => {
      if (myStatus === s) return;
      myStatus = s;
      const uid = meRef.current;
      if (uid) presence?.track({ user_id: uid, status: s });
    };

    const onActivity = () => {
      setMyStatus("online");
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setMyStatus("away"), AWAY_AFTER_MS);
    };

    const activityEvents = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ] as const;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      meRef.current = uid;
      if (!uid) return;
      supabase.rpc("touch_presence").then(() => {});
      presence = supabase.channel("online-users", {
        config: { presence: { key: uid } },
      });
      presence
        .on("presence", { event: "sync" }, publishState)
        .on("presence", { event: "join" }, publishState)
        .on("presence", { event: "leave" }, publishState)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            presence?.track({ user_id: uid, status: myStatus });
          }
        });
      for (const ev of activityEvents) {
        window.addEventListener(ev, onActivity, { passive: true });
      }
      idleTimer = setTimeout(() => setMyStatus("away"), AWAY_AFTER_MS);
    });

    const presenceTick = setInterval(() => {
      supabase.rpc("touch_presence").then(() => {});
    }, 60_000);
    refresh();
    const interval = setInterval(refresh, 45_000);

    const channel = supabase
      .channel("chat-hub-nav")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m = payload.new as { sender_id: string };
          refresh();
          if (
            m.sender_id !== meRef.current &&
            window.location.pathname !== "/chat"
          ) {
            beep();
            toast.message("Nova mensagem no Chat Hub");
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(presenceTick);
      if (idleTimer) clearTimeout(idleTimer);
      for (const ev of activityEvents) {
        window.removeEventListener(ev, onActivity);
      }
      supabase.removeChannel(channel);
      if (presence) supabase.removeChannel(presence);
    };
  }, []);

  // Reconta ao navegar (ex.: depois de ler no Chat Hub).
  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("chat_unread_total").then(({ data }) => {
      setUnread(typeof data === "number" ? data : 0);
    });
  }, [pathname]);

  return (
    <Link href="/chat" className={linkClass}>
      <MessagesSquare className="size-4" />
      <span className="flex-1">Chat Hub</span>
      {unread > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-medium text-gold-foreground"
          )}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
