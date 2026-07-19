"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Bell,
  BellOff,
  Cake,
  CalendarCheck,
  CalendarClock,
  Check,
  ClipboardList,
  Presentation,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_CATEGORY_CLASS,
  NOTIFICATION_CATEGORY_LABELS,
  categorizeNotification,
  type NotificationCategory,
} from "@/lib/notifications";
import type { NotificationRow } from "./page";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

const SP = "America/Sao_Paulo";

/** Ícone (círculo) de cada categoria — âncora visual do aviso. */
const CATEGORY_ICON: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  plano: ClipboardList,
  comercial: Presentation,
  compartilhamento: Share2,
  inicio_tratamento: CalendarCheck,
  agenda: CalendarClock,
  aniversario: Cake,
  transferencia: ArrowLeftRight,
  outras: Bell,
};

/** "YYYY-MM-DD" do dia do aviso no fuso de São Paulo (determinístico → sem
 * divergência de hidratação entre servidor UTC e navegador BRT). */
function spDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Diferença em dias entre o aviso e hoje (0 = hoje, 1 = ontem, ...). */
function dayDiffFromToday(iso: string): number {
  const a = new Date(`${spDayKey(iso)}T00:00:00Z`).getTime();
  const b = new Date(`${spDayKey(new Date().toISOString())}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function bucketLabel(iso: string): string {
  const d = dayDiffFromToday(iso);
  if (d <= 0) return "Hoje";
  if (d === 1) return "Ontem";
  if (d < 7) return "Esta semana";
  return "Mais antigas";
}

function fmtTime(iso: string, withDate: boolean): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP,
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

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

  // Agrupa por data (na ordem em que chegam — já vêm do mais novo ao mais antigo).
  const groups: { label: string; items: NotificationRow[] }[] = [];
  for (const n of notifications) {
    const label = bucketLabel(n.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="space-y-4">
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

      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.label}
          </p>
          <ul className="space-y-2">
            {group.items.map((notification) => {
              const cat = categorizeNotification(notification.title);
              const Icon = CATEGORY_ICON[cat];
              const unread = !notification.read_at;
              const older = dayDiffFromToday(notification.created_at) >= 2;
              return (
                <li
                  key={notification.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border bg-card p-3",
                    unread && "border-primary/40 bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      NOTIFICATION_CATEGORY_CLASS[cat]
                    )}
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 text-sm font-medium">
                        {notification.title}
                      </p>
                      {unread && (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-gold"
                          aria-label="Não lida"
                        />
                      )}
                    </div>
                    {notification.body && (
                      <p className="truncate text-sm text-muted-foreground">
                        {notification.body}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {NOTIFICATION_CATEGORY_LABELS[cat]}
                      {notification.clinics?.name
                        ? ` · ${notification.clinics.name}`
                        : ""}{" "}
                      · {fmtTime(notification.created_at, older)}
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
                          if (unread) markRead(notification.id);
                        }}
                      >
                        Abrir
                      </Button>
                    )}
                    {unread && (
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
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
