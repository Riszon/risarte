"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

export type ChatChannel = {
  id: string;
  kind: "unit" | "direct";
  title: string;
  clinicId: string | null;
  unread: number;
  lastMessage: string | null;
  lastAt: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ChatColleague = { userId: string; name: string; hint: string | null };

type ActionResult = { ok: boolean; error?: string };

/** Lista os canais do usuário — o MESMO conjunto do badge (chat_my_channel_ids):
 * minhas equipes (todas as unidades onde tenho função) + escopo da franqueadora
 * (exceto Admin) + diretos + já abertos. Garante o canal de cada equipe. */
export async function listChannels(): Promise<ChatChannel[]> {
  const session = await getSessionContext();
  const supabase = await createClient();

  // Clínicas das minhas equipes.
  const teamClinicIds = new Set<string>(Object.keys(session.rolesByClinic));
  if (!session.isAdminMaster) {
    const { data: accessIds } = await supabase.rpc("user_full_access_clinic_ids");
    for (const x of (accessIds as { clinic_id?: string }[] | string[] | null) ??
      []) {
      teamClinicIds.add(typeof x === "string" ? x : (x.clinic_id ?? ""));
    }
  }
  if (session.activeClinic) teamClinicIds.add(session.activeClinic.id);
  teamClinicIds.delete("");

  const clinicNameById = new Map<string, string>();
  if (teamClinicIds.size > 0) {
    const { data: clinicRows } = await supabase
      .from("clinics")
      .select("id, name, type")
      .in("id", [...teamClinicIds])
      .returns<{ id: string; name: string; type: string }[]>();
    const unitIds: string[] = [];
    for (const c of clinicRows ?? []) {
      clinicNameById.set(c.id, c.name);
      if (c.type === "franchise_unit") unitIds.push(c.id);
    }
    // Garante o canal de cada equipe (limite defensivo para não escalar demais).
    for (const id of unitIds.slice(0, 40)) {
      await supabase.rpc("ensure_unit_chat_channel", { p_clinic_id: id });
    }
  }

  // Conjunto autoritativo (idêntico ao do badge).
  const { data: idRows } = await supabase.rpc("chat_my_channel_ids");
  const ids = ((idRows as { channel_id?: string }[] | null) ?? [])
    .map((r) => r.channel_id ?? "")
    .filter(Boolean);
  if (ids.length === 0) return [];

  const { data: chanRows } = await supabase
    .from("chat_channels")
    .select("id, kind, clinic_id")
    .in("id", ids)
    .returns<
      { id: string; kind: "unit" | "direct"; clinic_id: string | null }[]
    >();

  // Nomes de clínica que faltam (canais fora das minhas equipes).
  const missingClinic = (chanRows ?? [])
    .filter(
      (c) => c.kind === "unit" && c.clinic_id && !clinicNameById.has(c.clinic_id)
    )
    .map((c) => c.clinic_id as string);
  if (missingClinic.length > 0) {
    const { data: extra } = await supabase
      .from("clinics")
      .select("id, name")
      .in("id", missingClinic);
    for (const c of extra ?? []) clinicNameById.set(c.id, c.name);
  }

  // Título das conversas diretas = o outro membro.
  const directIds = (chanRows ?? [])
    .filter((c) => c.kind === "direct")
    .map((c) => c.id);
  const directTitleById = new Map<string, string>();
  if (directIds.length > 0) {
    const { data: memberRows } = await supabase
      .from("chat_channel_members")
      .select(
        "channel_id, user_id, profiles:profiles!chat_channel_members_user_id_fkey ( full_name )"
      )
      .in("channel_id", directIds)
      .returns<
        {
          channel_id: string;
          user_id: string;
          profiles: { full_name: string } | null;
        }[]
      >();
    for (const r of memberRows ?? []) {
      if (r.user_id !== session.userId) {
        directTitleById.set(r.channel_id, r.profiles?.full_name ?? "Colega");
      }
    }
  }

  const { data: readRows } = await supabase
    .from("chat_reads")
    .select("channel_id, last_read_at")
    .in("channel_id", ids);
  const lastReadById = new Map<string, string>();
  for (const r of readRows ?? []) {
    lastReadById.set(r.channel_id, r.last_read_at as string);
  }

  const channels: ChatChannel[] = [];
  for (const c of chanRows ?? []) {
    const lastRead = lastReadById.get(c.id) ?? "1970-01-01T00:00:00Z";
    const [{ data: lastMsg }, { count }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("body, created_at")
        .eq("channel_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", c.id)
        .neq("sender_id", session.userId)
        .gt("created_at", lastRead),
    ]);
    channels.push({
      id: c.id,
      kind: c.kind,
      title:
        c.kind === "unit"
          ? `Equipe — ${c.clinic_id ? (clinicNameById.get(c.clinic_id) ?? "unidade") : "unidade"}`
          : (directTitleById.get(c.id) ?? "Conversa"),
      clinicId: c.clinic_id,
      unread: count ?? 0,
      lastMessage: (lastMsg?.body as string | undefined) ?? null,
      lastAt: (lastMsg?.created_at as string | undefined) ?? null,
    });
  }

  channels.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "unit" ? -1 : 1;
    return (b.lastAt ?? "").localeCompare(a.lastAt ?? "");
  });
  return channels;
}

