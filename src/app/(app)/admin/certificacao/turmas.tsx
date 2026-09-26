"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  POLITICAS_DE_ACESSO,
  POLITICA_AJUDA,
  POLITICA_ROTULO,
  TIPOS_DE_TURMA,
  TIPO_DE_TURMA_AJUDA,
  TIPO_DE_TURMA_ROTULO,
  agruparPorUnidade,
  chaveDaConvocacao,
  ehRedeToda,
  exigePrazo,
  oQueImpedeAbrir,
  resumoDaPrevia,
  rotuloDoAlcance,
  type CandidatoDaUnidade,
  type EstadoDaMatricula,
  type Medicao,
  type PoliticaDeAcesso,
  type TipoDeTurma,
} from "@/lib/certificacao";
import { ROLE_LABELS } from "@/lib/roles";
import { formatAnyDateBr, todayInBrazil } from "@/lib/dates";
import { ProgressoDaMissao } from "@/components/progresso-da-missao";
import {
  abrirTurma,
  encerrarTurma,
  medirUnidadeDaTurma,
  previaDaTurma,
} from "./actions";

export type UnidadeParaTurma = {
  id: string;
  name: string;
  franqueadora: boolean;
  /** Código da turma aberta em que ela já está, ou `null`. */
  turmaAberta: string | null;
};

export type MatriculaNaTurma = {
  user_id: string;
  full_name: string | null;
  role: string;
  status: EstadoDaMatricula;
  started_at: string | null;
  access_suspended_at: string | null;
};

export type TurmaAberta = {
  id: string;
  code: string | null;
  kind: string;
  note: string | null;
  created_at: string;
  access_policy: string;
  deadline: string | null;
  whole_network: boolean;
  unidades: { id: string; name: string; matriculas: MatriculaNaTurma[] }[];
};

const nomeDaUnidade = (u: UnidadeParaTurma) =>
  u.franqueadora ? `${u.name} (Franqueadora)` : u.name;

/**
 * ESCOLHER AS UNIDADES — uma, várias, ou a rede toda (0275).
 *
 * Pedido do dono: *"quando tiver 200 unidades selecionar 1 por vez será um
 * trabalhão"*. Daí a caixa "rede toda" e a busca por nome: com 200 unidades,
 * achar as 15 certas numa lista sem filtro seria outro trabalhão.
 *
 * ⚠️ Unidade que já está numa turma aberta aparece DESABILITADA, com o código
 * da turma. Esconder faria o Admin procurar uma unidade que "sumiu"; mostrar
 * habilitada faria a abertura falhar inteira no banco por causa dela.
 */
