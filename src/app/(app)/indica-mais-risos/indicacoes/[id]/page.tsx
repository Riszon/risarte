import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { ehGestorIndica } from "@/lib/indica/access";
import { SALDO_LABEL, TIPO_LANCAMENTO_LABEL } from "@/lib/indica/rotulos";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { CANAL_LABEL, INDICACAO_STATUS_LABEL, type Canal, type IndicacaoStatus } from "@/lib/indica/status";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from "@/lib/appointments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "../../status-badge";
import { AcoesIndicacao } from "../../acoes-indicacao";
import { RegistrarAceite } from "./aceite";
import { nomesDePessoas } from "../../dados";

export const metadata: Metadata = { title: "Indicação — Indica +Risos" };

type Indicacao = {
  id: string;
  codigo: string;
  status: IndicacaoStatus;
  unidade_id: string;
  canal: Canal;
  embaixador_id: string | null;
  embaixador_rotulo: string | null;
  parceiro_nome: string | null;
  indicado_nome: string;
  indicado_telefone: string | null;
  cliente_indicado_id: string | null;
  risartano_origem_id: string | null;
  risartano_conversao_id: string | null;
  agendamento_id: string | null;
  venda_id: string | null;
  valor_fechado_centavos: number | null;
  trava_ate: string;
  trava_vencida: boolean;
  registrada_em: string;
  validada_em: string | null;
  agendada_em: string | null;
  compareceu_em: string | null;
  fechou_em: string | null;
  convertida_em: string | null;
  encerrada_em: string | null;
};

type Evento = {
  id: number;
  status_de: IndicacaoStatus | null;
  status_para: IndicacaoStatus;
  motivo: string | null;
  usuario_id: string | null;
  criado_em: string;
};

type Lancamento = {
  id: number;
  tipo: string;
  saldo: "disponivel" | "pendente" | "carencia";
  riso_coins: number;
  libera_em: string | null;
  expira_em: string | null;
  criado_em: string;
};

const TIPO_LANCAMENTO = TIPO_LANCAMENTO_LABEL;
const SALDO = SALDO_LABEL;

