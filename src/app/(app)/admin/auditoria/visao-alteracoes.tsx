import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COLUNAS_DA_ALTERACAO,
  EXPLICACAO_DO_SISTEMA,
  OPERACAO_ROTULO,
  OPERACOES,
  lerOperacao,
  lerTabela,
  opcoesDeTabela,
  rotuloDaArea,
  rotuloDaTabela,
  type Alteracao,
} from "@/lib/auditoria-alteracoes";
import {
  CLASSE_DO_SELECT,
  comClientes,
  desde,
  enderecoDaVisao,
  lerPeriodo,
  texto,
  type Banco,
  type Pessoas,
} from "./comum";
import { LinhaDaAlteracao } from "./linha-da-alteracao";

const POR_PAGINA = 200;
/** No filtro de pessoa: o que NÃO foi feito por alguém logado. */
const SISTEMA = "sistema";

type Fora = { schema_name: string; table_name: string; motivo: string };

export async function VisaoAlteracoes({
  supabase,
  pessoas,
  searchParams,
}: {
  supabase: Banco;
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const colaborador = texto(searchParams.colaborador);
  const operacao = lerOperacao(searchParams.operacao);
  const tabela = lerTabela(searchParams.tabela);
  const periodo = lerPeriodo(searchParams.periodo);
  const busca = texto(searchParams.busca).trim().slice(0, 80);
  const cliente = texto(searchParams.cliente);
  const antes = Number(texto(searchParams.antes)) || 0;

  let consulta = supabase
    .from("audit_changes")
    .select(COLUNAS_DA_ALTERACAO)
    .order("id", { ascending: false })
    .limit(POR_PAGINA + 1);
  if (colaborador === SISTEMA) consulta = consulta.is("user_id", null);
  else if (colaborador) consulta = consulta.eq("user_id", colaborador);
  if (operacao) consulta = consulta.eq("op", operacao);
  if (tabela) {
    consulta = consulta.eq("schema_name", tabela.schema).eq("table_name", tabela.tabela);
  }
  const inicio = desde(periodo);
  if (inicio) consulta = consulta.gte("occurred_at", inicio);
  if (busca) consulta = consulta.ilike("row_label", `%${busca.replace(/[%_]/g, " ")}%`);
  if (cliente) consulta = consulta.eq("client_id", cliente);
  if (antes > 0) consulta = consulta.lt("id", antes);

  const [{ data, error }, faltando, fora] = await Promise.all([
    consulta.returns<Alteracao[]>(),
    supabase.rpc("audit_missing_tables"),
    supabase
      .from("audit_excluded_tables")
      .select("schema_name, table_name, motivo")
      .order("schema_name")
      .order("table_name")
      .returns<Fora[]>(),
  ]);

  const lista = (data ?? []).slice(0, POR_PAGINA);
  const comNomes = await comClientes(supabase, pessoas, lista);
  const temMais = (data ?? []).length > POR_PAGINA;
  const semAuditoria = (faltando.data ?? []) as { schema_name: string; table_name: string }[];

  const filtros = {
    colaborador,
    operacao,
    tabela: tabela ? `${tabela.schema}.${tabela.tabela}` : "",
    periodo,
    busca,
    cliente,
  };

  return (
    <div className="space-y-4">
      <FilterForm className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="visao" value="alteracoes" />
        {cliente && <input type="hidden" name="cliente" value={cliente} />}
        <select name="colaborador" defaultValue={colaborador} className={CLASSE_DO_SELECT}>
          <option value="">Todas as pessoas</option>
          <option value={SISTEMA}>Sistema (sem pessoa logada)</option>
          {pessoas.opcoes.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select name="operacao" defaultValue={operacao} className={CLASSE_DO_SELECT}>
          <option value="">Cadastrou, alterou ou excluiu</option>
          {OPERACOES.map((o) => (
            <option key={o} value={o}>
              {OPERACAO_ROTULO[o]}
            </option>
          ))}
        </select>
        <select name="tabela" defaultValue={filtros.tabela} className={CLASSE_DO_SELECT}>
          <option value="">Em qualquer cadastro</option>
          {opcoesDeTabela().map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="periodo" defaultValue={periodo} className={CLASSE_DO_SELECT}>
          <option value="hoje">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="tudo">Tudo</option>
        </select>
        <input
          name="busca"
          defaultValue={busca}
          placeholder="Código ou nome do registro (Enter)"
          className={`${CLASSE_DO_SELECT} w-64`}
        />
      </FilterForm>

      {cliente && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          Mostrando só o que envolve <strong>um cliente</strong>.{" "}
          <Link
            href={enderecoDaVisao("alteracoes", { ...filtros, cliente: undefined })}
            className="underline underline-offset-2"
          >
            Ver de todos
          </Link>
        </p>
      )}

      {semAuditoria.length > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>Atenção:</strong> {semAuditoria.length} cadastro(s) ainda não estão
          sendo registrados aqui:{" "}
          {semAuditoria
            .map((t) => rotuloDaTabela(t.schema_name, t.table_name))
            .join(", ")}
          . São tabelas criadas depois da auditoria; avise o suporte para incluí-las.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Alterações ({lista.length}
            {temMais ? "+" : ""})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Clique numa linha para ver <strong>campo a campo</strong> o que havia antes
            e o que ficou depois. {EXPLICACAO_DO_SISTEMA}
          </p>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              O registro de alterações ainda não existe neste banco (falta rodar a
              migração 0288). As outras abas continuam funcionando.
            </p>
          ) : lista.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma alteração no período e nos filtros escolhidos.
            </p>
          ) : (
            <>
              <div className="rounded-md border">
                {lista.map((a) => (
                  <LinhaDaAlteracao key={a.id} a={a} pessoas={comNomes} />
                ))}
              </div>
              {temMais && (
                <p className="pt-3 text-center text-sm">
                  <Link
                    href={enderecoDaVisao("alteracoes", {
                      ...filtros,
                      antes: String(lista[lista.length - 1].id),
                    })}
                    className="underline underline-offset-2"
                  >
                    Ver as {POR_PAGINA} anteriores
                  </Link>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {(fora.data ?? []).length > 0 && (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            O que NÃO entra nesta lista, e por quê ({fora.data!.length})
          </summary>
          <p className="pt-2 text-xs text-muted-foreground">
            Dado pessoal entra (decisão do dono). Fica de fora só o que já é
            histórico, o que é calculado a partir de outro cadastro, o chat da
            equipe e os registros técnicos. Senha e token nunca são gravados:
            aparecem como “oculto”.
          </p>
          <ul className="grid gap-x-6 gap-y-0.5 pt-2 text-xs sm:grid-cols-2">
            {fora.data!.map((f) => (
              <li key={`${f.schema_name}.${f.table_name}`}>
                <span className="font-mono">{f.table_name}</span>
                {f.schema_name !== "public" && ` (${rotuloDaArea(f.schema_name)})`} —{" "}
                <span className="text-muted-foreground">{f.motivo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