function SeletorDeUnidades({
  unidades,
  escolhidas,
  mudar,
}: {
  unidades: UnidadeParaTurma[];
  escolhidas: Set<string>;
  mudar: (novas: Set<string>) => void;
}) {
  const [busca, setBusca] = useState("");
  const livres = unidades.filter((u) => !u.turmaAberta);
  const todasLivresMarcadas =
    livres.length > 0 && livres.every((u) => escolhidas.has(u.id));
  const visiveis = unidades.filter((u) =>
    nomeDaUnidade(u).toLowerCase().includes(busca.trim().toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Unidades</Label>
        <span className="text-xs text-muted-foreground">
          {escolhidas.size} de {unidades.length} escolhida(s)
        </span>
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={todasLivresMarcadas}
          onChange={(e) =>
            mudar(e.currentTarget.checked ? new Set(livres.map((u) => u.id)) : new Set())
          }
          className="size-4 shrink-0 accent-primary"
        />
        Rede toda
        {livres.length < unidades.length && (
          <span className="text-xs font-normal text-muted-foreground">
            — {unidades.length - livres.length} unidade(s) já em turma aberta ficam de fora
          </span>
        )}
      </label>

      {unidades.length > 8 && (
        <Input
          value={busca}
          onChange={(e) => setBusca(e.currentTarget.value)}
          placeholder="Procurar unidade pelo nome…"
          className="h-9"
        />
      )}

      <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-input p-2">
        {visiveis.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            Nenhuma unidade com esse nome.
          </p>
        )}
        {visiveis.map((u) => (
          <label
            key={u.id}
            className={
              u.turmaAberta
                ? "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                : "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40 has-[:checked]:bg-accent/60"
            }
          >
            <input
              type="checkbox"
              disabled={Boolean(u.turmaAberta)}
              checked={escolhidas.has(u.id)}
              onChange={(e) => {
                const novas = new Set(escolhidas);
                if (e.currentTarget.checked) novas.add(u.id);
                else novas.delete(u.id);
                mudar(novas);
              }}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1 truncate">{nomeDaUnidade(u)}</span>
            {u.turmaAberta && (
              <span className="shrink-0 text-xs">já na turma {u.turmaAberta}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * ABRIR UMA TURMA — escolher as unidades, o tipo, e CONFERIR a lista.
 *
 * ⚠️ A prévia não é enfeite. Convocar é um ato que a equipe inteira sente:
 * chamar quem está de férias, ou deixar de fora quem precisa, gasta a
 * confiança no portão. Por isso a lista aparece marcada, item a item, e o
 * Admin desmarca quem não deve entrar ANTES de convocar.
 *
 * ⚠️ Quem o Admin desmarca é lembrado mesmo quando a prévia é refeita (ao
 * marcar outra unidade, por exemplo). Sem isso, acrescentar uma unidade
 * desfaria em silêncio todas as exclusões já feitas nas outras.
 */
function AbrirTurma({ unidades }: { unidades: UnidadeParaTurma[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [tipo, setTipo] = useState<TipoDeTurma>("novatos");
  // A prévia guarda A QUAL SELEÇÃO ela pertence. Sem isso, entre marcar uma
  // unidade nova e a resposta chegar, a tela mostraria a lista ANTIGA como se
  // fosse da seleção nova — e o Admin poderia convocar olhando a lista errada.
  const [previa, setPrevia] = useState<{
    chave: string;
    lista: CandidatoDaUnidade[];
  } | null>(null);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [politica, setPolitica] = useState<PoliticaDeAcesso>("mantem");
  const [prazo, setPrazo] = useState("");
  const [nota, setNota] = useState("");

  // "Hoje" no relógio brasileiro: o servidor roda em UTC, e usar a data dele
  // deixaria o Admin escolher uma data que o banco recusa como passada.
  const hoje = todayInBrazil();
  const impedimento = oQueImpedeAbrir({ politica, tipo, prazo: prazo || null, hoje });

  // A prévia é refeita quando as unidades ou o tipo mudam — com uma pequena
  // espera, para "rede toda" não disparar uma consulta por unidade marcada.
  const chaveAtual = `${tipo}|${[...escolhidas].sort().join(",")}`;
  useEffect(() => {
    if (escolhidas.size === 0) return;
    let cancelado = false;
    const t = setTimeout(async () => {
      const r = await previaDaTurma([...escolhidas], tipo);
      // Resposta de uma seleção que já mudou: descarta. É o que impede uma
      // consulta lenta de sobrescrever a prévia da seleção mais nova.
      if (cancelado) return;
      if (r.ok) setPrevia({ chave: chaveAtual, lista: r.candidatos ?? [] });
      else {
        setPrevia(null);
        toast.error(r.error ?? "Não foi possível montar a prévia.");
      }
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
    // `escolhidas` e `tipo` entram pela chave estável: o Set muda de
    // identidade a cada clique e dispararia a consulta sem necessidade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAtual]);

  // Só vale a prévia DA SELEÇÃO ATUAL. Qualquer outra é "ainda montando".
  const candidatos =
    escolhidas.size > 0 && previa?.chave === chaveAtual ? previa.lista : null;
  const carregando = escolhidas.size > 0 && candidatos === null;

  const grupos = useMemo(() => agruparPorUnidade(candidatos ?? []), [candidatos]);
  const convocados = (candidatos ?? []).filter((c) => !fora.has(chaveDaConvocacao(c)));
  const resumo = candidatos ? resumoDaPrevia(convocados) : null;
  const todasAtivas = unidades.map((u) => u.id);

  function alternarPessoa(chave: string, dentro: boolean) {
    const novo = new Set(fora);
    if (dentro) novo.delete(chave);
    else novo.add(chave);
    setFora(novo);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    for (const id of escolhidas) fd.append("clinic_ids", id);
    for (const c of convocados) fd.append("convocados", chaveDaConvocacao(c));
    fd.set("kind", tipo);
    fd.set("note", nota);
    fd.set("access_policy", tipo === "reciclagem" ? politica : "mantem");
    if (tipo === "reciclagem" && exigePrazo(politica)) fd.set("deadline", prazo);
    if (ehRedeToda([...escolhidas], todasAtivas)) fd.set("whole_network", "sim");

    startTransition(async () => {
      const r = await abrirTurma(fd);
      if (r.ok) {
        toast.success("Turma aberta. As pessoas já veem a convocação no Início.");
        setEscolhidas(new Set());
        setFora(new Set());
        setPrevia(null);
        setNota("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível abrir a turma.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Abrir uma turma</CardTitle>
        <CardDescription>
          Escolha uma unidade, várias, ou a rede toda. O sistema monta a lista;
          você confere antes de convocar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <SeletorDeUnidades
              unidades={unidades}
              escolhidas={escolhidas}
              mudar={setEscolhidas}
            />

            <div className="space-y-5">
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
                        // Voltar para "novatos" volta a política junto: a opção
                        // some da tela, e uma escolha invisível que ainda vale é
                        // o jeito mais fácil de o Admin ser surpreendido.
                        if (t !== "reciclagem") {
                          setPolitica("mantem");
                          setPrazo("");
                        }
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

              <div className="space-y-1.5">
                <Label htmlFor="note">Observação (opcional)</Label>
                <Input
                  id="note"
                  value={nota}
                  onChange={(e) => setNota(e.currentTarget.value)}
                  placeholder="Ex.: reciclagem do novo fluxo da agenda"
                />
              </div>
            </div>
          </div>

          {/* ⚠️ A POLÍTICA DE ACESSO SÓ APARECE NA RECICLAGEM. Em turma de
              novatos a pessoa ainda não tem acesso ao sistema real (a 0259 já
              a deixa fechada), então "suspender" seria um comando sem efeito. */}
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

          {escolhidas.size > 0 && (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
              {carregando || !candidatos ? (
                <p className="text-sm text-muted-foreground">Montando a lista…</p>
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-medium">
                      Quem será convocado: {resumo!.total} pessoa(s) em{" "}
                      {grupos.length} unidade(s)
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {candidatos.length === 0
                        ? "Ninguém entra nesta turma. Ou as unidades não têm gente com função que exige missão, ou todos já estão certificados."
                        : tipo === "reciclagem"
                          ? `${resumo!.jaCertificados} já certificado(s) e ${resumo!.novos} sem certificação. Quem já tem continua trabalhando no sistema real, conforme a política escolhida acima.`
                          : "Só quem ainda não tem certificação. Abra a unidade para desmarcar quem não deve entrar agora."}
                    </p>
                  </div>

                  {grupos.length > 0 && (
                    <div className="max-h-96 space-y-2 overflow-y-auto">
                      {grupos.map((g) => {
                        const dentro = g.pessoas.filter(
                          (p) => !fora.has(chaveDaConvocacao(p))
                        ).length;
                        return (
                          <details
                            key={g.clinic_id}
                            // Com poucas unidades, já abertas: dá para conferir
                            // de uma vez. Com muitas, fechadas — a lista inteira
                            // aberta seria a lista longa de novo.
                            open={grupos.length <= 3}
                            className="rounded-md border border-input bg-background"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent/40">
                              <span className="font-medium">{g.clinic_name}</span>
                              <span className="text-xs text-muted-foreground">
                                {dentro} de {g.pessoas.length} convocada(s)
                              </span>
                            </summary>
                            <div className="space-y-1 border-t p-2">
                              {g.pessoas.map((c) => {
                                const chave = chaveDaConvocacao(c);
                                return (
                                  <label
                                    key={chave}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40 has-[:checked]:bg-accent/60"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={!fora.has(chave)}
                                      onChange={(e) =>
                                        alternarPessoa(chave, e.currentTarget.checked)
                                      }
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
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                isPending ||
                carregando ||
                !candidatos ||
                convocados.length === 0 ||
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

/**
 * UMA UNIDADE DENTRO DA TURMA — o progresso é medido quando o Admin a abre.
 *
 * ⚠️ Sob demanda de propósito: uma turma da rede toda pode ter milhares de
 * pessoas, e medir todas ao abrir a tela seriam dezenas de milhares de
 * consultas ao banco de treino. A tela não abriria.
 */
function UnidadeDaTurma({
  turmaId,
  unidade,
}: {
  turmaId: string;
  unidade: TurmaAberta["unidades"][number];
}) {
  const [medidas, setMedidas] = useState<Record<string, Medicao> | null>(null);
  const [medindo, setMedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comecaram = unidade.matriculas.filter((m) => m.started_at).length;

  async function medir() {
    if (medidas || medindo) return;
    setMedindo(true);
    const r = await medirUnidadeDaTurma(turmaId, unidade.id);
    setMedindo(false);
    if (r.ok) setMedidas(r.medidas ?? {});
    else setErro(r.error ?? "Não foi possível medir agora.");
  }

  return (
    <details
      className="rounded-md border border-input"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void medir();
      }}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent/40">
        <span className="font-medium">{unidade.name}</span>
        <span className="text-xs text-muted-foreground">
          {unidade.matriculas.length} convocada(s) · {comecaram} começaram
        </span>
      </summary>
      <div className="border-t px-3 py-2">
        {medindo && <p className="py-1 text-xs text-muted-foreground">Medindo no treino…</p>}
        {erro && <p className="py-1 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
        <ul className="divide-y text-sm">
          {unidade.matriculas.map((m) => {
            const medicao = medidas?.[chaveDaConvocacao(m)];
            return (
              <li
                key={chaveDaConvocacao(m)}
                className="flex flex-wrap items-start justify-between gap-2 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.full_name ?? "(sem nome)"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                  </span>
                  {medicao && medicao.estado !== "nao_comecou" && (
                    <span className="mt-1.5 block">
                      <ProgressoDaMissao medicao={medicao} compacto />
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
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function ListaDeTurmas({
  turmas,
  erroAoLer,
}: {
  turmas: TurmaAberta[];
  erroAoLer: string | null;
}) {
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

  if (erroAoLer) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-amber-700 dark:text-amber-400">
          ⚠️ {erroAoLer}
        </CardContent>
      </Card>
    );
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
        const todas = t.unidades.flatMap((u) => u.matriculas);
        const comecaram = todas.filter((m) => m.started_at).length;
        return (
          <Card key={t.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {rotuloDoAlcance(
                      t.whole_network,
                      t.unidades.map((u) => u.name)
                    )}{" "}
                    <span className="font-normal text-muted-foreground">· {t.code}</span>
                  </CardTitle>
                  <CardDescription>
                    {t.kind === "reciclagem" ? "Reciclagem" : "Novatos"} · aberta em{" "}
                    {formatAnyDateBr(t.created_at)} · {comecaram} de {todas.length}{" "}
                    já começaram
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
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Abra uma unidade para ver o progresso de cada pessoa — ele é
                medido no treino na hora em que você abre.
              </p>
              {t.unidades.map((u) => (
                <UnidadeDaTurma key={u.id} turmaId={t.id} unidade={u} />
              ))}
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
  erroAoLer,
}: {
  unidades: UnidadeParaTurma[];
  turmas: TurmaAberta[];
  erroAoLer: string | null;
}) {
  return (
    <div className="space-y-4">
      <AbrirTurma unidades={unidades} />
      <ListaDeTurmas turmas={turmas} erroAoLer={erroAoLer} />
    </div>
  );
}
