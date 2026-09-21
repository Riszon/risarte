import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBrDateTime } from "@/lib/dates";
import {
  GRAVIDADE_ROTULO,
  MODULO_ROTULO,
  TIPO_ROTULO,
  relogioDoRelato,
  rotuloDeDuracao,
} from "@/lib/system-reports";
import {
  carregarAnexos,
  carregarConversa,
  carregarRelatos,
  instanteDoPedido,
  reporterDoRelato,
} from "../dados";
import { GaleriaDeAnexos } from "../anexos";
import { CorDaIdade, SeloDeSituacao } from "../selos";
import { Conversa } from "./conversa";
import { carregarRelatoDoTreinoPorCodigo } from "@/lib/relatos-do-treino";
import { carregarEnderecos } from "@/lib/ambientes-db";

export async function generateMetadata(
  props: PageProps<"/problemas/[codigo]">
): Promise<Metadata> {
  const { codigo } = await props.params;
  return { title: `${decodeURIComponent(codigo).toUpperCase()} · Problemas` };
}

/**
 * UM RELATO E A CONVERSA DELE (0256).
 *
 * O endereço é o CÓDIGO (`/problemas/OC-00009`), não o id: é o código que as
 * pessoas falam, escrevem no WhatsApp e colam na resposta ao relator. Um link
 * que se entende lendo é um link que se encontra depois.
 *
 * A guarda de quem vê é a RLS da 0247 — relato de outra unidade simplesmente
 * não volta da consulta, e a tela responde "não encontrado", sem dizer se ele
 * existe.
 */
export default async function RelatoPage(props: PageProps<"/problemas/[codigo]">) {
  const session = await getSessionContext();
  // QUEM ESTÁ SÓ NO INÍCIO TAMBÉM RELATA (20/09/2026): no modo portal a pessoa
  // não tem função nenhuma, então a matriz de permissões diria não — e quem
  // está treinando é justamente quem mais precisa avisar que algo deu errado.
  const soInicio = !session.ambientes.sistema;
  if (!soInicio && !pode(session, "menu.sistema")) redirect("/");

  const { codigo } = await props.params;
  const code = decodeURIComponent(codigo).trim().toUpperCase();
  // Só o formato do código entra na consulta: qualquer outra coisa é 404
  // direto, sem ir ao banco.
  if (!/^OC-\d{1,10}$/.test(code)) notFound();

  const supabase = await createClient();
  const { relatos, nivel } = await carregarRelatos(supabase, session.userId, { code });
  let relato = relatos[0];

  // NÃO ACHOU AQUI? PODE SER DO TREINO (19/09/2026, decisão do dono): a mesma
  // tela abre o relato que vive no banco de lá. Quem consolida é sempre a
  // produção — o treino não alcança este banco.
  let conversa, anexos, reporterId: string | null;
  if (relato) {
    reporterId = await reporterDoRelato(supabase, relato.id);
    [conversa, anexos] = await Promise.all([
      carregarConversa(supabase, relato, reporterId),
      carregarAnexos(supabase, relato, {
        userId: session.userId,
        isAdminMaster: session.isAdminMaster,
        reporterId,
      }),
    ]);
  } else {
    const enderecos = await carregarEnderecos(supabase);
    const doTreino = await carregarRelatoDoTreinoPorCodigo({
      code,
      prodUserId: session.userId,
      isAdminMaster: session.isAdminMaster,
      endereco: enderecos.treino ?? null,
    });
    if (!doTreino) notFound();
    relato = doTreino.relato;
    conversa = doTreino.conversa;
    anexos = doTreino.anexos;
    reporterId = doTreino.reporterId;
  }
  const agora = instanteDoPedido();
  const relogio = relogioDoRelato(relato, agora);
  const criado = Date.parse(relato.createdAt);

  const marcos: { rotulo: string; valor: string }[] = [
    { rotulo: "Aberto em", valor: formatBrDateTime(relato.createdAt) },
  ];
  if (relato.firstResponseAt) {
    marcos.push({
      rotulo: "1ª resposta",
      valor: `${formatBrDateTime(relato.firstResponseAt)} · ${rotuloDeDuracao(
        Date.parse(relato.firstResponseAt) - criado
      )} depois`,
    });
  }
  if (relato.closedAt) {
    marcos.push({
      rotulo: "Encerrado em",
      valor: `${formatBrDateTime(relato.closedAt)} · ${rotuloDeDuracao(
        Date.parse(relato.closedAt) - criado
      )} depois`,
    });
  }
  if (relato.resolvedVersion) {
    // Reaberto, a versão gravada foi uma TENTATIVA que não funcionou. O dado
    // fica (é a pista de onde procurar); o que muda é o que a tela afirma.
    marcos.push({
      rotulo:
        relato.status === "resolvido"
          ? "Corrigido na versão"
          : "Correção tentada na versão",
      valor: relato.resolvedVersion,
    });
  }

  const dados: { rotulo: string; valor: string | null }[] = [
    { rotulo: "Tipo", valor: TIPO_ROTULO[relato.kind] },
    {
      rotulo: "Parte do sistema",
      valor: relato.module ? MODULO_ROTULO[relato.module] : "Não informada",
    },
    { rotulo: "Quanto atrapalha", valor: GRAVIDADE_ROTULO[relato.severity] },
    { rotulo: "Unidade", valor: relato.clinicName },
    {
      rotulo: "Quem relatou",
      valor: relato.reporterRole
        ? `${relato.reporterName} (${relato.reporterRole})`
        : relato.reporterName,
    },
    { rotulo: "Tela", valor: relato.screen },
    { rotulo: "Versão", valor: relato.appVersion },
    { rotulo: "Código do erro", valor: relato.errorDigest },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <Link
        href="/problemas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Problemas
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{relato.code}</span>
          <SeloDeSituacao situacao={relato.status} />
          {relato.reopenedCount > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              Reaberto {relato.reopenedCount}×
            </span>
          )}
          <span className="text-xs">
            <CorDaIdade faixa={relogio.faixa}>{relogio.principal}</CorDaIdade>
          </span>
          {relogio.secundario && (
            <span className="text-xs text-muted-foreground">{relogio.secundario}</span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-balance">{relato.title}</h1>
      </header>

      <section className="rounded-lg border">
        <dl className="grid gap-x-6 gap-y-2 border-b px-4 py-3 text-sm sm:grid-cols-2">
          {dados
            .filter((d) => d.valor)
            .map((d) => (
              <div key={d.rotulo} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{d.rotulo}:</dt>
                <dd className="min-w-0 break-words">{d.valor}</dd>
              </div>
            ))}
        </dl>
        <div className="space-y-3 px-4 py-3 text-sm">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              O que aconteceu
            </p>
            <p className="mt-1 whitespace-pre-wrap">{relato.whatHappened}</p>
          </div>
          {relato.expected && (
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                O que esperava
              </p>
              <p className="mt-1 whitespace-pre-wrap">{relato.expected}</p>
            </div>
          )}
          {anexos.doRelato.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Anexos
              </p>
              <GaleriaDeAnexos anexos={anexos.doRelato} />
            </div>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t bg-muted/30 px-4 py-2 text-xs">
          {marcos.map((m) => (
            <div key={m.rotulo} className="flex gap-1.5">
              <dt className="text-muted-foreground">{m.rotulo}:</dt>
              <dd className="tabular-nums">{m.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Conversa
        relato={relato}
        mensagens={conversa}
        isAdminMaster={session.isAdminMaster}
        conversaLigada={nivel === "completo"}
        anexosLigados={anexos.ligados}
        anexosPorMensagem={anexos.porMensagem}
      />
    </div>
  );
}
