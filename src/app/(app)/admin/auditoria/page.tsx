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

const PERIODS: Record<string, number | null> = {
  hoje: 0,
  "7d": 7,
  "30d": 30,
  tudo: null,
};

function sinceFor(period: string): string | null {
  const days = PERIODS[period];
  if (days === null || days === undefined) return null;
  const d = new Date();
  if (days === 0) {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(d.getDate() - days);
  }
  return d.toISOString();
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
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
                    <span className="mr-1 font-mono text-xs text-gold">
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
                          <span className="font-mono text-xs text-gold">
                            {staffCodeByUser.get(r.user_id)}
                          </span>
                        )}
                        <span>
                          {r.user_id ? nameByUser.get(r.user_id) ?? "—" : "—"}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.action === "login" ? (
                        <Badge variant="secondary">
                          {auditActionLabel(r.action)}
                        </Badge>
                      ) : (
                        auditActionLabel(r.action)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {r.action === "login"
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
