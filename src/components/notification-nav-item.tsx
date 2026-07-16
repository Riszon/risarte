"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Sidebar item with a live unread counter (polls every 60s — good enough
 * for the MVP; can be swapped for Supabase Realtime later).
 */
export function NotificationNavItem({
  linkClass,
  collapsed,
}: {
  linkClass: string;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function fetchCount() {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (!cancelled) setUnread(count ?? 0);
    }

    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]); // re-fetch on navigation (e.g. after reading)

  return (
    <Link
      href="/notificacoes"
      className={linkClass}
      title={collapsed ? "Notificações" : undefined}
    >
      <Bell className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1">Notificações</span>}
      {unread > 0 &&
        (collapsed ? (
          <span className="absolute right-1 top-1 size-2 rounded-full bg-gold" />
        ) : (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-medium text-gold-foreground"
            )}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ))}
    </Link>
  );
}
