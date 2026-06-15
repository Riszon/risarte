"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";
import {
  createClientRecord,
  lookupClientByCpf,
  transferClientToActiveClinic,
  updateClientRecord,
  type DuplicateInfo,
  type GuardianInput,
} from "./actions";

export type ClientFormValues = {
  id?: string;
  full_name?: string;
  cpf?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  notes?: string | null;
};

function isMinor(birthDate: string): boolean {
  if (!birthDate) return false;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return false;
  return (Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000) < 18;
}

const EMPTY_GUARDIAN: GuardianInput = {
  fullName: "",
  cpf: null,
  birthDate: null,
  relationship: "",
  phone: null,
  guardianClientId: null,
};

export function ClientForm({
  client,
  initialGuardians = [],
  showPreferredUnit = false,
  preferredUnits = [],
}: {
  client?: ClientFormValues;
  initialGuardians?: GuardianInput[];
  /** SDR registering at the Franqueadora picks the client's preferred unit. */
  showPreferredUnit?: boolean;
  preferredUnits?: { id: string; name: string }[];
}) {
  const isEdit = Boolean(client?.id);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [noCpf, setNoCpf] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [consent, setConsent] = useState(false);
  const [birthDate, setBirthDate] = useState(client?.birth_date ?? "");
  const [preferredUnit, setPreferredUnit] = useState("");
  const [guardians, setGuardians] = useState<GuardianInput[]>(initialGuardians);

  const minor = isMinor(birthDate);

  function applyMask(
    formatter: (v: string) => string
  ): React.ChangeEventHandler<HTMLInputElement> {
    return (e) => {
      e.target.value = formatter(e.target.value);
    };
  }

  function updateGuardian(index: number, patch: Partial<GuardianInput>) {
    setGuardians((prev) =>
      prev.map((g, i) => (i === index ? { ...g, ...patch } : g))
    );
  }

  function handleGuardianCpfBlur(index: number, cpf: string) {
    if (cpf.replace(/\D/g, "").length !== 11) return;
    startTransition(async () => {
      const result = await lookupClientByCpf(cpf);
      if (result.found) {
        updateGuardian(index, {
          fullName: result.fullName ?? "",
          birthDate: result.birthDate ?? null,
          phone: result.phone ?? null,
          guardianClientId: result.clientId ?? null,
        });
        toast.success(
          `${result.fullName} já é cliente Risarte — dados preenchidos.`
        );
      } else {
        updateGuardian(index, { guardianClientId: null });
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("no_cpf", String(noCpf));
    formData.set("guardians", JSON.stringify(minor ? guardians : []));
    if (showPreferredUnit) formData.set("preferred_clinic_id", preferredUnit);
    setDuplicate(null);

    startTransition(async () => {
      const result = isEdit
        ? await updateClientRecord(client!.id!, formData)
        : await createClientRecord(formData);

      if (result.ok) {
        toast.success(isEdit ? "Dados salvos." : "Cliente cadastrado.");
        router.push(result.clientId ? `/clientes/${result.clientId}` : "/clientes");
        router.refresh();
      } else if (result.duplicate) {
        setDuplicate(result.duplicate);
        setConsent(false);
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleTransfer() {
    if (!duplicate) return;
    startTransition(async () => {
      const result = await transferClientToActiveClinic(
        duplicate.clientId,
        consent
      );
      if (result.ok) {
        toast.success(
          `${duplicate.fullName} foi transferido(a) para esta unidade.`
        );
        router.push(`/clientes/${duplicate.clientId}`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {duplicate && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="size-4" />
              Cliente já cadastrado na rede
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{duplicate.fullName}</span> já está
              cadastrado(a) em{" "}
              <span className="font-medium">{duplicate.clinicName}</span>
              {duplicate.matchType === "cpf"
                ? " (mesmo CPF)."
                : " (mesmo nome e data de nascimento)."}{" "}
              Clientes não podem ser duplicados na rede.
            </p>
            {duplicate.sameClinic ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(`/clientes/${duplicate.clientId}`)}
              >
                Abrir a ficha do cliente
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-muted-foreground">
                  Se o cliente está sendo atendido agora nesta unidade,
                  transfira o cadastro (o histórico é preservado e a unidade
                  anterior será avisada).
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    Confirmo que o cliente autorizou a transferência do seu
                    cadastro para esta unidade.
                  </span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={!consent || isPending}
                  onClick={handleTransfer}
                >
                  {isPending ? "Transferindo..." : "Transferir para esta unidade"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {showPreferredUnit && (
        <Card className="border-gold">
          <CardHeader>
            <CardTitle className="text-base">Unidade preferida *</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Cadastro pela Franqueadora (código FRA). O cliente aparecerá também
              na lista da unidade escolhida.
            </p>
            <select
              value={preferredUnit}
              onChange={(e) => setPreferredUnit(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Selecione a unidade...</option>
              {preferredUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome completo *</Label>
            <Input
              id="full_name"
              name="full_name"
              required
              defaultValue={client?.full_name ?? ""}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF {noCpf ? "" : "*"}</Label>
              <Input
                id="cpf"
                name="cpf"
                inputMode="numeric"
                required={!noCpf}
                disabled={noCpf}
                defaultValue={client?.cpf ?? ""}
                onChange={applyMask(formatCpf)}
                placeholder="000.000.000-00"
              />
              {!isEdit && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={noCpf}
                    onChange={(e) => setNoCpf(e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  Cliente sem CPF (ex.: criança)
                </label>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_date">Data de nascimento *</Label>
              <Input
                id="birth_date"
                name="birth_date"
                type="date"
                required
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {minor && (
        <Card className="border-gold">
          <CardHeader>
            <CardTitle className="text-base">
              Responsáveis (obrigatório para menores de 18 anos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {guardians.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Adicione ao menos um responsável. Se o responsável já for
                cliente Risarte, informe o CPF que os dados são preenchidos
                automaticamente.
              </p>
            )}
            {guardians.map((guardian, index) => (
              <div key={index} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Responsável {index + 1}
                    {guardian.guardianClientId && (
                      <span className="ml-2 text-xs text-gold">
                        ★ cliente Risarte
                      </span>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover responsável"
                    onClick={() =>
                      setGuardians((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>CPF do responsável</Label>
                    <Input
                      inputMode="numeric"
                      value={guardian.cpf ?? ""}
                      onChange={(e) =>
                        updateGuardian(index, { cpf: formatCpf(e.target.value) })
                      }
                      onBlur={(e) => handleGuardianCpfBlur(index, e.target.value)}
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Nome completo *</Label>
                    <Input
                      required
                      value={guardian.fullName}
                      onChange={(e) =>
                        updateGuardian(index, { fullName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Data de nascimento</Label>
                    <Input
                      type="date"
                      value={guardian.birthDate ?? ""}
                      onChange={(e) =>
                        updateGuardian(index, { birthDate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Grau de parentesco *</Label>
                    <Input
                      required
                      value={guardian.relationship}
                      onChange={(e) =>
                        updateGuardian(index, { relationship: e.target.value })
                      }
                      placeholder="Mãe, pai, avó, tutor..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Contato (telefone)</Label>
                    <Input
                      inputMode="numeric"
                      value={guardian.phone ?? ""}
                      onChange={(e) =>
                        updateGuardian(index, {
                          phone: formatPhone(e.target.value),
                        })
                      }
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGuardians((prev) => [...prev, EMPTY_GUARDIAN])}
            >
              Adicionar responsável
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone / WhatsApp *</Label>
              <Input
                id="phone"
                name="phone"
                inputMode="numeric"
                required
                defaultValue={client?.phone ?? ""}
                onChange={applyMask(formatPhone)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail *</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={client?.email ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
            <div className="space-y-2">
              <Label htmlFor="address">Endereço (rua/avenida) *</Label>
              <Input
                id="address"
                name="address"
                required
                defaultValue={client?.address ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address_number">Número *</Label>
              <Input
                id="address_number"
                name="address_number"
                required
                defaultValue={client?.address_number ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input
                id="complement"
                name="complement"
                defaultValue={client?.complement ?? ""}
                placeholder="Apto, bloco..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="neighborhood">Bairro *</Label>
              <Input
                id="neighborhood"
                name="neighborhood"
                required
                defaultValue={client?.neighborhood ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_70px_120px]">
            <div className="space-y-2">
              <Label htmlFor="city">Cidade *</Label>
              <Input
                id="city"
                name="city"
                required
                defaultValue={client?.city ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">UF *</Label>
              <Input
                id="state"
                name="state"
                required
                maxLength={2}
                defaultValue={client?.state ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">CEP *</Label>
              <Input
                id="zip_code"
                name="zip_code"
                inputMode="numeric"
                required
                defaultValue={client?.zip_code ?? ""}
                onChange={applyMask(formatCep)}
                placeholder="00000-000"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={client?.notes ?? ""}
              placeholder="Como conheceu a Risarte, preferências de contato..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : isEdit ? "Salvar alterações" : "Cadastrar cliente"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
