import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "Ficha do cliente" };

const STATUS_LABELS = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
} as const;

export default async function ClientDetailPage(
  props: PageProps<"/clientes/[id]">
) {
  const session = await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, clinic_id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, notes, status, created_at"
    )
    .eq("id", id)
    .single();

  if (!client) notFound();

  // LGPD: every view of a client record is audited.
  await logAudit({
    action: "view",
    entityType: "client",
    entityId: client.id,
    clinicId: client.clinic_id,
  });

  const canEdit =
    client.status !== "anonymized" &&
    hasRoleInClinic(session, client.clinic_id, ["receptionist"]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cliente desde{" "}
            {new Date(client.created_at).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <Badge variant={client.status === "active" ? "secondary" : "outline"}>
          {STATUS_LABELS[client.status as keyof typeof STATUS_LABELS]}
        </Badge>
      </div>

      {canEdit ? (
        <ClientForm client={client} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">CPF</dt>
                <dd>{client.cpf ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nascimento</dt>
                <dd>
                  {client.birth_date
                    ? new Date(
                        `${client.birth_date}T00:00:00`
                      ).toLocaleDateString("pt-BR")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Telefone</dt>
                <dd>{client.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{client.email ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Endereço</dt>
                <dd>
                  {[
                    [client.address, client.address_number]
                      .filter(Boolean)
                      .join(", nº "),
                    client.complement,
                    client.neighborhood,
                    client.city,
                    client.state,
                    client.zip_code,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Observações</dt>
                <dd>{client.notes ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
