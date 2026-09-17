"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FRANCHISOR_ROLES,
  ROLE_LABELS,
  UNIT_SCOPE_LABELS,
  rolesForClinicType,
  type ClinicType,
  type UnitScope,
  type UserRole,
} from "@/lib/roles";
import type { StaffAccess } from "@/lib/staff";
import {
  addUserRole,
  createUser,
  removeUserRole,
  resetUserPassword,
  setUserActive,
  updateRoleScope,
  type RoleAssignment,
} from "./acesso-actions";
import { linkStaffUser, unlinkStaffUser } from "./actions";
import { UnitAccessControl } from "./unit-access-control";

export type FuncaoDoAcesso = {
  id: string;
  clinicId: string;
  role: UserRole;
  clinicName: string;
  clinicType: ClinicType;
  unitScope: UnitScope | null;
  unitIds: string[];
};

type Clinica = { id: string; name: string; type: ClinicType };

/**
 * ACESSO AO SISTEMA — a metade que antes morava em "Usuários (acesso)".
 *
 * Quem NÃO é Admin Master lê e não mexe: é a mesma regra de antes, só que agora
 * ela é visível no mesmo lugar do cadastro, em vez de estar atrás de uma tela
 * que a pessoa nem enxergava no menu.
 */
export function AcessoDoRisartano({
  staffId,
  staffNome,
  staffEmail,
  staffAtivo,
  acesso,
  funcoes,
  clinicas,
  loginsLivres,
  isAdmin,
  isSelf,
}: {
  /** null quando é um login sem cadastro de Risartano. */
  staffId: string | null;
  staffNome: string;
  staffEmail: string | null;
  staffAtivo: boolean;
  acesso: StaffAccess | null;
  funcoes: FuncaoDoAcesso[];
  clinicas: Clinica[];
  loginsLivres: { id: string; label: string }[];
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [criando, setCriando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [loginEscolhido, setLoginEscolhido] = useState("");

  function rodar(
    acao: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string
  ) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(sucesso);
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  // ---- sem login ------------------------------------------------------------
  if (!acesso) {
    return (
      <Bloco>
        <Cabecalho />
        <p className="text-sm text-muted-foreground">
          {staffNome} está no cadastro, mas <b>não entra no sistema</b>.
          {!isAdmin && " Fale com o Admin Master para criar o acesso."}
        </p>
        {isAdmin && staffId && !criando && !vinculando && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setCriando(true)}>
              Criar acesso
            </Button>
            {loginsLivres.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setVinculando(true)}
              >
                Vincular a um login que já existe
              </Button>
            )}
          </div>
        )}
        {isAdmin && staffId && criando && (
          <CriarAcesso
            staffId={staffId}
            nome={staffNome}
            email={staffEmail}
            clinicas={clinicas}
            onCancelar={() => setCriando(false)}
          />
        )}
        {isAdmin && staffId && vinculando && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={loginEscolhido}
              onChange={(e) => setLoginEscolhido(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Escolha o login...</option>
              {loginsLivres.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!loginEscolhido || isPending}
              onClick={() =>
                rodar(
                  () => linkStaffUser(staffId, loginEscolhido),
                  "Login vinculado."
                )
              }
            >
              Vincular
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVinculando(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </Bloco>
    );
  }

  // ---- com login ------------------------------------------------------------
  return (
    <Bloco>
      <Cabecalho />

      {!staffAtivo && acesso.loginActive && staffId && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <b>{staffNome} saiu da equipe e o login continua entrando.</b> Desative
          o acesso abaixo, ou reative o cadastro se a saída foi engano.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {acesso.email ?? "login vinculado"}
          </p>
          <p className="text-xs text-muted-foreground">
            {acesso.loginActive
              ? "Entra no sistema com este e-mail."
              : "Acesso desativado — não consegue entrar."}
          </p>
        </div>
        {isAdmin && !isSelf && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              rodar(
                () => setUserActive(acesso.userId, !acesso.loginActive),
                acesso.loginActive ? "Acesso desativado." : "Acesso reativado."
              )
            }
          >
            {acesso.loginActive ? "Desativar acesso" : "Reativar acesso"}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Funções por unidade
        </p>
        {funcoes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma função atribuída — o login existe, mas não abre nada.
          </p>
        )}
        {funcoes.map((f) => (
          <div key={f.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{f.clinicName}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[f.role]}
                  {FRANCHISOR_ROLES.includes(f.role) &&
                    ` · ${UNIT_SCOPE_LABELS[f.unitScope ?? "all"]}`}
                </p>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  aria-label={`Remover função em ${f.clinicName}`}
                  onClick={() =>
                    rodar(
                      () => removeUserRole(f.id, acesso.userId),
                      "Função removida."
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            {isAdmin && FRANCHISOR_ROLES.includes(f.role) && (
              <EscopoDaFuncao
                funcao={f}
                userId={acesso.userId}
                unidades={clinicas.filter((c) => c.type === "franchise_unit")}
                onSalvo={() => router.refresh()}
              />
            )}
          </div>
        ))}
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Quem cria login, redefine senha e muda função é o Admin Master. Aqui
            você vê o acesso para saber com quem falar — e o que já está valendo.
          </p>
        )}
        {isAdmin && (
          <NovaFuncao
            userId={acesso.userId}
            clinicas={clinicas.filter(
              (c) => !funcoes.some((f) => f.clinicId === c.id)
            )}
            unidades={clinicas.filter((c) => c.type === "franchise_unit")}
            jaTemTodas={funcoes.length > 0}
            onFeito={() => router.refresh()}
          />
        )}
      </div>

      {isAdmin && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              startTransition(async () => {
                const r = await resetUserPassword(acesso.userId, formData);
                if (r.ok) {
                  toast.success("Senha redefinida. Informe por um canal seguro.");
                  form.reset();
                } else {
                  toast.error(r.error ?? "Algo deu errado.");
                }
              });
            }}
            className="space-y-2 rounded-lg border p-3"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Senha
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="password" className="text-xs">
                  Nova senha provisória
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="text"
                  required
                  minLength={6}
                  placeholder="Mín. 6 caracteres, letras e números"
                />
              </div>
              <Button type="submit" variant="outline" disabled={isPending}>
                Redefinir senha
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A pessoa entra com ela e troca depois. Passe por um canal seguro —
              nunca por aqui.
            </p>
          </form>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={{
                    pathname: "/admin/auditoria",
                    query: { colaborador: acesso.userId },
                  }}
                />
              }
            >
              Ver auditoria
            </Button>
            {staffId && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  rodar(
                    () => unlinkStaffUser(staffId),
                    "Vínculo desfeito (o login continua existindo)."
                  )
                }
              >
                Desvincular do cadastro
              </Button>
            )}
          </div>
        </>
      )}
    </Bloco>
  );
}

