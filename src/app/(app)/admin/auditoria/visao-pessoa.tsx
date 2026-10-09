import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import { duracao, temposDoAcesso } from "@/lib/acesso";
import {
  COLUNAS_DA_ALTERACAO,
  contarAlteracoes,
  lerDia,
  type Alteracao,
} from "@/lib/auditoria-alteracoes";
import {
  addDaysIso,
  formatIsoDateBr,
  startOfDayInBrazil,
  todayInBrazil,
} from "@/lib/dates";
import {
  CLASSE_DO_SELECT,
  comClientes,
  enderecoDaVisao,
  hora,
  texto,
  type Banco,
  type Pessoas,
} from "./comum";
import { LinhaDaAlteracao } from "./linha-da-alteracao";
import {
  COLUNAS_DO_ACESSO,
  TabelaDeAcessos,
  type Acesso,
} from "./visao-acessos";
import {
  COLUNAS_DA_ACAO,
  DetalhesDaAcao,
  destinoDaAcao,
  type Acao,
} from "./visao-acoes";

const TETO = 1000;

function Numero({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs uppercase text-muted-foreground">{titulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

type Item =
  | { quando: string; tipo: "acao"; acao: Acao }
  | { quando: string; tipo: "alteracao"; alteracao: Alteracao };

export async function VisaoPessoa({
  supabase,
  pessoas,
  searchParams,
}: {
  supabase: Banco;
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const colaborador = texto(searchParams.colaborador);
  const hoje = todayInBrazil();
  const dia = lerDia(searchParams.dia) || hoje;

  const filtro = (
    <FilterForm className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="visao" value="pessoa" />
      <select name="colaborador" defaultValue={colaborador} className={CLASSE_DO_SELECT}>
        <option value="">Escolha a pessoa…</option>
        {pessoas.opcoes.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
      <input
        type="date"
        name="dia"
        defaultValue={dia}
        max={hoje}
        className={CLASSE_DO_SELECT}
      />
      {colaborador && (
        <span className="flex gap-3 pl-1 text-sm">
          <Link
            href={enderecoDaVisao("pessoa", { colaborador, dia: addDaysIso(dia, -1) })}
            className="underline underline-offset-2"
          >
            ← dia anterior
          </Link>
          {dia < hoje && (
            <Link
              href={enderecoDaVisao("pessoa", { colaborador, dia: addDaysIso(dia, 1) })}
              className="underline underline-offset-2"
            >
              dia seguinte →
            </Link>
          )}
        </span>
      )}
    </FilterForm>
  );

  if (!colaborador) {
    return (
      <div className="space-y-4">
        {filtro}
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          Escolha uma pessoa para ver o dia dela.
        </p>
      </div>
    );
  }

  // O dia é o dia BRASILEIRO: da meia-noite daqui até a meia-noite seguinte.
  const inicio = startOfDayInBrazil(dia).toISOString();
  const fim = startOfDayInBrazil(addDaysIso(dia, 1)).toISOString();

  const [acessosR, acoesR, alteracoesR] = await Promise.all([
    supabase
      .from("access_sessions")
      .select(COLUNAS_DO_ACESSO)
      .eq("user_id", colaborador)
      .eq("access_day", dia)
      .order("started_at")
      .returns<Acesso[]>(),
    supabase
      .from("audit_logs")
      .select(COLUNAS_DA_ACAO)
      .eq("user_id", colaborador)
      .gte("created_at", inicio)
      .lt("created_at", fim)
      .order("created_at")
      .limit(TETO)
      .returns<Acao[]>(),
    supabase
      .from("audit_changes")
      .select(COLUNAS_DA_ALTERACAO)
      .eq("user_id", colaborador)
      .gte("occurred_at", inicio)
      .lt("occurred_at", fim)
      .order("id")
      .limit(TETO)
      .returns<Alteracao[]>(),
  ]);

  const acessos = acessosR.data ?? [];
  const acoes = acoesR.data ?? [];
  const alteracoes = alteracoesR.data ?? [];
  const comNomes = await comClientes(supabase, pessoas, alteracoes);

  let emUso = 0;
  let parado = 0;
  for (const a of acessos) {
    const t = temposDoAcesso({
      startedAt: a.started_at,
      lastActivityAt: a.last_activity_at,
      endedAt: a.ended_at,
      activeSeconds: a.active_seconds,
    });
    emUso += t.emUsoS;
    parado += t.paradoS;
  }
  const primeiro = acessos[0]?.started_at ?? null;
  const ultima = acessos.reduce<string | null>(
    (m, a) => (m === null || a.last_activity_at > m ? a.last_activity_at : m),
    null
  );

  const nasTelas = acoes.filter((a) => a.action !== "login" && a.action !== "logout");
  const porAcao = new Map<string, number>();
  for (const a of nasTelas) porAcao.set(a.action, (porAcao.get(a.action) ?? 0) + 1);
  const resumoDasAcoes = [...porAcao.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([acao, n]) => `${auditActionLabel(acao).toLowerCase()} ${n}`)
    .join(" · ");
  const c = contarAlteracoes(alteracoes);

  const linha: Item[] = [
    ...acoes.map((a): Item => ({ quando: a.created_at, tipo: "acao", acao: a })),
    ...alteracoes.map(
      (a): Item => ({ quando: a.occurred_at, tipo: "alteracao", alteracao: a })
    ),
  ].sort((a, b) => a.quando.localeCompare(b.quando));

  const nome = pessoas.nomes.usuarios.get(colaborador) ?? "Pessoa";
  const nada = acessos.length === 0 && linha.length === 0;

  return (
    <div className="space-y-4">
      {filtro}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {nome} — {formatIsoDateBr(dia)}
            {dia === hoje ? " (hoje)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {nada ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum acesso e nenhuma ação neste dia.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Numero titulo="Entrou" valor={primeiro ? hora(primeiro) : "—"} />
                <Numero titulo="Última atividade" valor={ultima ? hora(ultima) : "—"} />
                <Numero titulo="Em uso" valor={duracao(emUso)} />
                <Numero titulo="Parado" valor={duracao(parado)} />
                <Numero
                  titulo="Ações nas telas"
                  valor={String(nasTelas.length)}
                  nota={resumoDasAcoes || undefined}
                />
                <Numero
                  titulo="Alterações"
                  valor={String(alteracoes.length)}
                  nota={
                    alteracoes.length > 0
                      ? `cadastrou ${c.cadastrou} · alterou ${c.alterou} · excluiu ${c.excluiu} — em ${c.registros} registro(s)`
                      : undefined
                  }
                />
              </div>
              {acessos.length > 0 && (
                <div className="overflow-x-auto">
                  <TabelaDeAcessos acessos={acessos} pessoas={pessoas} mostrarQuem={false} />
                </div>
              )}
            </>
          )}
          {(acessosR.error || alteracoesR.error) && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              Parte do registro ainda não existe neste banco
              {acessosR.error ? " (acessos: falta a migração 0287)" : ""}
              {alteracoesR.error ? " (alterações: falta a migração 0288)" : ""}.
            </p>
          )}
        </CardContent>
      </Card>

      {linha.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">O dia, em ordem ({linha.length})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Do primeiro ao último ato. As linhas com seta são alterações: clique
              para ver o antes e o depois.
              {(acoes.length === TETO || alteracoes.length === TETO) &&
                ` Dia muito cheio: aparecem os primeiros ${TETO} de cada tipo.`}
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              {linha.map((it) =>
                it.tipo === "alteracao" ? (
                  <LinhaDaAlteracao
                    key={`m${it.alteracao.id}`}
                    a={it.alteracao}
                    pessoas={comNomes}
                    mostrarQuem={false}
                    soHora
                  />
                ) : (
                  <LinhaDaAcao key={`a${it.acao.id}`} a={it.acao} pessoas={pessoas} />
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LinhaDaAcao({ a, pessoas }: { a: Acao; pessoas: Pessoas }) {
  const acesso = a.action === "login" || a.action === "logout";
  const destino = destinoDaAcao(a);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-2 py-1.5 pl-[1.6rem] text-sm last:border-0">
      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {hora(a.created_at, true)}
      </span>
      {acesso ? (
        <Badge variant="outline">{auditActionLabel(a.action)}</Badge>
      ) : (
        <>
          <span className="text-muted-foreground">{auditActionLabel(a.action)}</span>
          {destino ? (
            <Link href={destino} className="font-medium underline underline-offset-2">
              {auditEntityLabel(a.entity_type)}
            </Link>
          ) : (
            <span className="font-medium">{auditEntityLabel(a.entity_type)}</span>
          )}
        </>
      )}
      <DetalhesDaAcao a={a} pessoas={pessoas} />
    </div>
  );
}
