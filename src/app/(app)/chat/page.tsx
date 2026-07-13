import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { listChannels, listColleagues } from "./actions";
import { ChatHub } from "./chat-hub";

export const metadata: Metadata = { title: "Chat Hub" };

export default async function ChatPage() {
  const session = await getSessionContext();
  const [channels, colleagues] = await Promise.all([
    listChannels(),
    listColleagues(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Chat Hub</h1>
        <p className="text-sm text-muted-foreground">
          Conversas internas da equipe — canal da unidade e mensagens diretas.
        </p>
      </div>
      <ChatHub
        meId={session.userId}
        initialChannels={channels}
        colleagues={colleagues}
      />
    </div>
  );
}
