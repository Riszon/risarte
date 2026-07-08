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
import { GENDERS, GENDER_LABELS } from "@/lib/gender";
import {
  createClientRecord,
  lookupClientByCpf,
  lookupCpfForRegistration,
  transferClientToActiveClinic,
  transferClientToUnit,
  updateClientRecord,
  type DuplicateInfo,
  type GuardianInput,
} from "./actions";

export type ClientFormValues = {
  id?: string;
  full_name?: string;
  cpf?: string | null;
  birth_date?: string | null;
  gender?: string | null;
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
  onSaved,
}: {
  client?: ClientFormValues;
  initialGuardians?: GuardianInput[];
  /** SDR registering at the Franqueadora picks the client's preferred unit. */
  showPreferredUnit?: boolean;
  preferredUnits?: { id: string; name: string }[];
  /** When editing inline on the ficha, collapse back to read-only after saving. */
  onSaved?: () => void;
}) {
  const isEdit = Boolean(client?.id);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [noCpf, setNoCpf] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [consent, setConsent] = useState(false);
  const [fullName, setFullName] = useState(client?.full_name ?? "");
  const [birthDate, setBirthDate] = useState(client?.birth_date ?? "");
  const [gender, setGender] = useState(client?.gender ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  // Campos de contato/endereço controlados para o autopreenchimento por CPF (H1.9).
  const [email, setEmail] = useState(client?.email ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [addressNumber, setAddressNumber] = useState(
    client?.address_number ?? ""
  );
  const [complement, setComplement] = useState(client?.complement ?? "");
  const [neighborhood, setNeighborhood] = useState(client?.neighborhood ?? "");
  const [city, setCity] = useState(client?.city ?? "");
  const [state, setState] = useState(client?.state ?? "");
  const [zipCode, setZipCode] = useState(client?.zip_code ?? "");
  const [preferredUnit, setPreferredUnit] = useState("");
  const [guardians, setGuardians] = useState<GuardianInput[]>(initialGuardians);

  // H1.9: autopreenche TODOS os campos com os dados do cliente já existente.
  function applyAutofill(a: {
    fullName: string | null;
    birthDate: string | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    addressNumber: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  }) {
    if (a.fullName) setFullName(a.fullName);
    if (a.birthDate) setBirthDate(a.birthDate);
    if (a.gender) setGender(a.gender);
    if (a.phone) setPhone(a.phone);
    if (a.email) setEmail(a.email);
    if (a.address) setAddress(a.address);
    if (a.addressNumber) setAddressNumber(a.addressNumber);
    if (a.complement) setComplement(a.complement);
    if (a.neighborhood) setNeighborhood(a.neighborhood);
    if (a.city) setCity(a.city);
    if (a.state) setState(a.state);
    if (a.zipCode) setZipCode(a.zipCode);
  }

  const minor = isMinor(birthDate);

  // CPF-first: as soon as the CPF is filled, check the network. Already a
  // client → block + open/transfer; a prospect (guardian) → autofill.
  function handleClientCpfBlur(cpf: string) {
    if (isEdit || cpf.replace(/\D/g, "").length !== 11) return;
    startTransition(async () => {
      const result = await lookupCpfForRegistration(cpf);
      if (result.duplicate) {
        setDuplicate(result.duplicate);
        setConsent(false);
        // Já é cliente: autopreenche TODOS os dados visíveis (H1.9) para o
        // usuário ver de quem se trata — o card de duplicado guia abrir/transferir.
        if (result.autofill) applyAutofill(result.autofill);
        else if (result.duplicate.fullName) setFullName(result.duplicate.fullName);
      } else if (result.risartano) {
        // É um Risartano (colaborador): preenche a partir do cadastro de RH.
        setDuplicate(null);
        applyAutofill(result.risartano.autofill);
        toast.success(
          result.risartano.isActive
            ? "É um Risartano — dados preenchidos."
            : "É um Risartano (inativo) — dados preenchidos."
        );
      } else if (result.prospect) {
        setDuplicate(null);
        setFullName(result.prospect.fullName ?? fullName);
        if (result.prospect.birthDate) setBirthDate(result.prospect.birthDate);
        if (result.prospect.phone) setPhone(result.prospect.phone);
        toast.success(
          `${result.prospect.fullName} já estava cadastrado(a) como responsável — dados preenchidos.`
        );
      } else {
        setDuplicate(null);
      }
    });
  }

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
        if (isEdit && onSaved) {
          // Inline edit on the ficha: collapse to read-only and refresh in place.
          onSaved();
          router.refresh();
        } else {
          router.push(
            result.clientId ? `/prontuarios/${result.clientId}` : "/prontuarios"
          );
          router.refresh();
        }
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
        router.push(`/prontuarios/${duplicate.clientId}`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  // SDR: transfer the existing client from its current unit (A) to the
  // chosen preferred unit (B).
  function handleTransferToUnit() {
    if (!duplicate || !preferredUnit) return;
    startTransition(async () => {
      const result = await transferClientToUnit(
        duplicate.clientId,
        preferredUnit,
        consent
      );
      if (result.ok) {
        toast.success(`${duplicate.fullName} transferido(a) para a unidade.`);
        router.push(`/prontuarios/${duplicate.clientId}`);
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
              <span className="font-medium">{duplicate.fullName}</span> já é
              cliente da unidade{" "}
              <span className="font-medium text-primary">
                {duplicate.clinicName}
              </span>
              {duplicate.matchType === "cpf"
                ? " (mesmo CPF)."
                : " (mesmo nome e data de nascimento)."}{" "}
              Você pode abrir a ficha para ver/editar os dados.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/prontuarios/${duplicate.clientId}`)}
            >
              Abrir a ficha do cliente
            </Button>

            {showPreferredUnit ? (
              // SDR: confirm the preferred unit; transfer A→B only if different.
              !preferredUnit ? (
                <p className="text-xs text-muted-foreground">
                  Escolha a unidade de preferência acima para confirmar.
                </p>
              ) : preferredUnit === duplicate.clinicId ? (
                <p className="text-xs text-muted-foreground">
                  O cliente já pertence à unidade escolhida — basta abrir a ficha.
                </p>
              ) : (
                <div className="space-y-2 rounded-md border border-gold/40 bg-gold/5 p-3">
                  <p>
                    Transferir da unidade{" "}
                    <span className="font-medium">{duplicate.clinicName}</span>{" "}
                    para a unidade{" "}
                    <span className="font-medium text-primary">
                      {preferredUnits.find((u) => u.id === preferredUnit)?.name}
                    </span>
                    ? O histórico é preservado e a unidade anterior é avisada.
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span>
                      Confirmo que o cliente autorizou a transferência da unidade{" "}
                      {duplicate.clinicName} para a unidade escolhida.
                    </span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!consent || isPending}
                    onClick={handleTransferToUnit}
                  >
                    {isPending ? "Transferindo..." : "Transferir cliente"}
                  </Button>
                </div>
              )
            ) : (
              !duplicate.sameClinic && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-muted-foreground">
                    Se o cliente está sendo atendido agora nesta unidade,
                    transfira o cadastro (o histórico é preservado e a unidade
                    anterior será avisada).
                  </p>
                  <label className="flex items-start gap-2">
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
                    {isPending
                      ? "Transferindo..."
                      : "Transferir para esta unidade"}
                  </Button>
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}
      {showPreferredUnit && (
        <Card className="border-gold">
          <CardHeader>
            <CardTitle className="text-base">Unidade do cliente *</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              O cliente será cadastrado nesta unidade (aparece na Jornada e na
              lista dela). O código mantém o prefixo da Franqueadora (FRA).
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
            <Label htmlFor="cpf">CPF {noCpf ? "" : "*"}</Label>
            <Input
              id="cpf"
              name="cpf"
              inputMode="numeric"
              required={!noCpf}
              disabled={noCpf}
              defaultValue={client?.cpf ?? ""}
              onChange={applyMask(formatCpf)}
              onBlur={(e) => handleClientCpfBlur(e.target.value)}
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
            {!isEdit && !noCpf && (
              <p className="text-xs text-muted-foreground">
                Informe o CPF primeiro: se já houver cadastro na rede, avisamos
                aqui — você não precisa refazer nada.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input
                id="full_name"
                name="full_name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
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
            <div className="space-y-2">
              <Label htmlFor="gender">Gênero</Label>
              <select
                id="gender"
                name="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Selecione...</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
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
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address_number">Número *</Label>
              <Input
                id="address_number"
                name="address_number"
                required
                value={addressNumber}
                onChange={(e) => setAddressNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input
                id="complement"
                name="complement"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                placeholder="Apto, bloco..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="neighborhood">Bairro *</Label>
              <Input
                id="neighborhood"
                name="neighborhood"
                required
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
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
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">UF *</Label>
              <Input
                id="state"
                name="state"
                required
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">CEP *</Label>
              <Input
                id="zip_code"
                name="zip_code"
                inputMode="numeric"
                required
                value={zipCode}
                onChange={(e) => setZipCode(formatCep(e.target.value))}
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
