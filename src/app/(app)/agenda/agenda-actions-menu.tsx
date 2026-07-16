"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Agrupa as ações secundárias da Agenda num menu, deixando o topo limpo. */
export function AgendaActionsMenu({
  items,
}: {
  items: { label: string; href: string }[];
}) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <MoreHorizontal className="mr-1 size-4" />
            Mais ações
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {items.map((it) => (
          <DropdownMenuItem key={it.href} onClick={() => router.push(it.href)}>
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
