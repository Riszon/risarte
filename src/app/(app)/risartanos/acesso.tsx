"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Globe, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { SO_O_ADMIN_PRINCIPAL } from "@/lib/admins";
import {
  AMBIENTES,
  AMBIENTE_AJUDA,
  AMBIENTE_ROTULO,
  ambientePermitido,
  type PermissoesDeAmbiente,
} from "@/lib/ambientes";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  definirAdmin,
  definirAmbiente,
  removeUserRole,
  resetUserPassword,
  setUserActive,
  updateRoleScope,
  type RoleAssignment,
} from "./acesso-actions";
import { linkStaffUser, unlinkStaffUser } from "./actions";
import { UnitAccessControl } from "./unit-access-control";
import { EnviarAcesso } from "./enviar-acesso";

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
  unidadeDoCadastro,
  funcaoPrevista,
  senhaSugerida,
  ambientes,
  treinoConfigurado,
  acesso,
  funcoes,
  clinicas,
  loginsLivres,
  isAdmin,
  isSelf,
  modoTreino = false,
  admin,
  enderecoDoSistema,
  enderecoDoTreino,
  whatsapp,
}: {
  /** null quando é um login sem cadastro de Risartano. */
  staffId: string | null;
  staffNome: string;
  staffEmail: string | null;
  staffAtivo: boolean;
  /** A unidade do cadastro — dar função FORA dela pede autorização na hora. */
  unidadeDoCadastro: { id: string; name: string } | null;
  /** A função escolhida no cadastro: chega pronta na ficha do acesso. */
  funcaoPrevista: UserRole | null;
  /** Sugestão vinda do servidor (sorteio não pode acontecer no desenho). */
  senhaSugerida: string;
  /** Os três ambientes desta pessoa (0259) e se o treino está ligado no servidor. */
  ambientes: PermissoesDeAmbiente;
  treinoConfigurado: boolean;
  acesso: StaffAccess | null;
  funcoes: FuncaoDoAcesso[];
  clinicas: Clinica[];
  loginsLivres: { id: string; label: string }[];
  isAdmin: boolean;
  isSelf: boolean;
  /** No treino tudo é cópia do sistema real (0260): só consulta, para todos. */
  modoTreino?: boolean;
  /** Admin Principal (0262): quem esta pessoa é e o que quem vê pode fazer. */
  admin?: {
    alvoEAdmin: boolean;
    alvoEPrincipal: boolean;
    podeDarOuTirar: boolean;
    /** Quem vê é Admin, mas o alvo é outro Admin e quem vê não é o Principal. */
    bloqueadoPorHierarquia: boolean;
  };
  /** Endereços dos ambientes, para a mensagem de acesso (21/09/2026). */
  enderecoDoSistema?: string | null;
  enderecoDoTreino?: string | null;
  /** WhatsApp do cadastro — sem ele não há botão do WhatsApp. */
  whatsapp?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [criando, setCriando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [loginEscolhido, setLoginEscolhido] = useState("");
  // A SENHA SÓ EXISTE NESTE INSTANTE: o banco guarda o embaralhado. Guardamos
  // a que acabou de ser definida (criação ou redefinição) só para montar a
  // mensagem que o Admin manda à pessoa.
  const [senhaRecente, setSenhaRecente] = useState<string | null>(null);

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
          {!isAdmin &&
            (modoTreino
              ? " O acesso se cria no sistema real."
              : " Fale com o Admin Master para criar o acesso.")}
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
            unidadeDoCadastro={unidadeDoCadastro}
            funcaoPrevista={funcaoPrevista}
            senhaSugerida={senhaSugerida}
            treinoConfigurado={treinoConfigurado}
            onCancelar={() => setCriando(false)}
            onCriado={(senha) => setSenhaRecente(senha)}
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

      {admin && (admin.alvoEAdmin || (admin.podeDarOuTirar && !modoTreino)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Crown className="size-4 text-gold-tinta" />
              {admin.alvoEPrincipal
                ? "Admin Principal"
                : admin.alvoEAdmin
                  ? "Admin"
                  : "Não é Admin"}
            </p>
            <p className="text-xs text-muted-foreground">
              {admin.alvoEPrincipal
                ? "O dono do sistema. Ninguém mais altera o acesso, as funções ou o Admin dele."
                : admin.alvoEAdmin
                  ? "Faz tudo no sistema, mas não altera o acesso de outros Admins nem o do Admin Principal."
                  : "Tornar Admin dá acesso a tudo no sistema. Só o Admin Principal faz isso."}
            </p>
          </div>
          {admin.podeDarOuTirar && !modoTreino && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" disabled={isPending}>
                  {admin.alvoEAdmin ? "Retirar Admin" : "Tornar Admin"}
                </Button>
              }
              title={admin.alvoEAdmin ? `Retirar o Admin de ${staffNome}?` : `Tornar ${staffNome} Admin?`}
              description={
                admin.alvoEAdmin ? (
                  <>
                    {staffNome} volta a ter só as funções por unidade. Fica
                    registrado na auditoria.
                  </>
                ) : (
                  <>
                    <b>{staffNome}</b> passa a ver e fazer <b>tudo</b> no sistema,
                    em todas as unidades. Fica sempre abaixo de você: não altera
                    o seu acesso nem o de outros Admins. Fica registrado na
                    auditoria.
                  </>
                )
              }
              destructive={admin.alvoEAdmin}
              confirmLabel={admin.alvoEAdmin ? "Retirar Admin" : "Tornar Admin"}
              successMessage={admin.alvoEAdmin ? "Admin retirado." : "Agora é Admin."}
              onConfirm={() => definirAdmin(acesso.userId, !admin.alvoEAdmin)}
            />
          )}
        </div>
      )}

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
            {modoTreino
              ? "No treino o acesso é cópia do sistema real: login, senha, funções e ambientes se alteram lá."
              : admin?.bloqueadoPorHierarquia
                ? SO_O_ADMIN_PRINCIPAL
                : "Quem cria login, redefine senha e muda função é o Admin Master. Aqui você vê o acesso para saber com quem falar — e o que já está valendo."}
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
            unidadeDoCadastro={unidadeDoCadastro}
            nome={staffNome}
            onFeito={() => router.refresh()}
          />
        )}
      </div>

      <Ambientes
        userId={acesso.userId}
        nome={staffNome}
        ambientes={ambientes}
        treinoConfigurado={treinoConfigurado}
        isAdmin={isAdmin}
      />

      {/* A MENSAGEM PRONTA PARA MANDAR (21/09/2026): endereço, login, senha
          provisória e TODAS as unidades com as funções. Só para quem gere o
          acesso, e nunca no treino (lá é cópia). */}
      {isAdmin && !modoTreino && (
        <EnviarAcesso
          nome={staffNome}
          email={acesso.email ?? staffEmail}
          senha={senhaRecente}
          unidades={acesso.units.map((u) => ({
            unidade: u.clinicName,
            funcao: u.roleLabel,
          }))}
          enderecoDoSistema={enderecoDoSistema}
          enderecoDoTreino={
            ambientePermitido(ambientes, "treino") ? enderecoDoTreino : null
          }
          sistemaLiberado={ambientePermitido(ambientes, "sistema")}
          whatsapp={whatsapp}
        />
      )}

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
                  setSenhaRecente(String(formData.get("password") ?? "") || null);
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