/** Mensagens de um canal (ordem cronológica). A RLS garante o acesso. */
export async function getMessages(
  channelId: string,
  limit = 80
): Promise<ChatMessage[]> {
  if (!channelId) return [];
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_messages")
    .select(
      "id, sender_id, body, created_at, profiles:profiles!chat_messages_sender_id_fkey ( full_name )"
    )
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<
      {
        id: string;
        sender_id: string;
        body: string;
        created_at: string;
        profiles: { full_name: string } | null;
      }[]
    >();
  return (data ?? [])
    .reverse()
    .map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: r.profiles?.full_name ?? "—",
      body: r.body,
      createdAt: r.created_at,
      mine: r.sender_id === session.userId,
    }));
}

/** Envia uma mensagem de texto para um canal. */
export async function sendMessage(
  channelId: string,
  body: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  const text = body.trim();
  if (!channelId) return { ok: false, error: "Canal inválido." };
  if (!text) return { ok: false, error: "Escreva uma mensagem." };
  if (text.length > 4000) return { ok: false, error: "Mensagem muito longa." };
  const supabase = await createClient();
  const { error } = await supabase.from("chat_messages").insert({
    channel_id: channelId,
    sender_id: session.userId,
    body: text,
  });
  if (error) {
    console.error("sendMessage failed:", error.message);
    return { ok: false, error: "Não foi possível enviar a mensagem." };
  }
  // Marca como lido para mim (a leitura acompanha o meu envio).
  await supabase.from("chat_reads").upsert(
    {
      channel_id: channelId,
      user_id: session.userId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,user_id" }
  );
  return { ok: true };
}

/** Marca o canal como lido (recibo de leitura). */
export async function markRead(channelId: string): Promise<void> {
  if (!channelId) return;
  const session = await getSessionContext();
  const supabase = await createClient();
  await supabase.from("chat_reads").upsert(
    {
      channel_id: channelId,
      user_id: session.userId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,user_id" }
  );
}

/** Últimas leituras dos outros membros de um canal (para o "visto"). */
export async function getChannelReads(
  channelId: string
): Promise<{ userId: string; name: string; lastReadAt: string }[]> {
  if (!channelId) return [];
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_reads")
    .select(
      "user_id, last_read_at, profiles:profiles!chat_reads_user_id_fkey ( full_name )"
    )
    .eq("channel_id", channelId)
    .neq("user_id", session.userId)
    .returns<
      {
        user_id: string;
        last_read_at: string;
        profiles: { full_name: string } | null;
      }[]
    >();
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    name: r.profiles?.full_name ?? "—",
    lastReadAt: r.last_read_at,
  }));
}

export type ChatPerson = {
  userId: string;
  name: string;
  roleLabel: string | null;
  unitLabel: string | null;
  photoUrl: string | null;
};

/** Anexa a foto (bucket staff-photos, link assinado) a cada pessoa. */
async function attachPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  people: Record<string, ChatPerson>
): Promise<void> {
  const userIds = Object.keys(people);
  if (userIds.length === 0) return;
  const { data: staff } = await supabase
    .from("staff_members")
    .select("user_id, photo_path")
    .in("user_id", userIds)
    .not("photo_path", "is", null)
    .returns<{ user_id: string; photo_path: string }[]>();
  const pathByUser = new Map<string, string>();
  for (const s of staff ?? []) {
    if (s.photo_path && !pathByUser.has(s.user_id)) {
      pathByUser.set(s.user_id, s.photo_path);
    }
  }
  const paths = [...pathByUser.values()];
  if (paths.length === 0) return;
  const { data: signed } = await supabase.storage
    .from("staff-photos")
    .createSignedUrls(paths, 3600);
  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  for (const [userId, path] of pathByUser) {
    const url = urlByPath.get(path);
    if (url && people[userId]) people[userId].photoUrl = url;
  }
}

