"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, BookMarked, Ellipsis, Moon, Sparkles, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { alternarTema, useTemaEscuro } from "@/components/tema";

/**
 * O MENU "⋯" DA BARRA DE CIMA — só no celular (AP23/AP46).
 *
 * No celular a fileira de ícones não cabia: a página ficava mais larga que a
 * tela (582 px numa tela de 375, medido como Admin) e rolava para o lado em
 * TODA tela. Os menos usados (tema, alertas, novidades, manual) vêm para cá;
 * em tela maior eles continuam na barra e este botão some (`sm:hidden`).
 *
 * As mesmas condições da barra: quem não vê alertas ou o manual lá também
 * não vê aqui.
 */
export function MenuMaisDaBarra({
  podeVerSistema,
  podeVerManual,
  modoPortal,
}: {
  podeVerSistema: boolean;
  podeVerManual: boolean;
  modoPortal: boolean;
}) {
  const router = useRouter();
  const escuro = useTemaEscuro();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Mais opções"
        className="grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground sm:hidden"
      >
        <Ellipsis className="size-[18px]" />
        <span className="sr-only">Mais opções</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => alternarTema()}>
          {escuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {escuro ? "Usar tema claro" : "Usar tema escuro"}
        </DropdownMenuItem>
        {podeVerSistema && (
          <DropdownMenuItem onClick={() => router.push("/alertas")}>
            <AlertTriangle className="size-4 text-amber-600" />
            Alertas do sistema
          </DropdownMenuItem>
        )}
        {!modoPortal && (
          <DropdownMenuItem onClick={() => router.push("/novidades")}>
            <Sparkles className="size-4" />
            Novidades do sistema
          </DropdownMenuItem>
        )}
        {podeVerManual && (
          <DropdownMenuItem onClick={() => router.push("/manual")}>
            <BookMarked className="size-4" />
            Manual de treinamento
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