export default async function IndicacaoPage(props: PageProps<"/indica-mais-risos/indicacoes/[id]">) {
  const session = await getSessionContext();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = await indicaDb();
  const { data: ind } = await db
    .from("v_indicacoes")
    .select(
      "id, codigo, status, unidade_id, canal, embaixador_id, embaixador_rotulo, parceiro_nome, indicado_nome, indicado_telefone, cliente_indicado_id, risartano_origem_id, risartano_conversao_id, agendamento_id, venda_id, valor_fechado_centavos, trava_ate, trava_vencida, registrada_em, validada_em, agendada_em, compareceu_em, fechou_em, convertida_em, encerrada_em"
    )
    .eq("id", id)
    .maybeSingle<Indicacao>();
  // Não existe OU a RLS não deixa ver: a mesma resposta (não revelar qual).
  if (!ind) notFound();

  // Trilha LGPD: a indicação tem nome e telefone de um terceiro.
  await logAudit({
    action: "view",
    entityType: "indica_indicacao",
    entityId: ind.id,
    clinicId: ind.unidade_id,
  });

  const supabase = await createClient();
  const [
    { data: eventos },
    { data: lancamentos },
    { data: agendamento },
    { data: unidade },
    { data: lgpd },
    { data: aceite },
  ] = await Promise.all([
      db
        .from("indicacao_eventos")
        .select("id, status_de, status_para, motivo, usuario_id, criado_em")
        .eq("indicacao_id", id)
        .order("criado_em", { ascending: false })
        .returns<Evento[]>(),
      db
        .from("pontos_lancamentos")
        .select("id, tipo, saldo, riso_coins, libera_em, expira_em, criado_em")
        .eq("indicacao_id", id)
        .order("id")
        .returns<Lancamento[]>(),
      ind.agendamento_id
        ? supabase
            .from("appointments")
            .select("starts_at, status, checked_in_at")
            .eq("id", ind.agendamento_id)
            .maybeSingle<{ starts_at: string; status: string; checked_in_at: string | null }>()
        : Promise.resolve({ data: null }),
      supabase.from("clinics").select("name").eq("id", ind.unidade_id).maybeSingle<{ name: string }>(),
      db.from("indicacoes")
        .select("consentimento_id, convite_expira_em, anonimizada_em")
        .eq("id", id)
        .maybeSingle<{ consentimento_id: string | null; convite_expira_em: string | null; anonimizada_em: string | null }>(),
      db.from("consentimentos")
        .select("canal, aceito_em")
        .eq("indicacao_id", id)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle<{ canal: string; aceito_em: string | null }>(),
    ]);
  const CANAL_ACEITE: Record<string, string> = {
    presencial: "pessoalmente",
    telefone: "por telefone",
    link: "pelo link do convite",
    whatsapp: "pelo WhatsApp",
    portal: "pelo portal",
  };

  const pessoas = await nomesDePessoas([
    ind.risartano_origem_id,
    ind.risartano_conversao_id,
    ...(eventos ?? []).map((e) => e.usuario_id),
  ]);

  const totais = { disponivel: 0, pendente: 0, carencia: 0 };
  for (const l of lancamentos ?? []) totais[l.saldo] += l.riso_coins;

  const podeCancelar = ehGestorIndica(session, ind.unidade_id);

  const etapas: [string, string | null][] = [
    ["Registrada", ind.registrada_em],
    ["Validada", ind.validada_em],
    ["Agendada", ind.agendada_em],
    ["Compareceu", ind.compareceu_em],
    ["Fechou", ind.fechou_em],
    ["Convertida", ind.convertida_em],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/indica-mais-risos/indicacoes" />}
      >
        <ArrowLeft className="mr-1 size-4" /> Indicações
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{ind.indicado_nome}</h1>
            <StatusBadge status={ind.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{ind.codigo}</span> · {unidade?.name ?? ""} ·{" "}
            {CANAL_LABEL[ind.canal] ?? ind.canal}
          </p>
        </div>
        <AcoesIndicacao
          podeCancelar={podeCancelar}
          indicacao={{
            id: ind.id,
            codigo: ind.codigo,
            status: ind.status,
            clienteIndicadoId: ind.cliente_indicado_id,
            indicadoNome: ind.indicado_nome,
          }}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Indicado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{ind.indicado_nome}</p>
            {ind.indicado_telefone && <p className="text-muted-foreground">{ind.indicado_telefone}</p>}
            <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
              {lgpd?.anonimizada_em ? (
                <span className="text-muted-foreground">Dados do indicado anonimizados (LGPD).</span>
              ) : aceite?.aceito_em ? (
                <span className="text-emerald-700 dark:text-emerald-300">
                  Aceitou o contato {CANAL_ACEITE[aceite.canal] ?? aceite.canal} em {formatBrDate(aceite.aceito_em)}.
                </span>
              ) : ind.cliente_indicado_id ? (
                <span className="text-muted-foreground">Contato coberto pelo cadastro do cliente.</span>
              ) : (
                <div className="space-y-1.5">
                  <span className="text-amber-700 dark:text-amber-300">
                    Aguardando o aceite do contato
                    {lgpd?.convite_expira_em ? ` (convite vale até ${formatBrDate(lgpd.convite_expira_em)} — está na fila de mensagens)` : ""}.
                  </span>
                  {!["recusada", "cancelada", "expirada"].includes(ind.status) && <RegistrarAceite indicacaoId={ind.id} />}
                </div>
              )}
            </div>
            {ind.cliente_indicado_id ? (
              <Link href={`/prontuarios/${ind.cliente_indicado_id}`} className="font-medium text-primary hover:underline">
                Abrir a ficha
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ainda sem cadastro ligado. Cadastre e agende a avaliação; depois use “Ligar à avaliação”.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quem indicou</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {ind.embaixador_id ? (
              <Link href={`/indica-mais-risos/embaixadores/${ind.embaixador_id}`} className="font-medium hover:underline">
                {ind.embaixador_rotulo ?? "—"}
              </Link>
            ) : (
              <p className="font-medium">{ind.parceiro_nome ?? "—"}</p>
            )}
            <p className="text-muted-foreground">
              Pedido por:{" "}
              {ind.risartano_origem_id ? (pessoas.get(ind.risartano_origem_id) ?? "—") : "—"}
            </p>
            {ind.risartano_conversao_id && (
              <p className="text-muted-foreground">
                Fechamento: {pessoas.get(ind.risartano_conversao_id) ?? "—"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Riso Coins desta indicação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="font-semibold">{totais.disponivel}</span> disponíveis
            </p>
            <p className="text-muted-foreground">
              {totais.pendente} pendentes · {totais.carencia} em carência
            </p>
            <p className={cn("text-xs", ind.trava_vencida ? "text-destructive" : "text-muted-foreground")}>
              Trava de atribuição até {formatBrDate(ind.trava_ate)}
              {ind.trava_vencida ? " — vencida" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Etapas</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1.5 text-sm">
              {etapas.map(([nome, quando]) => (
                <li key={nome} className="flex justify-between gap-2">
                  <span className={quando ? "" : "text-muted-foreground"}>{nome}</span>
                  <span className="text-muted-foreground">{quando ? formatBrDateTime(quando) : "—"}</span>
                </li>
              ))}
              {ind.encerrada_em && ind.status !== "convertida" && (
                <li className="flex justify-between gap-2">
                  <span>{INDICACAO_STATUS_LABEL[ind.status]}</span>
                  <span className="text-muted-foreground">{formatBrDateTime(ind.encerrada_em)}</span>
                </li>
              )}
            </ol>
            <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
              <p>
                Avaliação:{" "}
                {agendamento
                  ? `${formatBrDateTime(agendamento.starts_at)} · ${
                      APPOINTMENT_STATUS_LABELS[agendamento.status as AppointmentStatus] ?? agendamento.status
                    }${agendamento.checked_in_at ? " · chegou" : ""}`
                  : "não ligada"}
              </p>
              <p>
                Venda:{" "}
                {ind.venda_id && ind.valor_fechado_centavos !== null
                  ? formatBRL(ind.valor_fechado_centavos)
                  : "não ligada"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Extrato desta indicação</CardTitle>
          </CardHeader>
          <CardContent>
            {(lancamentos ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(lancamentos ?? []).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>
                      {TIPO_LANCAMENTO[l.tipo] ?? l.tipo}{" "}
                      <span className="text-xs text-muted-foreground">({SALDO[l.saldo]})</span>
                      {l.libera_em && (
                        <span className="text-xs text-muted-foreground"> · libera {formatBrDate(l.libera_em)}</span>
                      )}
                    </span>
                    <span className={cn("font-mono", l.riso_coins < 0 ? "text-destructive" : "")}>
                      {l.riso_coins > 0 ? "+" : ""}
                      {l.riso_coins}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {(eventos ?? []).map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                <div>
                  <p>
                    {e.status_de ? (
                      <>
                        {INDICACAO_STATUS_LABEL[e.status_de]} → <strong>{INDICACAO_STATUS_LABEL[e.status_para]}</strong>
                      </>
                    ) : (
                      <strong>{INDICACAO_STATUS_LABEL[e.status_para]}</strong>
                    )}
                  </p>
                  {e.motivo && <p className="text-muted-foreground">“{e.motivo}”</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatBrDateTime(e.criado_em)} ·{" "}
                    {e.usuario_id ? (pessoas.get(e.usuario_id) ?? "—") : "sistema"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
