import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, FileSignature, FileStack, PenLine, Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { NAO_FOI_POSSIVEL_CONTAR, SEM_CONTAGEM } from "@/lib/contagem";
import { canConfigureSignatures, canViewSignatures } from "@/lib/signatures/access";
import { calcularIndicadores, linhasDaLista, textoDoTempo } from "@/lib/signatures/indicadores";
import {
  alcanceDoPainel,
  lerFiltros,
  lerLinhasDoPainel,
  lerOpcoes,
  urlDoPainel,
} from "@/lib/signatures/painel-dados";
import { createClient } from "@/lib/supabase/server";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";
import { ListaDoPainelView } from "./lista-do-painel";
import { Filtros } from "./filtros-do-painel";

export const metadata: Metadata = { title: "Assinaturas digitais" };
export const dynamic = "force-dynamic";

/**
 * O PAINEL DAS ASSINATURAS (ZS7, plano ZS0 §9 e §10). Os números do período e,
 * a pedido do dono, a LISTA de cada número (assinados, faltam assinar,
 * recusados, vencidos, cancelados) com o link para o pacote e para a
 * negociação de origem. A conta é `calcularIndicadores` (a mesma do
 * relatório e do e-mail mensal) sobre a leitura `signature_report_rows`, que
 * respeita a RLS: a unidade vê as suas, quem tem o painel da rede vê todas, o
 * RisLife só as empresas dele.
 */
