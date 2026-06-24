"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Room filter (G3): choose which rooms to show in the agenda. "Todas" is the
 * default (no rooms selected = show all). Clicking a room shows only the
 * selected rooms; click more to add, click again to remove. State lives in the
 * URL as `?salas=id,id,online` (preserving vista/ref), so it works across
 * Dia/Semana/Mês.
 */
export function RoomFilter({
  rooms,
  selected,
}: {
  rooms: { id: string; name: string }[];
  selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedSet = new Set(selected);
  const showingAll = selectedSet.size === 0;

  function navigate(next: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete("salas");
    else params.set("salas", next.join(","));
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggle(key: string) {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    navigate([...next]);
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background hover:bg-muted"
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Salas:</span>
      <button
        type="button"
        className={chip(showingAll)}
        onClick={() => navigate([])}
      >
        Todas
      </button>
      {rooms.map((r) => (
        <button
          key={r.id}
          type="button"
          className={chip(selectedSet.has(r.id))}
          onClick={() => toggle(r.id)}
        >
          {r.name}
        </button>
      ))}
      <button
        type="button"
        className={cn(
          chip(selectedSet.has("online")),
          !selectedSet.has("online") && "text-sky-700"
        )}
        onClick={() => toggle("online")}
      >
        ONLINE
      </button>
    </div>
  );
}
