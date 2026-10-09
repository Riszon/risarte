import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatIsoDateBr } from "@/lib/dates";
import {
  MOTIVO_ROTULO,
  duracao,
  navegadorCurto,
  temposDoAcesso,
  type MotivoDeSaida,
} from "@/lib/acesso";
import {
  CLASSE_DO_SELECT,
  dataEHora,
  desde,
  hora,
  lerPeriodo,
  texto,
  type Banco,
  type Pessoas,
} from "./comum";

export type Acesso = {
  id: string;
  user_id: string | null;
  access_day: string;
  origin: "login" | "retomada";
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  end_reason: MotivoDeSaida | null;
  active_seconds: number;
  user_agent: string | null;
  ip: string | null;
};

export const COLUNAS_DO_ACESSO =
  "id, user_id, access_day, origin, started_at, last_activity_at, ended_at, end_reason, active_seconds, user_agent, ip";

/** A tabela de acessos — usada aqui e em "O dia de uma pessoa". */
export function TabelaDeAcessos({
  acessos,
  pessoas,
  mostrarQuem = true,
}: {
  acessos: Acesso[];
  pessoas: Pessoas;
  mostrarQuem?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-2 py-1.5 font-medium">Dia</th>
          {mostrarQuem && <th className="px-2 py-1.5 font-medium">Pessoa</th>}
          <th className="px-2 py-1.5 font-medium">Entrou</th>
          <th className="px-2 py-1.5 font-medium">Saída</th>
          <th className="px-2 py-1.5 font-medium">Em uso</th>
          <th className="px-2 py-1.5 font-medium">Parado</th>
          <th className="px-2 py-1.5 font-medium">Navegador · IP</th>
        </tr>
      </thead>
      <tbody>
        {acessos.map((a) => {
          const t = temposDoAcesso({
            startedAt: a.started_at,
            lastActivityAt: a.last_activity_at,
            endedAt: a.ended_at,
            activeSeconds: a.active_seconds,
          });
          return (
            <tr key={a.id} className="border-b last:border-0">
              <td className="whitespace-nowrap px-2 py-1.5">
                {formatIsoDateBr(a.access_day)}
              </td>
              {mostrarQuem && (
                <td className="px-2 py-1.5">
                  {a.user_id && pessoas.codigoPorUsuario.get(a.user_id) && (
                    <span className="mr-1.5 font-mono text-xs text-gold-tinta">
                      {pessoas.codigoPorUsuario.get(a.user_id)}
                    </span>
                  )}
                  {a.user_id ? pessoas.nomes.usuarios.get(a.user_id) ?? "—" : "—"}
                </td>
              )}
              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                {hora(a.started_at)}
                {a.origin === "retomada" && (
                  <span
                    className="ml-1 text-[10px]"
                    title="A pessoa já estava logada quando o registro passou a existir, ou entrou por link de acesso."
                  >
                    (já logado)
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {a.ended_at ? (
                  <span className="text-muted-foreground">
                    {hora(a.ended_at)} ·{" "}
                    {a.end_reason ? MOTIVO_ROTULO[a.end_reason] : "encerrado"}
                  </span>
                ) : (
                  <Badge variant="secondary">
                    aberto · última atividade {hora(a.last_activity_at)}
                  </Badge>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{duracao(t.emUsoS)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                {duracao(t.paradoS)}
              </td>
              <td className="px-2 py-1.5 text-xs text-muted-foreground">
                <span title={a.user_agent ?? undefined}>{navegadorCurto(a.user_agent)}</span>
                {a.ip ? ` · ${a.ip}` : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export async function VisaoAcessos({
  supabase,
  pessoas,
  searchParams,
}: {
  supabase: Banco;
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const colaborador = texto(searchParams.colaborador);
  const periodo = lerPeriodo(searchParams.periodo);

  // Último login de cada pessoa (do serviço de autenticação).
  const ultimos: { nome: string; codigo: string | null; em: string | null }[] = [];
  try {
    const admin = createAdminClient();
    const { data: pagina } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const porId = new Map<string, string | null>();
    for (const u of pagina?.users ?? []) porId.set(u.id, u.last_sign_in_at ?? null);
    for (const [userId, codigo] of pessoas.codigoPorUsuario) {
      ultimos.push({
        nome: pessoas.nomes.usuarios.get(userId) ?? "—",
        codigo,
        em: porId.get(userId) ?? null,
      });
    }
    ultimos.sort((a, b) => (b.em ?? "").localeCompare(a.em ?? ""));
  } catch {
    // Sem a chave de serviço configurada: o quadro fica de fora.
  }

  // Tolerante: banco sem a 0287 devolve erro, e o quadro só avisa.
  let consulta = supabase
    .from("access_sessions")
    .select(COLUNAS_DO_ACESSO)
    .order("started_at", { ascending: false })
    .limit(300);
  if (colaborador) consulta = consulta.eq("user_id", colaborador);
  const inicio = desde(periodo);
  if (inicio) consulta = consulta.gte("started_at", inicio);
  const { data: acessos, error } = await consulta.returns<Acesso[]>();

  return (
    <div className="space-y-4">
      <FilterForm className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="visao" value="acessos" />
        <select name="colaborador" defaultValue={colaborador} className={CLASSE_DO_SELECT}>
          <option value="">Todas as pessoas</option>
          {pessoas.opcoes.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select name="periodo" defaultValue={periodo} className={CLASSE_DO_SELECT}>
          <option value="hoje">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="tudo">Tudo</option>
        </select>
      </FilterForm>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Acessos ({acessos?.length ?? 0}
            {(acessos?.length ?? 0) === 300 ? "+" : ""})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Um registro por login. <strong>Em uso</strong> é o tempo em que a pessoa
            esteve mexendo no sistema; <strong>parado</strong> é o resto do acesso,
            com a tela aberta e sem uso.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              O registro de acessos ainda não existe neste banco (falta rodar a
              migração 0287).
            </p>
          ) : !acessos || acessos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum acesso no período e nos filtros escolhidos.
            </p>
          ) : (
            <TabelaDeAcessos acessos={acessos} pessoas={pessoas} />
          )}
        </CardContent>
      </Card>

      {ultimos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Último login de cada pessoa</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ultimos.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {l.codigo && (
                    <span className="mr-1 font-mono text-xs text-gold-tinta">{l.codigo}</span>
                  )}
                  {l.nome}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {l.em ? dataEHora(l.em) : "nunca acessou"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
