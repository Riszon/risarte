"use client";

import { useState } from "react";
import { MapPin, Pencil, Phone, StickyNote, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm, type ClientFormValues } from "../client-form";
import type { GuardianInput } from "../actions";
import { genderLabel } from "@/lib/gender";

/** Rótulo de sub-seção dos dados (ícone dourado + título em maiúsculas). */
function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <span className="text-gold">{icon}</span>
      {children}
    </p>
  );
}

/** Campo (rótulo pequeno + valor em destaque). */
function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

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

  const address =
    [
      [client.address, client.address_number].filter(Boolean).join(", nº "),
      client.complement,
      client.neighborhood,
      client.city,
      client.state,
      client.zip_code,
    ]
      .filter(Boolean)
      .join(", ") || "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="size-4 text-gold" />
          Dados do cliente
        </CardTitle>
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
      <CardContent className="space-y-4">
        <div>
          <SectionLabel icon={<User className="size-3.5" />}>
            Identificação
          </SectionLabel>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Field label="CPF" value={client.cpf} />
            <Field
              label="Nascimento"
              value={
                client.birth_date
                  ? new Date(
                      `${client.birth_date}T00:00:00`
                    ).toLocaleDateString("pt-BR")
                  : "—"
              }
            />
            <Field label="Gênero" value={genderLabel(client.gender)} />
          </dl>
        </div>

        <div className="border-t pt-4">
          <SectionLabel icon={<Phone className="size-3.5" />}>
            Contato
          </SectionLabel>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Telefone" value={client.phone} />
            <Field label="E-mail" value={client.email} />
          </dl>
        </div>

        <div className="border-t pt-4">
          <SectionLabel icon={<MapPin className="size-3.5" />}>
            Endereço
          </SectionLabel>
          <p className="text-sm font-medium">{address}</p>
        </div>

        {client.notes && (
          <div className="border-t pt-4">
            <SectionLabel icon={<StickyNote className="size-3.5" />}>
              Observações
            </SectionLabel>
            <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
