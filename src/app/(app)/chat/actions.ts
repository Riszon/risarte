"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

/** Garante o canal da unidade ativa e lista os canais do usuário (unidade ativa
 * + diretos), com não lidas e a última mensagem. */
export async function listChannels(): Promise<ChatChannel[]> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const channelIds = new Set<string>();
  const unitTitleById = new Map<string, string>();
  const unitClinicById = new Map<string, string>();

  // Canal da unidade ativa.
  if (session.activeClinic) {
    const { data: unitId } = await supabase.rpc("ensure_unit_chat_channel", {
      p_clinic_id: session.activeClinic.id,
    });
    if (typeof unitId === "string") {
      channelIds.add(unitId);
      unitTitleById.set(unitId, `Equipe — ${session.activeClinic.name}`);
      unitClinicById.set(unitId, session.activeClinic.id);
    }
  }

  // Canais diretos em que sou membro.
  const { data: myMemberships } = await supabase
    .from("chat_channel_members")
    .select("channel_id")
    .eq("user_id", session.userId);
  const directIds = (myMemberships ?? []).map((m) => m.channel_id as string);
  for (const id of directIds) channelIds.add(id);

  if (channelIds.size === 0) return [];
  const ids = [...channelIds];

  // Nome dos canais diretos = o outro participante.
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

  // Minhas marcas de leitura.
  const { data: readRows } = await supabase
    .from("chat_reads")
    .select("channel_id, last_read_at")
    .in("channel_id", ids);
  const lastReadById = new Map<string, string>();
  for (const r of readRows ?? []) {
    lastReadById.set(r.channel_id, r.last_read_at as string);
  }

  const channels: ChatChannel[] = [];
  for (const id of ids) {
    const isUnit = unitTitleById.has(id);
    const lastRead = lastReadById.get(id) ?? "1970-01-01T00:00:00Z";

    const [{ data: lastMsg }, { count }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("body, created_at")
        .eq("channel_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", id)
        .neq("sender_id", session.userId)
        .gt("created_at", lastRead),
    ]);

    channels.push({
      id,
      kind: isUnit ? "unit" : "direct",
      title: isUnit
        ? (unitTitleById.get(id) ?? "Equipe")
        : (directTitleById.get(id) ?? "Conversa"),
      clinicId: unitClinicById.get(id) ?? null,
      unread: count ?? 0,
      lastMessage: (lastMsg?.body as string | undefined) ?? null,
      lastAt: (lastMsg?.created_at as string | undefined) ?? null,
    });
  }

  // Ordena: com atividade mais recente primeiro; unidade sempre no topo.
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
