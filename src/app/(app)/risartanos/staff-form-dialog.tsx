"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, KeyRound, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { STAFF_PHOTO_BUCKET, type StaffAccess } from "@/lib/staff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CONTRACT_LABELS,
  CONTRACT_TYPES,
  GENDER_LABELS,
  GENDERS,
  MARITAL_LABELS,
  MARITAL_STATUSES,
  type StaffMember,
} from "@/lib/staff";
import {
  createStaffMember,
  linkStaffUser,
  setStaffPhoto,
  setStaffUnitActive,
  unlinkStaffUser,
  updateStaffMember,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function StaffFormDialog({
  units,
  staff,
  photoUrl,
  access,
  isAdmin = false,
  linkableUsers = [],
  canPickUnit = false,
  activeClinicName = null,
  manageClinicIds = [],
  specialtyOptions = [],
}: {
  units: { id: string; name: string }[];
  staff?: StaffMember;
  photoUrl?: string;
  /** Login vinculado (H4.1 Lote 2b) — null/undefined = sem acesso. */
  access?: StaffAccess | null;
  isAdmin?: boolean;
  linkableUsers?: { id: string; label: string }[];
  /** Admin/RH escolhem a unidade; Gerente/Franqueado usam a unidade ativa. */
  canPickUnit?: boolean;
  activeClinicName?: string | null;
  /** Unidades que o usuário atual gere (pode ativar/inativar o status ali). */
  manageClinicIds?: string[];
  /** Especialidades disponíveis (dos procedimentos) — H4.5 Lote 3. */
  specialtyOptions?: string[];
}) {
  const router = useRouter();
  const isEdit = Boolean(staff);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // No cadastro (sem id ainda) a foto fica guardada e sobe após salvar.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const displayUrl = preview ?? photoUrl;
  // H4.1 Lote 2b: vínculo manual com um usuário de acesso (Admin).
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkUserId, setLinkUserId] = useState("");
  // Cônjuge só quando casado(a)/união estável.
  const [maritalStatus, setMaritalStatus] = useState(
    staff?.maritalStatus ?? ""
  );
  const showSpouse =
    maritalStatus === "married" || maritalStatus === "stable_union";

  // Libera a prévia local da memória ao trocar/fechar.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function resetPhoto() {
    setPendingFile(null);
    setPreview(null);
  }

  /** Sobe o arquivo ao Storage e devolve o caminho salvo (ou null se falhar). */
  async function uploadPhoto(clinicId: string, staffId: string, file: File) {
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${clinicId}/${staffId}/photo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(STAFF_PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type });
    return error ? null : path;
  }

  // Edição: sobe na hora. Cadastro: guarda + mostra prévia (sobe ao salvar).
  function handlePick(file: File) {
    if (isEdit && staff) {
      setUploading(true);
      startTransition(async () => {
        const path = await uploadPhoto(staff.clinicId, staff.id, file);
        if (!path) {
          setUploading(false);
          toast.error("Não foi possível enviar a foto.");
          return;
        }
        const result = await setStaffPhoto(staff.id, path);
        setUploading(false);
        if (result.ok) {
          toast.success("Foto atualizada.");
          router.refresh();
        } else {
          toast.error(result.error ?? "Algo deu errado.");
        }
      });
      return;
    }
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }

  function handleRemove() {
    if (isEdit && staff) {
      startTransition(async () => {
        const result = await setStaffPhoto(staff.id, "");
        if (result.ok) {
          toast.success("Foto removida.");
          router.refresh();
        } else {
          toast.error(result.error ?? "Algo deu errado.");
        }
      });
      return;
    }
    resetPhoto();
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && !isEdit) resetPhoto();
    if (!next) {
      setShowLinkPicker(false);
      setLinkUserId("");
    }
  }

  function handleLink() {
    if (!staff || !linkUserId) return;
    startTransition(async () => {
      const result = await linkStaffUser(staff.id, linkUserId);
      if (result.ok) {
        toast.success("Usuário vinculado.");
        setShowLinkPicker(false);
        setLinkUserId("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleUnlink() {
    if (!staff) return;
    startTransition(async () => {
      const result = await unlinkStaffUser(staff.id);
      if (result.ok) {
        toast.success("Vínculo desfeito (o login continua existindo).");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleUnitActive(clinicId: string, active: boolean) {
    if (!staff) return;
    startTransition(async () => {
      const result = await setStaffUnitActive(staff.id, clinicId, active);
      if (result.ok) {
        toast.success(
          active ? "Ativado nesta unidade." : "Inativado nesta unidade."
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      if (isEdit) {
        const result = await updateStaffMember(staff!.id, formData);
        if (result.ok) {
          toast.success("Risartano atualizado.");
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error ?? "Algo deu errado.");
        }
        return;
      }
      const result = await createStaffMember(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Algo deu errado.");
        return;
      }
      // Cadastrado: sobe a foto escolhida (se houver) e vincula ao novo id.
      let photoFailed = false;
      if (pendingFile && result.staffId && result.clinicId) {
        const path = await uploadPhoto(
          result.clinicId,
          result.staffId,
          pendingFile
        );
        if (path) await setStaffPhoto(result.staffId, path);
        else photoFailed = true;
      }
      toast.success("Risartano cadastrado.");
      if (photoFailed) {
        toast.error("A foto não pôde ser enviada; adicione pela edição.");
      }
      resetPhoto();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Novo Risartano
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Editar ${staff!.code ?? "Risartano"}`
              : "Novo Risartano"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt=""
              className="size-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ImagePlus className="size-6" />
            </span>
          )}
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePick(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? "Enviando…"
                  : displayUrl
                    ? "Trocar foto"
                    : "Adicionar foto"}
              </Button>
              {displayUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading || isPending}
                  onClick={handleRemove}
                >
                  Remover
                </Button>
              )}
            </div>
            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                {pendingFile
                  ? "A foto será enviada ao salvar o cadastro."
                  : "Opcional. Você também pode adicionar depois."}
              </p>
            )}
          </div>
        </div>

        {isEdit && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
              <KeyRound className="size-3.5" />
              Acesso ao sistema
            </p>
            {access ? (
              <>
                <p className="text-sm">
                  Login: <span className="font-medium">{access.email ?? "vinculado"}</span>
                  {!access.loginActive && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (acesso desativado)
                    </span>
                  )}
                </p>
                {access.units.length > 0 ? (
                  <div className="text-xs">
                    <p className="font-medium text-muted-foreground">
                      Unidades e cargos (status por unidade):
                    </p>
                    <ul className="mt-1 space-y-1">
                      {access.units.map((u) => {
                        const managed =
                          isAdmin || manageClinicIds.includes(u.clinicId);
                        const unitInactive =
                          staff?.inactiveUnitIds.includes(u.clinicId) ?? false;
                        return (
                          <li
                            key={u.clinicId}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span>
                              {u.clinicName}
                              <span className="ml-1 font-medium text-gold">
                                {u.roleLabel}
                              </span>
                            </span>
                            {managed ? (
                              <span className="flex items-center gap-1.5">
                                <Badge
                                  variant={unitInactive ? "outline" : "secondary"}
                                >
                                  {unitInactive ? "Inativo" : "Ativo"}
                                </Badge>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={isPending}
                                  onClick={() =>
                                    handleUnitActive(u.clinicId, unitInactive)
                                  }
                                >
                                  {unitInactive ? "Reativar" : "Inativar"}
                                </Button>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {unitInactive ? "Inativo" : "Ativo"} · outra unidade
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Login ainda sem função definida.
                  </p>
                )}
                {staff && !staff.isActive && access.loginActive && (
                  <p className="text-xs font-medium text-destructive">
                    Atenção: o colaborador está inativo, mas o login ainda está
                    ativo.
                  </p>
                )}
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/usuarios/${access.userId}`} />}
                    >
                      Gerenciar acesso
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={{
                            pathname: "/admin/auditoria",
                            query: { colaborador: access.userId },
                          }}
                        />
                      }
                    >
                      Ver auditoria
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={handleUnlink}
                    >
                      Desvincular
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Este Risartano não tem login no sistema.
                  {!isAdmin && " Fale com o Admin para criar o acesso."}
                </p>
                {isAdmin && !showLinkPicker && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={{
                            pathname: "/admin/usuarios/novo",
                            query: { risartano: staff!.id },
                          }}
                        />
                      }
                    >
                      Criar acesso
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowLinkPicker(true)}
                    >
                      Vincular usuário existente
                    </Button>
                  </div>
                )}
                {isAdmin && showLinkPicker && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={linkUserId}
                      onChange={(e) => setLinkUserId(e.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    >
                      <option value="">Escolha o usuário...</option>
                      {linkableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!linkUserId || isPending}
                      onClick={handleLink}
                    >
                      Vincular
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowLinkPicker(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {!isEdit &&
            (canPickUnit ? (
              <div>
                <Label htmlFor="clinic_id">Unidade *</Label>
                <select
                  id="clinic_id"
                  name="clinic_id"
                  required
                  className={selectClass}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
                Será cadastrado na sua unidade:{" "}
                <span className="font-medium">{activeClinicName ?? "—"}</span>.
              </p>
            ))}

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Dados pessoais
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" name="full_name" required defaultValue={staff?.fullName ?? ""} />
            </div>
            <div>
              <Label htmlFor="preferred_name">Como quer ser chamado(a) *</Label>
              <Input id="preferred_name" name="preferred_name" required defaultValue={staff?.preferredName ?? ""} />
            </div>
            <div>
              <Label htmlFor="cpf">CPF *</Label>
              <Input id="cpf" name="cpf" required placeholder="000.000.000-00" defaultValue={staff?.cpf ?? ""} />
            </div>
            <div>
              <Label htmlFor="birth_date">Nascimento *</Label>
              <Input id="birth_date" name="birth_date" type="date" required defaultValue={staff?.birthDate ?? ""} />
            </div>
            <div>
              <Label htmlFor="gender">Gênero *</Label>
              <select id="gender" name="gender" required defaultValue={staff?.gender ?? ""} className={selectClass}>
                <option value="">Selecione...</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="marital_status">Estado civil *</Label>
              <select
                id="marital_status"
                name="marital_status"
                required
                value={maritalStatus}
                onChange={(e) => setMaritalStatus(e.target.value)}
                className={selectClass}
              >
                <option value="">Selecione...</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m} value={m}>
                    {MARITAL_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            {showSpouse && (
              <>
                <div>
                  <Label htmlFor="spouse_name">Cônjuge — nome *</Label>
                  <Input id="spouse_name" name="spouse_name" required defaultValue={staff?.spouseName ?? ""} />
                </div>
                <div>
                  <Label htmlFor="spouse_phone">Cônjuge — telefone</Label>
                  <Input id="spouse_phone" name="spouse_phone" defaultValue={staff?.spousePhone ?? ""} />
                </div>
              </>
            )}
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Contato
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="whatsapp">WhatsApp *</Label>
              <Input id="whatsapp" name="whatsapp" required placeholder="(00) 00000-0000" defaultValue={staff?.whatsapp ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">E-mail *</Label>
              <Input id="email" name="email" type="email" required defaultValue={staff?.email ?? ""} />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Endereço
          </p>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="zip_code">CEP *</Label>
              <Input id="zip_code" name="zip_code" required placeholder="00000-000" defaultValue={staff?.zipCode ?? ""} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="address">Logradouro *</Label>
              <Input id="address" name="address" required defaultValue={staff?.address ?? ""} />
            </div>
            <div>
              <Label htmlFor="address_number">Número *</Label>
              <Input id="address_number" name="address_number" required defaultValue={staff?.addressNumber ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input id="complement" name="complement" defaultValue={staff?.complement ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="neighborhood">Bairro *</Label>
              <Input id="neighborhood" name="neighborhood" required defaultValue={staff?.neighborhood ?? ""} />
            </div>
            <div>
              <Label htmlFor="city">Cidade *</Label>
              <Input id="city" name="city" required defaultValue={staff?.city ?? ""} />
            </div>
            <div>
              <Label htmlFor="state">UF *</Label>
              <Input id="state" name="state" required maxLength={2} defaultValue={staff?.state ?? ""} />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Contrato
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contract_type">Regime *</Label>
              <select id="contract_type" name="contract_type" required defaultValue={staff?.contractType ?? ""} className={selectClass}>
                <option value="">Selecione...</option>
                {CONTRACT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CONTRACT_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <p className="text-xs text-muted-foreground">
                O cargo/função vem do <b>acesso</b> do Risartano (por unidade).
              </p>
            </div>
          </div>

          {/* H4.5 Lote 3: especialidades do profissional (alimentam a sugestão
              de profissional por sessão). Opcional. */}
          <div>
            <Label>Especialidades (para sugerir nas sessões)</Label>
            {specialtyOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma especialidade cadastrada ainda.
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                {specialtyOptions.map((sp) => (
                  <label
                    key={sp}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="specialty"
                      value={sp}
                      defaultChecked={staff?.specialties?.includes(sp) ?? false}
                    />
                    {sp}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="notes">Observações</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={staff?.notes ?? ""}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
