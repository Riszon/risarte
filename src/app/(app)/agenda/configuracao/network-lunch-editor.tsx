"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveNetworkLunch } from "../actions";

/** H4.8 Bloco 2: a franqueadora define o almoço padrão da rede (cascata). */
export function NetworkLunchEditor({
  lunch,
}: {
  lunch: { enabled: boolean; start: string; end: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(lunch.enabled);
  const [start, setStart] = useState(lunch.start);
  const [end, setEnd] = useState(lunch.end);

  function save() {
    startTransition(async () => {
      const r = await saveNetworkLunch({ enabled, start, end });
      if (r.ok) {
        toast.success("Almoço padrão da rede salvo.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Almoço padrão da rede</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Fechar a agenda no horário de almoço (padrão da rede)
        </label>
        {enabled && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="net-lunch-start">Início</Label>
              <Input
                id="net-lunch-start"
                type="time"
                className="max-w-[8rem]"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="net-lunch-end">Fim</Label>
              <Input
                id="net-lunch-end"
                type="time"
                className="max-w-[8rem]"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Este é o padrão de toda a rede. Cada unidade herda automaticamente, mas
          pode personalizar o próprio horário de almoço na configuração dela.
        </p>
        <Button size="sm" disabled={isPending} onClick={save}>
          {isPending ? "Salvando..." : "Salvar padrão da rede"}
        </Button>
      </CardContent>
    </Card>
  );
}
