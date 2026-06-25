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
import Link from "next/link";
import { CalendarSearch } from "lucide-react";
import { openSpecialDays, removeSpecialDay, saveLunchBreak } from "../actions";
import { EditOpenDayDialog } from "./edit-open-day-dialog";

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function AgendaConfigEditor({
  clinicId,
  hours,
  rooms,
  coordinatorRoomId,
  staff,
  openDays,
  lunch,
}: {
  clinicId: string;
  hours: { openTime: string; closeTime: string; weekdays: number[] };
  rooms: Room[];
  coordinatorRoomId: string | null;
  staff: { userId: string; name: string }[];
  openDays: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    note: string | null;
    createdAt: string;
    createdByName: string | null;
    staffIds: string[];
    isPast: boolean;
  }[];
  lunch: { enabled: boolean; start: string; end: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [openTime, setOpenTime] = useState(hours.openTime);
  const [closeTime, setCloseTime] = useState(hours.closeTime);
  const [weekdays, setWeekdays] = useState<number[]>(hours.weekdays);

  const [newRoom, setNewRoom] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Liberar dia avulso (G5/GR4).
  const [releaseDates, setReleaseDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState("");
  const [releaseStart, setReleaseStart] = useState("08:00");
  const [releaseEnd, setReleaseEnd] = useState("18:00");
  const [releaseStaff, setReleaseStaff] = useState<Set<string>>(new Set());
  const [releaseNote, setReleaseNote] = useState("");

  // Horário de almoço (GR4).
  const [lunchEnabled, setLunchEnabled] = useState(lunch.enabled);
  const [lunchStart, setLunchStart] = useState(lunch.start);
  const [lunchEnd, setLunchEnd] = useState(lunch.end);

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

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="relStart">Início do atendimento</Label>
              <select
                id="relStart"
                className={selectClass + " max-w-[8rem]"}
                value={releaseStart}
                onChange={(e) => setReleaseStart(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="relEnd">Fim do atendimento</Label>
              <select
                id="relEnd"
                className={selectClass + " max-w-[8rem]"}
                value={releaseEnd}
                onChange={(e) => setReleaseEnd(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
                  releaseStart,
                  releaseEnd,
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
                {openDays.map((d) => {
                  const advanceDays = Math.round(
                    (new Date(`${d.date}T00:00:00`).getTime() -
                      new Date(d.createdAt).getTime()) /
                      86_400_000
                  );
                  return (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">
                          {new Date(`${d.date}T00:00:00`).toLocaleDateString(
                            "pt-BR",
                            { weekday: "long", day: "2-digit", month: "long" }
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {d.startTime}–{d.endTime}
                        </span>
                        {d.isPast && (
                          <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            histórico
                          </span>
                        )}
                        {d.staffIds.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {d.staffIds
                              .map((id) => staffNameById.get(id) ?? "—")
                              .join(", ")}
                          </p>
                        )}
                        {d.note && (
                          <p className="text-xs text-muted-foreground">{d.note}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          Liberado em{" "}
                          {new Date(d.createdAt).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                          {d.createdByName ? ` por ${d.createdByName}` : ""}
                          {advanceDays >= 0
                            ? ` · avisado com ${advanceDays} dia(s) de antecedência`
                            : ""}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-0.5 px-2 text-xs"
                          nativeButton={false}
                          render={<Link href={`/agenda?vista=dia&ref=${d.date}`} />}
                        >
                          <CalendarSearch className="size-3" />
                          Ver
                        </Button>
                        {!d.isPast && (
                          <>
                            <EditOpenDayDialog
                              openDay={{
                                id: d.id,
                                date: d.date,
                                startTime: d.startTime,
                                endTime: d.endTime,
                                note: d.note,
                                staffIds: d.staffIds,
                              }}
                              staff={staff}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={isPending}
                              onClick={() =>
                                run(() => removeSpecialDay(d.id), "Dia removido.")
                              }
                            >
                              Remover
                            </Button>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Horário de almoço (GR4) ------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horário de almoço</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lunchEnabled}
              onChange={(e) => setLunchEnabled(e.target.checked)}
            />
            Fechar a agenda no horário de almoço
          </label>
          {lunchEnabled && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="lunchStart">Início</Label>
                <select
                  id="lunchStart"
                  className={selectClass + " max-w-[8rem]"}
                  value={lunchStart}
                  onChange={(e) => setLunchStart(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="lunchEnd">Fim</Label>
                <select
                  id="lunchEnd"
                  className={selectClass + " max-w-[8rem]"}
                  value={lunchEnd}
                  onChange={(e) => setLunchEnd(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            No almoço a agenda fica fechada para agendamentos normais; encaixes,
            urgências e emergências continuam permitidos.
          </p>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  saveLunchBreak(clinicId, {
                    enabled: lunchEnabled,
                    start: lunchStart,
                    end: lunchEnd,
                  }),
                "Horário de almoço salvo."
              )
            }
          >
            Salvar almoço
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
