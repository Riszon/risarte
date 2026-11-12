"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, MessageCircle, MessagesSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime } from "@/lib/dates";
import { whatsappLink } from "@/lib/whatsapp";
import { CONTEST_LABEL, type ReportItem } from "@/lib/finance/payout-report";
import {
  CHANNELS,
  CHANNEL_LABEL,
  PARTY_LABEL,
  linkDeLigacao,
  mediationError,
  mensagemDaDivergencia,
  roteiro,
  type MediationChannel,
  type MediationContact,
  type MediationOutcome,
  type MediationParty,
  type MediationPerson,
} from "@/lib/finance/payout-divergencia";
import { openDirectChannel } from "@/app/(app)/chat/actions";
import { recordMediation } from "../actions";
import type { HistoryRow } from "./report-detail";

/**
 * 0402 — O ROTEIRO DA DIVERGÊNCIA (pedido do dono, 12/11/2026).
 *
 * Quando um procedimento chega ao Financeiro (o dentista contestou 2× ou o
 * aprovador pediu), antes de decidir: 1) entender, 2) falar com a unidade,
 * 3) falar com o dentista. Os passos 4 (decidir) e 5 (orientar) ficam no
 * formulário de decisão, que só se libera com os dois registros — e o banco
 * confere de novo (MEDIATION_REQUIRED).
 */
