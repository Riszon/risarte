"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";
import { enderecoDaFicha, pedeEspecialidades } from "@/lib/risartanos";
import { ROLE_LABELS, rolesForClinicType, type ClinicType } from "@/lib/roles";
import {
  CONTRACT_LABELS,
  CONTRACT_TYPES,
  GENDER_LABELS,
  GENDERS,
  MARITAL_LABELS,
  MARITAL_STATUSES,
  STAFF_PHOTO_BUCKET,
  type StaffMember,
} from "@/lib/staff";
import { createStaffMember, setStaffPhoto, updateStaffMember } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * O CADASTRO DO RISARTANO — o mesmo formulário para cadastrar e para editar.
 *
 * Saiu da janela pop-up e virou tela: o cadastro é longo (dados pessoais,
 * contato, endereço, contrato) e dividia espaço com o acesso, as unidades e os
 * dias de atendimento. Numa janela, tudo isso vira rolagem dentro de rolagem.
 */
export function FormularioDoRisartano({
  units,
  staff,
  photoUrl,
  canPickUnit = false,
  activeClinicName = null,
  activeClinicType = "franchise_unit",
  specialtyOptions = [],
  podeGerir = true,
  modoTreino = false,
  prefill,
  vincularUsuario,
}: {
  units: { id: string; name: string; type: ClinicType }[];
  staff?: StaffMember;
  photoUrl?: string | null;
  /** Admin/RH escolhem a unidade; Gerente/Franqueado usam a unidade ativa. */
  canPickUnit?: boolean;
  activeClinicName?: string | null;
  /** Tipo da unidade onde o cadastro nasce — decide as funções oferecidas. */
  activeClinicType?: ClinicType;
  specialtyOptions?: string[];
  /** Só quem gere edita; os demais leem. */
  podeGerir?: boolean;
  /** No treino a ficha é cópia do sistema real (0260): lá ninguém edita. */
  modoTreino?: boolean;
  /** Nome e e-mail vindos de um login sem cadastro ("Completar cadastro"). */
  prefill?: { fullName?: string; email?: string };
  /** Login a vincular ao novo cadastro (Admin, vindo de "Completar cadastro"). */
  vincularUsuario?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(staff);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // No cadastro (sem id ainda) a foto fica guardada e sobe após salvar.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const displayUrl = preview ?? photoUrl ?? undefined;
  const [maritalStatus, setMaritalStatus] = useState(staff?.maritalStatus ?? "");
  const showSpouse =
    maritalStatus === "married" || maritalStatus === "stable_union";

  // A UNIDADE decide as funções possíveis (a da Franqueadora não tem
  // recepcionista; a da unidade não tem Planner), então as duas andam juntas.
  const [clinicId, setClinicId] = useState(
    staff?.clinicId ?? units[0]?.id ?? ""
  );
  const tipoDaUnidade =
    units.find((u) => u.id === clinicId)?.type ?? activeClinicType;
  const funcoesPossiveis = rolesForClinicType(tipoDaUnidade);
  const [funcao, setFuncao] = useState(staff?.roleTitle ?? "");
  // Trocou de unidade e a função não existe lá: limpa em vez de gravar uma
  // função que aquela clínica não aceita.
  const funcaoValida = funcoesPossiveis.includes(
    funcao as (typeof funcoesPossiveis)[number]
  );
  const mostrarEspecialidades = funcaoValida && pedeEspecialidades(funcao);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

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
    setPendingFile(null);
    setPreview(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      if (isEdit) {
        const result = await updateStaffMember(staff!.id, formData);
        if (result.ok) {
          toast.success("Cadastro atualizado.");
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
      let photoFailed = false;
      if (pendingFile && result.staffId && result.clinicId) {
        const path = await uploadPhoto(result.clinicId, result.staffId, pendingFile);
        if (path) await setStaffPhoto(result.staffId, path);
        else photoFailed = true;
      }
      toast.success("Risartano cadastrado.");
      if (photoFailed) {
        toast.error("A foto não pôde ser enviada; adicione pela ficha.");
      }
      // Cadastro feito, a próxima pergunta é o acesso — a ficha já abre nela.
      router.push(
        `${enderecoDaFicha({ code: result.code ?? null, id: result.staffId! })}?aba=acesso`
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="flex items-center gap-4">
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt=""
            className="size-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ImagePlus className="size-6" />
          </span>
        )}
        {podeGerir && (
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
                {uploading ? "Enviando…" : displayUrl ? "Trocar foto" : "Adicionar foto"}
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
        )}
      </div>

      <fieldset disabled={!podeGerir || isPending} className="space-y-5">
        {vincularUsuario && (
          <input type="hidden" name="vincular_usuario" value={vincularUsuario} />
        )}

        {!isEdit &&
          (canPickUnit ? (
            <div>
              <Label htmlFor="clinic_id">Unidade *</Label>
              <select
                id="clinic_id"
                name="clinic_id"
                required
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
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

        <Secao titulo="Dados pessoais">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="full_name" rotulo="Nome completo *">
              <Input
                id="full_name"
                name="full_name"
                required
                defaultValue={staff?.fullName ?? prefill?.fullName ?? ""}
              />
            </Campo>
            <Campo id="preferred_name" rotulo="Como quer ser chamado(a) *">
              <Input
                id="preferred_name"
                name="preferred_name"
                required
                defaultValue={staff?.preferredName ?? ""}
              />
            </Campo>
            <Campo id="cpf" rotulo="CPF *">
              {/* A máscara aparece ENQUANTO se digita: com os pontos na tela,
                  falta ou sobra de número salta aos olhos antes de salvar. */}
              <Input
                id="cpf"
                name="cpf"
                required
                inputMode="numeric"
                placeholder="000.000.000-00"
                defaultValue={staff?.cpf ?? ""}
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
              />
            </Campo>
            <Campo id="birth_date" rotulo="Nascimento *">
              <Input
                id="birth_date"
                name="birth_date"
                type="date"
                required
                defaultValue={staff?.birthDate ?? ""}
              />
            </Campo>
            <Campo id="gender" rotulo="Gênero *">
              <select
                id="gender"
                name="gender"
                required
                defaultValue={staff?.gender ?? ""}
                className={selectClass}
              >
                <option value="">Selecione...</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="marital_status" rotulo="Estado civil *">
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
            </Campo>
            {showSpouse && (
              <>
                <Campo id="spouse_name" rotulo="Cônjuge — nome *">
                  <Input
                    id="spouse_name"
                    name="spouse_name"
                    required
                    defaultValue={staff?.spouseName ?? ""}
                  />
                </Campo>
                <Campo id="spouse_phone" rotulo="Cônjuge — telefone">
                  <Input
                    id="spouse_phone"
                    name="spouse_phone"
                    inputMode="numeric"
                    defaultValue={staff?.spousePhone ?? ""}
                    onChange={(e) => (e.target.value = formatPhone(e.target.value))}
                  />
                </Campo>
              </>
            )}
          </div>
        </Secao>

        <Secao titulo="Contato">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="whatsapp" rotulo="WhatsApp *">
              <Input
                id="whatsapp"
                name="whatsapp"
                required
                inputMode="numeric"
                placeholder="(00) 00000-0000"
                defaultValue={staff?.whatsapp ?? ""}
                onChange={(e) => (e.target.value = formatPhone(e.target.value))}
              />
            </Campo>
            <Campo
              id="email"
              rotulo="E-mail *"
              ajuda="É por ele que o cadastro encontra o login do sistema."
            >
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={staff?.email ?? prefill?.email ?? ""}
              />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Endereço">
          <div className="grid gap-3 sm:grid-cols-6">
            <Campo id="zip_code" rotulo="CEP *" className="sm:col-span-2">
              <Input
                id="zip_code"
                name="zip_code"
                required
                inputMode="numeric"
                placeholder="00000-000"
                defaultValue={staff?.zipCode ?? ""}
                onChange={(e) => (e.target.value = formatCep(e.target.value))}
              />
            </Campo>
            <Campo id="address" rotulo="Logradouro *" className="sm:col-span-3">
              <Input id="address" name="address" required defaultValue={staff?.address ?? ""} />
            </Campo>
            <Campo id="address_number" rotulo="Número *">
              <Input
                id="address_number"
                name="address_number"
                required
                defaultValue={staff?.addressNumber ?? ""}
              />
            </Campo>
            <Campo id="complement" rotulo="Complemento" className="sm:col-span-2">
              <Input
                id="complement"
                name="complement"
                defaultValue={staff?.complement ?? ""}
              />
            </Campo>
            <Campo id="neighborhood" rotulo="Bairro *" className="sm:col-span-2">
              <Input
                id="neighborhood"
                name="neighborhood"
                required
                defaultValue={staff?.neighborhood ?? ""}
              />
            </Campo>
            <Campo id="city" rotulo="Cidade *">
              <Input id="city" name="city" required defaultValue={staff?.city ?? ""} />
            </Campo>
            <Campo id="state" rotulo="UF *">
              <Input
                id="state"
                name="state"
                required
                maxLength={2}
                defaultValue={staff?.state ?? ""}
              />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Contrato">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="contract_type" rotulo="Regime *">
              <select
                id="contract_type"
                name="contract_type"
                required
                defaultValue={staff?.contractType ?? ""}
                className={selectClass}
              >
                <option value="">Selecione...</option>
                {CONTRACT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CONTRACT_LABELS[c]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="role_title"
              rotulo="Função na unidade *"
              ajuda="É ela que vai preencher o acesso ao sistema depois."
            >
              <select
                id="role_title"
                name="role_title"
                required
                value={funcaoValida ? funcao : ""}
                onChange={(e) => setFuncao(e.target.value)}
                className={selectClass}
              >
                <option value="">Selecione...</option>
                {funcoesPossiveis.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </Secao>

        {/* Especialidade é assunto de dentista: para recepção, TSB ou gerente a
            lista não diz nada e só atrapalha o preenchimento. */}
        {mostrarEspecialidades && (
          <Secao
            titulo="Especialidades do dentista"
            ajuda="Ajudam o sistema a sugerir o profissional certo em cada sessão."
          >
            {specialtyOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma especialidade cadastrada ainda.
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {specialtyOptions.map((sp) => (
                  <label key={sp} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="specialty"
                      value={sp}
                      defaultChecked={staff?.specialties?.includes(sp) ?? false}
                      className="accent-primary"
                    />
                    {sp}
                  </label>
                ))}
              </div>
            )}
          </Secao>
        )}

        <Campo id="notes" rotulo="Observações">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={staff?.notes ?? ""}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </Campo>
      </fieldset>

      {podeGerir && (
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isPending}>
            {isEdit ? "Salvar cadastro" : "Cadastrar"}
          </Button>
        </div>
      )}
      {!podeGerir && (
        <p className="text-xs text-muted-foreground">
          {modoTreino
            ? "No treino esta ficha é uma cópia do sistema real: para alterar, edite no sistema real — a mudança chega aqui sozinha."
            : "Você pode ver este cadastro, mas quem edita é a gestão da unidade dele."}
        </p>
      )}
    </form>
  );
}

function Secao({
  titulo,
  ajuda,
  children,
}: {
  titulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
        {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
      </div>
      {children}
    </div>
  );
}

function Campo({
  id,
  rotulo,
  ajuda,
  className,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
