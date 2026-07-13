"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  PHASE_APPOINTMENT_TYPE,
  TYPE_PROVIDER_ROLES,
  appointmentTypeOptions,
  type AppointmentType,
  type StaffOption,
} from "@/lib/appointments";
import { effectiveDayHours, timeToMinutes } from "@/lib/agenda-settings";
import { PHASE_LABELS } from "@/lib/journey";
import { ROLE_LABELS } from "@/lib/roles";
import {
  createAppointment,
  checkParticipantsBusy,
  checkProviderCrossUnit,
  getAppointmentParticipants,
  getAppointmentSessionOptions,
  getClientPendingSessions,
  getClientSchedulingInfo,
  getDayBusyTimes,
  getDaySchedule,
  getNextAvailableSlots,
  getProviderProcedureStats,
  updateAppointment,
  type AgendaFormConfig,
  type AvailableSlot,
  type BusyRange,
  type DaySchedule,
  type PendingSession,
  type SchedulingInfo,
} from "./actions";
import { AgendaPeekDialog } from "./agenda-peek-dialog";

const DURATION_ITEMS = [
  { value: "15", label: "15 minutos" },
  { value: "30", label: "30 minutos" },
  { value: "45", label: "45 minutos" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
];

// Wide fallback slots (every 5 min, 06–21h) used for encaixe (urgência/
// emergência) and when a unit has no agenda configured yet.
const WIDE_TIME_ITEMS: { value: string; label: string }[] = [];
for (let hour = 6; hour <= 21; hour++) {
  for (let minute = 0; minute < 60; minute += 5) {
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    WIDE_TIME_ITEMS.push({ value, label: value });
  }
}

const SLOT_STEP = 15; // configured agenda offers 15-minute slots.

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type AppointmentDefaults = {
  id: string;
  type: AppointmentType;
  starts_at: string;
  ends_at: string;
  provider_user_id: string | null;
  notes: string | null;
  room_id: string | null;
  clientName: string;
};

/** Default appointment type for a client: a session for clients already in
 * treatment, otherwise the type that follows the current journey phase. */
function defaultTypeFor(info: SchedulingInfo): AppointmentType {
  if (info.phase === "treatment_start" && info.journeyStatus === "in_treatment") {
    return "treatment_session";
  }
  return PHASE_APPOINTMENT_TYPE[info.phase];
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const minutes = Math.round(d.getMinutes() / 5) * 5;
  const h = minutes === 60 ? d.getHours() + 1 : d.getHours();
  const m = minutes === 60 ? 0 : minutes;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function AppointmentFormDialog({
  clients,
  staff,
  config,
  appointment,
  trigger,
  initialClientId,
  initialDate,
  initialTime,
  initialDuration,
  initialProviderId,
  treatmentSessionId,
  initialSessionIds,
  initialRoomId,
  defaultOpen = false,
  open,
  onOpenChange,
  units,
  loadUnitData,
  fixedClinicId,
  activeClinicId,
}: {
  clients: { id: string; full_name: string; inactive?: boolean }[];
  staff: StaffOption[];
  /** Rooms + working hours of the unit (direct/fixed flow). */
  config?: AgendaFormConfig;
  /** When set, the dialog edits/reschedules this appointment. */
  appointment?: AppointmentDefaults;
  /** Optional when the dialog is opened in a controlled way (open/onOpenChange). */
  trigger?: React.ReactElement<Record<string, unknown>>;
  /** Pre-select a client (e.g. opening the agenda from a notification). */
  initialClientId?: string;
  /** Pre-fill date/time/room (quick scheduling by clicking an empty slot). */
  initialDate?: string;
  initialTime?: string;
  /** Pré-preenche a duração (min) — ex.: ao agendar uma sessão planejada (E4). */
  initialDuration?: number;
  /** Pré-seleciona o profissional sugerido para a sessão (H4.5 Lote 3). */
  initialProviderId?: string;
  /** Vincula este agendamento a uma sessão planejada do tratamento (E4). */
  treatmentSessionId?: string;
  /** Pré-marca VÁRIAS sessões para agendar juntas no mesmo horário (H4.5 Lote 4). */
  initialSessionIds?: string[];
  initialRoomId?: string;
  defaultOpen?: boolean;
  /** Controlled open state (quick scheduling). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** SDR flow: choose the target unit first, then load its clients/staff. */
  units?: { id: string; name: string }[];
  loadUnitData?: (clinicId: string) => Promise<{
    clients: { id: string; full_name: string; inactive?: boolean }[];
    staff: StaffOption[];
    config: AgendaFormConfig;
  }>;
  /** Schedule into a specific clinic (e.g. the button inside a client ficha). */
  fixedClinicId?: string;
  /** The active unit's clinic id (direct flow) — for slot suggestions / peek. */
  activeClinicId?: string;
}) {
  const isEdit = Boolean(appointment);
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlledOpen = open !== undefined;
  const actualOpen = isControlledOpen ? open : internalOpen;
  const setActualOpen = (o: boolean) => {
    if (isControlledOpen) onOpenChange?.(o);
    else setInternalOpen(o);
  };
  const [isPending, startTransition] = useTransition();
  const [unitId, setUnitId] = useState("");
  const [unitClients, setUnitClients] = useState<
    { id: string; full_name: string; inactive?: boolean }[]
  >([]);
  const [unitStaff, setUnitStaff] = useState<StaffOption[]>([]);
  const [unitConfig, setUnitConfig] = useState<AgendaFormConfig | null>(null);
  const [clientId, setClientId] = useState(initialClientId ?? "");

  const pickUnit = Boolean(units);
  const effectiveClients = pickUnit ? unitClients : clients;
  const effectiveStaff = pickUnit ? unitStaff : staff;
  const effectiveConfig = pickUnit ? unitConfig : (config ?? null);
  const rooms = useMemo(() => effectiveConfig?.rooms ?? [], [effectiveConfig]);
  const effectiveClinicId = pickUnit
    ? unitId
    : (fixedClinicId ?? activeClinicId ?? "");

  function handleUnitChange(id: string) {
    setUnitId(id);
    setClientId("");
    setProviderId("");
    setRoomId("");
    setParticipantIds([]);
    setSchedulingInfo(null);
    setUnitClients([]);
    setUnitStaff([]);
    setUnitConfig(null);
    if (id && loadUnitData) {
      startTransition(async () => {
        const data = await loadUnitData(id);
        setUnitClients(data.clients);
        setUnitStaff(data.staff);
        setUnitConfig(data.config);
      });
    }
  }
  const [schedulingInfo, setSchedulingInfo] = useState<SchedulingInfo | null>(
    null
  );
  const [type, setType] = useState<AppointmentType>(
    appointment?.type ?? "evaluation"
  );
  const [providerId, setProviderId] = useState(
    appointment?.provider_user_id ?? initialProviderId ?? ""
  );
  const [roomId, setRoomId] = useState(
    appointment?.room_id ?? initialRoomId ?? ""
  );
  const [date, setDate] = useState(
    appointment ? toLocalDate(appointment.starts_at) : (initialDate ?? "")
  );
  const [time, setTime] = useState(
    appointment ? toLocalTime(appointment.starts_at) : (initialTime ?? "")
  );
  const [duration, setDuration] = useState(
    appointment
      ? String(
          Math.round(
            (new Date(appointment.ends_at).getTime() -
              new Date(appointment.starts_at).getTime()) /
              60_000
          )
        )
      : initialDuration
        ? String(initialDuration)
        : "60"
  );
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [sessionIds, setSessionIds] = useState<string[]>(
    initialSessionIds && initialSessionIds.length > 0
      ? initialSessionIds
      : treatmentSessionId
        ? [treatmentSessionId]
        : []
  );
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  // Ao editar, só envia o campo de sessões depois de carregá-las (H1.5) —
  // senão um salvar rápido desvincularia as sessões sem querer.
  const [sessionsLoaded, setSessionsLoaded] = useState(!isEdit);
  const [providerStats, setProviderStats] = useState<
    Record<string, { avgMinutes: number; sample: number }>
  >({});
  // H4.7: profissionais adicionais do atendimento conjunto.
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participantsLoaded, setParticipantsLoaded] = useState(!isEdit);

  const clientItems = effectiveClients.map((c) => ({
    value: c.id,
    label: c.inactive ? `${c.full_name} (inativo)` : c.full_name,
  }));

  // When opened pre-filled from a notification, load the client's scheduling
  // info (current phase → suggested appointment type) once.
  useEffect(() => {
    if (!isEdit && initialClientId) {
      getClientSchedulingInfo(initialClientId).then((info) => {
        setSchedulingInfo(info);
        if (info) setType(defaultTypeFor(info));
      });
      getClientPendingSessions(initialClientId).then(setPendingSessions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // H1.5: editing loads the sessions already linked to this appointment +
  // the client's still-pending ones, with the linked ones pre-checked.
  const editAppointmentId = isEdit ? appointment?.id : undefined;
  useEffect(() => {
    if (!editAppointmentId || !actualOpen) return;
    let cancelled = false;
    getAppointmentSessionOptions(editAppointmentId).then((r) => {
      if (cancelled) return;
      setPendingSessions([...r.linked, ...r.pending]);
      setSessionIds(r.linked.map((s) => s.id));
      setSessionsLoaded(true);
    });
    getAppointmentParticipants(editAppointmentId).then((r) => {
      if (cancelled) return;
      setParticipantIds(r.map((p) => p.userId));
      setParticipantsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editAppointmentId, actualOpen]);

  // The type follows the journey when creating; editing keeps all options.
  const typeOptions = isEdit
    ? [...APPOINTMENT_TYPES]
    : appointmentTypeOptions(schedulingInfo?.phase ?? null);
  const typeItems = typeOptions.map((t) => ({
    value: t,
    label: APPOINTMENT_TYPE_LABELS[t],
  }));

  const providerItems = useMemo(() => {
    const allowedRoles = TYPE_PROVIDER_ROLES[type];
    return effectiveStaff
      .filter((s) => s.roles.some((role) => allowedRoles.includes(role)))
      .map((s) => ({ value: s.userId, label: s.name }));
  }, [effectiveStaff, type]);

  const allowedRoleLabels = TYPE_PROVIDER_ROLES[type]
    .map((role) => ROLE_LABELS[role])
    .join(" ou ");

  const providerValid = providerItems.some((p) => p.value === providerId);

  // Apresentação comercial = ONLINE (no physical room).
  const isOnline = type === "commercial_presentation";
  const isEncaixe = type === "urgency" || type === "emergency";

  // H4.7: candidatos a profissional adicional — dentistas/coordenadores da
  // unidade, exceto o responsável principal já escolhido.
  const participantCandidates = useMemo(
    () =>
      effectiveStaff
        .filter(
          (s) =>
            s.userId !== providerId &&
            s.roles.some(
              (r) => r === "dentist" || r === "clinical_coordinator"
            )
        )
        .map((s) => ({ userId: s.userId, name: s.name })),
    [effectiveStaff, providerId]
  );
  // Nunca conta o responsável principal como "adicional".
  const validParticipantIds = useMemo(
    () => participantIds.filter((id) => id !== providerId),
    [participantIds, providerId]
  );
  function toggleParticipant(userId: string) {
    setParticipantIds((prev) =>
      prev.includes(userId)
        ? prev.filter((x) => x !== userId)
        : [...prev, userId]
    );
  }

  // Default room: coordinator's room for avaliação/reavaliação, else first room.
  const prefersCoordRoom = type === "evaluation" || type === "reevaluation";
  const defaultRoomId = useMemo(() => {
    if (rooms.length === 0) return "";
    const coord = effectiveConfig?.coordinatorRoomId;
    if (prefersCoordRoom && coord && rooms.some((r) => r.id === coord)) {
      return coord;
    }
    return rooms[0].id;
  }, [rooms, effectiveConfig?.coordinatorRoomId, prefersCoordRoom]);

  // Use the chosen room while it's valid; otherwise fall back to the default.
  const effectiveRoomId = isOnline
    ? ""
    : roomId && rooms.some((r) => r.id === roomId)
      ? roomId
      : defaultRoomId;
  const roomItems = rooms.map((r) => ({ value: r.id, label: r.name }));

  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // For today, don't offer times that have already passed.
  const nowTime = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;

  // Busy ranges → suggest only free time slots (the DB still guards conflicts).
  const [busy, setBusy] = useState<{
    providerBusy: BusyRange[];
    clientBusy: BusyRange[];
    roomBusy: BusyRange[];
  }>({ providerBusy: [], clientBusy: [], roomBusy: [] });

  const shouldFetchBusy = Boolean(
    date && (clientId || providerId || effectiveRoomId)
  );

  useEffect(() => {
    if (!shouldFetchBusy) return;
    let cancelled = false;
    getDayBusyTimes({
      providerUserId: providerId || null,
      clientId: clientId || "",
      date,
      roomId: effectiveRoomId || null,
      excludeId: appointment?.id,
    }).then((b) => {
      if (!cancelled) setBusy(b);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldFetchBusy, date, clientId, providerId, effectiveRoomId, appointment?.id]);

  // When inputs are incomplete, ignore any stale busy data (derived, no effect).
  const effectiveBusy = useMemo(
    () =>
      shouldFetchBusy
        ? busy
        : {
            providerBusy: [] as BusyRange[],
            clientBusy: [] as BusyRange[],
            roomBusy: [] as BusyRange[],
          },
    [shouldFetchBusy, busy]
  );

  const durationMin = Number(duration) || 60;

  // H1.6: situação especial do dia escolhido (dia avulso / feriado) — o
  // seletor de horário precisa refletir as mesmas regras do servidor.
  const [daySpecial, setDaySpecial] = useState<{
    key: string;
    value: DaySchedule;
  }>({ key: "", value: { openDay: null, holidayAttend: null } });
  const dayKey = effectiveClinicId && date ? `${effectiveClinicId}|${date}` : "";
  useEffect(() => {
    if (!dayKey) return;
    let cancelled = false;
    getDaySchedule(effectiveClinicId, date).then((value) => {
      if (!cancelled) setDaySpecial({ key: dayKey, value });
    });
    return () => {
      cancelled = true;
    };
  }, [dayKey, effectiveClinicId, date]);
  const daySchedule: DaySchedule =
    daySpecial.key === dayKey
      ? daySpecial.value
      : { openDay: null, holidayAttend: null };

  // H4.6 E2: aviso de conflito entre unidades (o dentista já tem atendimento em
  // outra unidade no mesmo dia) + se o dia é dia dele nesta unidade (config E1).
  const EMPTY_CROSS = {
    otherUnits: [] as { clinic: string; time: string }[],
    scheduleKnown: false,
    isPriorityDay: false,
  };
  const [crossUnit, setCrossUnit] = useState(EMPTY_CROSS);
  const shouldCheckCross = Boolean(providerId && effectiveClinicId && date);
  useEffect(() => {
    if (!shouldCheckCross) return;
    let cancelled = false;
    checkProviderCrossUnit({
      providerUserId: providerId,
      clinicId: effectiveClinicId,
      date,
    }).then((r) => {
      if (!cancelled) setCrossUnit(r);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldCheckCross, providerId, effectiveClinicId, date]);
  // Ignora dados obsoletos quando os campos estão incompletos (derivado).
  const effectiveCross = shouldCheckCross ? crossUnit : EMPTY_CROSS;

  const dayWeekday = date ? new Date(`${date}T00:00:00`).getDay() : null;
  const weekdayConfigured = Boolean(
    effectiveConfig &&
      dayWeekday !== null &&
      effectiveConfig.weekdays.includes(dayWeekday)
  );
  // AJ7: dia avulso num dia NORMAL estende o horário (une); em dia fechado usa a
  // janela própria. Mesma regra do servidor (effectiveDayHours).
  const openWindow =
    daySchedule.openDay && effectiveConfig
      ? (() => {
          const eff = effectiveDayHours(
            effectiveConfig.openTime,
            effectiveConfig.closeTime,
            daySchedule.openDay,
            weekdayConfigured || daySchedule.holidayAttend === true
          );
          return { start: eff.open, end: eff.close };
        })()
      : null;
  // Feriado decidido como "não atende" bloqueia todos (inclusive encaixe).
  const holidayClosed = daySchedule.holidayAttend === false;

  // Base slots: configured hours (15-min) for normal appointments, wide list
  // for encaixe and when there's no agenda config yet. A special open day
  // (dia avulso) offers its own window even on a closed weekday (H1.6).
  const baseSlots = useMemo(() => {
    if (isEncaixe || !effectiveConfig) return WIDE_TIME_ITEMS;
    const openMin = timeToMinutes(openWindow?.start ?? effectiveConfig.openTime);
    const closeMin = timeToMinutes(openWindow?.end ?? effectiveConfig.closeTime);
    const items: { value: string; label: string }[] = [];
    for (let m = openMin; m <= closeMin - SLOT_STEP; m += SLOT_STEP) {
      const v = minutesToHHMM(m);
      items.push({ value: v, label: v });
    }
    return items;
  }, [isEncaixe, effectiveConfig, openWindow]);

  // Closed weekday (configured) blocks the day, except for encaixe — unless
  // it's a special open day or a holiday the manager decided to attend.
  const dayClosed = Boolean(
    !isEncaixe &&
      effectiveConfig &&
      dayWeekday !== null &&
      !weekdayConfigured &&
      !openWindow &&
      daySchedule.holidayAttend !== true
  );
  // H2.9: encaixe em dia fechado é permitido, mas com alerta na escolha da data.
  const encaixeClosedDay = Boolean(
    isEncaixe &&
      effectiveConfig &&
      dayWeekday !== null &&
      !weekdayConfigured &&
      !openWindow &&
      daySchedule.holidayAttend !== true
  );

  const timeItems = useMemo(() => {
    if (holidayClosed) return [];
    if (!date) return baseSlots;
    if (dayClosed) return [];
    const base =
      date === minDate ? baseSlots.filter((t) => t.value > nowTime) : baseSlots;
    return base.filter((t) => {
      // AJ2: baseSlots já limita o INÍCIO ao horário de funcionamento; o FIM
      // pode passar do fechamento (permitido, com alerta ao agendar), então não
      // filtramos por duração aqui.
      const s = new Date(`${date}T${t.value}:00`).getTime();
      const e = s + durationMin * 60_000;
      const overlaps = (r: BusyRange) =>
        s < new Date(r.ends_at).getTime() && e > new Date(r.starts_at).getTime();
      if (effectiveBusy.clientBusy.some(overlaps)) return false;
      if (!isEncaixe && effectiveBusy.providerBusy.some(overlaps)) return false;
      if (!isEncaixe && !isOnline && effectiveBusy.roomBusy.some(overlaps)) {
        return false;
      }
      return true;
    });
  }, [
    baseSlots,
    date,
    dayClosed,
    holidayClosed,
    durationMin,
    isEncaixe,
    isOnline,
    minDate,
    nowTime,
    effectiveBusy,
  ]);

  // The chosen time, but only while it's still an available slot.
  const effectiveTime =
    time && timeItems.some((t) => t.value === time) ? time : "";

  // H4.7 Bloco 2: aviso suave se algum profissional adicional já está ocupado
  // no horário escolhido (na mesma unidade). Não bloqueia o agendamento.
  const [busyParts, setBusyParts] = useState<{ key: string; ids: string[] }>({
    key: "",
    ids: [],
  });
  const partClashKey =
    !isOnline &&
    effectiveClinicId &&
    date &&
    effectiveTime &&
    validParticipantIds.length > 0
      ? `${effectiveClinicId}|${date}|${effectiveTime}|${durationMin}|${validParticipantIds.join(",")}`
      : "";
  useEffect(() => {
    if (!partClashKey) return;
    let cancelled = false;
    checkParticipantsBusy({
      clinicId: effectiveClinicId,
      date,
      time: effectiveTime,
      durationMin,
      participantIds: validParticipantIds,
      excludeId: appointment?.id,
    }).then((ids) => {
      if (!cancelled) setBusyParts({ key: partClashKey, ids });
    });
    return () => {
      cancelled = true;
    };
  }, [
    partClashKey,
    effectiveClinicId,
    date,
    effectiveTime,
    durationMin,
    validParticipantIds,
    appointment?.id,
  ]);
  const busyPartNames = (busyParts.key === partClashKey ? busyParts.ids : [])
    .map((id) => effectiveStaff.find((s) => s.userId === id)?.name)
    .filter((n): n is string => Boolean(n));

  const lastWasMissed =
    schedulingInfo?.lastAppointment &&
    ["cancelled", "no_show"].includes(schedulingInfo.lastAppointment.status);

  const roomMissing = !isOnline && rooms.length > 0 && !effectiveRoomId;

  // Suggested next available slots (GR1).
  const [slotLimit, setSlotLimit] = useState(3);
  const [slotState, setSlotState] = useState<{
    key: string;
    slots: AvailableSlot[];
  }>({ key: "", slots: [] });
  const canSuggest =
    !isEdit &&
    Boolean(effectiveClinicId) &&
    providerValid &&
    Boolean(clientId) &&
    (isOnline || Boolean(effectiveRoomId));
  const slotKey = canSuggest
    ? `${effectiveClinicId}|${providerId}|${effectiveRoomId}|${isOnline}|${clientId}|${durationMin}|${slotLimit}`
    : "";

  useEffect(() => {
    if (!canSuggest) return;
    let cancelled = false;
    getNextAvailableSlots({
      clinicId: effectiveClinicId,
      providerUserId: providerId || null,
      roomId: isOnline ? null : effectiveRoomId || null,
      clientId: clientId || null,
      isOnline,
      durationMin,
      limit: slotLimit,
    }).then((res) => {
      if (!cancelled) setSlotState({ key: slotKey, slots: res });
    });
    return () => {
      cancelled = true;
    };
  }, [
    canSuggest,
    slotKey,
    effectiveClinicId,
    providerId,
    effectiveRoomId,
    clientId,
    isOnline,
    durationMin,
    slotLimit,
  ]);
  const slots = slotState.key === slotKey ? slotState.slots : [];
  const slotsLoading = canSuggest && slotState.key !== slotKey;

  function handleClientChange(id: string) {
    setClientId(id);
    setSchedulingInfo(null);
    setSessionIds([]);
    setPendingSessions([]);
    startTransition(async () => {
      const info = await getClientSchedulingInfo(id);
      setSchedulingInfo(info);
      if (info) {
        // Scheduling follows the journey (a session for clients in treatment).
        setType(defaultTypeFor(info));
      }
      setPendingSessions(await getClientPendingSessions(id));
    });
  }

  // Procedimentos distintos das sessões marcadas (para a média do dentista).
  const selectedProcedureIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of pendingSessions) {
      if (sessionIds.includes(s.id) && s.procedureId) set.add(s.procedureId);
    }
    return Array.from(set);
  }, [pendingSessions, sessionIds]);

  // E5: média real do dentista escolhido para os procedimentos marcados.
  useEffect(() => {
    let cancelled = false;
    getProviderProcedureStats(providerId, selectedProcedureIds).then((r) => {
      if (!cancelled) setProviderStats(r);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, selectedProcedureIds]);

  // Marca/desmarca uma sessão; a duração soma o tempo planejado das marcadas.
  function toggleSession(s: PendingSession) {
    const next = sessionIds.includes(s.id)
      ? sessionIds.filter((x) => x !== s.id)
      : [...sessionIds, s.id];
    setSessionIds(next);
    const totalMin = pendingSessions
      .filter((p) => next.includes(p.id))
      .reduce((sum, p) => sum + (p.minutes ?? 0), 0);
    if (totalMin > 0) {
      setDuration(String(Math.max(15, Math.round(totalMin / 15) * 15)));
    }
  }

  function doSubmit(slotDate: string, slotTime: string) {
    if (!slotDate || !slotTime) return;
    const formData = new FormData();
    if (!isEdit) formData.set("client_id", clientId);
    if (pickUnit) formData.set("clinic_id", unitId);
    else if (fixedClinicId) formData.set("clinic_id", fixedClinicId);
    formData.set("type", type);
    formData.set("date", slotDate);
    formData.set("time", slotTime);
    formData.set("duration", duration);
    formData.set("provider_user_id", providerValid ? providerId : "");
    formData.set("room_id", isOnline ? "" : effectiveRoomId);
    formData.set("notes", notes);
    // H1.5: na edição o campo sempre vai (permite desmarcar sessões); na
    // criação só vai quando há sessão marcada.
    if (isEdit ? sessionsLoaded : sessionIds.length > 0) {
      formData.set("treatment_session_ids", sessionIds.join(","));
    }
    // H4.7: participantes adicionais — ONLINE não usa. Na edição só envia
    // depois de carregar a lista (para permitir remover todos).
    if (!isOnline && (isEdit ? participantsLoaded : true)) {
      formData.set("participant_ids", validParticipantIds.join(","));
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateAppointment(appointment!.id, formData)
        : await createAppointment(formData);
      if (result.ok) {
        toast.success(isEdit ? "Agendamento alterado." : "Agendamento criado.");
        // AJ2: atendimento fora do horário — alerta forte a quem agendou; o
        // profissional recebe uma notificação separada.
        if (result.warning) {
          toast.warning(result.warning, {
            description: "O profissional foi avisado.",
            duration: 8000,
          });
        }
        setActualOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    doSubmit(date, effectiveTime);
  }

  return (
    <Dialog open={actualOpen} onOpenChange={setActualOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Alterar agendamento — ${appointment!.clientName}`
              : "Novo agendamento"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Toda alteração fica registrada no histórico."
              : "O tipo do compromisso segue a fase da Jornada do cliente."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {pickUnit && (
            <div className="space-y-2">
              <Label>Unidade *</Label>
              <select
                value={unitId}
                onChange={(e) => handleUnitChange(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Escolha a unidade...</option>
                {(units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {unitId && (
                <p className="rounded-md border border-gold/40 bg-gold/5 p-2 text-xs">
                  Agendando na unidade:{" "}
                  <span className="font-medium text-primary">
                    {units?.find((u) => u.id === unitId)?.name}
                  </span>
                  . Para agendar em outra unidade (desejo do cliente), troque
                  acima.
                </p>
              )}
            </div>
          )}
          {!isEdit && (!pickUnit || unitId) && (
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select
                items={clientItems}
                value={clientId || null}
                onValueChange={(v) => v !== null && handleClientChange(v)}
              >
                <SelectTrigger className="w-full">
                  {clientId ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      Escolha o cliente
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {clientItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isEdit && schedulingInfo && (
            <div className="space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
              <p className="flex items-center gap-1">
                <Info className="size-3.5 shrink-0 text-primary" />
                Fase atual:{" "}
                <span className="font-medium">
                  {PHASE_LABELS[schedulingInfo.phase]}
                </span>
                {" → "}será agendado:{" "}
                <span className="font-medium">
                  {APPOINTMENT_TYPE_LABELS[defaultTypeFor(schedulingInfo)]}
                </span>
              </p>
              {lastWasMissed && (
                <p className="font-medium text-destructive">
                  O último agendamento foi{" "}
                  {schedulingInfo!.lastAppointment!.status === "cancelled"
                    ? "cancelado"
                    : "uma falta"}{" "}
                  — o cliente continua na fase atual (reagendamento).
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select
              items={typeItems}
              value={typeOptions.includes(type) ? type : null}
              onValueChange={(v) => {
                if (v !== null) setType(v as AppointmentType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEncaixe && (
              <p className="text-xs text-muted-foreground">
                {APPOINTMENT_TYPE_LABELS[type]} permite encaixe: pode ser marcada
                em qualquer dia/horário, mesmo já ocupado.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Profissional responsável *</Label>
            {providerItems.length > 0 ? (
              <Select
                items={providerItems}
                value={providerValid ? providerId : null}
                onValueChange={(v) => v !== null && setProviderId(v)}
              >
                <SelectTrigger className="w-full">
                  {providerValid ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      Escolha o profissional
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {providerItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Nenhum usuário com a função {allowedRoleLabels} nesta clínica.
                Peça ao Admin Master para cadastrar.
              </p>
            )}
          </div>

          {/* Sala de atendimento (cadeira) — ONLINE para apresentação comercial */}
          <div className="space-y-2">
            <Label>Sala de atendimento{isOnline ? "" : " *"}</Label>
            {isOnline ? (
              <p className="flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 p-2 text-xs font-medium text-sky-700">
                <Wifi className="size-3.5 shrink-0" />
                ONLINE — apresentação comercial não ocupa sala física.
              </p>
            ) : rooms.length > 0 ? (
              <Select
                items={roomItems}
                value={effectiveRoomId || null}
                onValueChange={(v) => v !== null && setRoomId(v)}
              >
                <SelectTrigger className="w-full">
                  {effectiveRoomId ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      Escolha a sala
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {roomItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                Esta unidade ainda não tem salas cadastradas (a Gerente pode
                cadastrá-las em Configurar agenda).
              </p>
            )}
          </div>

          {/* H4.7: atendimento conjunto — profissionais adicionais. */}
          {!isOnline &&
            (participantCandidates.length > 0 ||
              validParticipantIds.length > 0) && (
              <div className="space-y-1.5 rounded-md border p-2">
                <Label>Outros profissionais neste atendimento</Label>
                <p className="text-[11px] text-muted-foreground">
                  Atendimento conjunto: marque outros dentistas/coordenadores
                  que atuam no mesmo horário e sala. Cada um recebe um aviso e
                  passa a ver na própria agenda.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {participantCandidates.map((p) => (
                    <Button
                      key={p.userId}
                      type="button"
                      size="sm"
                      variant={
                        participantIds.includes(p.userId)
                          ? "default"
                          : "outline"
                      }
                      onClick={() => toggleParticipant(p.userId)}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
                {validParticipantIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {validParticipantIds.length + 1} profissionais no
                    atendimento (1 responsável principal +{" "}
                    {validParticipantIds.length} adicional
                    {validParticipantIds.length === 1 ? "" : "is"}).
                  </p>
                )}
              </div>
            )}

          {pendingSessions.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
              <Label>
                {isEdit
                  ? "Sessões do plano neste agendamento"
                  : "Sessões do plano a agendar"}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {isEdit
                  ? "As marcadas ficam vinculadas a este agendamento; desmarcar devolve a sessão para “a agendar”."
                  : "Marque uma — ou mais de uma, se o dentista vai executar vários procedimentos neste mesmo horário (a duração soma sozinha)."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pendingSessions.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant={sessionIds.includes(s.id) ? "default" : "outline"}
                    onClick={() => toggleSession(s)}
                  >
                    {s.label}
                    {s.minutes ? ` (${s.minutes} min)` : ""}
                  </Button>
                ))}
              </div>
              {sessionIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {sessionIds.length === 1
                    ? "Este agendamento será vinculado à sessão selecionada (marca como agendada)."
                    : `${sessionIds.length} sessões serão vinculadas a este agendamento; o tempo real será rateado entre elas ao concluir.`}
                </p>
              )}
              {providerValid &&
                selectedProcedureIds.some((pid) => providerStats[pid]) && (
                  <div className="rounded-md bg-emerald-50 p-1.5 text-xs text-emerald-800">
                    {selectedProcedureIds.map((pid) => {
                      const st = providerStats[pid];
                      if (!st) return null;
                      const procName =
                        pendingSessions
                          .find((s) => s.procedureId === pid)
                          ?.label.split(" — ")[0] ?? "Procedimento";
                      return (
                        <p key={pid}>
                          Média deste dentista — {procName}: {st.avgMinutes}{" "}
                          min/sessão ({st.sample}{" "}
                          {st.sample === 1 ? "execução" : "execuções"})
                        </p>
                      );
                    })}
                  </div>
                )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Duração</Label>
            <Select
              items={DURATION_ITEMS}
              value={duration}
              onValueChange={(v) => v !== null && setDuration(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Input
              id="notes"
              name="notes"
              placeholder="Opcional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* H3.1: data/horário/sugestões são a ÚLTIMA etapa do agendamento —
              com tipo, profissional, sala e duração definidos, o sistema já
              sabe filtrar os horários certos. */}
          <div className="space-y-1 border-t pt-3">
            <Label>Quando será o atendimento?</Label>
            <p className="text-xs text-muted-foreground">
              Última etapa: escolha a data e o horário — ou clique numa das
              sugestões de horários livres.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data *</Label>
              <Input
                id="date"
                name="date"
                type="date"
                required
                min={minDate}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setTime("");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Horário *</Label>
              <Select
                items={timeItems}
                value={effectiveTime || null}
                onValueChange={(v) => v !== null && setTime(v)}
              >
                <SelectTrigger className="w-full">
                  {effectiveTime ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      --:--
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {timeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canSuggest && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
              <p className="text-xs font-medium">
                Próximos horários disponíveis
              </p>
              {slotsLoading && slots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Buscando horários…
                </p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum horário livre nos próximos dias com esses filtros.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={`${s.date}-${s.time}`}
                      type="button"
                      disabled={isPending}
                      onClick={() => doSubmit(s.date, s.time)}
                      className="rounded-full border bg-background px-2.5 py-1 text-xs hover:border-primary hover:bg-primary/5"
                    >
                      {new Date(`${s.date}T00:00:00`).toLocaleDateString("pt-BR", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                      })}{" "}
                      {s.time}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={isPending || slotsLoading}
                    onClick={() => setSlotLimit((n) => n + 5)}
                    className="px-1.5 py-1 text-xs font-medium text-primary hover:underline"
                  >
                    ver mais
                  </button>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Clique num horário para confirmar o agendamento.
              </p>
            </div>
          )}

          {(date || effectiveClinicId) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span
                className={
                  holidayClosed || dayClosed
                    ? "font-medium text-destructive"
                    : encaixeClosedDay
                      ? "font-medium text-amber-700"
                      : "text-muted-foreground"
                }
              >
                {date
                  ? holidayClosed
                    ? "Feriado sem atendimento nesta unidade."
                    : dayClosed
                      ? "A unidade não atende neste dia da semana."
                      : encaixeClosedDay
                        ? "Atenção: a unidade não atende neste dia — o agendamento só é permitido por ser Urgência/Emergência."
                        : openWindow
                          ? `Dia avulso liberado — atendimento das ${openWindow.start} às ${openWindow.end}.`
                          : "Só aparecem horários livres dentro do funcionamento."
                  : ""}
              </span>
              {effectiveClinicId && (
                <AgendaPeekDialog
                  clinicId={effectiveClinicId}
                  providerUserId={providerValid ? providerId : null}
                  roomId={isOnline ? null : effectiveRoomId || null}
                  isOnline={isOnline}
                  durationMin={durationMin}
                  onPickDate={(iso) => {
                    setDate(iso);
                    setTime("");
                  }}
                />
              )}
            </div>
          )}

          {effectiveCross.otherUnits.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">⚠ Atenção — conflito entre unidades</p>
              <p className="mt-0.5">
                Este dentista já tem atendimento em outra unidade neste dia:{" "}
                {effectiveCross.otherUnits
                  .map((u) => `${u.clinic} (${u.time})`)
                  .join(", ")}
                . Confirme se ele consegue atender nas duas antes de agendar.
              </p>
            </div>
          )}
          {effectiveCross.scheduleKnown &&
            !effectiveCross.isPriorityDay &&
            effectiveCross.otherUnits.length === 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                Este não é um dia de atendimento configurado deste dentista nesta
                unidade. Você pode agendar mesmo assim.
              </div>
            )}

          {busyPartNames.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">⚠ Profissional já ocupado</p>
              <p className="mt-0.5">
                No horário escolhido, {busyPartNames.join(", ")}{" "}
                {busyPartNames.length === 1 ? "já tem" : "já têm"} outro
                atendimento nesta unidade. Você pode agendar mesmo assim, mas
                confirme se dá para atender junto.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                isPending ||
                (pickUnit && !unitId) ||
                (!isEdit && !clientId) ||
                !providerValid ||
                roomMissing ||
                !effectiveTime
              }
            >
              {isPending
                ? "Salvando..."
                : isEdit
                  ? "Salvar alterações"
                  : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
