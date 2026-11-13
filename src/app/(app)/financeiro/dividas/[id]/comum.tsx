"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Peças comuns das abas do detalhe da dívida (0405).

type Resultado = { ok: boolean; error?: string };

/** Roda uma ação do servidor com aviso e recarrega a tela no sucesso. */
export function useAcao() {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const rodar = (fn: () => Promise<Resultado>, ok: string, depois?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        depois?.();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  return { ocupado, rodar };
}

export const SELECT =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60";

export function Campo({
  rotulo,
  valor,
  onChange,
  type,
  placeholder,
  inputMode,
  className,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "tel" | "email";
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <Label className="text-[11px]">{rotulo}</Label>
      <Input className="h-9" type={type} value={valor} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Marca({ rotulo, valor, onChange }: { rotulo: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-primary" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );
}

export const moeda = (v: string) => v.replace(/[^\d.,]/g, "");

/** Caixa de formulário dentro da aba. */
export function Caixa({ titulo, children, onCancelar, onSalvar, ocupado }: {
  titulo: string;
  children: ReactNode;
  onCancelar: () => void;
  onSalvar: () => void;
  ocupado: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="text-xs font-semibold">{titulo}</p>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onCancelar}>Cancelar</Button>
        <Button size="sm" type="button" onClick={onSalvar} disabled={ocupado}>Salvar</Button>
      </div>
    </div>
  );
}

/** Pede o motivo antes de remover algo "lançado por engano" (a linha fica). */
export function RemoverComMotivo({
  titulo,
  aberto,
  onFechar,
  onConfirmar,
  ocupado,
}: {
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  onConfirmar: (motivo: string) => void;
  ocupado: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Use quando foi lançado por engano. Nada se apaga: o registro fica guardado, com quem removeu, quando e o motivo.
        </p>
        <Campo rotulo="Motivo *" valor={motivo} onChange={setMotivo} />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={ocupado}
            onClick={() => (motivo.trim().length < 5 ? toast.error("Escreva o motivo (5 letras ou mais).") : onConfirmar(motivo))}
          >
            Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rodapé "removido em … — motivo" para os registros removidos. */
export function Removido({ em, motivo }: { em: string | null; motivo: string | null }) {
  if (!em) return null;
  return <p className="text-[11px] text-destructive">Removido — {motivo ?? "sem motivo"}</p>;
}
