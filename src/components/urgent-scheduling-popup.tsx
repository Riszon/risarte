"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlarmClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  markNotificationRead,
  markNotificationsRead,
} from "@/app/(app)/notificacoes/actions";

type Item = { id: string; title: string; body: string | null; link: string | null };

/** Só o nome do cliente do corpo "Nome — Clínica: ... — Veio de: ...". */
function clientNameFromBody(body: string | null, fallback: string): string {
  if (!body) return fallback;
  const first = body.split(" — ")[0]?.trim();
  return first || fallback;
}

/**
 * AJ4/AJ6: pop-up para a recepção. Verifica a cada ~45s se há pedidos NÃO lidos
 * de "agendar apresentação comercial" e abre um modal para agir na hora. Altura
 * limitada + rolagem + "marcar todos" para não bagunçar quando há vários.
 */
export function UrgentSchedulingPopup() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Avisos já dispensados nesta sessão — não reabrem sozinhos até chegar um novo.
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, link")
        .is("read_at", null)
        .ilike("title", "%agendar apresenta%")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const list = (data ?? []) as Item[];
      setItems(list);
      if (list.some((i) => !dismissed.current.has(i.id))) setOpen(true);
    }

    poll();
    const id = setInterval(poll, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function resolve(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      dismissed.current.add(id);
      setItems((prev) => {
        const rest = prev.filter((i) => i.id !== id);
        if (rest.length === 0) setOpen(false);
        return rest;
      });
      router.refresh();
    });
  }

  function resolveAll() {
    const ids = items.map((i) => i.id);
    startTransition(async () => {
      await markNotificationsRead(ids);
      for (const id of ids) dismissed.current.add(id);
      setItems([]);
      setOpen(false);
      router.refresh();
    });
  }

  function dismissAll() {
    for (const i of items) dismissed.current.add(i.id);
    setOpen(false);
  }

  if (items.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) dismissAll();
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <AlarmClock className="size-5" />
            Agendar apresentação comercial
          </DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? "1 cliente aguardando o agendamento da apresentação comercial."
              : `${items.length} clientes aguardando o agendamento da apresentação comercial.`}{" "}
            Agende o quanto antes.
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 max-h-[52vh] space-y-2 overflow-y-auto px-1">
          {items.map((i) => (
            <li key={i.id} className="rounded-md border p-2 text-sm">
              <p className="font-medium">
                {clientNameFromBody(i.body, i.title)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {i.link && (
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    nativeButton={false}
                    render={
                      <Link href={i.link} onClick={() => resolve(i.id)} />
                    }
                  >
                    Abrir agenda
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={isPending}
                  onClick={() => resolve(i.id)}
                >
                  Já agendei
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={resolveAll}
          >
            Marcar todos como agendados
          </Button>
          <Button variant="ghost" size="sm" onClick={dismissAll}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
