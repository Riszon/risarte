"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm, type ClientFormValues } from "../client-form";
import type { GuardianInput } from "../actions";

/**
 * Client data on the ficha. Opens read-only; when the viewer may edit
 * (recepcionista/SDR/admin) an "Editar" button reveals the form (owner rule:
 * the ficha shouldn't open already editable).
 */
export function ClientDataSection({
  client,
  initialGuardians,
  canEdit,
}: {
  client: ClientFormValues;
  initialGuardians: GuardianInput[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (canEdit && editing) {
    return (
      <ClientForm
        client={client}
        initialGuardians={initialGuardians}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Dados do cliente</CardTitle>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            Editar
          </Button>
        )}
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
  );
}
