"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { setOnlineIds } from "@/lib/presence-store";
import { cn } from "@/lib/utils";

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
 * H4.9 Chat Hub: item do menu com contador de não lidas em tempo real. Quando
 * chega mensagem e o usuário NÃO está no Chat Hub, toca o som + pop-up (na tela
 * do chat, o próprio Chat Hub cuida disso).
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

    // Presença: marca-se online (Realtime) + atualiza "visto por último".
    let presence: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      meRef.current = uid;
      if (!uid) return;
      supabase.rpc("touch_presence");
      presence = supabase.channel("online-users", {
        config: { presence: { key: uid } },
      });
      const syncOnline = () =>
        setOnlineIds(new Set(Object.keys(presence?.presenceState() ?? {})));
      presence
        .on("presence", { event: "sync" }, syncOnline)
        .on("presence", { event: "join" }, syncOnline)
        .on("presence", { event: "leave" }, syncOnline)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") presence?.track({ user_id: uid });
        });
    });
    const presenceTick = setInterval(() => {
      supabase.rpc("touch_presence");
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
