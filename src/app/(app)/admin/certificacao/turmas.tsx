"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ESTADO_ROTULO,
  TIPOS_DE_TURMA,
  TIPO_DE_TURMA_AJUDA,
  TIPO_DE_TURMA_ROTULO,
  exigePrazo,
  oQueImpedeAbrir,
  POLITICAS_DE_ACESSO,
  POLITICA_AJUDA,
  POLITICA_ROTULO,
  resumoDaPrevia,
  type Candidato,
  type EstadoDaMatricula,
  type PoliticaDeAcesso,
  type TipoDeTurma,
  type Medicao,
} from "@/lib/certificacao";
import { ProgressoDaMissao } from "@/components/progresso-da-missao";
import { ROLE_LABELS } from "@/lib/roles";
import { formatAnyDateBr, todayInBrazil } from "@/lib/dates";
import { abrirTurma, encerrarTurma, previaDaTurma } from "./actions";

type Unidade = { id: string; name: string };

export type TurmaAberta = {
  id: string;
  code: string | null;
  kind: string;
  note: string | null;
  created_at: string;
  access_policy: string;
  deadline: string | null;
  clinic_name: string;
  matriculas: {
    user_id: string;
    full_name: string | null;
    role: string;
    status: EstadoDaMatricula;
    started_at: string | null;
    access_suspended_at: string | null;
    email: string | null;
    medicao: Medicao | null;
  }[];
};

/**
 * ABRIR UMA TURMA — escolher a unidade, o tipo, e CONFERIR a lista.
 *
 * ⚠️ A prévia não é enfeite. Convocar é um ato que a equipe inteira sente:
 * chamar quem está de férias, ou deixar de fora quem precisa, gasta a
 * confiança no portão. Por isso a lista aparece marcada, item a item, e o
 * Admin desmarca quem não deve entrar ANTES de convocar.
 */
