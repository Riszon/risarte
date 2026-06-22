"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellOff, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_CATEGORY_CLASS,
  NOTIFICATION_CATEGORY_LABELS,
  categorizeNotification,
} from "@/lib/notifications";
import type { NotificationRow } from "./page";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export function NotificationList({
  notifications,
}: {
  notifications: NotificationRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  function markRead(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (result.ok) toast.success("Todas marcadas como lidas.");
      router.refresh();
    });
  }

  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <BellOff className="size-6" />
          <p className="text-sm">Nenhuma notificação por enquanto.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={markAll}
          >
            <Check className="mr-1 size-4" />
            Marcar todas como lidas ({unreadCount})
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {notifications.map((notification) => (
          <li
            key={notification.id}
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border bg-card p-3",
              !notification.read_at && "border-primary/40 bg-primary/5"
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{notification.title}</p>
                {(() => {
                  const cat = categorizeNotification(notification.title);
                  return (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${NOTIFICATION_CATEGORY_CLASS[cat]}`}
                    >
                      {NOTIFICATION_CATEGORY_LABELS[cat]}
                    </span>
                  );
                })()}
                {!notification.read_at && (
                  <Badge className="bg-gold text-gold-foreground text-[10px]">
                    Nova
                  </Badge>
                )}
              </div>
              {notification.body && (
                <p className="truncate text-sm text-muted-foreground">
                  {notification.body}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {notification.clinics?.name ? `${notification.clinics.name} · ` : ""}
                {new Date(notification.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {notification.link && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={notification.link} />}
                  onClick={() => {
                    if (!notification.read_at) markRead(notification.id);
                  }}
                >
                  Abrir
                </Button>
              )}
              {!notification.read_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => markRead(notification.id)}
                  aria-label="Marcar como lida"
                >
                  <Check className="size-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
