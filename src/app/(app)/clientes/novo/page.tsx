import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NewClientPage() {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, session.activeClinic?.id, ["receptionist"])) {
    redirect("/clientes");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo cliente</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro em {session.activeClinic?.name}.
        </p>
      </div>
      <ClientForm />
    </div>
  );
}
