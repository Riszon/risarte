"use client";

import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Botão de acesso rápido que abre um pop-up com o conteúdo (children). Usado na
 * barra de apoio do cockpit (Resumo, Atendimentos, Evidências, Anamnese,
 * Considerações) para liberar a tela e dar destaque ao editor de plano.
 */
export function PopupCard({
  label,
  icon,
  badge,
  dialogTitle,
  wide = false,
  disabled = false,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  /** Selo à direita do rótulo (ex.: contagem, alerta), visível no botão. */
  badge?: React.ReactNode;
  dialogTitle?: React.ReactNode;
  /** Pop-up mais largo (para conteúdos densos, ex.: Atendimentos). */
  wide?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium ring-1 ring-foreground/5 transition-colors",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:bg-muted/60"
            )}
          >
            {icon && <span className="text-gold">{icon}</span>}
            {label}
            {badge}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </button>
        }
      />
      <DialogContent className={wide ? "sm:max-w-4xl" : "sm:max-w-2xl"}>
        <DialogHeader>
          <DialogTitle>{dialogTitle ?? label}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto pr-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
