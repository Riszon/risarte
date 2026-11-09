"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SupplierKind } from "@/lib/fornecedores";
import { saveSupplierKind } from "./actions";

/**
 * Tipos de fornecedor (0371): lista da rede, editada pela Franqueadora.
 * Tipo não se apaga — desativa (quem já usa continua com ele).
 */
export function KindsDialog({
  open,
  onOpenChange,
  kinds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kinds: SupplierKind[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rascunho, setRascunho] = useState<Record<string, { label: string; sortOrder: string }>>({});
  const [novo, setNovo] = useState("");

  function gravar(k: SupplierKind | null, mudanca: { label?: string; sortOrder?: number; active?: boolean }) {
    startTransition(async () => {
      const r = await saveSupplierKind({
        code: k?.code ?? null,
        label: mudanca.label ?? k?.label ?? "",
        sortOrder: mudanca.sortOrder ?? k?.sortOrder ?? 500,
        active: mudanca.active ?? k?.active ?? true,
      });
      if (r.ok) {
        toast.success(k ? "Tipo salvo." : "Tipo criado.");
        if (!k) setNovo("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const ordenados = [...kinds].sort((a, b) => a.sortOrder - b.sortOrder);
  const maior = ordenados.reduce((m, k) => (k.sortOrder < 999 ? Math.max(m, k.sortOrder) : m), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tipos de fornecedor</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          A lista vale para a rede toda. Um tipo desativado some da escolha, mas
          continua nos fornecedores que já o usam. O número ao lado do nome define a
          posição na lista.
        </p>
        <div className={cn("space-y-1.5", isPending && "opacity-70")}>
          {ordenados.map((k) => {
            const r = rascunho[k.code] ?? { label: k.label, sortOrder: String(k.sortOrder) };
            const mudou = r.label !== k.label || r.sortOrder !== String(k.sortOrder);
            return (
              <div key={k.code} className={cn("flex items-center gap-2", !k.active && "opacity-60")}>
                <Input
                  className="h-8 flex-1"
                  value={r.label}
                  onChange={(e) => setRascunho({ ...rascunho, [k.code]: { ...r, label: e.target.value } })}
                />
                <Input
                  className="h-8 w-16"
                  inputMode="numeric"
                  aria-label="Ordem"
                  value={r.sortOrder}
                  onChange={(e) =>
                    setRascunho({ ...rascunho, [k.code]: { ...r, sortOrder: e.target.value.replace(/\D/g, "") } })
                  }
                />
                {mudou ? (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={isPending}
                    onClick={() => gravar(k, { label: r.label, sortOrder: Number(r.sortOrder || k.sortOrder) })}
                  >
                    Salvar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    disabled={isPending}
                    onClick={() => gravar(k, { active: !k.active })}
                  >
                    {k.active ? "Desativar" : "Reativar"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t pt-3">
          <Input
            className="h-8 flex-1"
            placeholder="Novo tipo (ex.: Software de gestão)"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
          />
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={isPending || !novo.trim()}
            onClick={() => gravar(null, { label: novo, sortOrder: maior + 10 })}
          >
            Criar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