/** Pessoas de um canal, com nome, função, unidade e foto — para exibir no chat. */
export async function getChannelPeople(
  channelId: string
): Promise<Record<string, ChatPerson>> {
  if (!channelId) return {};
  await getSessionContext();
  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("chat_channels")
    .select("kind, clinic_id")
    .eq("id", channelId)
    .maybeSingle();
  if (!ch) return {};

  const people: Record<string, ChatPerson> = {};

  if (ch.kind === "unit" && ch.clinic_id) {
    const [{ data: clinicRow }, { data: roleRows }, { data: senderRows }] =
      await Promise.all([
        supabase
          .from("clinics")
          .select("name")
          .eq("id", ch.clinic_id)
          .maybeSingle(),
        supabase
          .from("user_clinic_roles")
          .select("user_id, role, profiles ( full_name )")
          .eq("clinic_id", ch.clinic_id)
          .returns<
            {
              user_id: string;
              role: UserRole;
              profiles: { full_name: string } | null;
            }[]
          >(),
        supabase
          .from("chat_messages")
          .select(
            "sender_id, profiles:profiles!chat_messages_sender_id_fkey ( full_name )"
          )
          .eq("channel_id", channelId)
          .returns<
            { sender_id: string; profiles: { full_name: string } | null }[]
          >(),
      ]);
    const unitName = clinicRow?.name ?? null;
    for (const r of roleRows ?? []) {
      if (!people[r.user_id]) {
        people[r.user_id] = {
          userId: r.user_id,
          name: r.profiles?.full_name ?? "—",
          roleLabel: ROLE_LABELS[r.role] ?? null,
          unitLabel: unitName,
          photoUrl: null,
        };
      }
    }
    for (const s of senderRows ?? []) {
      if (!people[s.sender_id]) {
        people[s.sender_id] = {
          userId: s.sender_id,
          name: s.profiles?.full_name ?? "—",
          roleLabel: null,
          unitLabel: null,
          photoUrl: null,
        };
      }
    }
  } else {
    // Direto: os dois membros; função/unidade = a 1ª função de cada.
    const { data: memRows } = await supabase
      .from("chat_channel_members")
      .select(
        "user_id, profiles:profiles!chat_channel_members_user_id_fkey ( full_name )"
      )
      .eq("channel_id", channelId)
      .returns<
        { user_id: string; profiles: { full_name: string } | null }[]
      >();
    for (const m of memRows ?? []) {
      people[m.user_id] = {
        userId: m.user_id,
        name: m.profiles?.full_name ?? "—",
        roleLabel: null,
        unitLabel: null,
        photoUrl: null,
      };
    }
    const uids = Object.keys(people);
    if (uids.length > 0) {
      const { data: roleRows } = await supabase
        .from("user_clinic_roles")
        .select(
          "user_id, role, clinics!user_clinic_roles_clinic_id_fkey ( name )"
        )
        .in("user_id", uids)
        .returns<
          {
            user_id: string;
            role: UserRole;
            clinics: { name: string } | null;
          }[]
        >();
      for (const r of roleRows ?? []) {
        const p = people[r.user_id];
        if (p && !p.roleLabel) {
          p.roleLabel = ROLE_LABELS[r.role] ?? null;
          p.unitLabel = r.clinics?.name ?? null;
        }
      }
    }
  }

  await attachPhotos(supabase, people);
  return people;
}

/** Colegas com quem posso iniciar uma conversa direta. */
export async function listColleagues(): Promise<ChatColleague[]> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: accessIds } = await supabase.rpc("user_full_access_clinic_ids");
  const clinicIds = new Set<string>(session.clinics.map((c) => c.id));
  for (const x of (accessIds as { clinic_id?: string }[] | string[] | null) ??
    []) {
    clinicIds.add(typeof x === "string" ? x : (x.clinic_id ?? ""));
  }
  clinicIds.delete("");
  if (clinicIds.size === 0) return [];

  const { data: rows } = await supabase
    .from("user_clinic_roles")
    .select(
      "user_id, clinic_id, profiles ( full_name ), clinics!user_clinic_roles_clinic_id_fkey ( name )"
    )
    .in("clinic_id", [...clinicIds])
    .returns<
      {
        user_id: string;
        clinic_id: string;
        profiles: { full_name: string } | null;
        clinics: { name: string } | null;
      }[]
    >();

  const byUser = new Map<string, ChatColleague>();
  for (const r of rows ?? []) {
    if (r.user_id === session.userId) continue;
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, {
        userId: r.user_id,
        name: r.profiles?.full_name ?? "—",
        hint: r.clinics?.name ?? null,
      });
    }
  }
  return [...byUser.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );
}

/** Abre (ou cria) uma conversa direta com um colega; devolve o id do canal. */
export async function openDirectChannel(
  otherUserId: string
): Promise<{ ok: boolean; channelId?: string; error?: string }> {
  await getSessionContext();
  if (!otherUserId) return { ok: false, error: "Escolha um colega." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_direct_chat_channel", {
    p_other: otherUserId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Você não pode conversar com este usuário." };
    }
    console.error("ensure_direct_chat_channel failed:", error.message);
    return { ok: false, error: "Não foi possível abrir a conversa." };
  }
  revalidatePath("/chat");
  return { ok: true, channelId: data as string };
}
