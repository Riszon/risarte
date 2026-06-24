"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WEEKDAY_NAMES } from "@/lib/agenda-settings";
import type { Room } from "@/lib/rooms";
import {
  addRoom,
  renameRoom,
  saveAgendaHours,
  setCoordinatorRoom,
  setRoomActive,
} from "./actions";
import { openSpecialDays, removeSpecialDay } from "../actions";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function AgendaConfigEditor({
  clinicId,
  hours,
  rooms,
  coordinatorRoomId,
  staff,
  openDays,
}: {
  clinicId: string;
  hours: { openTime: string; closeTime: string; weekdays: number[] };
  rooms: Room[];
  coordinatorRoomId: string | null;
  staff: { userId: string; name: string }[];
  openDays: { id: string; date: string; note: string | null; staffIds: string[] }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [openTime, setOpenTime] = useState(hours.openTime);
  const [closeTime, setCloseTime] = useState(hours.closeTime);
  const [weekdays, setWeekdays] = useState<number[]>(hours.weekdays);

  const [newRoom, setNewRoom] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Liberar dia avulso (G5).
  const [releaseDates, setReleaseDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState("");
  const [releaseStaff, setReleaseStaff] = useState<Set<string>>(new Set());
  const [releaseNote, setReleaseNote] = useState("");

  const activeRooms = rooms.filter((r) => r.isActive);
  const staffNameById = new Map(staff.map((s) => [s.userId, s.name]));
  const todayIso = new Date().toISOString().slice(0, 10);

  function toggleReleaseStaff(id: string) {
    setReleaseStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addReleaseDate() {
    if (newDate && !releaseDates.includes(newDate)) {
      setReleaseDates((prev) => [...prev, newDate].sort());
    }
    setNewDate("");
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(ok);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function toggleDay(d: number) {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  return (
    <div className="space-y-4">
      {/* Horário de atendimento ------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horário de atendimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="open">Abertura</Label>
              <Input
                id="open"
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="close">Fechamento</Label>
              <Input
                id="close"
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Dias de atendimento</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, d) => (
                <label
                  key={d}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={weekdays.includes(d)}
                    onChange={() => toggleDay(d)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  saveAgendaHours(clinicId, { openTime, closeTime, weekdays }),
                "Horário salvo."
              )
            }
          >
            Salvar horário
          </Button>
        </CardContent>
      </Card>

      {/* Salas de atendimento --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Salas de atendimento{" "}
            <span className="font-normal text-muted-foreground">
              ({activeRooms.length} ativa{activeRooms.length === 1 ? "" : "s"})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-lg border">
            {rooms.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Nenhuma sala cadastrada ainda.
              </li>
            )}
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                {editingId === room.id ? (
                  <>
                    <Input
                      className="h-8 max-w-[14rem]"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        run(() => renameRoom(room.id, editingName), "Sala renomeada.")
                      }
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className={`flex-1 text-sm ${
                        room.isActive ? "" : "text-muted-foreground line-through"
                      }`}
                    >
                      {room.name}
                      {!room.isActive && " (inativa)"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(room.id);
                        setEditingName(room.name);
                      }}
                    >
                      Renomear
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => setRoomActive(room.id, !room.isActive),
                          room.isActive ? "Sala desativada." : "Sala ativada."
                        )
                      }
                    >
                      {room.isActive ? "Desativar" : "Ativar"}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 max-w-[14rem]"
              placeholder="Nome da nova sala"
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
            />
            <Button
              size="sm"
              disabled={isPending || !newRoom.trim()}
              onClick={() =>
                run(async () => {
                  const result = await addRoom(clinicId, newRoom);
                  if (result.ok) setNewRoom("");
                  return result;
                }, "Sala adicionada.")
              }
            >
              Adicionar sala
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sala do Coordenador Clínico -------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sala do Coordenador Clínico</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sala usada pelo Coordenador para avaliações e reavaliações.
          </p>
          <select
            className={selectClass}
            value={coordinatorRoomId ?? ""}
            disabled={isPending}
            onChange={(e) =>
              run(
                () => setCoordinatorRoom(clinicId, e.target.value || null),
                "Sala do Coordenador salva."
              )
            }
          >
            <option value="">— Não definida —</option>
            {activeRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Liberar dia avulso (G5) ------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liberar dia avulso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Abra um ou mais dias fora dos dias normais de atendimento (ex.: um
            sábado) e escale quem estará disponível — cada um recebe uma
            notificação.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="newDate">Dia</Label>
              <Input
                id="newDate"
                type="date"
                min={todayIso}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="max-w-[12rem]"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!newDate}
              onClick={addReleaseDate}
            >
              Adicionar dia
            </Button>
          </div>

          {releaseDates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {releaseDates.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
                >
                  {new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setReleaseDates((prev) => prev.filter((x) => x !== d))
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div>
            <Label>Quem estará disponível</Label>
            {staff.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum profissional cadastrado nesta unidade.
              </p>
            ) : (
              <div className="mt-1 flex flex-col gap-1">
                {staff.map((s) => (
                  <label key={s.userId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={releaseStaff.has(s.userId)}
                      onChange={() => toggleReleaseStaff(s.userId)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="releaseNote">Observação</Label>
            <Input
              id="releaseNote"
              value={releaseNote}
              onChange={(e) => setReleaseNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <Button
            size="sm"
            disabled={isPending || releaseDates.length === 0}
            onClick={() =>
              run(async () => {
                const result = await openSpecialDays(
                  clinicId,
                  releaseDates,
                  [...releaseStaff],
                  releaseNote
                );
                if (result.ok) {
                  setReleaseDates([]);
                  setReleaseStaff(new Set());
                  setReleaseNote("");
                }
                return result;
              }, "Dia(s) liberado(s).")
            }
          >
            Liberar dia(s)
          </Button>

          {openDays.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-sm font-medium">Dias avulsos liberados</p>
              <ul className="divide-y rounded-lg border">
                {openDays.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {new Date(`${d.date}T00:00:00`).toLocaleDateString(
                          "pt-BR",
                          { weekday: "long", day: "2-digit", month: "long" }
                        )}
                      </span>
                      {d.staffIds.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          ·{" "}
                          {d.staffIds
                            .map((id) => staffNameById.get(id) ?? "—")
                            .join(", ")}
                        </span>
                      )}
                      {d.note ? (
                        <span className="text-muted-foreground"> · {d.note}</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        run(() => removeSpecialDay(d.id), "Dia removido.")
                      }
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
