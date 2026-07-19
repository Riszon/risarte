import type { Metadata } from "next";
import { Ban, MessagesSquare } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  amIChatBlocked,
  listBlockedChatUsers,
  listChannels,
  listColleagues,
} from "./actions";
import { ChatHub } from "./chat-hub";

export const metadata: Metadata = { title: "Chat Hub" };

export default async function ChatPage() {
  const session = await getSessionContext();

  // Bloqueio (0133): o usuário bloqueado perde o acesso à tela inteira.
  if (await amIChatBlocked()) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Ban className="size-6" />
          </span>
          <h1 className="text-lg font-semibold">Chat indisponível</h1>
          <p className="text-sm text-muted-foreground">
            Seu acesso ao chat foi bloqueado pela administração. Fale com o
            Admin Master se precisar reativá-lo.
          </p>
        </div>
      </div>
    );
  }

  const [channels, colleagues, blockedUserIds] = await Promise.all([
    listChannels(),
    listColleagues(),
    listBlockedChatUsers(),
  ]);

  // Total de usuários (só para a contagem online/offline do Admin).
  let totalUsers = 0;
  if (session.isAdminMaster) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });
    totalUsers = count ?? 0;
  }

  // R4: Admin/franqueadora pode enviar para uma unidade específica.
  const canMessageUnits =
    session.isAdminMaster ||
    session.clinics.some((c) => c.type === "franchisor");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessagesSquare className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chat Hub</h1>
          <p className="text-sm text-muted-foreground">
            Conversas internas da equipe — canal da unidade e mensagens diretas.
          </p>
        </div>
      </div>
      <ChatHub
        meId={session.userId}
        initialChannels={channels}
        colleagues={colleagues}
        isAdmin={session.isAdminMaster}
        totalUsers={totalUsers}
        canMessageUnits={canMessageUnits}
        initialBlockedIds={blockedUserIds}
      />
    </div>
  );
}
