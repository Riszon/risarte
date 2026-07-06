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
import { markNotificationRead } from "@/app/(app)/notificacoes/actions";

type Item = { id: string; title: string; body: string | null; link: string | null };

/**
 * AJ4: pop-up para a recepção. Verifica a cada ~45s se há pedidos NÃO lidos de
 * "agendar apresentação comercial" e abre um modal para agir na hora. Só quem
 * recebe esses avisos (recepção) vê algo — os demais nunca têm esses registros.
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
        .limit(10);
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <AlarmClock className="size-5" />
            Agendar apresentação comercial
          </DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? "Há um cliente esperando o agendamento da apresentação comercial."
              : `Há ${items.length} clientes esperando o agendamento da apresentação comercial.`}{" "}
            Agende o quanto antes.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="rounded-md border p-2 text-sm">
              <p className="font-medium">{i.body ?? i.title}</p>
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
        <DialogFooter>
          <Button variant="ghost" onClick={dismissAll}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