export function RoteiroDaDivergencia({
  reportId,
  reportCode,
  item,
  people,
  contacts,
  history,
}: {
  reportId: string;
  reportCode: string;
  item: ReportItem;
  people: MediationPerson[];
  contacts: MediationContact[];
  /** A linha do tempo do relatório (filtrada aqui pelo procedimento). */
  history: HistoryRow[];
}) {
  const r = roteiro(contacts, item.itemId);
  const unidade = people.filter((p) => p.party === "unidade");
  const dentista = people.filter((p) => p.party === "dentista");
  const conversa = history
    .filter(
      (h) =>
        h.procedureName === item.procedureName &&
        [
          "contestado",
          "contestado_de_novo",
          "resposta_mantem",
          "pedido_ao_financeiro",
          "financeiro_propos_valor",
          "unidade_ciente_valor",
          "dentista_recusou_valor",
        ].includes(h.action)
    )
    .reverse();

  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/20">
      <div>
        <p className="font-medium">Roteiro da divergência</p>
        <p className="text-xs text-muted-foreground">
          Antes de decidir, entenda o caso e converse com a unidade e com o
          dentista. A decisão só se libera com as duas conversas registradas
          {item.finalRound
            ? ". Esta é a rodada final: o dentista não aceitou o valor proposto, e a sua decisão agora vale direto."
            : "."}
        </p>
      </div>

      {/* 1) ENTENDER */}
      <Passo feito numero={1} titulo="Entender o que aconteceu">
        <ul className="space-y-1 text-xs">
          {conversa.length === 0 && item.contestText && (
            <li>
              <strong>Dentista:</strong>{" "}
              {item.contestKind ? `${CONTEST_LABEL[item.contestKind]} — ` : ""}
              {item.contestText}
            </li>
          )}
          {conversa.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <span className="text-muted-foreground">{formatBrDateTime(h.at)} · </span>
              <strong>{rotuloCurto(h.action)}</strong>
              {h.actorName ? ` (${h.actorName})` : ""}: {h.note ?? "—"}
            </li>
          ))}
          {item.dentistValueReply && (
            <li>
              <strong>Por que o dentista não aceitou o valor:</strong> {item.dentistValueReply}
            </li>
          )}
          <li className="text-muted-foreground">
            Valor de hoje: <strong>{formatBRL(item.amountCents)}</strong>
            {item.proposedAmountCents !== null &&
              ` · proposto antes: ${formatBRL(item.proposedAmountCents)}`}
            {item.prevReportCode && ` · veio adiado do ${item.prevReportCode}`}
          </li>
        </ul>
      </Passo>

      {/* 2) A UNIDADE */}
      <Passo
        feito={r.unidade !== null}
        numero={2}
        titulo="Conversar com a unidade"
        ajuda="Quem aprova a equipe: entenda o lado da unidade e combine o que vai ser feito."
      >
        <Contatos
          pessoas={unidade}
          party="unidade"
          reportCode={reportCode}
          item={item}
          vazio="A unidade não tem Gerente nem Coordenador para aprovar. Registre como sem contato e explique."
        />
        <Registro
          reportId={reportId}
          itemId={item.itemId}
          party="unidade"
          pessoas={unidade}
          feito={r.unidade}
        />
      </Passo>

      {/* 3) O DENTISTA */}
      <Passo
        feito={r.dentista !== null}
        numero={3}
        titulo="Conversar com o dentista"
        ajuda="Ouça o dentista, explique o que a unidade disse e oriente sobre a divergência."
      >
        <Contatos pessoas={dentista} party="dentista" reportCode={reportCode} item={item} vazio="" />
        <Registro
          reportId={reportId}
          itemId={item.itemId}
          party="dentista"
          pessoas={dentista}
          feito={r.dentista}
        />
      </Passo>

      {r.anteriores.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Conversas de antes ({r.anteriores.length}) — não contam para esta decisão
          </summary>
          <ul className="mt-1 space-y-1">
            {r.anteriores.map((c, i) => (
              <li key={`${c.createdAt}-${i}`}>{textoDoRegistro(c)}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        <strong>4 e 5 — Decidir e orientar:</strong>{" "}
        {r.podeDecidir
          ? "use o formulário abaixo. A orientação vai junto para a unidade e o dentista."
          : "liberado depois das duas conversas registradas."}
      </p>
    </div>
  );
}

function rotuloCurto(action: string): string {
  switch (action) {
    case "contestado":
      return "Dentista contestou";
    case "contestado_de_novo":
      return "Dentista contestou de novo";
    case "resposta_mantem":
      return "Unidade respondeu";
    case "pedido_ao_financeiro":
      return "Unidade pediu a decisão do Financeiro";
    case "financeiro_propos_valor":
      return "Financeiro propôs outro valor";
    case "unidade_ciente_valor":
      return "Unidade ciente do valor";
    case "dentista_recusou_valor":
      return "Dentista não aceitou o valor";
    default:
      return action;
  }
}

function textoDoRegistro(c: MediationContact): string {
  const como =
    c.outcome === "sem_contato"
      ? "sem contato"
      : `${c.channel ? CHANNEL_LABEL[c.channel] : "conversa"}${c.contactName ? ` com ${c.contactName}` : ""}`;
  return `${formatBrDateTime(c.createdAt)} · ${como} · ${c.summary}${c.createdByName ? ` (${c.createdByName})` : ""}`;
}

function Passo({
  numero,
  titulo,
  ajuda,
  feito,
  children,
}: {
  numero: number;
  titulo: string;
  ajuda?: string;
  feito: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border bg-background p-2">
      <p className="flex items-center gap-1.5 font-medium">
        {feito ? (
          <CheckCircle2 className="size-4 text-emerald-600" aria-label="feito" />
        ) : (
          <Circle className="size-4 text-muted-foreground" aria-label="a fazer" />
        )}
        {numero}. {titulo}
      </p>
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
      {children}
    </div>
  );
}

/** Os botões para falar rápido: WhatsApp com mensagem pronta, ligar, Chat. */
function Contatos({
  pessoas,
  party,
  reportCode,
  item,
  vazio,
}: {
  pessoas: MediationPerson[];
  party: MediationParty;
  reportCode: string;
  item: ReportItem;
  vazio: string;
}) {
  const router = useRouter();
  const [abrindo, startTransition] = useTransition();
  if (pessoas.length === 0) {
    return vazio ? <p className="text-xs text-muted-foreground">{vazio}</p> : null;
  }
  const mensagem = mensagemDaDivergencia({
    party,
    reportCode,
    procedureName: item.procedureName,
    amountCents: item.amountCents,
  });

  function abrirChat(userId: string) {
    startTransition(async () => {
      const r = await openDirectChannel(userId);
      if (!r.ok || !r.channelId) return void toast.error(r.error ?? "Não foi possível abrir o Chat.");
      router.push(`/chat?canal=${r.channelId}`);
    });
  }

  return (
    <ul className="space-y-1.5">
      {pessoas.map((p) => {
        const whats = whatsappLink(p.phone, mensagem, p.fullName);
        const tel = linkDeLigacao(p.phone);
        return (
          <li key={p.userId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-xs">
              <strong>{p.fullName}</strong> · {p.roleLabel}
              {!p.phone && (
                <span className="block text-[11px] text-muted-foreground">
                  Sem telefone na ficha do Risartano: use o Chat.
                </span>
              )}
            </span>
            {whats && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                nativeButton={false}
                render={<a href={whats} target="_blank" rel="noopener noreferrer" />}
              >
                <MessageCircle className="mr-1 size-3.5" />
                WhatsApp
              </Button>
            )}
            {tel && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                nativeButton={false}
                render={<a href={tel} />}
              >
                <Phone className="mr-1 size-3.5" />
                Ligar
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={abrindo}
              onClick={() => abrirChat(p.userId)}
            >
              <MessagesSquare className="mr-1 size-3.5" />
              Chat
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Registrar a conversa (ou que não conseguiu contato). */
function Registro({
  reportId,
  itemId,
  party,
  pessoas,
  feito,
}: {
  reportId: string;
  itemId: string;
  party: MediationParty;
  pessoas: MediationPerson[];
  feito: MediationContact | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [outcome, setOutcome] = useState<MediationOutcome>("conversou");
  const [channel, setChannel] = useState<MediationChannel | null>(null);
  const [contato, setContato] = useState<string | null>(pessoas[0]?.userId ?? null);
  const [summary, setSummary] = useState("");

  function salvar() {
    const erro = mediationError({ outcome, channel, summary });
    if (erro) return void toast.error(erro);
    startTransition(async () => {
      const r = await recordMediation({
        reportId,
        itemId,
        party,
        outcome,
        channel: outcome === "conversou" ? channel : null,
        contactUserId: contato,
        summary,
      });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success("Conversa registrada.");
        setAberto(false);
        setSummary("");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {feito && (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          Registrado: {textoDoRegistro(feito)}
        </p>
      )}
      {!aberto ? (
        <Button size="sm" variant={feito ? "ghost" : "default"} className="h-7 text-xs" onClick={() => setAberto(true)}>
          {feito ? "Registrar outra conversa" : `Registrar a conversa com ${PARTY_LABEL[party]}`}
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <div className="flex flex-wrap gap-4 text-xs">
            {(
              [
                ["conversou", "Conversei"],
                ["sem_contato", "Não consegui contato"],
              ] as [MediationOutcome, string][]
            ).map(([o, t]) => (
              <label key={o} className="flex items-center gap-1">
                <input
                  type="radio"
                  name={`res-${party}-${itemId}`}
                  checked={outcome === o}
                  onChange={() => setOutcome(o)}
                />
                {t}
              </label>
            ))}
          </div>
          {pessoas.length > 1 && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-muted-foreground">Com quem:</span>
              {pessoas.map((p) => (
                <label key={p.userId} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`com-${party}-${itemId}`}
                    checked={contato === p.userId}
                    onChange={() => setContato(p.userId)}
                  />
                  {p.fullName}
                </label>
              ))}
            </div>
          )}
          {outcome === "conversou" && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-muted-foreground">Por onde:</span>
              {CHANNELS.map((ch) => (
                <label key={ch} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`canal-${party}-${itemId}`}
                    checked={channel === ch}
                    onChange={() => setChannel(ch)}
                  />
                  {CHANNEL_LABEL[ch]}
                </label>
              ))}
            </div>
          )}
          <label className="block">
            <Label className="text-[11px]">
              {outcome === "conversou"
                ? "O que foi conversado e combinado (obrigatório)"
                : "O que você tentou (obrigatório)"}
            </Label>
            <Input className="h-8" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={isPending} onClick={salvar}>
              Registrar
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAberto(false)}>
              Desistir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
