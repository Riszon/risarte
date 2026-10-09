import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_OPTIONS,
  auditActionLabel,
  auditEntityLabel,
} from "@/lib/audit-labels";
import { BRAZIL_TIME_ZONE, formatIsoDateBr, startOfTodayInBrazil } from "@/lib/dates";
import {
  MOTIVO_ROTULO,
  duracao,
  navegadorCurto,
  temposDoAcesso,
  type MotivoDeSaida,
} from "@/lib/acesso";

export const metadata: Metadata = { title: "Auditoria" };

type AuditRow = {
  id: number;
  user_id: string | null;
  clinic_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
};

type AcessoRow = {
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

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PERIODS: Record<string, number | null> = {
  hoje: 0,
  "7d": 7,
  "30d": 30,
  tudo: null,
};

function sinceFor(period: string): string | null {
  const days = PERIODS[period];
  if (days === null || days === undefined) return null;
  // "Hoje" é o dia BRASILEIRO: `setHours` zera o relógio da máquina, e no
  // servidor (UTC) o filtro pegava desde as 21h de ontem.
  const d = startOfTodayInBrazil();
  if (days === 0) {
    // já é o começo de hoje
  } else {
    d.setDate(d.getDate() - days);
  }
  return d.toISOString();
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AuditoriaPage(
  props: PageProps<"/admin/auditoria">
) {
  await requireAdminMaster();
  const supabase = await createClient();
  const searchParams = await props.searchParams;

  const colaborador =
    typeof searchParams.colaborador === "string" ? searchParams.colaborador : "";
  const acao = typeof searchParams.acao === "string" ? searchParams.acao : "";
  const entidade =
    typeof searchParams.entidade === "string" ? searchParams.entidade : "";
  const periodo =
    typeof searchParams.periodo === "string" &&
    searchParams.periodo in PERIODS
      ? searchParams.periodo
      : "30d";

  // Colaboradores com login (para o filtro e os rótulos) + todos os perfis.
  const [{ data: profiles }, { data: staffLinks }, { data: clinics }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name"),
      supabase
        .from("staff_members")
        .select("user_id, code")
        .not("user_id", "is", null),
      supabase.from("clinics").select("id, name"),
    ]);

  const staffCodeByUser = new Map<string, string>();
  for (const s of staffLinks ?? []) {
    if (s.user_id && s.code) staffCodeByUser.set(s.user_id, s.code);
  }
  const nameByUser = new Map<string, string>();
  const clinicById = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameByUser.set(p.id, p.full_name || p.email || "—");
  }
  for (const c of clinics ?? []) clinicById.set(c.id, c.name);

  const userOptions = (profiles ?? []).map((p) => {
    const code = staffCodeByUser.get(p.id);
    const name = p.full_name || p.email || "—";
    return { value: p.id, label: code ? `${name} (${code})` : name };
  });

  // Últimos acessos (last_sign_in_at do Auth) dos colaboradores com login.
  const lastAccess: { name: string; code: string | null; at: string | null }[] =
    [];
  try {
    const admin = createAdminClient();
    const { data: usersPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const lastById = new Map<string, string | null>();
    for (const u of usersPage?.users ?? []) {
      lastById.set(u.id, u.last_sign_in_at ?? null);
    }
    for (const [userId, code] of staffCodeByUser) {
      lastAccess.push({
        name: nameByUser.get(userId) ?? "—",
        code,
        at: lastById.get(userId) ?? null,
      });
    }
    lastAccess.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  } catch {
    // Sem service_role configurada: a seção de últimos acessos fica vazia.
  }

  // Registro de atividades.
  let query = supabase
    .from("audit_logs")
    .select("id, user_id, clinic_id, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(400);
  if (colaborador) query = query.eq("user_id", colaborador);
  if (acao) query = query.eq("action", acao);
  if (entidade) query = query.eq("entity_type", entidade);
  const since = sinceFor(periodo);
  if (since) query = query.gte("created_at", since);

  const { data: rows } = await query.returns<AuditRow[]>();

  // 0287: OS ACESSOS — um por login, com o dia, a entrada, a saída e o motivo,
  // o tempo em uso e o tempo parado. Mesmo filtro de pessoa e de período.
  // Tolerante: banco sem a 0287 devolve erro, e o quadro simplesmente não
  // aparece (com o aviso), em vez de derrubar a tela inteira.
  let acessosQuery = supabase
    .from("access_sessions")
    .select(
      "id, user_id, access_day, origin, started_at, last_activity_at, ended_at, end_reason, active_seconds, user_agent, ip"
    )
    .order("started_at", { ascending: false })
    .limit(300);
  if (colaborador) acessosQuery = acessosQuery.eq("user_id", colaborador);
  if (since) acessosQuery = acessosQuery.gte("started_at", since);
  const { data: acessos, error: erroDosAcessos } =
    await acessosQuery.returns<AcessoRow[]>();

  const selectClass =
    "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Acessos (logins) e ações no sistema, por colaborador.
        </p>
      </div>

      {lastAccess.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos acessos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lastAccess.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {l.code && (
                    <span className="mr-1 font-mono text-xs text-gold-tinta">
                      {l.code}
                    </span>
                  )}
                  {l.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {l.at ? fmt(l.at) : "nunca acessou"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FilterForm className="flex flex-wrap items-center gap-2">
        <select name="colaborador" defaultValue={colaborador} className={selectClass}>
          <option value="">Todos os colaboradores</option>
          {userOptions.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select name="acao" defaultValue={acao} className={selectClass}>
          <option value="">Todas as ações</option>
          {AUDIT_ACTION_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select name="entidade" defaultValue={entidade} className={selectClass}>
          <option value="">Todos os registros</option>
          {AUDIT_ENTITY_OPTIONS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <select name="periodo" defaultValue={periodo} className={selectClass}>
          <option value="hoje">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="tudo">Tudo</option>
        </select>
      </FilterForm>

      {/* 0287: OS ACESSOS. Um por login — é aqui que se vê cada dia em que a
          pessoa entrou, quanto tempo usou e como saiu. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Acessos ({acessos?.length ?? 0}
            {(acessos?.length ?? 0) === 300 ? "+" : ""})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Um registro por login. <strong>Em uso</strong> é o tempo em que a
            pessoa esteve mexendo no sistema; <strong>parado</strong> é o
            resto do acesso, com a tela aberta e sem uso.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {erroDosAcessos ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              O registro de acessos ainda não existe neste banco (falta rodar a
              migração 0287).
            </p>
          ) : !acessos || acessos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum acesso no período/filtros escolhidos.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Dia</th>
                  <th className="px-2 py-1.5 font-medium">Colaborador</th>
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
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1.5">
                          {a.user_id && staffCodeByUser.get(a.user_id) && (
                            <span className="font-mono text-xs text-gold-tinta">
                              {staffCodeByUser.get(a.user_id)}
                            </span>
                          )}
                          <span>
                            {a.user_id ? nameByUser.get(a.user_id) ?? "—" : "—"}
                          </span>
                        </span>
                      </td>
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
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {duracao(t.emUsoS)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {duracao(t.paradoS)}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        <span title={a.user_agent ?? undefined}>
                          {navegadorCurto(a.user_agent)}
                        </span>
                        {a.ip ? ` · ${a.ip}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Registro de atividades ({rows?.length ?? 0}
            {(rows?.length ?? 0) === 400 ? "+" : ""})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!rows || rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum registro no período/filtros escolhidos.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Data/hora</th>
                  <th className="px-2 py-1.5 font-medium">Colaborador</th>
                  <th className="px-2 py-1.5 font-medium">Ação</th>
                  <th className="px-2 py-1.5 font-medium">Registro</th>
                  <th className="px-2 py-1.5 font-medium">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                      {fmt(r.created_at)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {r.user_id && staffCodeByUser.get(r.user_id) && (
                          <span className="font-mono text-xs text-gold-tinta">
                            {staffCodeByUser.get(r.user_id)}
                          </span>
                        )}
                        <span>
                          {r.user_id ? nameByUser.get(r.user_id) ?? "—" : "—"}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.action === "login" || r.action === "logout" ? (
                        <Badge variant="secondary">
                          {auditActionLabel(r.action)}
                        </Badge>
                      ) : (
                        auditActionLabel(r.action)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {r.action === "login" || r.action === "logout"
                        ? "—"
                        : auditEntityLabel(r.entity_type)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {r.clinic_id ? clinicById.get(r.clinic_id) ?? "—" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