function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <section
      id="acesso"
      className="scroll-mt-4 space-y-3 rounded-xl border bg-card p-4"
    >
      {children}
    </section>
  );
}

function Cabecalho() {
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
      <KeyRound className="size-4 text-gold-tinta" />
      Acesso ao sistema
    </h2>
  );
}

// -----------------------------------------------------------------------------
// Criar o acesso a partir do cadastro
// -----------------------------------------------------------------------------

function CriarAcesso({
  staffId,
  nome,
  email,
  clinicas,
  onCancelar,
}: {
  staffId: string;
  nome: string;
  email: string | null;
  clinicas: Clinica[];
  onCancelar: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [funcoes, setFuncoes] = useState<RoleAssignment[]>([]);

  function tipoDa(clinicId: string): ClinicType | undefined {
    return clinicas.find((c) => c.id === clinicId)?.type;
  }

  function livres(indice: number): Clinica[] {
    const usadas = funcoes.filter((_, i) => i !== indice).map((f) => f.clinicId);
    return clinicas.filter((c) => !usadas.includes(c.id));
  }

  function adicionar() {
    const disponiveis = livres(-1);
    if (disponiveis.length === 0) {
      toast.error("Já há uma função para cada clínica.");
      return;
    }
    const primeira = disponiveis[0];
    setFuncoes((prev) => [
      ...prev,
      {
        clinicId: primeira.id,
        role: rolesForClinicType(primeira.type)[0],
        unitScope: primeira.type === "franchisor" ? "all" : undefined,
        unitIds: [],
      },
    ]);
  }

  function atualizar(indice: number, patch: Partial<RoleAssignment>) {
    setFuncoes((prev) =>
      prev.map((f, i) => {
        if (i !== indice) return f;
        const proxima = { ...f, ...patch };
        if (patch.clinicId) {
          const tipo = tipoDa(patch.clinicId) ?? "franchise_unit";
          const permitidas = rolesForClinicType(tipo);
          if (!permitidas.includes(proxima.role)) proxima.role = permitidas[0];
          if (tipo === "franchisor") {
            proxima.unitScope = proxima.unitScope ?? "all";
            proxima.unitIds = proxima.unitIds ?? [];
          } else {
            proxima.unitScope = undefined;
            proxima.unitIds = [];
          }
        }
        return proxima;
      })
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        formData.set("full_name", nome);
        formData.set("assignments", JSON.stringify(funcoes));
        formData.set("staff_member_id", staffId);
        startTransition(async () => {
          const r = await createUser(formData);
          if (r.ok) {
            toast.success("Acesso criado. Passe a senha por um canal seguro.");
            onCancelar();
            router.refresh();
          } else {
            toast.error(r.error ?? "Algo deu errado.");
          }
        });
      }}
      className="space-y-3 rounded-lg border border-gold/40 bg-gold/5 p-3"
    >
      <p className="text-xs text-muted-foreground">
        O login nasce ligado a este cadastro. O nome vem dele; o e-mail vem do
        cadastro e pode ser trocado.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="acesso-email">E-mail de entrada *</Label>
          <Input
            id="acesso-email"
            name="email"
            type="email"
            required
            defaultValue={email ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acesso-senha">Senha provisória *</Label>
          <Input
            id="acesso-senha"
            name="password"
            type="text"
            required
            minLength={6}
            placeholder="Mín. 6 caracteres, letras e números"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Função por clínica
        </p>
        {funcoes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Sem função, o login entra e não abre nada. Adicione pelo menos uma.
          </p>
        )}
        {funcoes.map((f, i) => {
          const itensClinica = livres(i).map((c) => ({
            value: c.id,
            label: c.name,
          }));
          const itensFuncao = (rolesForClinicType(tipoDa(f.clinicId) ?? "franchise_unit")).map(
            (role) => ({ value: role, label: ROLE_LABELS[role] })
          );
          return (
            <div key={i} className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Escolha
                    rotulo={i === 0 ? "Clínica" : undefined}
                    itens={itensClinica}
                    valor={f.clinicId}
                    aoMudar={(v) => atualizar(i, { clinicId: v })}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Escolha
                    rotulo={i === 0 ? "Função" : undefined}
                    itens={itensFuncao}
                    valor={f.role}
                    aoMudar={(v) => atualizar(i, { role: v as UserRole })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remover função"
                  onClick={() =>
                    setFuncoes((prev) => prev.filter((_, x) => x !== i))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {tipoDa(f.clinicId) === "franchisor" && (
                <UnitAccessControl
                  idPrefix={`novo-acesso-${i}`}
                  units={clinicas.filter((c) => c.type === "franchise_unit")}
                  scope={f.unitScope ?? "all"}
                  unitIds={f.unitIds ?? []}
                  onChange={(scope, unitIds) =>
                    atualizar(i, { unitScope: scope, unitIds })
                  }
                />
              )}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={adicionar}>
          Adicionar função
        </Button>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Criando..." : "Criar acesso"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Dar mais uma função a quem já tem login
// -----------------------------------------------------------------------------

function NovaFuncao({
  userId,
  clinicas,
  unidades,
  jaTemTodas,
  onFeito,
}: {
  userId: string;
  clinicas: Clinica[];
  unidades: { id: string; name: string }[];
  jaTemTodas: boolean;
  onFeito: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [clinicId, setClinicId] = useState(clinicas[0]?.id ?? "");
  const tipo = clinicas.find((c) => c.id === clinicId)?.type;
  const [role, setRole] = useState<UserRole>(
    tipo ? rolesForClinicType(tipo)[0] : "receptionist"
  );
  const [scope, setScope] = useState<UnitScope>("all");
  const [unitIds, setUnitIds] = useState<string[]>([]);

  if (clinicas.length === 0) {
    return jaTemTodas ? (
      <p className="text-xs text-muted-foreground">
        Já existe uma função para cada clínica. Para trocar, remova a atual e
        adicione a nova.
      </p>
    ) : null;
  }

  function trocarClinica(id: string) {
    setClinicId(id);
    const t = clinicas.find((c) => c.id === id)?.type;
    if (t) {
      const permitidas = rolesForClinicType(t);
      if (!permitidas.includes(role)) setRole(permitidas[0]);
    }
    setScope("all");
    setUnitIds([]);
  }

  const itensClinica = clinicas.map((c) => ({ value: c.id, label: c.name }));
  const itensFuncao = rolesForClinicType(tipo ?? "franchise_unit").map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
  }));

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Escolha
            rotulo="Clínica"
            itens={itensClinica}
            valor={clinicId}
            aoMudar={trocarClinica}
          />
        </div>
        <div className="flex-1">
          <Escolha
            rotulo="Função"
            itens={itensFuncao}
            valor={role}
            aoMudar={(v) => setRole(v as UserRole)}
          />
        </div>
        <Button
          variant="outline"
          disabled={isPending || !clinicId}
          onClick={() =>
            startTransition(async () => {
              const r = await addUserRole(
                userId,
                clinicId,
                role,
                tipo === "franchisor" ? scope : undefined,
                tipo === "franchisor" ? unitIds : undefined
              );
              if (r.ok) {
                toast.success("Função atribuída.");
                onFeito();
              } else {
                toast.error(r.error ?? "Algo deu errado.");
              }
            })
          }
        >
          Adicionar
        </Button>
      </div>
      {tipo === "franchisor" && (
        <UnitAccessControl
          idPrefix="funcao-nova"
          units={unidades}
          scope={scope}
          unitIds={unitIds}
          onChange={(s, ids) => {
            setScope(s);
            setUnitIds(ids);
          }}
        />
      )}
    </div>
  );
}

function EscopoDaFuncao({
  funcao,
  userId,
  unidades,
  onSalvo,
}: {
  funcao: FuncaoDoAcesso;
  userId: string;
  unidades: { id: string; name: string }[];
  onSalvo: () => void;
}) {
  const [scope, setScope] = useState<UnitScope>(funcao.unitScope ?? "all");
  const [unitIds, setUnitIds] = useState<string[]>(funcao.unitIds);
  const [isPending, startTransition] = useTransition();

  const mudou =
    scope !== (funcao.unitScope ?? "all") ||
    [...unitIds].sort().join(",") !== [...funcao.unitIds].sort().join(",");

  return (
    <div className="space-y-2">
      <UnitAccessControl
        idPrefix={`escopo-${funcao.id}`}
        units={unidades}
        scope={scope}
        unitIds={unitIds}
        onChange={(s, ids) => {
          setScope(s);
          setUnitIds(ids);
        }}
      />
      {mudou && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await updateRoleScope(funcao.id, userId, scope, unitIds);
              if (r.ok) {
                toast.success("Acesso às unidades atualizado.");
                onSalvo();
              } else {
                toast.error(r.error ?? "Algo deu errado.");
              }
            })
          }
        >
          <ShieldCheck className="mr-1 size-4" />
          Salvar acesso às unidades
        </Button>
      )}
    </div>
  );
}

function Escolha({
  rotulo,
  itens,
  valor,
  aoMudar,
}: {
  rotulo?: string;
  itens: { value: string; label: string }[];
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      {rotulo && <Label className="text-xs">{rotulo}</Label>}
      <Select
        items={itens}
        value={valor}
        onValueChange={(v) => v !== null && aoMudar(v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(value) =>
              itens.find((i) => i.value === value)?.label ?? "Selecionar"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {itens.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
