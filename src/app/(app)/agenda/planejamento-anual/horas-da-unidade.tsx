import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterForm } from "@/components/filter-form";
import { addDaysIso, formatIsoDateBr, monthRangeOf } from "@/lib/dates";
import {
  formatarHoras,
  formatarOcupacao,
  ocupacao,
  type PeriodoDasHoras,
  type QuadroDeHoras,
} from "@/lib/horas-da-agenda";

// OC-00071 — "Horas possíveis × horas trabalhadas". Só desenha: a conta vem
// pronta de `src/lib/horas-da-agenda.ts`, e a leitura de `horas-dados.ts`.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function nomeDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

function dias(n: number): string {
  return `${n} dia${n === 1 ? "" : "s"}`;
}

const TH = "px-2 py-1.5 font-medium";
const TD = "px-2 py-1.5 tabular-nums";

function Numero({
  valor,
  rotulo,
  detalhe,
}: {
  valor: string;
  rotulo: string;
  detalhe?: string;
}) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      <p className="text-xs font-medium">{rotulo}</p>
      {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

function Linha({
  sinal,
  rotulo,
  valor,
  forte,
}: {
  sinal?: "+" | "−" | "=" | "×";
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <li
      className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${forte ? "font-semibold" : ""}`}
    >
      <span>
        {sinal && <span className="mr-1.5 inline-block w-3 text-muted-foreground">{sinal}</span>}
        {rotulo}
      </span>
      <span className="shrink-0 tabular-nums">{valor}</span>
    </li>
  );
}

export function HorasDaUnidade({
  ano,
  hoje,
  periodo,
  quadro,
  cadeiras,
  cadeirasPelaConfiguracao,
  naoLido,
}: {
  ano: number;
  hoje: string;
  periodo: PeriodoDasHoras;
  /** `null` quando a base não pôde ser lida — aí `naoLido` diz o que faltou. */
  quadro: QuadroDeHoras | null;
  /** Quantas cadeiras entraram na conta. */
  cadeiras: number;
  /** Sem sala cadastrada: o número veio da configuração da agenda. */
  cadeirasPelaConfiguracao: boolean;
  naoLido: string[];
}) {
  const base = `/agenda/planejamento-anual?ano=${ano}`;
  const esteMes = monthRangeOf(hoje);
  const mesPassado = monthRangeOf(addDaysIso(esteMes.from, -1));
  const atalhos: { rotulo: string; href: string; ativo: boolean }[] = [
    { rotulo: `Ano de ${ano}`, href: base, ativo: periodo.padrao },
    {
      rotulo: "Este mês",
      href: `${base}&de=${esteMes.from}&ate=${esteMes.to}`,
      ativo: periodo.de === esteMes.from && periodo.ate === esteMes.to,
    },
    {
      rotulo: "Mês passado",
      href: `${base}&de=${mesPassado.from}&ate=${mesPassado.to}`,
      ativo: periodo.de === mesPassado.from && periodo.ate === mesPassado.to,
    },
    {
      rotulo: "Do início do ano até hoje",
      href: `${base}&de=${hoje.slice(0, 4)}-01-01&ate=${hoje}`,
      ativo: periodo.de === `${hoje.slice(0, 4)}-01-01` && periodo.ate === hoje,
    },
  ];

  const t = quadro?.total;
  const a = quadro?.agenda ?? null;
  const rotuloDasCadeiras = `${cadeiras} cadeira${cadeiras === 1 ? "" : "s"}${
    cadeirasPelaConfiguracao ? "" : cadeiras === 1 ? " ativa" : " ativas"
  }`;

  return (
    <Card id="horas">
      <CardHeader>
        <CardTitle className="text-base">Horas possíveis × horas trabalhadas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Período ------------------------------------------------------- */}
        <div className="space-y-2">
          <FilterForm className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="ano" value={ano} />
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">De</span>
              <input
                type="date"
                name="de"
                defaultValue={periodo.de}
                key={`de-${periodo.de}`}
                className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Até</span>
              <input
                type="date"
                name="ate"
                defaultValue={periodo.ate}
                key={`ate-${periodo.ate}`}
                className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {atalhos.map((x) => (
                <Link
                  key={x.rotulo}
                  href={x.href}
                  scroll={false}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    x.ativo ? "border-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {x.rotulo}
                </Link>
              ))}
            </div>
          </FilterForm>
          <p className="text-xs text-muted-foreground">
            Período: {formatIsoDateBr(periodo.de)} a {formatIsoDateBr(periodo.ate)}.
            {periodo.encurtado &&
              " O período pedido passava de dois anos e foi encurtado — os números abaixo são deste intervalo."}
          </p>
        </div>

        {!quadro || !t ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            Não foi possível calcular as horas agora: não consegui ler{" "}
            {naoLido.length > 0 ? naoLido.join(", ") : "os dados da agenda"}. Atualize a página; se
            continuar, avise o suporte. Nenhum número é mostrado para não parecer que a conta é zero.
          </p>
        ) : (
          <>
            {/* Os números ------------------------------------------------ */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Numero
                valor={formatarHoras(t.funcionamento)}
                rotulo="horas de funcionamento"
                detalhe={`${dias(t.diasAbertos)} com atendimento`}
              />
              <Numero
                valor={formatarHoras(t.cadeira)}
                rotulo="horas de cadeira"
                detalhe={cadeiras === 0 ? "nenhuma cadeira" : rotuloDasCadeiras}
              />
              <Numero
                valor={a ? formatarHoras(a.agendadas) : "—"}
                rotulo="horas agendadas"
                detalhe={
                  a
                    ? `ocupação da agenda: ${formatarOcupacao(quadro.ocupacaoDaAgenda)}`
                    : "não consegui ler os atendimentos"
                }
              />
              <Numero
                valor={a ? formatarHoras(a.trabalhadas) : "—"}
                rotulo="horas trabalhadas"
                detalhe={
                  a
                    ? `${a.concluidos} atendimento${a.concluidos === 1 ? "" : "s"} concluído${a.concluidos === 1 ? "" : "s"}`
                    : "não consegui ler os atendimentos"
                }
              />
              <Numero
                valor={formatarOcupacao(quadro.ocupacaoRealizada)}
                rotulo="ocupação realizada"
                detalhe={
                  !quadro.comecou
                    ? "o período ainda não começou"
                    : quadro.terminou
                      ? "trabalhadas ÷ horas de cadeira"
                      : `trabalhadas ÷ ${formatarHoras(quadro.ateHoje.cadeira)} de cadeira até hoje`
                }
              />
            </div>

            {cadeiras === 0 && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                Esta unidade não tem cadeira em Configurar agenda — por isso não há horas de cadeira
                nem percentual de ocupação.
              </p>
            )}
            {cadeirasPelaConfiguracao && cadeiras > 0 && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                Esta unidade não tem sala cadastrada em Configurar agenda. A conta usa as{" "}
                {cadeiras} cadeira{cadeiras === 1 ? "" : "s"} da configuração da agenda — o mesmo
                número que a agenda usa. Cadastre as salas para o número seguir as cadeiras de
                verdade e para o fechamento por sala entrar na conta.
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Como se chega às horas possíveis ------------------------ */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Como se chega às horas possíveis
                </p>
                <ul className="divide-y rounded-lg border">
                  <Linha
                    rotulo="Dias e horário configurados (já sem o almoço)"
                    valor={formatarHoras(t.potencial)}
                  />
                  <Linha
                    sinal="−"
                    rotulo={`Feriados fechados (${dias(t.diasFeriadoFechado)})`}
                    valor={formatarHoras(t.perdidoFeriado)}
                  />
                  <Linha
                    sinal="−"
                    rotulo={`Períodos planejados da unidade (${dias(t.diasPeriodoUnidade)})`}
                    valor={formatarHoras(t.perdidoUnidade)}
                  />
                  <Linha
                    sinal="−"
                    rotulo={`Períodos planejados pela rede (${dias(t.diasPeriodoRede)})`}
                    valor={formatarHoras(t.perdidoRede)}
                  />
                  <Linha
                    sinal="+"
                    rotulo={`Horários avulsos liberados (${dias(t.diasComAvulso)})`}
                    valor={formatarHoras(t.ganhoAvulso)}
                  />
                  <Linha
                    sinal="−"
                    rotulo="Agenda fechada — unidade toda"
                    valor={formatarHoras(t.fechadoUnidade)}
                  />
                  <Linha
                    sinal="="
                    rotulo="Horas de funcionamento"
                    valor={formatarHoras(t.funcionamento)}
                    forte
                  />
                  <Linha
                    sinal="×"
                    rotulo={rotuloDasCadeiras}
                    valor={formatarHoras(t.funcionamento * cadeiras)}
                  />
                  <Linha
                    sinal="−"
                    rotulo="Agenda fechada — sala específica"
                    valor={formatarHoras(t.fechadoSala)}
                  />
                  <Linha sinal="=" rotulo="Horas de cadeira" valor={formatarHoras(t.cadeira)} forte />
                </ul>
                <p className="text-xs text-muted-foreground">
                  Agenda fechada de profissional específico: {formatarHoras(t.fechadoProfissional)} —
                  não reduz as horas possíveis, porque a cadeira continua disponível para outro
                  profissional.
                </p>
              </div>

              {/* O que aconteceu na agenda ------------------------------- */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  O que aconteceu na agenda
                </p>
                {a ? (
                  <>
                    <ul className="divide-y rounded-lg border">
                      <Linha rotulo="Horas agendadas na cadeira" valor={formatarHoras(a.agendadas)} forte />
                      <Linha
                        rotulo="Trabalhadas (atendimentos concluídos)"
                        valor={formatarHoras(a.trabalhadas)}
                      />
                      <Linha rotulo="Faltas e desistências" valor={formatarHoras(a.faltas)} />
                      <Linha
                        rotulo="Dia já passou e ninguém registrou o desfecho"
                        valor={formatarHoras(a.semDesfecho)}
                      />
                      <Linha
                        rotulo="Ainda por atender"
                        valor={formatarHoras(a.agendadas - a.trabalhadas - a.faltas - a.semDesfecho)}
                      />
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Fora da conta: {formatarHoras(a.canceladas)} de agendamentos cancelados (o
                      horário voltou a ficar livre) e {formatarHoras(a.onlineAgendadas)} de
                      atendimento online ({formatarHoras(a.onlineTrabalhadas)} concluídas), que não
                      usa cadeira.
                    </p>
                  </>
                ) : (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                    Não consegui ler os atendimentos deste período. As horas possíveis ao lado estão
                    certas; as horas agendadas, as trabalhadas e a ocupação não são mostradas para
                    não parecer que foram zero.
                  </p>
                )}
              </div>
            </div>

            {/* Mês a mês -------------------------------------------------- */}
            {quadro.meses.length > 1 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Mês a mês</p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className={TH}>Mês</th>
                        <th className={`${TH} text-right`}>Dias</th>
                        <th className={`${TH} text-right`}>Funcionamento</th>
                        <th className={`${TH} text-right`}>Cadeira</th>
                        <th className={`${TH} text-right`}>Agendadas</th>
                        <th className={`${TH} text-right`}>Trabalhadas</th>
                        <th className={`${TH} text-right`}>Ocupação da agenda</th>
                        <th className={`${TH} text-right`}>Ocupação realizada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {quadro.meses.map((m) => (
                        <tr key={m.mes}>
                          <td className={TD}>{nomeDoMes(m.mes)}</td>
                          <td className={`${TD} text-right`}>{m.possiveis.diasAbertos}</td>
                          <td className={`${TD} text-right`}>
                            {formatarHoras(m.possiveis.funcionamento)}
                          </td>
                          <td className={`${TD} text-right`}>{formatarHoras(m.possiveis.cadeira)}</td>
                          <td className={`${TD} text-right`}>
                            {a ? formatarHoras(m.atendimentos.agendadas) : "—"}
                          </td>
                          <td className={`${TD} text-right`}>
                            {a ? formatarHoras(m.atendimentos.trabalhadas) : "—"}
                          </td>
                          <td className={`${TD} text-right`}>
                            {a
                              ? formatarOcupacao(
                                  ocupacao(m.atendimentos.agendadas, m.possiveis.cadeira)
                                )
                              : "—"}
                          </td>
                          <td className={`${TD} text-right`}>
                            {a
                              ? formatarOcupacao(
                                  ocupacao(m.atendimentos.trabalhadas, m.possiveisAteHoje.cadeira)
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                <strong>Horas de funcionamento</strong> é o relógio da unidade: um dia das 08h às 18h
                vale 10 horas. <strong>Horas de cadeira</strong> multiplica pelo número de cadeiras
                ativas — é sobre elas que a ocupação é calculada.{" "}
                <strong>Hora trabalhada</strong> é o tempo marcado na agenda de cada atendimento
                concluído, não o relógio entre chamar e concluir.
              </p>
              <p>
                Liberar um horário avulso aumenta as horas possíveis; fechar a agenda da unidade ou
                de uma sala reduz. A <strong>ocupação da agenda</strong> compara o que está agendado
                com o período inteiro; a <strong>ocupação realizada</strong> compara o que foi
                concluído com as horas de cadeira dos dias até hoje. Encaixes podem levar a ocupação
                acima de 100%.
              </p>
              <p>
                Feriado ainda sem decisão conta como dia normal, porque a agenda aceita agendamento
                nele. Os dias que já passaram são calculados com o horário e as cadeiras
                configurados hoje — o sistema não guarda como a agenda estava configurada no
                passado.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