export default async function AssinaturasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSessionContext();
  if (!canViewSignatures(session)) redirect("/");
  const sp = await searchParams;
  const alcance = alcanceDoPainel(session);
  const hoje = todayInBrazil();

  const cabecalho = (
    <CabecalhoDeModulo
      chapeu="Assinaturas digitais"
      icone={FileSignature}
      titulo="Assinaturas"
      descricao="Contratos, TCLE, orçamentos aprovados, autorizações de imagem e contratos de adesão assinados pelo celular, com validade jurídica (ZapSign)."
    >
      <Button render={<Link href="/assinaturas/pacotes" />} nativeButton={false} variant="secondary" size="sm">
        <FileStack className="size-4" />
        Pacotes
      </Button>
      <Button render={<Link href="/assinaturas/minhas" />} nativeButton={false} variant="secondary" size="sm">
        <PenLine className="size-4" />
        Minhas pendentes
      </Button>
      {alcance && (
        <Button render={<Link href={`/assinaturas/relatorios${sp.periodo ? `?periodo=${sp.periodo}` : ""}`} />} nativeButton={false} variant="secondary" size="sm">
          <BarChart3 className="size-4" />
          Relatórios
        </Button>
      )}
      {canConfigureSignatures(session) && (
        <Button render={<Link href="/assinaturas/configuracoes" />} nativeButton={false} variant="secondary" size="sm">
          <Settings className="size-4" />
          Configurações
        </Button>
      )}
    </CabecalhoDeModulo>
  );

  if (!alcance) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
        {cabecalho}
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          O painel com os números aparece para quem tem a permissão <b>Painel da unidade</b> ou <b>Painel da rede</b> (Administração →
          Permissões). Os pacotes e as suas assinaturas pendentes estão nos botões acima.
        </p>
      </div>
    );
  }

  const f = lerFiltros(sp, hoje);
  const supabase = await createClient();
  const leitura = await lerLinhasDoPainel(supabase, f);
  const linhas = leitura.ok ? leitura.linhas : [];
  const opcoes = await lerOpcoes(supabase, session, alcance, linhas);
  const ind = calcularIndicadores(linhas, f.periodo, { hoje, faixas: opcoes.faixas });
  const lista = f.lista ? linhasDaLista(linhas, f.lista, f.periodo, { hoje, faixas: opcoes.faixas, faixa: f.faixa }) : [];
  const url = (t: Partial<Record<string, string | null>>) => urlDoPainel("/assinaturas", f, t);
  const maiorSemana = Math.max(1, ...ind.serie.map((s) => Math.max(s.enviados, s.assinados)));
  const maiorFaixa = Math.max(1, ...ind.faixas.map((x) => x.quantos));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      {cabecalho}

      <Filtros f={f} opcoes={opcoes} alcance={alcance} />

      <p className="text-sm text-muted-foreground">
        {formatIsoDateBr(f.periodo.de)} a {formatIsoDateBr(f.periodo.ate)} · {alcance === "rede" ? (f.clinicId ? "uma unidade" : "toda a rede") : "as suas unidades"}
      </p>

      {!leitura.ok && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{leitura.erro}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Cartao rotulo="Enviados" valor={ind.enviados} href={url({ lista: "enviados", faixa: null })} ativo={f.lista === "enviados"} />
        <Cartao
          rotulo="Assinados"
          valor={ind.assinados}
          detalhe={ind.taxaPercent == null ? undefined : `${ind.taxaPercent.toLocaleString("pt-BR")}% dos enviados`}
          href={url({ lista: "assinados", faixa: null })}
          ativo={f.lista === "assinados"}
          tom="verde"
        />
        <Cartao
          rotulo="Faltam assinar"
          valor={ind.faltam}
          detalhe={`${ind.faltamCliente} no cliente · ${ind.faltamEquipe} na equipe`}
          href={url({ lista: "faltam", faixa: null })}
          ativo={f.lista === "faltam"}
          tom="ambar"
        />
        <Cartao rotulo="Recusados" valor={ind.recusados} href={url({ lista: "recusados", faixa: null })} ativo={f.lista === "recusados"} tom="vermelho" />
        <Cartao rotulo="Vencidos" valor={ind.vencidos} href={url({ lista: "vencidos", faixa: null })} ativo={f.lista === "vencidos"} />
        <Cartao rotulo="Cancelados" valor={ind.cancelados} href={url({ lista: "cancelados", faixa: null })} ativo={f.lista === "cancelados"} />
      </div>

      {f.lista && (
        <ListaDoPainelView
          lista={f.lista}
          linhas={lista}
          hoje={hoje}
          titulo={f.lista === "faltam" && f.faixa != null ? `Faltam assinar — esperando ${ind.faixas[f.faixa]?.rotulo ?? ""}` : undefined}
          fechar={url({ lista: null, faixa: null })}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Info
          rotulo="Tempo de resposta do cliente"
          valor={textoDoTempo(ind.tempoCliente.medianaHoras)}
          detalhe={ind.tempoCliente.quantos ? `mediana · média ${textoDoTempo(ind.tempoCliente.mediaHoras)} · ${ind.tempoCliente.quantos} cliente(s)` : "nenhum cliente assinou no período"}
        />
        <Info
          rotulo="Tempo total até concluir"
          valor={textoDoTempo(ind.tempoTotal.medianaHoras)}
          detalhe={ind.tempoTotal.quantos ? `mediana · média ${textoDoTempo(ind.tempoTotal.mediaHoras)}` : "nenhum pacote concluído no período"}
        />
        <Info
          rotulo={`Plano da ZapSign (${hoje.slice(5, 7)}/${hoje.slice(0, 4)})`}
          valor={opcoes.limiteDoPlano ? `${opcoes.usadosNoMes ?? SEM_CONTAGEM} de ${opcoes.limiteDoPlano}` : String(opcoes.usadosNoMes ?? SEM_CONTAGEM)}
          detalhe={opcoes.usadosNoMes === null ? NAO_FOI_POSSIVEL_CONTAR : opcoes.limiteDoPlano ? "documentos usados no mês" : "documentos no mês · sem limite cadastrado"}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border p-4">
          <p className="text-sm font-medium">Faltam assinar, por tempo de espera</p>
          <p className="mb-3 text-xs text-muted-foreground">Clique numa faixa para ver os pacotes.</p>
          <ul className="space-y-2">
            {ind.faixas.map((x, i) => (
              <li key={x.rotulo}>
                <Link href={url({ lista: "faltam", faixa: String(i) })} className="flex items-center gap-2 text-sm hover:underline">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{x.rotulo}</span>
                  <span className="h-3 rounded bg-amber-400/80" style={{ width: `${(x.quantos / maiorFaixa) * 70}%`, minWidth: x.quantos ? 6 : 0 }} />
                  <span className="text-xs font-medium">{x.quantos}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border p-4">
          <p className="text-sm font-medium">Enviados × assinados por {ind.seriePorMes ? "mês" : "semana"}</p>
          <p className="mb-3 flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-sky-500" /> enviados
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-500" /> assinados
            </span>
          </p>
          <ul className="space-y-1.5">
            {ind.serie.map((s) => (
              <li key={s.inicio} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{ind.seriePorMes ? `${s.inicio.slice(5, 7)}/${s.inicio.slice(2, 4)}` : `${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)}`}</span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="h-2 rounded bg-sky-500" style={{ width: `${(s.enviados / maiorSemana) * 100}%`, minWidth: s.enviados ? 4 : 0 }} />
                  <span className="h-2 rounded bg-emerald-500" style={{ width: `${(s.assinados / maiorSemana) * 100}%`, minWidth: s.assinados ? 4 : 0 }} />
                </span>
                <span className="w-12 text-right">
                  {s.enviados}/{s.assinados}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {ind.motivosCancelamento.length > 0 && (
        <section className="rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">Motivos de cancelamento</p>
          <ul className="space-y-1 text-sm">
            {ind.motivosCancelamento.map((m) => (
              <li key={m.motivo} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{m.motivo}</span>
                <span className="font-medium">{m.quantos}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {alcance === "rede" && !f.clinicId && ind.porUnidade.length > 1 && (
        <section className="overflow-x-auto rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">Por unidade</p>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Unidade</th>
                <th className="py-1 text-right font-medium">Enviados</th>
                <th className="py-1 text-right font-medium">Assinados</th>
                <th className="py-1 text-right font-medium">Faltam</th>
                <th className="py-1 text-right font-medium">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {ind.porUnidade.map((u) => (
                <tr key={u.clinicId} className="border-t">
                  <td className="py-1.5">
                    <Link href={url({ unidade: u.clinicId })} className="hover:underline">
                      {u.nome}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right">{u.enviados}</td>
                  <td className="py-1.5 text-right">{u.assinados}</td>
                  <td className="py-1.5 text-right">{u.faltam}</td>
                  <td className="py-1.5 text-right">{u.taxaPercent == null ? "—" : `${u.taxaPercent.toLocaleString("pt-BR")}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

const TONS = {
  neutro: "",
  verde: "text-emerald-700 dark:text-emerald-300",
  ambar: "text-amber-700 dark:text-amber-300",
  vermelho: "text-destructive",
} as const;

function Cartao({
  rotulo,
  valor,
  detalhe,
  href,
  ativo,
  tom = "neutro",
}: {
  rotulo: string;
  valor: number;
  detalhe?: string;
  href: string;
  ativo: boolean;
  tom?: keyof typeof TONS;
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-3 transition-colors hover:bg-muted/50 ${ativo ? "border-primary ring-1 ring-primary" : ""}`}
      aria-current={ativo ? "true" : undefined}
    >
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-2xl font-semibold ${TONS[tom]}`}>{valor}</p>
      {detalhe && <p className="text-[11px] leading-tight text-muted-foreground">{detalhe}</p>}
      <p className="mt-1 text-[11px] text-primary">{ativo ? "lista aberta abaixo" : "ver a lista"}</p>
    </Link>
  );
}

function Info({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-semibold">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{detalhe}</p>
    </div>
  );
}