function AbrirTurma({ unidades }: { unidades: Unidade[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [unidade, setUnidade] = useState("");
  const [tipo, setTipo] = useState<TipoDeTurma>("novatos");
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [politica, setPolitica] = useState<PoliticaDeAcesso>("mantem");
  const [prazo, setPrazo] = useState("");

  // "Hoje" no relógio brasileiro: o servidor roda em UTC, e usar a data dele
  // deixaria o Admin escolher uma data que o banco recusa como passada.
  const hoje = todayInBrazil();
  const impedimento = oQueImpedeAbrir({ politica, tipo, prazo: prazo || null, hoje });

  async function verPrevia(idUnidade: string, qualTipo: TipoDeTurma) {
    if (!idUnidade) {
      setCandidatos(null);
      return;
    }
    setCarregando(true);
    const r = await previaDaTurma(idUnidade, qualTipo);
    setCarregando(false);
    if (r.ok) setCandidatos(r.candidatos ?? []);
    else {
      setCandidatos(null);
      toast.error(r.error ?? "Não foi possível montar a prévia.");
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await abrirTurma(formData);
      if (r.ok) {
        toast.success("Turma aberta. As pessoas já veem a convocação no Início.");
        setCandidatos(null);
        setUnidade("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível abrir a turma.");
      }
    });
  }

  const resumo = candidatos ? resumoDaPrevia(candidatos) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Abrir uma turma</CardTitle>
        <CardDescription>
          Escolha a unidade e o tipo. O sistema monta a lista; você confere
          antes de convocar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clinic_id">Unidade</Label>
              <select
                id="clinic_id"
                name="clinic_id"
                value={unidade}
                onChange={(e) => {
                  setUnidade(e.currentTarget.value);
                  void verPrevia(e.currentTarget.value, tipo);
                }}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Escolha a unidade…</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note">Observação (opcional)</Label>
              <Input
                id="note"
                name="note"
                placeholder="Ex.: reciclagem do novo fluxo da agenda"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tipo de turma</legend>
            {TIPOS_DE_TURMA.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer gap-3 rounded-lg border border-input p-3 hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
              >
                <input
                  type="radio"
                  name="kind"
                  value={t}
                  checked={tipo === t}
                  onChange={() => {
                    setTipo(t);
                    // Voltar para "novatos" tem de voltar a política junto: a
                    // opção some da tela, e uma escolha invisível que ainda
                    // vale é o jeito mais fácil de o Admin ser surpreendido.
                    if (t !== "reciclagem") {
                      setPolitica("mantem");
                      setPrazo("");
                    }
                    void verPrevia(unidade, t);
                  }}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {TIPO_DE_TURMA_ROTULO[t]}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {TIPO_DE_TURMA_AJUDA[t]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {/* ⚠️ A POLÍTICA DE ACESSO SÓ APARECE NA RECICLAGEM.
              Em turma de novatos a pessoa ainda não tem acesso ao sistema real
              (a 0259 já a deixa fechada), então "suspender" seria um comando
              sem efeito — e mostrar a opção faria o Admin acreditar que travou
              alguém que continua exatamente como estava. */}
          {tipo === "reciclagem" && (
            <fieldset className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <legend className="px-1 text-sm font-medium">
                O acesso ao sistema real durante a reciclagem
              </legend>
              {POLITICAS_DE_ACESSO.map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer gap-3 rounded-lg border border-input bg-background p-3 hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
                >
                  <input
                    type="radio"
                    name="access_policy"
                    value={p}
                    checked={politica === p}
                    onChange={() => setPolitica(p)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {POLITICA_ROTULO[p]}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {POLITICA_AJUDA[p]}
                    </span>
                  </span>
                </label>
              ))}

              {exigePrazo(politica) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Label htmlFor="deadline" className="text-sm">
                    Data limite:
                  </Label>
                  <Input
                    id="deadline"
                    name="deadline"
                    type="date"
                    value={prazo}
                    min={hoje}
                    onChange={(e) => setPrazo(e.currentTarget.value)}
                    className="h-9 w-44"
                  />
                  <span className="text-xs text-muted-foreground">
                    Na madrugada seguinte, quem não tiver concluído é suspenso.
                  </span>
                </div>
              )}

              {politica === "suspende_agora" && (
                <p className="rounded-md bg-background p-3 text-sm">
                  ⚠️ <strong>As pessoas marcadas perdem o acesso ao sistema real
                  assim que você convocar</strong>, e só voltam ao concluir a
                  reciclagem. Encerrar a turma também devolve o acesso.
                </p>
              )}

              {impedimento && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {impedimento}
                </p>
              )}
            </fieldset>
          )}

          {carregando && (
            <p className="text-sm text-muted-foreground">Montando a lista…</p>
          )}

          {candidatos && !carregando && (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <div>
                <h3 className="text-sm font-medium">
                  Quem será convocado ({resumo!.total})
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {resumo!.total === 0
                    ? "Ninguém entra nesta turma. Ou a unidade não tem gente com função que exige missão, ou todos já estão certificados."
                    : tipo === "reciclagem"
                      ? `${resumo!.jaCertificados} já certificado(s) e ${resumo!.novos} sem certificação. Quem já tem continua trabalhando no sistema real enquanto refaz a missão.`
                      : "Só quem ainda não tem certificação. Desmarque quem não deve entrar agora."}
                </p>
              </div>

              {candidatos.length > 0 && (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-input bg-background p-2">
                  {candidatos.map((c) => (
                    <label
                      key={`${c.user_id}-${c.role}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40 has-[:checked]:bg-accent/60"
                    >
                      <input
                        type="checkbox"
                        name="convocados"
                        value={c.user_id}
                        defaultChecked
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {c.full_name ?? "(sem nome)"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ROLE_LABELS[c.role]}
                      </span>
                      {c.ja_certificado && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                          já certificado
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                isPending ||
                !candidatos ||
                candidatos.length === 0 ||
                impedimento !== null
              }
            >
              {isPending ? "Convocando…" : "Convocar e abrir a turma"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ListaDeTurmas({ turmas }: { turmas: TurmaAberta[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function fechar(id: string) {
    startTransition(async () => {
      const r = await encerrarTurma(id);
      if (r.ok) {
        toast.success("Turma encerrada.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível encerrar.");
      }
    });
  }

  if (turmas.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma turma aberta. Enquanto não houver turma, ninguém tem missão
          para cumprir — e é assim mesmo: a pessoa usa o treino livremente até
          ser convocada.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {turmas.map((t) => {
        const comecaram = t.matriculas.filter((m) => m.started_at).length;
        return (
          <Card key={t.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {t.clinic_name}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {t.code}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {t.kind === "reciclagem" ? "Reciclagem" : "Novatos"} · aberta
                    em {formatAnyDateBr(t.created_at)} ·{" "}
                    {comecaram} de {t.matriculas.length} já começaram
                    {t.access_policy === "suspende_agora"
                      ? " · acesso SUSPENSO até concluir"
                      : t.access_policy === "prazo" && t.deadline
                        ? ` · prazo até ${formatAnyDateBr(t.deadline)}`
                        : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => fechar(t.id)}
                >
                  Encerrar turma
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {t.matriculas.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {m.full_name ?? "(sem nome)"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                      </span>
                      {m.medicao && (
                        <span className="mt-1.5 block">
                          <ProgressoDaMissao medicao={m.medicao} compacto />
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={
                          m.started_at
                            ? "rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                            : "rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                        }
                      >
                        {ESTADO_ROTULO[m.status]}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {m.access_suspended_at
                          ? "acesso ao real suspenso"
                          : m.started_at
                            ? `começou em ${formatAnyDateBr(m.started_at)}`
                            : "ainda não aceitou — nada está sendo contado"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function Turmas({
  unidades,
  turmas,
}: {
  unidades: Unidade[];
  turmas: TurmaAberta[];
}) {
  return (
    <div className="space-y-4">
      <AbrirTurma unidades={unidades} />
      <ListaDeTurmas turmas={turmas} />
    </div>
  );
}
