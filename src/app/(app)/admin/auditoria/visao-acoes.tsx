import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_OPTIONS,
  auditActionLabel,
  auditEntityLabel,
} from "@/lib/audit-labels";
import { formatarDetalhe, rotuloDoDetalhe } from "@/lib/auditoria-alteracoes";
import {
  CLASSE_DO_SELECT,
  dataEHora,
  desde,
  lerPeriodo,
  texto,
  type Banco,
  type Pessoas,
} from "./comum";

export type Acao = {
  id: number;
  user_id: string | null;
  clinic_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export const COLUNAS_DA_ACAO =
  "id, user_id, clinic_id, action, entity_type, entity_id, details, created_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Para onde a ação leva: hoje, o prontuário quando o registro é um cliente. */
export function destinoDaAcao(a: Pick<Acao, "entity_type" | "entity_id">): string | null {
  return a.entity_type === "client" && a.entity_id && UUID.test(a.entity_id)
    ? `/prontuarios/${a.entity_id}`
    : null;
}

/** Os detalhes que a tela gravou junto com a ação (só ids e metadados). */
export function DetalhesDaAcao({ a, pessoas }: { a: Acao; pessoas: Pessoas }) {
  const chaves = Object.keys(a.details ?? {});
  if (chaves.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {chaves.map((k, i) => (
        <span key={k} title={k}>
          {i > 0 && " · "}
          {rotuloDoDetalhe(k)}: {formatarDetalhe(k, a.details![k], pessoas.nomes)}
        </span>
      ))}
    </span>
  );
}

export async function VisaoAcoes({
  supabase,
  pessoas,
  searchParams,
}: {
  supabase: Banco;
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const colaborador = texto(searchParams.colaborador);
  const acao = texto(searchParams.acao);
  const entidade = texto(searchParams.entidade);
  const periodo = lerPeriodo(searchParams.periodo);

  let consulta = supabase
    .from("audit_logs")
    .select(COLUNAS_DA_ACAO)
    .order("created_at", { ascending: false })
    .limit(400);
  if (colaborador) consulta = consulta.eq("user_id", colaborador);
  if (acao) consulta = consulta.eq("action", acao);
  if (entidade) consulta = consulta.eq("entity_type", entidade);
  const inicio = desde(periodo);
  if (inicio) consulta = consulta.gte("created_at", inicio);
  const { data: linhas } = await consulta.returns<Acao[]>();

  return (
    <div className="space-y-4">
      <FilterForm className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="visao" value="acoes" />
        <select name="colaborador" defaultValue={colaborador} className={CLASSE_DO_SELECT}>
          <option value="">Todas as pessoas</option>
          {pessoas.opcoes.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select name="acao" defaultValue={acao} className={CLASSE_DO_SELECT}>
          <option value="">Todas as ações</option>
          {AUDIT_ACTION_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select name="entidade" defaultValue={entidade} className={CLASSE_DO_SELECT}>
          <option value="">Todos os registros</option>
          {AUDIT_ENTITY_OPTIONS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
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
            Ações ({linhas?.length ?? 0}
            {(linhas?.length ?? 0) === 400 ? "+" : ""})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            O que cada pessoa fez nas telas. O conteúdo que mudou (antes e depois)
            está na aba <strong>Alterações</strong>.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!linhas || linhas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum registro no período e nos filtros escolhidos.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Data/hora</th>
                  <th className="px-2 py-1.5 font-medium">Pessoa</th>
                  <th className="px-2 py-1.5 font-medium">Ação</th>
                  <th className="px-2 py-1.5 font-medium">Registro</th>
                  <th className="px-2 py-1.5 font-medium">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => {
                  const acesso = r.action === "login" || r.action === "logout";
                  const destino = destinoDaAcao(r);
                  return (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {dataEHora(r.created_at)}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.user_id && pessoas.codigoPorUsuario.get(r.user_id) && (
                          <span className="mr-1.5 font-mono text-xs text-gold-tinta">
                            {pessoas.codigoPorUsuario.get(r.user_id)}
                          </span>
                        )}
                        {r.user_id ? pessoas.nomes.usuarios.get(r.user_id) ?? "—" : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {acesso ? (
                          <Badge variant="secondary">{auditActionLabel(r.action)}</Badge>
                        ) : (
                          auditActionLabel(r.action)
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {!acesso && (
                          <span className="mr-2">
                            {destino ? (
                              <Link href={destino} className="underline underline-offset-2">
                                {auditEntityLabel(r.entity_type)}
                              </Link>
                            ) : (
                              auditEntityLabel(r.entity_type)
                            )}
                          </span>
                        )}
                        <DetalhesDaAcao a={r} pessoas={pessoas} />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.clinic_id ? pessoas.nomes.unidades.get(r.clinic_id) ?? "—" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