/**
 * OS TRÊS AMBIENTES (0259).
 *
 * O `sistema` e o `academy` são uma decisão guardada neste banco. O `treino` é
 * outro banco: ligar cria a pessoa lá, desligar bane o login de lá — por isso
 * ele é o único que pode devolver uma senha nova para o Admin anotar.
 */
function Ambientes({
  userId,
  nome,
  ambientes,
  treinoConfigurado,
  isAdmin,
}: {
  userId: string;
  nome: string;
  ambientes: PermissoesDeAmbiente;
  treinoConfigurado: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [senhaDoTreino, setSenhaDoTreino] = useState<string | null>(null);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Globe className="size-3.5" />
        Ambientes que esta pessoa acessa
      </p>
      <ul className="space-y-1.5">
        {AMBIENTES.map((a) => {
          const ligado = ambientePermitido(ambientes, a);
          return (
            <li
              key={a}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="text-sm font-medium">{AMBIENTE_ROTULO[a]}</span>
                <span className="block text-xs text-muted-foreground">
                  {AMBIENTE_AJUDA[a]}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    ligado
                      ? "text-xs font-medium text-emerald-700 dark:text-emerald-400"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {ligado ? "Liberado" : "Sem acesso"}
                </span>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending || (a === "treino" && !treinoConfigurado)}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await definirAmbiente(userId, a, !ligado);
                        if (!r.ok) {
                          toast.error(r.error ?? "Algo deu errado.");
                          return;
                        }
                        setSenhaDoTreino(r.senhaDoTreino ?? null);
                        toast.success(
                          ligado
                            ? `${AMBIENTE_ROTULO[a]} retirado de ${nome}.`
                            : `${AMBIENTE_ROTULO[a]} liberado para ${nome}.`
                        );
                        if (r.aviso) toast.warning(r.aviso);
                        router.refresh();
                      })
                    }
                  >
                    {ligado ? "Retirar" : "Liberar"}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {isAdmin && !treinoConfigurado && (
        <p className="text-xs text-muted-foreground">
          O treino ainda não está ligado neste servidor: falta cadastrar
          <b> TREINO_SUPABASE_URL</b> e <b>TREINO_SERVICE_ROLE_KEY</b> nas
          variáveis da Vercel.
        </p>
      )}
      {senhaDoTreino && (
        <p className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
          Login do treino criado. Senha provisória de lá:{" "}
          <b className="font-mono">{senhaDoTreino}</b> — anote e passe por um
          canal seguro. Quando {nome} trocar a senha no Perfil, ela passa a valer
          nos dois ambientes.
        </p>
      )}
    </div>
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
  unidadeDoCadastro,
  funcaoPrevista,
  senhaSugerida,
  treinoConfigurado,
  onCancelar,
  onCriado,
}: {
  staffId: string;
  nome: string;
  email: string | null;
  clinicas: Clinica[];
  unidadeDoCadastro: { id: string; name: string } | null;
  funcaoPrevista: UserRole | null;
  senhaSugerida: string;
  treinoConfigurado: boolean;
  onCancelar: () => void;
  onCriado?: (senha: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // A FICHA JÁ CHEGA PREENCHIDA com o que o cadastro disse: a unidade dele e a
  // função escolhida lá. Ao Admin sobra conferir e liberar — que é o pedido.
  const [funcoes, setFuncoes] = useState<RoleAssignment[]>(
    unidadeDoCadastro && funcaoPrevista
      ? [
          {
            clinicId: unidadeDoCadastro.id,
            role: funcaoPrevista,
            unitScope:
              clinicas.find((c) => c.id === unidadeDoCadastro.id)?.type ===
              "franchisor"
                ? "all"
                : undefined,
            unitIds: [],
          },
        ]
      : []
  );
  const [autorizado, setAutorizado] = useState(false);

  // Unidades FORA da unidade do cadastro: liberar acesso nelas é decisão à
  // parte, e o Admin autoriza no ato (decisão do dono, 17/09/2026).
  const foraDoCadastro = funcoes
    .filter((f) => f.clinicId !== unidadeDoCadastro?.id)
    .map((f) => clinicas.find((c) => c.id === f.clinicId)?.name ?? "outra unidade");
  const precisaAutorizar = foraDoCadastro.length > 0;

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
        // O treino precisa saber COM QUE função e em que unidade a pessoa entra
        // lá — os ids das clínicas são diferentes em cada banco, então vai o
        // nome da unidade.
        if (funcaoPrevista) formData.set("funcao_prevista", funcaoPrevista);
        if (unidadeDoCadastro) {
          formData.set("unidade_do_cadastro", unidadeDoCadastro.name);
        }
        startTransition(async () => {
          const r = await createUser(formData);
          if (r.ok) {
            toast.success("Acesso criado. Passe a senha por um canal seguro.");
            if (r.aviso) toast.warning(r.aviso);
            // A senha sobe para a ficha montar a mensagem de envio (21/09/2026).
            onCriado?.(String(formData.get("password") ?? "") || null);
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
        Tudo aqui já veio do cadastro de <b>{nome}</b>, inclusive uma senha
        provisória sorteada. Confira e libere — ou mude o que precisar.
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
            defaultValue={senhaSugerida}
            placeholder="Mín. 6 caracteres, letras e números"
          />
          <p className="text-xs text-muted-foreground">
            Sugerida pelo sistema, sem letras e números que se confundem ao
            ditar. A pessoa troca depois de entrar.
          </p>
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

      {/* OS AMBIENTES, escolhidos no mesmo ato de liberar o acesso (0259). O
          treino vem marcado de propósito: todo Risartano recém-chegado passa
          primeiro por lá. O sistema real é o que se decide caso a caso. */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ambientes liberados
        </p>
        {AMBIENTES.map((a) => (
          <label key={a} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={`ambiente_${a}`}
              defaultChecked={a !== "sistema"}
              disabled={a === "treino" && !treinoConfigurado}
              className="mt-0.5 accent-primary"
            />
            <span>
              <b>{AMBIENTE_ROTULO[a]}</b>
              <span className="block text-xs text-muted-foreground">
                {AMBIENTE_AJUDA[a]}
                {a === "treino" && !treinoConfigurado
                  ? " (ainda não ligado neste servidor)"
                  : ""}
              </span>
            </span>
          </label>
        ))}
      </div>

      {precisaAutorizar && (
        <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
          <input
            type="checkbox"
            checked={autorizado}
            onChange={(e) => setAutorizado(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span>
            <b>Autorizo o acesso fora da unidade do cadastro.</b> Isto libera{" "}
            {nome} também em {[...new Set(foraDoCadastro)].join(", ")}. Fica
            registrado na auditoria.
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={isPending || (precisaAutorizar && !autorizado)}
        >
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
  unidadeDoCadastro,
  nome,
  onFeito,
}: {
  userId: string;
  clinicas: Clinica[];
  unidades: { id: string; name: string }[];
  jaTemTodas: boolean;
  unidadeDoCadastro: { id: string; name: string } | null;
  nome: string;
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
  const nomeDaClinica =
    clinicas.find((c) => c.id === clinicId)?.name ?? "outra unidade";
  const foraDoCadastro = Boolean(
    unidadeDoCadastro && clinicId && clinicId !== unidadeDoCadastro.id
  );

  function atribuir() {
    return addUserRole(
      userId,
      clinicId,
      role,
      tipo === "franchisor" ? scope : undefined,
      tipo === "franchisor" ? unitIds : undefined
    );
  }

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
        {/* Fora da unidade do cadastro, o Admin autoriza no ato — é acesso a
            dados de outra unidade, não um detalhe do mesmo cadastro. */}
        {foraDoCadastro ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" disabled={isPending || !clinicId}>
                Adicionar
              </Button>
            }
            title="Liberar acesso em outra unidade?"
            description={
              <>
                Isto dá a <b>{nome}</b> a função de{" "}
                <b>{ROLE_LABELS[role]}</b> em <b>{nomeDaClinica}</b>, fora de{" "}
                {unidadeDoCadastro?.name ?? "a unidade do cadastro"}. Ela passa a
                ver os dados dessa unidade. Fica registrado na auditoria.
              </>
            }
            confirmLabel="Autorizar e liberar"
            successMessage="Função atribuída."
            onConfirm={() => atribuir()}
          />
        ) : (
          <Button
            variant="outline"
            disabled={isPending || !clinicId}
            onClick={() =>
              startTransition(async () => {
                const r = await atribuir();
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
        )}
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
