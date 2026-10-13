import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { duracao } from "@/lib/acesso";
import {
  DIAS_DA_SEMANA,
  DIAS_DA_SEMANA_LONGO,
  FUNCOES_DO_FILTRO,
  ORDEM_DA_SEMANA,
  PERIODOS_DO_PAINEL,
  degrau,
  gradeDeHoras,
  lerFuncao,
  lerPeriodoDoPainel,
  lerPessoasDoPainel,
  lerUnidade,
  pontosDeAtencao,
  porFuncao,
  porUnidade,
  rankings,
  resumoDoPainel,
  rotuloDaFuncao,
  serieDiaria,
  type Atencao,
  type LinhaDoGrupo,
  type Ranking,
  type Variacao,
} from "@/lib/auditoria-painel";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { CLASSE_DO_SELECT, enderecoDaVisao, type Banco, type Pessoas } from "./comum";

// O PAINEL DE USO (0290). Tudo desenhado no servidor, sem biblioteca de gráfico
// e sem JavaScript: barras e casas são <div>, e o número de cada marca aparece
// ao parar o mouse (title) e, sempre, escrito ao lado — nenhuma informação
// depende só de cor.

const NIVEL: Record<Atencao["nivel"], { rotulo: string; variante: "destructive" | "outline" | "secondary" }> = {
  alerta: { rotulo: "Olhar hoje", variante: "destructive" },
  aviso: { rotulo: "Acompanhar", variante: "outline" },
  info: { rotulo: "Para saber", variante: "secondary" },
};

/** Os cinco degraus do mapa de horas: um tom só, do claro ao escuro. */
const TOM = ["bg-muted", "bg-primary/20", "bg-primary/45", "bg-primary/70", "bg-primary"] as const;

function Indicador({
  titulo,
  valor,
  nota,
  variacao,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  variacao?: Variacao | null;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs uppercase text-muted-foreground">{titulo}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
      {variacao && (
        <p className="text-xs text-muted-foreground">
          {variacao.sentido === "igual"
            ? "= igual ao período anterior"
            : `${variacao.sentido === "subiu" ? "▲" : "▼"} ${Math.abs(variacao.porcento)}% em relação ao período anterior`}
        </p>
      )}
    </div>
  );
}

