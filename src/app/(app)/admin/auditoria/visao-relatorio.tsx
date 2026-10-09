import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { duracao } from "@/lib/acesso";
import {
  MAXIMO_DE_DIAS,
  MODOS,
  MODO_ROTULO,
  alteracoesDe,
  horaBr,
  ordenarDiaADia,
  paradoS,
  resumirPorPessoa,
} from "@/lib/auditoria-relatorio";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { CLASSE_DO_SELECT, enderecoDaVisao, type Pessoas } from "./comum";
import { carregarRelatorioDeAtividade } from "./relatorio-dados";

const TH = "px-2 py-1.5 font-medium";
const TD = "whitespace-nowrap px-2 py-1.5";
const NUM = `${TD} text-right tabular-nums`;

function Numero({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs uppercase text-muted-foreground">{titulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

/** Zero vira traço: numa tabela cheia de números, o que salta é o que houve. */
const n = (v: number) => (v > 0 ? String(v) : "—");

export async function VisaoRelatorio({
  pessoas,
  searchParams,
}: {
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const carga = await carregarRelatorioDeAtividade(searchParams);
  const { periodo, modo, colaborador, linhas, quem } = carga;
  const hoje = todayInBrazil();

  const nome = (id: string) => quem.nomes.get(id) ?? "Usuário removido";
  const codigo = (id: string) => quem.codigos.get(id);

  const filtros = { de: periodo.de, ate: periodo.ate, modo, colaborador: colaborador || undefined };
  const planilha = `/admin/auditoria/exportar?${new URLSearchParams(
    Object.entries(filtros).filter((e): e is [string, string] => !!e[1])
  ).toString()}`;

  const resumo = linhas ? resumirPorPessoa(linhas) : [];
  const emUso = (linhas ?? []).reduce((s, l) => s + l.emUsoS, 0);
  const parado = (linhas ?? []).reduce((s, l) => s + paradoS(l), 0);
  const acoes = (linhas ?? []).reduce((s, l) => s + l.acoes, 0);
  const alteracoes = (linhas ?? []).reduce((s, l) => s + alteracoesDe(l), 0);

  return (
    <div className="space-y-4">
      <FilterForm className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="visao" value="relatorio" />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          De
          <input type="date" name="de" defaultValue={periodo.de} max={hoje} className={CLASSE_DO_SELECT} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          até
          <input type="date" name="ate" defaultValue={periodo.ate} max={hoje} className={CLASSE_DO_SELECT} />
        </label>
        <select name="colaborador" defaultValue={colaborador} className={CLASSE_DO_SELECT}>
          <option value="">Todas as pessoas</option>
          {pessoas.opcoes.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select name="modo" defaultValue={modo} className={CLASSE_DO_SELECT}>
          {MODOS.map((m) => (
            <option key={m} value={m}>
              {MODO_ROTULO[m]}
            </option>
          ))}
        </select>
        {linhas && linhas.length > 0 && (
          // ⚠️ <a>, nunca <Link>: o Next pré-carregaria a rota, e cada
          // pré-carga seria uma exportação registrada que ninguém pediu.
          <a
            href={planilha}
            className="inline-flex h-9 items-center rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted"
          >
            Baixar planilha (Excel)
          </a>
        )}
      </FilterForm>

      {periodo.encurtado && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          O período pedido passava de {MAXIMO_DE_DIAS} dias. O relatório mostra os{" "}
          {MAXIMO_DE_DIAS} dias mais recentes: {formatIsoDateBr(periodo.de)} a{" "}
          {formatIsoDateBr(periodo.ate)}.
        </p>
      )}

      {!linhas ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          O relatório de atividade ainda não existe neste banco (falta rodar a
          migração 0289). As outras abas continuam funcionando.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Numero
              titulo="Período"
              valor={`${periodo.dias} dia${periodo.dias === 1 ? "" : "s"}`}
              nota={`${formatIsoDateBr(periodo.de)} a ${formatIsoDateBr(periodo.ate)}`}
            />
            <Numero titulo="Pessoas com atividade" valor={String(resumo.length)} />
            <Numero titulo="Em uso (soma)" valor={duracao(emUso)} />
            <Numero titulo="Parado (soma)" valor={duracao(parado)} />
            <Numero
              titulo="Ações · alterações"
              valor={`${acoes} · ${alteracoes}`}
              nota="nas telas · no banco"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {MODO_ROTULO[modo]} ({modo === "pessoa" ? resumo.length : linhas.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                <strong>Em uso</strong> é o tempo clicando ou digitando;{" "}
                <strong>parado</strong> é o resto do acesso, com a tela aberta e sem
                uso. <strong>Ações</strong> são consultas, exportações e demais atos
                nas telas; <strong>cadastrou, alterou e excluiu</strong> são as
                gravações, registradas pelo banco desde 09/10/2026.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {linhas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum acesso e nenhuma ação no período e nos filtros escolhidos.
                </p>
              ) : modo === "pessoa" ? (
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className={TH}>Pessoa</th>
                      <th className={`${TH} text-right`}>Dias com acesso</th>
                      <th className={`${TH} text-right`}>Acessos</th>
                      <th className={`${TH} text-right`}>Em uso</th>
                      <th className={`${TH} text-right`}>Parado</th>
                      <th className={`${TH} text-right`} title="Vezes em que o sistema desconectou a pessoa por falta de uso">
                        Caiu por inatividade
                      </th>
                      <th className={`${TH} text-right`}>Ações</th>
                      <th className={`${TH} text-right`}>Cadastrou</th>
                      <th className={`${TH} text-right`}>Alterou</th>
                      <th className={`${TH} text-right`}>Excluiu</th>
                      <th className={TH}>Último dia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo.map((r) => (
                      <tr key={r.usuario} className="border-b last:border-0">
                        <td className={TD}>
                          {codigo(r.usuario) && (
                            <span className="mr-1.5 font-mono text-xs text-gold-tinta">
                              {codigo(r.usuario)}
                            </span>
                          )}
                          <Link
                            href={enderecoDaVisao("relatorio", {
                              ...filtros,
                              modo: "dia",
                              colaborador: r.usuario,
                            })}
                            className="underline underline-offset-2"
                            title="Ver dia a dia"
                          >
                            {nome(r.usuario)}
                          </Link>
                        </td>
                        <td className={NUM}>
                          {r.diasComAcesso} de {periodo.dias}
                        </td>
                        <td className={NUM}>{n(r.acessos)}</td>
                        <td className={NUM}>{r.acessos > 0 ? duracao(r.emUsoS) : "—"}</td>
                        <td className={`${NUM} text-muted-foreground`}>
                          {r.acessos > 0 ? duracao(r.paradoS) : "—"}
                        </td>
                        <td className={NUM}>{n(r.porInatividade)}</td>
                        <td className={NUM} title={`consultas ${r.consultas} · exportações ${r.exportacoes}`}>
                          {n(r.acoes)}
                        </td>
                        <td className={NUM}>{n(r.cadastrou)}</td>
                        <td className={NUM}>{n(r.alterou)}</td>
                        <td className={NUM}>{n(r.excluiu)}</td>
                        <td className={`${TD} text-muted-foreground`}>
                          {formatIsoDateBr(r.ultimoDia)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className={TH}>Dia</th>
                      <th className={TH}>Pessoa</th>
                      <th className={TH}>Entrou</th>
                      <th className={TH}>Última atividade</th>
                      <th className={`${TH} text-right`}>Acessos</th>
                      <th className={`${TH} text-right`}>Em uso</th>
                      <th className={`${TH} text-right`}>Parado</th>
                      <th className={`${TH} text-right`}>Caiu por inatividade</th>
                      <th className={`${TH} text-right`}>Ações</th>
                      <th className={`${TH} text-right`}>Cadastrou</th>
                      <th className={`${TH} text-right`}>Alterou</th>
                      <th className={`${TH} text-right`}>Excluiu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenarDiaADia(linhas, quem.nomes).map((l) => (
                      <tr key={`${l.usuario}-${l.dia}`} className="border-b last:border-0">
                        <td className={TD}>
                          <Link
                            href={enderecoDaVisao("pessoa", { colaborador: l.usuario, dia: l.dia })}
                            className="underline underline-offset-2"
                            title="Ver tudo o que a pessoa fez neste dia"
                          >
                            {formatIsoDateBr(l.dia)}
                          </Link>
                        </td>
                        <td className={TD}>
                          {codigo(l.usuario) && (
                            <span className="mr-1.5 font-mono text-xs text-gold-tinta">
                              {codigo(l.usuario)}
                            </span>
                          )}
                          {nome(l.usuario)}
                        </td>
                        <td className={`${TD} text-muted-foreground`}>
                          {horaBr(l.primeiroAcesso) || "—"}
                        </td>
                        <td className={`${TD} text-muted-foreground`}>
                          {horaBr(l.ultimaAtividade) || "—"}
                        </td>
                        <td className={NUM}>{n(l.acessos)}</td>
                        <td className={NUM}>{l.acessos > 0 ? duracao(l.emUsoS) : "—"}</td>
                        <td className={`${NUM} text-muted-foreground`}>
                          {l.acessos > 0 ? duracao(paradoS(l)) : "—"}
                        </td>
                        <td className={NUM}>{n(l.porInatividade)}</td>
                        <td className={NUM} title={`consultas ${l.consultas} · exportações ${l.exportacoes}`}>
                          {n(l.acoes)}
                        </td>
                        <td className={NUM}>{n(l.cadastrou)}</td>
                        <td className={NUM}>{n(l.alterou)}</td>
                        <td className={NUM}>{n(l.excluiu)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {carga.semAcesso.length > 0 && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">
                Com acesso ativo e sem nenhum acesso no período ({carga.semAcesso.length})
              </summary>
              <p className="pt-2 text-xs text-muted-foreground">
                Pessoas que podem entrar no sistema e não entraram nem uma vez de{" "}
                {formatIsoDateBr(periodo.de)} a {formatIsoDateBr(periodo.ate)}.
              </p>
              <ul className="grid gap-x-6 gap-y-0.5 pt-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {carga.semAcesso.map((id) => (
                  <li key={id}>
                    {codigo(id) && (
                      <span className="mr-1.5 font-mono text-xs text-gold-tinta">{codigo(id)}</span>
                    )}
                    {nome(id)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