export async function VisaoPainel({
  supabase,
  pessoas,
  searchParams,
}: {
  supabase: Banco;
  pessoas: Pessoas;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const hoje = todayInBrazil();
  const periodo = lerPeriodoDoPainel(searchParams.dias, hoje);
  const unidade = lerUnidade(searchParams.unidade, pessoas.nomes.unidades);
  const funcao = lerFuncao(searchParams.funcao);
  const recorte = {
    p_from: periodo.de,
    p_to: periodo.ate,
    p_clinic: unidade || null,
    p_role: funcao || null,
  };

  const [gente, dias, horas] = await Promise.all([
    supabase.rpc("audit_usage_people", recorte),
    supabase.rpc("audit_usage_days", recorte),
    supabase.rpc("audit_usage_hours", recorte),
  ]);
  const lista = gente.error ? null : lerPessoasDoPainel(gente.data);
  const serie = dias.error ? null : serieDiaria(dias.data, periodo);
  const grade = horas.error ? null : gradeDeHoras(horas.data);

  const nome = (id: string) => pessoas.nomes.usuarios.get(id) ?? "Usuário removido";
  const codigo = (id: string) => pessoas.codigoPorUsuario.get(id);
  const filtros = {
    dias: String(periodo.dias),
    unidade: unidade || undefined,
    funcao: funcao || undefined,
  };
  /** O dia a dia da pessoa, no mesmo período do painel. */
  const dele = (id: string) =>
    enderecoDaVisao("relatorio", { modo: "dia", colaborador: id, de: periodo.de, ate: periodo.ate });

  const Pessoa = ({ id }: { id: string }) => (
    <>
      {codigo(id) && (
        <span className="mr-1.5 font-mono text-xs text-gold-tinta">{codigo(id)}</span>
      )}
      <Link href={dele(id)} className="underline underline-offset-2" title="Ver o dia a dia desta pessoa">
        {nome(id)}
      </Link>
    </>
  );

  const filtro = (
    <FilterForm className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="visao" value="painel" />
      <select name="dias" defaultValue={String(periodo.dias)} className={CLASSE_DO_SELECT}>
        {PERIODOS_DO_PAINEL.map((n) => (
          <option key={n} value={n}>
            Últimos {n} dias
          </option>
        ))}
      </select>
      <select name="unidade" defaultValue={unidade} className={CLASSE_DO_SELECT}>
        <option value="">Todas as unidades</option>
        {[...pessoas.nomes.unidades]
          .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
          .map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
      </select>
      <select name="funcao" defaultValue={funcao} className={CLASSE_DO_SELECT}>
        <option value="">Todas as funções</option>
        {FUNCOES_DO_FILTRO.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        {formatIsoDateBr(periodo.de)} a {formatIsoDateBr(periodo.ate)}
      </span>
    </FilterForm>
  );

  if (!lista) {
    return (
      <div className="space-y-4">
        {filtro}
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          O painel de uso ainda não existe neste banco (falta rodar a migração
          0290). As outras abas continuam funcionando.
        </p>
      </div>
    );
  }

  const r = resumoDoPainel(lista);
  const atencoes = pontosDeAtencao(lista, periodo, hoje);
  const listas = rankings(lista, periodo, hoje);
  const funcoes = porFuncao(lista);
  const unidades = porUnidade(lista);
  const maiorDia = Math.max(1, ...(serie ?? []).map((d) => d.pessoas));
  // Rótulo no eixo: toda segunda-feira (e o primeiro dia), para o olho achar a semana.
  const passo = periodo.dias > 45 ? 14 : 7;

  return (
    <div className="space-y-4">
      {filtro}

      {unidade && (
        <p className="text-xs text-muted-foreground">
          Unidade: entram as pessoas que <strong>têm função</strong> nela. Quem tem
          função em mais de uma unidade aparece em todas, com os mesmos números.
        </p>
      )}

      {r.ativas === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          Ninguém com acesso ativo neste recorte.
        </p>
      ) : (
        <>
          {/* ------------------------------------------------ os números */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Indicador
              titulo="Entraram no período"
              valor={`${r.entraram} de ${r.ativas}`}
              nota={r.adesao === null ? undefined : `${r.adesao}% de quem tem acesso`}
              variacao={r.varPessoas}
            />
            <Indicador
              titulo="Não entraram"
              valor={String(r.naoEntraram)}
              nota={
                r.nuncaEntraram > 0
                  ? `${r.nuncaEntraram} nunca ${r.nuncaEntraram === 1 ? "entrou" : "entraram"} no sistema`
                  : "todos já entraram alguma vez"
              }
            />
            <Indicador
              titulo="Dias com acesso (média)"
              valor={r.mediaDeDias === null ? "—" : String(r.mediaDeDias).replace(".", ",")}
              nota={`de ${periodo.dias} dias, entre quem entrou`}
            />
            <Indicador
              titulo="Tempo em uso"
              valor={duracao(r.emUsoS)}
              nota={`conectado: ${duracao(r.totalS)}`}
              variacao={r.varEmUso}
            />
            <Indicador
              titulo="Atividade"
              valor={String(r.eventos)}
              nota="ações nas telas + alterações"
              variacao={r.varEventos}
            />
          </div>
          {!r.temAnterior && (
            <p className="text-xs text-muted-foreground">
              Sem comparação com o período anterior: nos {periodo.dias} dias antes
              deste não há registro de uso (o registro começou em 09/10/2026).
            </p>
          )}

          {/* --------------------------------------- pontos de atenção */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                O que merece atenção ({atencoes.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                O painel lê os números e aponta o que foge do esperado. Clique num
                item para ver quem.
              </p>
            </CardHeader>
            <CardContent>
              {atencoes.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nada fugindo do esperado neste período.
                </p>
              ) : (
                <div className="rounded-md border">
                  {atencoes.map((a) => (
                    <details key={a.id} className="group border-b last:border-0">
                      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                        <span
                          aria-hidden
                          className="w-3 shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90"
                        >
                          ▸
                        </span>
                        <Badge variant={NIVEL[a.nivel].variante}>{NIVEL[a.nivel].rotulo}</Badge>
                        <span className="font-medium">{a.titulo}</span>
                      </summary>
                      <div className="space-y-2 px-3 pb-3 pl-8 text-sm">
                        <p className="text-muted-foreground">{a.texto}</p>
                        <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                          {a.pessoas.map((p) => (
                            <li key={p.usuario}>
                              <Pessoa id={p.usuario} />{" "}
                              <span className="text-xs text-muted-foreground">— {p.detalhe}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ------------------------------------------------ uso por dia */}
          {serie && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pessoas que entraram, por dia</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Cada barra é um dia; a altura é quantas pessoas entraram. O dia
                  mais cheio teve {maiorDia} {maiorDia === 1 ? "pessoa" : "pessoas"}.
                  Pare o mouse numa barra para ver o dia.
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex h-36 items-end gap-[2px] border-b border-border">
                  {serie.map((d) => (
                    <div
                      key={d.dia}
                      className="flex h-full min-w-0 flex-1 items-end"
                      title={`${DIAS_DA_SEMANA[d.semana]} ${formatIsoDateBr(d.dia)}: ${d.pessoas} ${d.pessoas === 1 ? "pessoa" : "pessoas"}, ${d.acessos} acesso(s), ${d.eventos} ação(ões)`}
                    >
                      <div
                        className="w-full rounded-t-[4px] bg-primary"
                        style={{
                          height: d.pessoas > 0 ? `${Math.max(3, (d.pessoas / maiorDia) * 100)}%` : "0",
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-[2px] pt-1 text-[10px] text-muted-foreground">
                  {serie.map((d, i) => (
                    <div key={d.dia} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                      {i % passo === 0 ? formatIsoDateBr(d.dia).slice(0, 5) : ""}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* --------------------------------------------------- rankings */}
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {listas.map((rk) => (
              <CartaoDoRanking key={rk.id} ranking={rk} Pessoa={Pessoa} />
            ))}
          </div>

          {/* ------------------------------------------- função e unidade */}
          <div className="grid gap-4 2xl:grid-cols-2">
            <TabelaDoGrupo
              titulo="Uso por função"
              explica="A régua justa: cada função usa o sistema de um jeito. Compare a pessoa com a média da função dela, não com a de outra."
              coluna="Função"
              linhas={funcoes}
              rotulo={rotuloDaFuncao}
              dias={periodo.dias}
              destino={(k) => enderecoDaVisao("painel", { ...filtros, funcao: k })}
            />
            <TabelaDoGrupo
              titulo="Uso por unidade"
              explica="Quem tem função em duas unidades conta nas duas."
              coluna="Unidade"
              linhas={unidades}
              rotulo={(k) => pessoas.nomes.unidades.get(k) ?? "Unidade removida"}
              dias={periodo.dias}
              destino={(k) => enderecoDaVisao("painel", { ...filtros, unidade: k })}
            />
          </div>

          {/* ------------------------------------------- quando é usado */}
          {grade && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quando o sistema é usado</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Dia da semana × hora (horário de Brasília). Quanto mais escura a
                  casa, mais ações e alterações naquele horário.
                  {grade.pico &&
                    ` O pico é ${DIAS_DA_SEMANA_LONGO[grade.pico.semana]} às ${grade.pico.hora}h (${grade.pico.eventos} no período).`}
                  {grade.foraDoExpediente !== null &&
                    ` ${grade.foraDoExpediente}% do movimento acontece fora de segunda a sexta, das 7h às 19h.`}
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {grade.total === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nenhuma ação registrada no período.
                  </p>
                ) : (
                  <MapaDeHoras grade={grade} />
                )}
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            <strong>Como ler:</strong> <em>em uso</em> é o tempo clicando ou
            digitando; <em>conectado</em> é o tempo com o sistema aberto.{" "}
            <strong>Tempo em uso não é produtividade</strong> — quem atende na
            cadeira toca pouco na tela. Os rankings mostram o topo de cada lista;
            o número de todo mundo está na aba Relatório de atividade. O registro
            de acessos começou em 09/10/2026: antes disso só existe a data do
            último login.
          </p>
        </>
      )}
    </div>
  );
}

function CartaoDoRanking({
  ranking,
  Pessoa,
}: {
  ranking: Ranking;
  Pessoa: (p: { id: string }) => React.ReactNode;
}) {
  const maior = Math.max(1, ...ranking.linhas.map((l) => l.valor));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{ranking.titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">{ranking.explica}</p>
      </CardHeader>
      <CardContent>
        {ranking.linhas.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            Ninguém nesta lista no período.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {ranking.linhas.map((l, i) => (
              <li key={l.usuario} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    <span className="mr-1.5 inline-block w-4 text-right text-xs text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <Pessoa id={l.usuario} />
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">
                    {l.texto}
                  </span>
                </div>
                <div className="ml-[1.4rem] mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (l.valor / maior) * 100)}%` }}
                  />
                </div>
                {l.nota && (
                  <p className="ml-[1.4rem] pt-0.5 text-xs text-muted-foreground">{l.nota}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {ranking.total > ranking.linhas.length && (
          <p className="pt-3 text-xs text-muted-foreground">
            Mostrando {ranking.linhas.length} de {ranking.total}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TabelaDoGrupo({
  titulo,
  explica,
  coluna,
  linhas,
  rotulo,
  dias,
  destino,
}: {
  titulo: string;
  explica: string;
  coluna: string;
  linhas: LinhaDoGrupo[];
  rotulo: (chave: string) => string;
  dias: number;
  destino: (chave: string) => string;
}) {
  const th = "px-2 py-1.5 font-medium";
  const num = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">{explica}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {linhas.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">Sem dados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className={th}>{coluna}</th>
                <th className={`${th} text-right`}>Entraram</th>
                <th className={`${th} text-right`} title={`Média de dias com acesso, de ${dias}, entre todos do grupo`}>
                  Dias (média)
                </th>
                <th className={`${th} text-right`} title="Média de tempo em uso por pessoa que entrou">
                  Em uso (média)
                </th>
                <th className={`${th} text-right`} title="Média de ações por pessoa que entrou">
                  Ações (média)
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className="border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <Link href={destino(l.chave)} className="underline underline-offset-2">
                      {rotulo(l.chave)}
                    </Link>
                  </td>
                  <td className={num}>
                    {l.entraram} de {l.pessoas}
                    <span className="ml-1 text-xs text-muted-foreground">({l.adesao}%)</span>
                  </td>
                  <td className={num}>{String(l.mediaDeDias).replace(".", ",")}</td>
                  <td className={num}>{l.entraram ? duracao(l.mediaEmUsoS) : "—"}</td>
                  <td className={num}>{l.entraram ? l.mediaDeEventos : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function MapaDeHoras({ grade }: { grade: NonNullable<ReturnType<typeof gradeDeHoras>> }) {
  const horas: number[] = [];
  for (let h = grade.horaInicial; h <= grade.horaFinal; h++) horas.push(h);
  const colunas = { gridTemplateColumns: `2.25rem repeat(${horas.length}, minmax(1rem, 1fr))` };
  return (
    <div className="min-w-[28rem] space-y-[2px]">
      <div className="grid gap-[2px] text-[10px] text-muted-foreground" style={colunas}>
        <span />
        {horas.map((h) => (
          <span key={h} className="text-center">
            {h % 2 === 0 ? `${h}h` : ""}
          </span>
        ))}
      </div>
      {ORDEM_DA_SEMANA.map((semana) => (
        <div key={semana} className="grid items-center gap-[2px]" style={colunas}>
          <span className="text-xs text-muted-foreground">{DIAS_DA_SEMANA[semana]}</span>
          {horas.map((h) => {
            const v = grade.celulas[semana][h];
            return (
              <span
                key={h}
                className={`h-5 rounded-[3px] ${TOM[degrau(v, grade.maximo)]}`}
                title={`${DIAS_DA_SEMANA_LONGO[semana]}, ${h}h: ${v} ${v === 1 ? "ação" : "ações"}`}
              />
            );
          })}
        </div>
      ))}
      <div className="flex items-center gap-1.5 pt-2 text-[10px] text-muted-foreground">
        <span>menos</span>
        {TOM.map((t) => (
          <span key={t} className={`h-3 w-5 rounded-[3px] ${t}`} />
        ))}
        <span>mais</span>
      </div>
    </div>
  );
}
